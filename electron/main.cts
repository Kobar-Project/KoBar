import { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, clipboard, globalShortcut, shell, dialog, session, WebContents, desktopCapturer } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { exec, execFile, ChildProcess } from 'child_process';
import { LicenseManager } from './licenseManager.cjs';
import { autoUpdater } from 'electron-updater';
import AdmZip from 'adm-zip';

// ─── KoPlayer: Worker Thread Setup ────────────────────────────────
import { Worker } from 'worker_threads';
let smtcWorker: Worker | null = null;

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const isDev = !app.isPackaged;

if (isDev) {
    app.setName('KoBarDev');
    app.setPath('userData', path.join(app.getPath('appData'), 'KoBarDev'));
}

const systemConfigPath = path.join(app.getPath('userData'), 'kobar-system.json');

// GPU is MANDATORY for transparent windows in modern Electron.
// Any attempt to disable it results in an invisible (black) window.
function getSystemConfig() {
    return { hardwareAcceleration: true };
}

console.log("[SYS] Hardware Acceleration: FORCED ENABLED");

// SURGICAL FIX FOR VIDEO BLACKOUT & OCCLUSION
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,WindowOcclusion,HardwareMediaKeyHandling,MediaSessionService');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const windowStatePath = path.join(app.getPath('userData'), 'window-state.json');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let clipboardPollingInterval: ReturnType<typeof setInterval> | null = null;
let lastClipboardText = '';
let lastClipboardImageDataUrl = '';
let lastClipboardImageBmp: Buffer | null = null;
let currentEdge: string = 'left';
let psProcess: ChildProcess | null = null;
let isGlobalPasteModeActive = false;
let isAwaitingPinTarget = false;
let sidebarRect = { width: 80, height: 600, offsetX: 1660, offsetY: 20 };
let teleportShortcutKey = '';
let borderWindow: BrowserWindow | null = null;
let pipWindow: BrowserWindow | null = null;
let preEyeDropperBounds: { x: number; y: number; width: number; height: number; } | null = null;
let isEyeDropperActive = false;

let trackingInterval: NodeJS.Timeout | null = null;
let pinnedHwnd: number | null = null;
let allPinnedHwnds: Set<number> = new Set();

// KoPlayer Media Polling
let mediaPollingInterval: ReturnType<typeof setInterval> | null = null;
let lastMediaState = '';

// Video PiP — background URL scan debounce
const BROWSER_APP_IDS = ['chrome', 'msedge', 'brave', 'firefox', 'opera', 'vivaldi'];
let lastVideoScanAt = 0;
const VIDEO_SCAN_DEBOUNCE_MS = 5000;
let lastSmtcSourceAppId = '';
let lastSmtcAlbumArt: string | null = null;

// Set these flags for feature toggling (managed by kobar-build.js)
const IS_STORE_BUILD = true;
const ENABLE_AUTO_UPDATE = false;

// Set Application User Model ID to fix Windows Taskbar, Notifications, and Task Manager Startup icons
const AUMID = isDev ? 'com.eedali.kobar.dev' : 'com.eedali.kobar';
app.setAppUserModelId(AUMID);

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
            // Teleport to primary display center instead of just showing
            teleportToPrimaryCenter();
        }
    });
}

function createWindow() {
    let savedState: { x: number, y: number } | null = null;
    try {
        if (fs.existsSync(windowStatePath)) {
            savedState = JSON.parse(fs.readFileSync(windowStatePath, 'utf8'));
        }
    } catch (e) {
        console.error('Could not load window state', e);
    }

    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();

    // The visual 80px Sidebar is horizontally centered within the 3400px container.
    // 3400/2 = 1700. The bar is from 1660 to 1740.
    // To dock the bar on the right edge by default: windowX + 3040 = rightEdge
    const defaultX = primary.workArea.x + primary.workArea.width - 3040;
    const defaultY = primary.workArea.y;

    let x = savedState?.x ?? defaultX;
    let y = savedState?.y ?? defaultY;

    // Boundary check to ensure the invisible "ghost" 3400px window hasn't pushed the KoBar visual bar 
    // entirely off-screen on any resolution changes or active display disconnects.
    let isVisible = false;
    for (const display of displays) {
        const bounds = display.workArea;
        const barLeft = x + 2960;
        const barRight = barLeft + 80;
        const barTop = y + 20;

        // Ensure the 80px physical bar intersects the display
        if (barLeft < bounds.x + bounds.width && barRight > bounds.x) {
            // Ensure at least top 100px is visible so user can grab the Eye
            if (barTop < bounds.y + bounds.height && barTop > bounds.y - 100) {
                isVisible = true;
                break;
            }
        }
    }

    if (!isVisible) {
        // Saved position is off-screen — teleport to primary display after window creation
        const safePos = calculatePrimaryCenterPosition();
        x = safePos.x;
        y = safePos.y;
    }

    // Mac: use `bounds` (full screen incl. menu bar + Dock area) instead of `workArea`.
    // This prevents macOS from clipping the transparent window at the Dock boundary.
    const macScreen = isMac ? primary.bounds : primary.workArea;
    const winWidth = isWin ? 6000 : macScreen.width;
    const winHeight = isWin ? 4000 : macScreen.height;
    const winX = isWin ? x : macScreen.x;
    const winY = isWin ? y : macScreen.y;

    mainWindow = new BrowserWindow({
        x: winX,
        y: winY,
        width: winWidth,
        height: winHeight,
        minWidth: winWidth,
        minHeight: winHeight,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000', // Explicit transparent alpha channel to fix Windows DWM occlusion blurring
        alwaysOnTop: true,
        skipTaskbar: true,
        type: (isWin ? 'toolbar' : 'panel') as 'toolbar', // Win: toolbar (DWM throttle fix) | Mac: panel (NSPanel, floats above Dock)
        resizable: false,
        maximizable: false,
        enableLargerThanScreen: isWin,
        hasShadow: isMac ? false : true, // Mac: prevent native shadow being cast on invisible transparent divs (ghost stroke)
        icon: path.join(__dirname, '../build/icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.cjs')
        }
    });

    if (isWin) {
        mainWindow.setMinimumSize(6000, 4000);
        mainWindow.setMaximumSize(12000, 12000);
        mainWindow.setSize(6000, 4000);
    } else if (isMac) {
        mainWindow.setMinimumSize(winWidth, winHeight);
        mainWindow.setSize(winWidth, winHeight);
    }
    // Win: screen-saver (highest DWM level) | Mac: floating (above Dock, below TCC prompts)
    mainWindow.setAlwaysOnTop(true, isMac ? 'floating' : 'screen-saver', 1);
    if (isMac) {
        // Ensure KoBar stays above Dock, Mission Control overlays, and full-screen apps on macOS
        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        mainWindow.setAlwaysOnTop(true, 'floating', 1); // re-enforce after workspace registration
    }
    mainWindow.setIgnoreMouseEvents(true, { forward: true });

    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    // Edge detection — fires during drag for smooth real-time updates
    mainWindow.on('move', () => {
        if (isEyeDropperActive) return;
        handleWindowMove();
    });

    mainWindow.once('ready-to-show', () => {
        if (mainWindow) {
            const loginSettings = app.getLoginItemSettings();
            const isHidden = process.argv.includes('--hidden') || loginSettings.wasOpenedAtLogin;

            // Teleport to center on fresh boot and force Mini Mode (pass showWindow flag based on args)
            teleportToPrimaryCenter(!isHidden);

            if (!isHidden) {
                mainWindow.show(); mainWindow.webContents.openDevTools({ mode: 'detach' });
            }
            mainWindow.setAlwaysOnTop(true, isMac ? 'floating' : 'screen-saver', 1);
            if (isMac) {
                // Re-enforce workspace visibility after window is fully loaded
                mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
                mainWindow.setAlwaysOnTop(true, 'floating', 1);
            }
            handleWindowMove(true);

            // Dispatch forcing Mini Mode right after load
            mainWindow.webContents.send('force-center-mini-mode');
        }
    });

    let saveBoundsTimeout: ReturnType<typeof setTimeout>;
    mainWindow.on('move', () => {
        if (isEyeDropperActive) return;
        clearTimeout(saveBoundsTimeout);
        saveBoundsTimeout = setTimeout(async () => {
            if (!mainWindow) return;
            const [x, y] = mainWindow.getPosition();
            try {
                await fs.promises.writeFile(windowStatePath, JSON.stringify({ x, y }));
            } catch (err) {
                console.error('Failed to save window state:', err);
            }
        }, 500);
    });

    // Re-enforce Always on Top when losing focus to taskbar
    mainWindow.on('blur', () => {
        if (!isAwaitingPinTarget && mainWindow) {
            mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        }
    });
}

function handleWindowMove(force = false) {
    if (!mainWindow) return;
    const [x, y] = mainWindow.getPosition();
    const [width] = mainWindow.getSize();
    const windowCenter = x + (width / 2);
    const activeDisplay = screen.getDisplayNearestPoint({ x: windowCenter, y: 100 });
    const bounds = activeDisplay.workArea;
    const newEdge = windowCenter > (bounds.x + bounds.width / 2) ? 'right' : 'left';

    if (force || newEdge !== currentEdge) {
        currentEdge = newEdge;
        mainWindow.webContents.send('edge-changed', newEdge, bounds);
        console.log(`Edge changed to: ${newEdge}`);
    }

    if (sidebarRect.width > 0) {
        let newX = x;
        let newY = y;
        let clamped = false;

        const visLeft = x + sidebarRect.offsetX;
        const visRight = visLeft + sidebarRect.width;
        const visTop = y + sidebarRect.offsetY;
        const visBottom = visTop + sidebarRect.height;

        if (visLeft < bounds.x) { newX = bounds.x - sidebarRect.offsetX; clamped = true; }
        if (visRight > bounds.x + bounds.width) { newX = bounds.x + bounds.width - sidebarRect.width - sidebarRect.offsetX; clamped = true; }
        if (visTop < bounds.y) { newY = bounds.y - sidebarRect.offsetY; clamped = true; }
        if (visBottom > bounds.y + bounds.height) { newY = bounds.y + bounds.height - sidebarRect.height - sidebarRect.offsetY; clamped = true; }

        // Kullanıcının pencereyi istediği yere özgürce taşıyabilmesi için 
        // ekrandan taşma (clamping) kısıtlamasını devre dışı bıraktık.
        // if (clamped) {
        //     mainWindow.setPosition(Math.round(newX), Math.round(newY));
        // }
    }
}

// Calculates the ghost window (x, y) so it is perfectly centered horizontally
// and clamped to the top of the primary display. Used on launch fallback and tray show.
function calculatePrimaryCenterPosition(): { x: number; y: number } {
    const primary = screen.getPrimaryDisplay();
    const wa = primary.workArea; // { x, y, width, height } in OS coords

    if (isMac) {
        return { x: wa.x, y: wa.y };
    }

    // Center the 6000x4000 ghost window horizontally, clamp vertically to top
    const windowWidth = 6000;

    const x = Math.floor(wa.x + (wa.width / 2) - (windowWidth / 2));
    const y = wa.y;

    return { x, y };
}

function teleportToPrimaryCenter(showWindow = true) {
    if (!mainWindow) return;

    const pos = calculatePrimaryCenterPosition();
    mainWindow.setPosition(pos.x, pos.y);

    if (showWindow) {
        mainWindow.show(); mainWindow.webContents.openDevTools({ mode: 'detach' });
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        mainWindow.focus();
    }

    // Re-detect edge and send updated screen bounds to the frontend
    handleWindowMove(true);

    // Force the frontend to reset to Mini Mode and position perfectly at the center
    mainWindow.webContents.send('force-center-mini-mode');
}

// --- Clipboard Polling ---
function startClipboardPolling() {
    if (clipboardPollingInterval) return;
    lastClipboardText = clipboard.readText() || '';
    const initialImg = clipboard.readImage();
    lastClipboardImageDataUrl = initialImg.isEmpty() ? '' : initialImg.toDataURL();
    clipboardPollingInterval = setInterval(() => {
        if (!mainWindow) return;

        const formats = clipboard.availableFormats();

        // 1. FAST PATH: Check for Text
        if (formats.includes('text/plain')) {
            const currentText = clipboard.readText() || '';
            if (currentText && currentText !== lastClipboardText) {
                lastClipboardText = currentText;
                lastClipboardImageDataUrl = '';
                lastClipboardImageBmp = null; // Clear raw image cache to free RAM
                mainWindow.webContents.send('clipboard-updated', { type: 'text', content: currentText });
            }
            return;
        }

        // 2. HEAVY PATH: Buffer-level comparison to avoid toDataURL blocking
        if (formats.includes('image/png') || formats.includes('image/jpeg')) {
            const currentImage = clipboard.readImage();
            if (!currentImage.isEmpty()) {
                const bmp = currentImage.toBitmap(); // FAST: raw uncompressed memory

                // memcmp check: ONLY run expensive compression if raw bytes changed
                if (!lastClipboardImageBmp || !lastClipboardImageBmp.equals(bmp)) {
                    lastClipboardImageBmp = bmp; // Cache the raw buffer
                    lastClipboardText = '';

                    // EXECUTED ONLY ONCE PER NEW IMAGE
                    const currentDataUrl = currentImage.toDataURL();
                    lastClipboardImageDataUrl = currentDataUrl;

                    if (!mainWindow.isVisible()) {
                        mainWindow.show(); mainWindow.webContents.openDevTools({ mode: 'detach' });
                    }
                    if (mainWindow.isMinimized()) mainWindow.restore();
                    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
                    mainWindow.focus();

                    mainWindow.webContents.send('clipboard-updated', { type: 'image', content: currentDataUrl });
                }
            }
        }
    }, isMac ? 1000 : 500);
}

function stopClipboardPolling() {
    // clearInterval(clipboardPollingInterval);
    // clipboardPollingInterval = null;
    lastClipboardText = '';
    lastClipboardImageDataUrl = '';
}

function createTray() {
    // Resolve the icon path dynamically for both development and packaged environments
    // Dev path relative to dist-electron: ../build/icon-256x256.ico
    const iconPath = path.join(__dirname, '../build/icon-256x256.ico');

    let trayIcon = nativeImage.createFromPath(iconPath);

    // Fallback resolution using the app root if current path fails
    if (trayIcon.isEmpty()) {
        const rootPath = path.join(app.getAppPath(), 'build/icon-256x256.ico');
        trayIcon = nativeImage.createFromPath(rootPath);
    }

    // In case of emergency (still empty), attempt to use a standard PNG logo as last resort
    if (trayIcon.isEmpty()) {
        const pngPath = path.join(__dirname, '../build/icon.png');
        trayIcon = nativeImage.createFromPath(pngPath).resize({ width: 16, height: 16 });
    }

    tray = new Tray(trayIcon);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show/Hide KoBar',
            click: () => {
                if (mainWindow) {
                    if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
                        mainWindow.hide();
                    } else {
                        // Teleport to primary display center before showing
                        teleportToPrimaryCenter();
                    }
                }
            }
        },
        {
            label: 'Settings',
            click: () => {
                if (mainWindow) {
                    teleportToPrimaryCenter();
                    mainWindow.webContents.send('open-settings');
                }
            }
        },
        {
            label: 'Teleport to Center',
            click: () => {
                if (mainWindow) {
                    teleportToPrimaryCenter();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                app.quit();
            }
        }
    ]);

    tray.setToolTip('KoBar');
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
                mainWindow.hide();
            } else {
                // Teleport to primary display center before showing
                teleportToPrimaryCenter();
            }
        }
    });
}

app.whenReady().then(() => {
    // Ensure KoBox exists
    const koBoxPath = path.join(app.getPath('userData'), 'KoBox');
    if (!fs.existsSync(koBoxPath)) {
        fs.mkdirSync(koBoxPath, { recursive: true });
    }

    if (isWin) {
        // We use spawn for powershell here but for macOS we don't need persistent child process
        const spawn = require('child_process').spawn;
        psProcess = spawn('powershell', ['-NoProfile', '-Command', '-']);
        psProcess?.stdin?.write(`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class K { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo); [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags); [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex); [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong); [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect); [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; } }'\n`);
    }

    createWindow();
    createTray();

    // Handle microphone permissions explicitly for voice-to-text
    session.defaultSession.setPermissionCheckHandler((_webContents: WebContents | null, permission: string) => {
        if (permission === 'audioCapture') return true;
        return false;
    });

    session.defaultSession.setPermissionRequestHandler((_webContents: WebContents, permission: string, callback: (granted: boolean) => void) => {
        if (permission === 'audioCapture') {
            callback(true);
        } else {
            callback(false);
        }
    });

    startClipboardPolling();
    startMediaPolling();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    app.on('will-quit', () => {
        globalShortcut.unregisterAll();
        if (psProcess) psProcess.kill();
        stopMediaPolling();
    });

    app.on('browser-window-blur', (event, window) => {
        if (isAwaitingPinTarget && window === mainWindow) {
            isAwaitingPinTarget = false;
            // Wait 200ms for the OS to fully focus the new third-party window
            setTimeout(() => {
                if (isWin) {
                    const psPinScript = `
                    $hwnd = [K]::GetForegroundWindow()
                    $GWL_EXSTYLE = -20
                    $WS_EX_TOPMOST = 0x0008
                    $HWND_TOPMOST = -1
                    $HWND_NOTOPMOST = -2
                    
                    $exStyle = [K]::GetWindowLong($hwnd, $GWL_EXSTYLE)
                    if (($exStyle -band $WS_EX_TOPMOST) -eq $WS_EX_TOPMOST) {
                        # Already TopMost, so UNPIN it
                        [K]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, 3)
                        Write-Output "UNPINNED:$hwnd"
                    } else {
                        # Not TopMost, so PIN it
                        [K]::SetWindowPos($hwnd, $HWND_TOPMOST, 0, 0, 0, 0, 3)
                        Write-Output "PINNED:$hwnd"
                    }
                    `;
                    if (psProcess && psProcess.stdout) {
                        psProcess.stdout.once('data', (data: Buffer) => {
                            const output = data.toString();
                            if (output.includes('PINNED:')) {
                                const hwnd = parseInt(output.split('PINNED:')[1].trim());
                                allPinnedHwnds.add(hwnd);
                                startWindowTracking(hwnd);
                            } else if (output.includes('UNPINNED:')) {
                                const hwnd = parseInt(output.split('UNPINNED:')[1].trim());
                                allPinnedHwnds.delete(hwnd);
                                if (pinnedHwnd === hwnd) stopWindowTracking();
                            }
                        });
                        psProcess.stdin!.write(psPinScript + '\n');
                    }
                } else if (isMac) {
                    if (mainWindow) {
                        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
                        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
                        pinnedHwnd = 1; // Fake truthy value for macOS to signify pinned status
                        mainWindow.webContents.send('pin-targeting-complete');
                    }
                }
                if (isWin) mainWindow?.webContents.send('pin-targeting-complete');
            }, 200);
        }
    });

    // Auto Updater Setup
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
        if (mainWindow) {
            mainWindow.webContents.send('update-available', info.version);
        }
    });

    autoUpdater.on('download-progress', (progressObj) => {
        if (mainWindow) {
            mainWindow.webContents.send('update-download-progress', {
                percent: progressObj.percent,
                bytesPerSecond: progressObj.bytesPerSecond,
                transferred: progressObj.transferred,
                total: progressObj.total
            });
        }
    });

    autoUpdater.on('update-downloaded', (info) => {
        if (mainWindow) {
            mainWindow.webContents.send('update-download-complete', info.version);
        }
    });

    autoUpdater.on('error', (err) => {
        if (mainWindow) {
            mainWindow.webContents.send('update-error', err?.message || 'Unknown update error');
        }
    });

    if (ENABLE_AUTO_UPDATE) {
        autoUpdater.checkForUpdates();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC listeners
ipcMain.on('hide-app', () => {
    if (mainWindow) {
        mainWindow.hide();
    }
});

ipcMain.on('quit-app', () => {
    app.quit();
});

ipcMain.handle('ask-for-update', async (event, { title, message, yesLabel, noLabel }) => {
    if (!mainWindow) return false;
    const result = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: title,
        message: message,
        buttons: [yesLabel, noLabel]
    });
    // 0 is the index of the first button (yesLabel)
    return result.response === 0;
});

ipcMain.on('download-and-install-update', () => {
    autoUpdater.downloadUpdate();
});

ipcMain.on('quit-and-install-update', () => {
    autoUpdater.quitAndInstall();
});

ipcMain.handle('check-for-updates-manual', async () => {
    if (!ENABLE_AUTO_UPDATE) return { status: 'disabled' };
    try {
        const result = await autoUpdater.checkForUpdates();
        if (!result) {
            throw new Error('No update information retrieved');
        }
        const currentVersion = app.getVersion();
        const latestVersion = result.updateInfo.version;
        const updateAvailable = latestVersion !== currentVersion;
        
        return {
            status: 'success',
            updateAvailable,
            version: latestVersion
        };
    } catch (error: any) {
        return {
            status: 'error',
            message: error?.message || 'Unknown error'
        };
    }
});

ipcMain.on('enter-pin-targeting', () => {
    if (isMac) {
        // macOS: Panel windows don't fire blur events reliably.
        // Implement pseudo-pin: immediately elevate KoBar to screen-saver level.
        if (mainWindow) {
            mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
            mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
            pinnedHwnd = 1;
            mainWindow.webContents.send('pinned-window-changed', 1);
            mainWindow.webContents.send('pin-targeting-complete');
        }
        return;
    }
    isAwaitingPinTarget = true;
});

ipcMain.on('unpin-current-window', () => {
    if (isWin && pinnedHwnd) {
        const hwndToUnpin = pinnedHwnd;
        const psUnpinScript = `
        $hwnd = [IntPtr]${hwndToUnpin}
        $HWND_NOTOPMOST = -2
        [K]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, 3)
        `;
        if (psProcess && psProcess.stdin) {
            psProcess.stdin.write(psUnpinScript + '\n');
        }
        allPinnedHwnds.delete(hwndToUnpin);
        stopWindowTracking();
    } else if (isMac && mainWindow) {
        mainWindow.setAlwaysOnTop(true, 'floating', 1);
        pinnedHwnd = null;
        mainWindow.webContents.send('pinned-window-changed', null);
    }
});

ipcMain.on('unpin-all-windows', () => {
    if (isWin && allPinnedHwnds.size > 0) {
        let psUnpinAllScript = '';
        allPinnedHwnds.forEach(hwnd => {
            psUnpinAllScript += `[K]::SetWindowPos([IntPtr]${hwnd}, -2, 0, 0, 0, 0, 3)\n`;
        });
        if (psProcess && psProcess.stdin) {
            psProcess.stdin.write(psUnpinAllScript + '\n');
        }
        allPinnedHwnds.clear();
        stopWindowTracking();
        // Reset frontend targeting state
        mainWindow?.webContents.send('pin-targeting-complete');
    }
});

ipcMain.on('send-notification', (_event, { title, body }) => {
    const { Notification } = require('electron');
    new Notification({ title, body }).show();
});

function startWindowTracking(hwnd: number) {
    if (borderWindow) borderWindow.destroy();
    if (trackingInterval) clearInterval(trackingInterval);

    pinnedHwnd = hwnd;
    mainWindow?.webContents.send('pinned-window-changed', hwnd);

    borderWindow = new BrowserWindow({
        width: 1,
        height: 1,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        hasShadow: false,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        focusable: false,
        webPreferences: { nodeIntegration: false }
    });
    borderWindow.setIgnoreMouseEvents(true);
    borderWindow.showInactive();
    borderWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    borderWindow.loadURL(`data:text/html,<body style="margin:0;padding:2px;overflow:hidden;border:8px solid %23ef4444;box-sizing:border-box;width:100vw;height:100vh;background:transparent;"></body>`);

    trackingInterval = setInterval(() => {
        if (!borderWindow || !pinnedHwnd || borderWindow.isDestroyed()) return;
        const psPosScript = `
        $hwnd = [IntPtr]${pinnedHwnd}
        $rect = New-Object K+RECT
        if ([K]::GetWindowRect($hwnd, [ref]$rect)) {
            Write-Output "POS:$($rect.Left),$($rect.Top),$($rect.Right),$($rect.Bottom)"
        } else {
            Write-Output "LOST"
        }
        `;
        if (psProcess && psProcess.stdin) {
            psProcess.stdin.once('data', (data: Buffer) => {
                const output = data.toString();
                if (output.includes('POS:')) {
                    const parts = output.split('POS:')[1].trim().split(',');

                    // Native Windows rect is in PHYSICAL pixels
                    const physLeft = parseInt(parts[0]);
                    const physTop = parseInt(parts[1]);
                    const physRight = parseInt(parts[2]);
                    const physBottom = parseInt(parts[3]);

                    const physWidth = physRight - physLeft;
                    const physHeight = physBottom - physTop;

                    // Electron setBounds expects LOGICAL pixels
                    const primaryDisplay = screen.getPrimaryDisplay();
                    const sf = primaryDisplay.scaleFactor;

                    if (borderWindow && !borderWindow.isDestroyed()) {
                        const logicalX = Math.round(physLeft / sf);
                        const logicalY = Math.round(physTop / sf);
                        const logicalW = Math.round(physWidth / sf);
                        const logicalH = Math.round(physHeight / sf);

                        // Surgical logging for verification
                        console.log(`[TRK] HWND:${pinnedHwnd} | L:${logicalX} T:${logicalY} W:${logicalW} H:${logicalH}`);

                        borderWindow.setBounds({
                            x: logicalX,
                            y: logicalY,
                            width: logicalW,
                            height: logicalH
                        });

                        // Ensure it stays on top even if the pinned window is re-focused
                        borderWindow.setAlwaysOnTop(true, 'screen-saver', 1);
                    }
                } else if (output.includes('LOST')) {
                    stopWindowTracking();
                }
            });
            psProcess.stdin.write(psPosScript + '\n');
        }
    }, 50);
}

function stopWindowTracking() {
    pinnedHwnd = null;
    if (trackingInterval) clearInterval(trackingInterval);
    trackingInterval = null;
    if (borderWindow) {
        borderWindow.destroy();
        borderWindow = null;
    }
    mainWindow?.webContents.send('pinned-window-changed', null);
}

function resolvePhysicalPath(p: string): string {
    if (process.windowsStore && isWin && p) {
        try {
            let packageFullName = '';
            let current = process.execPath;
            while (true) {
                const parent = path.dirname(current);
                if (!parent || parent === current) break;
                if (path.basename(parent).toLowerCase() === 'windowsapps') {
                    packageFullName = path.basename(current);
                    break;
                }
                current = parent;
            }
            if (!packageFullName) {
                packageFullName = path.basename(path.dirname(process.execPath));
            }
            const match = packageFullName.match(/^([a-zA-Z0-9.-]+)_(\d+(?:\.\d+)+)_(?:.*_)?([a-zA-Z0-9]{13})$/);
            if (match) {
                const name = match[1];
                const publisherId = match[3];
                const packageFamilyName = `${name}_${publisherId}`;
                const localAppData = process.env.LOCALAPPDATA;
                if (localAppData) {
                    const appDataRoaming = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
                    const relativePath = path.relative(appDataRoaming, p);
                    if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
                        return path.join(localAppData, 'Packages', packageFamilyName, 'LocalCache', 'Roaming', relativePath);
                    }
                    const relativeLocalPath = path.relative(localAppData, p);
                    if (!relativeLocalPath.startsWith('..') && !path.isAbsolute(relativeLocalPath) && !relativeLocalPath.startsWith('Packages')) {
                        return path.join(localAppData, 'Packages', packageFamilyName, 'LocalState', relativeLocalPath);
                    }
                }
            }
        } catch (err) {
            console.error('Failed to resolve physical path for AppX container:', err);
        }
    }
    return p;
}

const koBoxPath = path.join(app.getPath('userData'), 'KoBox');

function cleanKoBox(mode: '24h' | 'quit') {
    if (!fs.existsSync(koBoxPath)) return;
    try {
        const files = fs.readdirSync(koBoxPath);
        const now = Date.now();
        files.forEach(file => {
            const filePath = path.join(koBoxPath, file);
            const stats = fs.statSync(filePath);
            if (mode === 'quit' || (mode === '24h' && now - stats.mtimeMs > 24 * 60 * 60 * 1000)) {
                fs.rmSync(filePath, { recursive: true, force: true });
            }
        });
    } catch (e) {
        console.error('KoBox Cleanup Error:', e);
    }
}

ipcMain.on('kobox-drop', (event, filePaths: string[]) => {
    if (!fs.existsSync(koBoxPath)) fs.mkdirSync(koBoxPath, { recursive: true });
    filePaths.forEach(src => {
        if (!src) return;
        try {
            const dest = path.join(koBoxPath, path.basename(src));

            // First attempt: Fast rename (move)
            try {
                fs.renameSync(src, dest);
            } catch (renameErr) {
                // Fallback: If moving across different drives/partitions fails, copy then delete original
                fs.copyFileSync(src, dest);
                fs.rmSync(src, { recursive: true, force: true });
            }
        } catch (e) {
            console.error('KoBox Move Error:', e);
        }
    });
});

ipcMain.on('kobox-open', () => {
    if (!fs.existsSync(koBoxPath)) {
        fs.mkdirSync(koBoxPath, { recursive: true });
    }
    const targetPath = resolvePhysicalPath(koBoxPath);
    shell.openPath(targetPath);
});
ipcMain.on('kobox-clean', (event, mode: '24h' | 'quit') => cleanKoBox(mode));

// AI Hub Fetch API & File Parsing 
ipcMain.handle('parse-file', async (event, filePath: string) => {
    try {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.pdf') {
            const pdfParse = require('pdf-parse');
            const dataBuffer = fs.readFileSync(filePath);
            const data = await pdfParse(dataBuffer);
            return { type: 'text', content: data.text as string };
        } else if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
            const buff = fs.readFileSync(filePath);
            const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
            return { type: 'image', content: `data:${mime};base64,${buff.toString('base64')}` };
        } else {
            // Assume text for txt, md, json, js, ts, etc
            return { type: 'text', content: fs.readFileSync(filePath, 'utf-8') };
        }
    } catch (e) {
        console.error('Parse file error:', e);
        return { type: 'error', content: String(e) };
    }
});

let cancelControllers: Record<string, AbortController> = {};

ipcMain.handle('cancel-llm-request', (event, messageId: string) => {
    if (cancelControllers[messageId]) {
        cancelControllers[messageId].abort();
        delete cancelControllers[messageId];
    }
});

ipcMain.handle('llm-request', async (event, data: { chatId: string, messageId: string, provider: string, model: string, messages: any[], apiKeys: any, systemPrompt?: string }) => {
    const { chatId, messageId, provider, model, messages, apiKeys, systemPrompt } = data;

    // Explicitly extract the correct key for validation
    let apiKey = '';
    if (apiKeys) {
        if (provider === 'openai') apiKey = apiKeys.openai;
        if (provider === 'gemini') apiKey = apiKeys.gemini;
        if (provider === 'anthropic') apiKey = apiKeys.anthropic;
    }

    // Validation: Prevent cloud calls without keys
    if (provider !== 'local' && (!apiKey || apiKey.trim() === '')) {
        if (mainWindow) {
            mainWindow.webContents.send('llm-stream-error', {
                chatId,
                messageId,
                error: `${provider.toUpperCase()} API key not found. Please check your AI Hub settings.`
            });
        }
        return;
    }

    cancelControllers[messageId] = new AbortController();
    const signal = cancelControllers[messageId].signal;

    try {
        let url = '';
        let headers: any = {};
        let body: any = {};

        let finalMessages = [...messages];

        if (provider === 'openai' || provider === 'gemini') {
            headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            };
        } else if (provider === 'anthropic') {
            headers = {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            };
        }

        if (provider === 'openai') {
            if (systemPrompt) {
                finalMessages.unshift({ role: 'system', content: systemPrompt });
            }
            url = 'https://api.openai.com/v1/chat/completions';
            body = {
                model: model || 'gpt-4o',
                messages: finalMessages,
                stream: true
            };
        } else if (provider === 'anthropic') {
            url = 'https://api.anthropic.com/v1/messages';

            // Translate multimodal (image) payloads to Anthropic's schema
            const anthropicMessages = finalMessages.map((m: any) => {
                if (Array.isArray(m.content)) {
                    const translatedContent = m.content.map((part: any) => {
                        if (part.type === 'image_url') {
                            const dataUrl = part.image_url.url;
                            const matches = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
                            if (matches) {
                                return {
                                    type: 'image',
                                    source: {
                                        type: 'base64',
                                        media_type: matches[1], // e.g., image/jpeg, image/png
                                        data: matches[2] // pure base64
                                    }
                                };
                            }
                        }
                        return part; // Keep text parts unchanged
                    });
                    return { role: m.role, content: translatedContent };
                }
                return m;
            });

            body = {
                model: model || 'claude-sonnet-4-6',
                max_tokens: 4096,
                messages: anthropicMessages,
                stream: true
            };
            if (systemPrompt) {
                body.system = systemPrompt;
            }
        } else if (provider === 'gemini') {
            let geminiModel = model.replace('gemini:', '').replace('-latest', '');

            // Use the official OpenAI compatibility endpoint
            url = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

            if (systemPrompt) {
                finalMessages.unshift({ role: 'system', content: systemPrompt });
            }

            body = {
                model: geminiModel || 'gemini-3.1-flash',
                messages: finalMessages,
                stream: true
            };
        } else if (provider === 'local') {
            // 1. Detect if it's Ollama or LM Studio
            let endpoint = (apiKeys?.localUrl || 'http://localhost:11434').replace(/\/v1\/?$/, '').replace(/\/api\/?$/, '').replace(/\/+$/, '');
            const isOllama = endpoint.includes('11434') || (apiKeys?.localUrl || '').toLowerCase().includes('ollama');

            // 2. Check for vision/multimodal payload
            const hasVision = finalMessages.some((m: any) => Array.isArray(m.content));

            // 3. SAFE System Prompt Injection (Disable for local vision to prevent looping)
            if (systemPrompt && !hasVision) {
                finalMessages.unshift({ role: 'system', content: systemPrompt });
            }

            headers = { 'Content-Type': 'application/json' };

            if (isOllama) {
                // OLLAMA NATIVE API
                url = endpoint + '/api/chat';
                const ollamaMessages = finalMessages.map((m: any) => {
                    if (Array.isArray(m.content)) {
                        let textContent = '';
                        let images: string[] = [];
                        m.content.forEach((part: any) => {
                            if (part.type === 'text') textContent += part.text + '\n';
                            if (part.type === 'image_url') {
                                // Ollama expects raw base64 without data:image prefix
                                images.push(part.image_url.url.replace(/^data:image\/\w+;base64,/, ''));
                            }
                        });
                        return { role: m.role, content: textContent.trim(), images: images.length > 0 ? images : undefined };
                    }
                    return m;
                });
                body = {
                    model: model.replace('local:', '') || 'llava',
                    messages: ollamaMessages,
                    stream: true
                };
            } else {
                // LM STUDIO (OpenAI API Compatibility)
                url = endpoint + '/v1/chat/completions';
                body = {
                    model: model.replace('local:', '') || 'local-model',
                    messages: finalMessages,
                    stream: true,
                    max_tokens: 2048,
                    temperature: 0.7
                };
            }
        }


        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`API Error: ${res.status} - ${errorText}`);
        }

        const reader = res.body?.getReader();
        const decoder = new TextDecoder("utf-8");

        if (reader && mainWindow) {
            let buffer = '';
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // keep the incomplete line in buffer

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === 'data: [DONE]') continue;


                    if (trimmed.startsWith('data: ')) {
                        try {
                            const dataPayload = JSON.parse(trimmed.substring(6));
                            let chunk = '';
                            if (provider === 'anthropic') {
                                if (dataPayload.type === 'content_block_delta') {
                                    chunk = dataPayload.delta.text || '';
                                }
                            } else {
                                chunk = dataPayload.choices?.[0]?.delta?.content || '';
                            }

                            if (chunk) {
                                mainWindow.webContents.send('llm-stream-chunk', { chatId, messageId, chunk });
                            }
                        } catch (e) {
                            // ignore unparseable chunks
                        } // handle JSON parses safely for tiny chunks
                    }
                }
            }
            if (buffer && mainWindow) {
                // Flush remaining
                try {
                    if (buffer.startsWith('data: ')) {
                        const finalPayload = JSON.parse(buffer.substring(6));
                        let chunk = '';
                        if (provider === 'anthropic') {
                            if (finalPayload.type === 'content_block_delta') {
                                chunk = finalPayload.delta.text || '';
                            }
                        } else {
                            chunk = finalPayload.choices?.[0]?.delta?.content || '';
                        }
                        if (chunk) mainWindow.webContents.send('llm-stream-chunk', { chatId, messageId, chunk });
                    }
                } catch (e) { }
            }
            mainWindow.webContents.send('llm-stream-end', { chatId, messageId });
        }

    } catch (e: any) {
        if (e.name === 'AbortError') {
            console.log('LLM Request aborted');
        } else {
            if (mainWindow) {
                const errorMessage = e instanceof Error ? e.message : (typeof e === 'object' ? JSON.stringify(e) : String(e));
                mainWindow.webContents.send('llm-stream-error', { chatId, messageId, error: errorMessage });
            }
        }
    } finally {
        delete cancelControllers[messageId];
    }
});

// Auto-launch at system startup
ipcMain.handle('get-auto-launch', () => {
    const settings = app.getLoginItemSettings();
    return settings.openAtLogin;
});

ipcMain.on('set-auto-launch', (_event, enabled: boolean) => {
    if (isDev) {
        console.log(`Bypassing auto-launch setting in DEV mode (would set to: ${enabled})`);
        return;
    }

    // For AppX/Windows Store builds, we MUST use the native openAtLogin without args
    // Electron internally triggers the Appx StartupTask.
    if (process.windowsStore) {
        app.setLoginItemSettings({ openAtLogin: enabled });
    } else {
        // For NSIS/Standard builds, explicitly defining the exe path with quotes fixes the Task Manager Generic Icon bug, extending reliable registry execution.
        const exePath = `"${process.execPath}"`;
        app.setLoginItemSettings({
            openAtLogin: enabled,
            path: exePath, // Electron uses this to set the registry key natively
            args: [
                '--hidden'
            ]
        });
    }
});

ipcMain.on('start-clipboard-listener', () => {
    startClipboardPolling();
});

ipcMain.on('write-to-clipboard', (_event, data: { type: string; content: string }) => {
    if (data.type === 'text') {
        clipboard.writeText(data.content);
        lastClipboardText = data.content;
    } else if (data.type === 'image') {
        const img = nativeImage.createFromDataURL(data.content);
        clipboard.writeImage(img);
        lastClipboardImageDataUrl = data.content;
    }
});

ipcMain.on('set-ignore-mouse-events', (event, ignore: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        win.setIgnoreMouseEvents(ignore, { forward: true });
    }
});

ipcMain.on('set-global-paste-mode', (event, isActive) => {
    isGlobalPasteModeActive = isActive;
    if (isActive) {
        globalShortcut.register('CommandOrControl+V', () => {
            if (mainWindow) mainWindow.webContents.send('request-next-paste');
        });
    } else {
        globalShortcut.unregister('CommandOrControl+V');
        if (isWin && psProcess && psProcess.stdin) {
            psProcess.stdin.write('[K]::keybd_event(0x11, 0, 2, 0)\n[K]::keybd_event(0x10, 0, 2, 0)\n[K]::keybd_event(0x12, 0, 2, 0)\n');
        }
    }
});

ipcMain.on('execute-global-paste', (event, data) => {
    if (data.type === 'text') {
        clipboard.writeText(data.content);
        lastClipboardText = data.content;
    } else if (data.type === 'image') {
        const img = nativeImage.createFromDataURL(data.content);
        clipboard.writeImage(img);
        lastClipboardImageDataUrl = data.content;
    }
    globalShortcut.unregister('CommandOrControl+V');

    if (isWin) {
        const psPaste = `
$isDown = ([K]::GetAsyncKeyState(0x11) -band 0x8000) -ne 0
if (-not $isDown) { [K]::keybd_event(0x11, 0, 0, 0) }
[K]::keybd_event(0x56, 0, 0, 0)
[K]::keybd_event(0x56, 0, 2, 0)
if (-not $isDown) { [K]::keybd_event(0x11, 0, 2, 0) }
`;
        if (psProcess && psProcess.stdin) {
            psProcess.stdin.write(psPaste + '\n');
        }
    } else if (isMac) {
        // macOS: Check Accessibility permission (required for keystroke injection)
        const macSysPrefs = require('electron').systemPreferences;
        const accessibilityGranted = macSysPrefs.isTrustedAccessibilityClient(false);

        if (!accessibilityGranted) {
            // Prompt user to grant Accessibility
            macSysPrefs.isTrustedAccessibilityClient(true);
            mainWindow?.webContents.send('clipboard-paste-error', {
                error: 'accessibility_required',
                message: 'Enable Accessibility for KoBar in System Settings'
            });
            // Re-register shortcut immediately since paste won't happen
            if (isGlobalPasteModeActive) {
                globalShortcut.register('CommandOrControl+V', () => {
                    if (mainWindow) mainWindow.webContents.send('request-next-paste');
                });
            }
            return;
        }

        // Hide KoBar to ensure target app has focus for the keystroke
        if (mainWindow) mainWindow.hide();

        // Short delay: let the target app fully gain focus
        setTimeout(() => {
            exec('osascript -e \'tell application "System Events"\n  delay 0.05\n  keystroke "v" using command down\nend tell\'', (err, stdout, stderr) => {
                if (err) console.error('[Clipboard] macOS Paste Error:', stderr || err);

                // Restore KoBar
                if (mainWindow) {
                    mainWindow.show(); mainWindow.webContents.openDevTools({ mode: 'detach' });
                    mainWindow.setAlwaysOnTop(true, isMac ? 'floating' : 'screen-saver', 1);
                }

                // Re-register shortcut ONLY AFTER osascript keystroke has fully resolved
                setTimeout(() => {
                    if (isGlobalPasteModeActive) {
                        globalShortcut.register('CommandOrControl+V', () => {
                            if (mainWindow) mainWindow.webContents.send('request-next-paste');
                        });
                    }
                }, 150);
            });
        }, 100);
        return; // Early return to avoid the default timeout below
    }

    setTimeout(() => {
        if (isGlobalPasteModeActive) {
            globalShortcut.register('CommandOrControl+V', () => {
                if (mainWindow) mainWindow.webContents.send('request-next-paste');
            });
        }
    }, 200);
});

// ─── Screenshot Studio: Custom In-App Capture ─────────────────────
// Keep legacy trigger-screenshot for backward compat (e.g. PrintScreen key)
ipcMain.on('trigger-screenshot', () => {
    if (isWin) {
        if (psProcess && psProcess.stdin) {
            const psScreenshot = `
[K]::keybd_event(0x2C, 0, 0, 0)
[K]::keybd_event(0x2C, 0, 2, 0)
`;
            psProcess.stdin.write(psScreenshot + '\n');
        }
    } else if (isMac) {
        exec('screencapture -i -c');
    }
});

// Legacy take-screenshot kept for backward compatibility
ipcMain.on('take-screenshot', (event, hideApp) => {
    if (hideApp && mainWindow) {
        mainWindow.hide();
    }
    setTimeout(() => {
        if (isWin) {
            shell.openExternal('ms-screenclip:');
        } else if (isMac) {
            exec('screencapture -i -c', () => {
                if (hideApp && mainWindow) {
                    mainWindow.show(); mainWindow.webContents.openDevTools({ mode: 'detach' });
                    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
                }
            });
        }
    }, 150);
});

// ─── NEW: Custom Screenshot Studio Capture ─────────────────────────
const { systemPreferences } = require('electron');
let screenshotOverlayWindows: BrowserWindow[] = [];
let preScreenshotBounds: { x: number; y: number; width: number; height: number; } | null = null;

ipcMain.handle('start-screenshot-capture', async () => {
    // 0a. macOS Permission Check
    if (isMac) {
        const screenStatus = systemPreferences.getMediaAccessStatus('screen');
        if (screenStatus !== 'granted') {
            const response = await dialog.showMessageBox({
                type: 'warning',
                title: 'Screen Recording Permission Required',
                message: 'KoBar needs Screen Recording permissions to use the Screenshot tool.',
                detail: 'Please enable "Screen Recording" for KoBar in System Settings -> Privacy & Security, then restart the application.',
                buttons: ['Open System Settings', 'Cancel'],
                defaultId: 0,
                cancelId: 1
            });

            if (response.response === 0) {
                shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
            }

            // Abort gracefully
            return { captures: [], windowPosition: { x: 0, y: 0 }, error: 'permission_denied' };
        }
    }

    // 0b. Compute multi-monitor boundaries
    const displays = screen.getAllDisplays();
    let minX = displays[0].bounds.x, minY = displays[0].bounds.y;
    let maxX = displays[0].bounds.x + displays[0].bounds.width;
    let maxY = displays[0].bounds.y + displays[0].bounds.height;

    displays.forEach(d => {
        if (d.bounds.x < minX) minX = d.bounds.x;
        if (d.bounds.y < minY) minY = d.bounds.y;
        if (d.bounds.x + d.bounds.width > maxX) maxX = d.bounds.x + d.bounds.width;
        if (d.bounds.y + d.bounds.height > maxY) maxY = d.bounds.y + d.bounds.height;
    });

    // 1. Hide KoBar and temporarily resize it to cover ALL monitors seamlessly
    if (mainWindow) {
        preScreenshotBounds = mainWindow.getBounds();
        mainWindow.setAlwaysOnTop(false); // DEMOTE BEFORE HIDE TO PREVENT BLACK SCREEN
        mainWindow.setBounds({
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        });
        mainWindow.hide();
    }

    // 2. Wait for the OS to fully render the desktop without KoBar
    await new Promise(resolve => setTimeout(resolve, 200));

    // 3. Grab all displays
    // (displays already grabbed above)

    // 4. Capture all screens using desktopCapturer
    const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
            // Use the largest display's scaled dimensions to get max quality
            width: Math.max(...displays.map(d => Math.round(d.bounds.width * d.scaleFactor))),
            height: Math.max(...displays.map(d => Math.round(d.bounds.height * d.scaleFactor))),
        }
    });

    // 5. Build per-display capture data
    const captureData = displays.map((display) => {
        // Correctly match the desktopCapturer screen source to the physical display
        let source = sources.find((s: any) => s.display_id === display.id.toString());
        // Fallback for edge-cases where ID parsing fails
        if (!source) {
            source = sources.find((s: any) => s.name === `Screen ${display.id}`) || sources[0];
        }
        const thumbnail = source.thumbnail;

        return {
            displayId: display.id.toString(),
            bounds: display.bounds,
            scaleFactor: display.scaleFactor,
            imageDataUrl: thumbnail.toDataURL(),
        };
    });

    // 6. Get the ghost window position for coordinate mapping
    //    The renderer needs this to position the overlay at the correct
    //    offset within the 6000×4000 ghost window.
    const windowPos = mainWindow ? mainWindow.getPosition() : [0, 0];

    // 7. Show KoBar back so the overlay React component becomes visible
    if (mainWindow) {
        mainWindow.show(); mainWindow.webContents.openDevTools({ mode: 'detach' });
        mainWindow.setAlwaysOnTop(true, isMac ? 'floating' : 'screen-saver', 1);
    }

    return {
        captures: captureData,
        windowPosition: { x: windowPos[0], y: windowPos[1] },
    };
});

// Cancel screenshot mode and restore KoBar
ipcMain.on('cancel-screenshot', () => {
    if (mainWindow) {
        if (preScreenshotBounds) mainWindow.setBounds(preScreenshotBounds);
        mainWindow.show(); mainWindow.webContents.openDevTools({ mode: 'detach' });
        mainWindow.setAlwaysOnTop(true, isMac ? 'floating' : 'screen-saver', 1);
    }
});

// Save screenshot to file
ipcMain.handle('save-screenshot', async (_event, data: { buffer: string; format: string; destinationPath?: string }) => {
    const { buffer, format, destinationPath } = data;

    // Convert base64 data URL to Buffer
    const base64Data = buffer.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    let savePath = destinationPath;

    if (!savePath) {
        // Temporarily disable alwaysOnTop to ensure the dialog appears ON TOP of the screen-filler ghost window
        if (mainWindow) mainWindow.setAlwaysOnTop(false);

        // Open native save dialog as fallback
        const result = await dialog.showSaveDialog(mainWindow!, {
            title: 'Save Screenshot',
            defaultPath: path.join(app.getPath('desktop'), `KoBar_Screenshot_${Date.now()}.${format}`),
            filters: [
                { name: 'Images', extensions: [format] }
            ]
        });

        // Restore alwaysOnTop
        if (mainWindow) mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);

        if (result.canceled || !result.filePath) return { success: false, reason: 'cancelled' };
        savePath = result.filePath;
    }

    try {
        await fs.promises.writeFile(savePath, imageBuffer);
        return { success: true, path: savePath };
    } catch (e) {
        console.error('Screenshot save error:', e);
        return { success: false, reason: String(e) };
    }
});

// Copy screenshot to system clipboard
ipcMain.on('copy-screenshot-to-clipboard', (_event, dataUrl: string) => {
    const img = nativeImage.createFromDataURL(dataUrl);
    clipboard.writeImage(img);
    lastClipboardImageDataUrl = dataUrl;
    lastClipboardImageBmp = img.toBitmap();
    // Let the existing clipboard polling pick this up for the FIFO queue
});

// Restore KoBar window after screenshot session finishes
ipcMain.on('screenshot-session-complete', () => {
    if (mainWindow) {
        if (preScreenshotBounds) mainWindow.setBounds(preScreenshotBounds);
        mainWindow.show(); mainWindow.webContents.openDevTools({ mode: 'detach' });
        mainWindow.setAlwaysOnTop(true, isMac ? 'floating' : 'screen-saver', 1);
    }
});

// ─── PIP Video Player (Webview-based mini browser) ───────────────────────────────

/**
 * Extract video URLs from open browsers (shared between on-demand and background scans).
 */
function runVideoUrlScan(): Promise<string[]> {
    return new Promise<string[]>((resolve) => {
        if (!isWin) { resolve([]); return; }

        const psScript = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$domains = @('youtube.com', 'youtu.be')
$browsers = @('chrome', 'msedge', 'brave', 'firefox', 'opera', 'vivaldi')
$urls = [System.Collections.Generic.List[string]]::new()

$root = [System.Windows.Automation.AutomationElement]::RootElement
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

foreach ($w in $windows) {
    try {
        $pidVal = $w.Current.ProcessId
        if ($pidVal -eq 0) { continue }
        $proc = Get-Process -Id $pidVal -ErrorAction SilentlyContinue
        if ($null -eq $proc) { continue }
        
        $procName = $proc.Name.ToLower()
        if ($browsers -contains $procName) {
            $cond = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::Edit
            )
            $edits = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
            foreach ($e in $edits) {
                try {
                    $vp = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                    $v = $vp.Current.Value
                    foreach ($d in $domains) {
                        if ($v -match [regex]::Escape($d)) {
                            $fullUrl = $v
                            if ($fullUrl -notmatch '^https?://') {
                                $fullUrl = "https://" + $fullUrl
                            }
                            if (!$urls.Contains($fullUrl)) { $urls.Add($fullUrl) }
                            break
                        }
                    }
                } catch {}
            }
        }
    } catch {}
}

if ($urls.Count -gt 0) { $urls | ForEach-Object { Write-Output $_ } }
`;
        const child = exec('powershell -NoProfile -NonInteractive -Command -', { timeout: 6000 }, (err, stdout) => {
            if (err || !stdout.trim()) { resolve([]); return; }
            const lines = stdout
                .split('\n')
                .map((l: string) => l.trim())
                .filter((l: string) => l.startsWith('http'));
            resolve(lines);
        });
        if (child.stdin) { child.stdin.write(psScript); child.stdin.end(); }
    });
}

function createPipWindow(videoUrl: string, title: string, albumArt?: string | null) {
    if (pipWindow && !pipWindow.isDestroyed()) {
        pipWindow.close();
    }

    const pipWidth = 480;
    const pipHeight = 270;

    // Position in the bottom-right corner of the primary display
    const primaryDisplay = screen.getPrimaryDisplay();
    const { x: dX, y: dY, width: dW, height: dH } = primaryDisplay.workArea;
    const startX = dX + dW - pipWidth - 20;
    const startY = dY + dH - pipHeight - 20;

    const pipPreloadPath = path.join(__dirname, 'preload.cjs');

    pipWindow = new BrowserWindow({
        x: startX,
        y: startY,
        width: pipWidth,
        height: pipHeight,
        minWidth: 240,
        minHeight: 135,
        frame: false,
        transparent: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        hasShadow: true,
        backgroundColor: '#000000',
        icon: path.join(__dirname, '../build/icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: pipPreloadPath,
        },
    });

    // Spoof user agent to bypass YouTube Error 153 (automation/webview block)
    pipWindow.webContents.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    pipWindow.setAspectRatio(16 / 9);
    pipWindow.setAlwaysOnTop(true, isMac ? 'floating' : 'screen-saver', 2);

    const encodedUrl = encodeURIComponent(videoUrl);
    const encodedTitle = encodeURIComponent(title);

    if (isDev) {
        pipWindow.loadURL(`http://localhost:5173/?pip=true&url=${encodedUrl}&title=${encodedTitle}`);
    } else {
        pipWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
            query: { pip: 'true', url: videoUrl, title },
        });
    }

    pipWindow.on('closed', () => {
        pipWindow = null;
        mainWindow?.webContents.send('pip-closed');
    });
}

// Detect video URLs playing in open browsers using PowerShell UIAutomation
// Returns an array of video URLs found in Chrome/Edge/Brave/Firefox address bars
ipcMain.handle('get-active-video-urls', () => runVideoUrlScan());

// Open PIP with a URL (mini browser approach — no capture needed)
ipcMain.on('open-pip', (_event, { url, title, albumArt }: { url: string; title: string; albumArt?: string }) => {
    createPipWindow(url, title, albumArt || lastSmtcAlbumArt || undefined);
});

// Return current SMTC source app ID (for renderer to query on-demand)
ipcMain.handle('get-smtc-source', () => lastSmtcSourceAppId);

// Close PIP window
ipcMain.on('close-pip', () => {
    if (pipWindow && !pipWindow.isDestroyed()) {
        pipWindow.close();
    }
    pipWindow = null;
});

ipcMain.on('move-window', (event, { dx, dy }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        const [x, y] = win.getPosition();
        win.setPosition(Math.round(x + dx), Math.round(y + dy));
    }
});

ipcMain.handle('recenter-window-on-widget', async (event, relativeX, relativeY, width, height) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;

    const [winX, winY] = win.getPosition();
    const physicalX = winX + relativeX;
    const physicalY = winY + relativeY;

    // Find nearest display to the widget center
    const activeDisplay = screen.getDisplayNearestPoint({ 
        x: Math.round(physicalX + width / 2), 
        y: Math.round(physicalY + height / 2) 
    });

    // Calculate new centered window position
    const windowWidth = 6000;
    const newWinX = Math.floor(activeDisplay.workArea.x + (activeDisplay.workArea.width / 2) - (windowWidth / 2));
    const newWinY = activeDisplay.workArea.y;

    // Move the window
    win.setPosition(newWinX, newWinY);

    // Calculate new relative coordinates
    const newRelativeX = physicalX - newWinX;
    const newRelativeY = physicalY - newWinY;

    // Trigger edge-changed to update screen bounds in the frontend
    handleWindowMove(true);

    return { x: newRelativeX, y: newRelativeY, displayBounds: activeDisplay.workArea };
});

ipcMain.on('get-window-position-sync', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    event.returnValue = win ? win.getPosition() : [0, 0];
});

ipcMain.handle('get-displays-info', () => {
    return {
        primaryDisplay: screen.getPrimaryDisplay(),
        allDisplays: screen.getAllDisplays()
    };
});

ipcMain.handle('get-screen-bounds', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        const [x, y] = win.getPosition();
        const [width] = win.getSize();
        const windowCenter = x + (width / 2);
        const activeDisplay = screen.getDisplayNearestPoint({ x: windowCenter, y: 100 });
        return activeDisplay.workArea;
    }
    return screen.getPrimaryDisplay().workArea;
});

ipcMain.on('update-sidebar-rect', (event, rect) => {
    sidebarRect = { ...sidebarRect, ...rect };
});

/* 
ipcMain.on('register-teleport-shortcut', (event, shortcut) => {
    if (teleportShortcutKey) globalShortcut.unregister(teleportShortcutKey);
    teleportShortcutKey = shortcut;
    if (shortcut) {
        try {
            globalShortcut.register(shortcut, () => {
                if (!mainWindow) return;
                const cursor = screen.getCursorScreenPoint();
                // KoBar Sidebar is statically positioned at y=20 (pt-[20px]).
                // We must use a targetVisualY close to 20 (e.g., 100) instead of half of height,
                // otherwise restoring the window from the eye will place the sidebar off-screen.
                const targetVisualX = 3000;
                const targetVisualY = 100;
                const newX = cursor.x - targetVisualX;
                const newY = cursor.y - targetVisualY;
                
                mainWindow.setPosition(Math.round(newX), Math.round(newY));
                mainWindow.webContents.send('teleport-triggered', { x: targetVisualX, y: targetVisualY });
                
                if (!mainWindow.isVisible()) mainWindow.show(); mainWindow.webContents.openDevTools({ mode: 'detach' });
                mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
            });
        } catch (e) {
            console.error('Failed to register teleport shortcut', e);
        }
    }
});
*/

ipcMain.handle('get-file-icon', async (_event, filePath: string) => {
    try {
        // Step A: Resolve target path for .lnk shortcut files
        let targetPath = filePath;
        if (isWin && filePath.toLowerCase().endsWith('.lnk')) {
            targetPath = await new Promise<string>((resolve) => {
                const psScript = `
                $shell = New-Object -ComObject WScript.Shell
                $link = $shell.CreateShortcut("${filePath}")
                $link.TargetPath
                `;
                exec(`powershell -NoProfile -Command "${psScript}"`, (error, stdout) => {
                    if (error || !stdout.trim()) {
                        resolve(filePath); // Fallback to original path
                        return;
                    }
                    resolve(stdout.trim());
                });
            });
        }

        // Step B: Use Electron's native API to get the file icon
        const icon = await app.getFileIcon(targetPath, { size: 'large' });
        return icon.toDataURL();
    } catch (e) {
        console.error('Failed to get file icon:', e);
        return null;
    }
});

ipcMain.on('launch-file', async (event, filePath) => {
    if (!filePath || typeof filePath !== 'string') {
        console.error('Launch failed: Invalid or undefined file path received.');
        return;
    }
    try {
        if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
            shell.openExternal(filePath);
        } else {
            const errorMessage = await shell.openPath(filePath);
            if (errorMessage) {
                console.error('Shell error opening path:', errorMessage);
            }
        }
    } catch (e) {
        console.error('Failed to launch application / open link:', e);
    }
});

ipcMain.handle('get-melody-audio', async (_event, melodyName: string) => {
    try {
        const audioPath = path.join(__dirname, '../Assets/Melody', `${melodyName}.ogg`);
        if (fs.existsSync(audioPath)) {
            const buf = await fs.promises.readFile(audioPath);
            return `data:audio/ogg;base64,${buf.toString('base64')}`;
        }
        return null;
    } catch (e) {
        console.error('Failed to load melody audio:', e);
        return null;
    }
});

// IPC map to expose the Hardware ID synchronously generated from LicenseManager
ipcMain.handle('get-hwid', () => {
    return LicenseManager.getDeviceHWID();
});

// ─── KoPlayer: OS Media Polling ────────────────────────────────────
function startMediaPolling() {
    if (mediaPollingInterval) return;

    if (isWin) {
        // Use Worker thread for Windows SMTC to prevent main thread lock
        try {
            const workerPath = path.join(__dirname, 'smtc-worker.cjs');

            smtcWorker = new Worker(workerPath);
            smtcWorker.on('message', (msg) => {
                if (msg.type === 'poll-result' && mainWindow) {
                    const mediaData = msg.data;
                    mainWindow.webContents.send('media-update', mediaData);

                    // Video PiP: if the current media source is a browser, run a
                    // background URL scan (debounced) and cache results for instant PiP open.
                    if (mediaData) {
                        const appId: string = (mediaData.sourceAppId || '').toLowerCase();
                        lastSmtcSourceAppId = appId;
                        lastSmtcAlbumArt = mediaData.albumArt || null;
                        const isBrowser = BROWSER_APP_IDS.some(b => appId.includes(b));
                        if (isBrowser) {
                            const now = Date.now();
                            if (now - lastVideoScanAt >= VIDEO_SCAN_DEBOUNCE_MS) {
                                lastVideoScanAt = now;
                                runVideoUrlScan().then(urls => {
                                    mainWindow?.webContents.send('video-urls-update', urls);
                                }).catch(() => {});
                            }
                        } else {
                            // Non-browser source: clear cached video URLs
                            mainWindow.webContents.send('video-urls-update', []);
                        }
                    } else {
                        lastSmtcSourceAppId = '';
                        lastSmtcAlbumArt = null;
                        mainWindow.webContents.send('video-urls-update', []);
                    }
                }
            });
            smtcWorker.on('error', (err) => {
                console.error('[KoPlayer] SMTC Worker error:', err);
                stopMediaPolling();
            });

            // Start polling loop via Worker
            mediaPollingInterval = setInterval(() => {
                if (smtcWorker) smtcWorker.postMessage({ type: 'poll' });
            }, 1500);

        } catch (e) {
            console.error('[KoPlayer] Failed to start SMTC Worker:', e);
        }
    } else if (isMac) {
        // macOS polling: Birleşik AppleScript — System Events bypass
        let macMediaPollingBusy = false;
        mediaPollingInterval = setInterval(() => {
            if (!mainWindow || macMediaPollingBusy) return;
            macMediaPollingBusy = true;

            // 1. Check which media apps are running — direct app query, no System Events permission needed
            const checkAppsScript = `
                try
                    tell application "Spotify" to if it is running then return "Spotify"
                end try
                try
                    tell application "Music" to if it is running then return "Music"
                end try
                return ""
            `;

            const checkChild = exec('osascript -', (err, stdout) => {
                if (err) {
                    macMediaPollingBusy = false;
                    if (err.message && err.message.includes('-1743')) {
                        mainWindow?.webContents.send('media-update', {
                            title: 'Permission Required',
                            artist: 'Enable Automation in System Settings',
                            albumArt: null,
                            isPlaying: false
                        });
                    } else {
                        mainWindow?.webContents.send('media-update', null);
                    }
                    return;
                }
                const targetApp = (stdout || '').trim();

                // If none of our supported apps are running
                if (!targetApp) {
                    macMediaPollingBusy = false;
                    mainWindow?.webContents.send('media-update', null);
                    return;
                }

                // 2. Only build the script for the SPECIFIC app that is running.
                // This completely bypasses the "-2741 identifier not found" compilation error for absent apps.
                let fetchScript = '';

                if (targetApp === 'Spotify') {
                    fetchScript = `
                        set isPlaying to false
                        set nowTitle to ""
                        set nowArtist to ""
                        set nowArt to ""
                        tell application "Spotify"
                            try
                                set nowTitle to name of current track
                                set nowArtist to artist of current track
                                set nowArt to artwork url of current track
                                if player state is playing then set isPlaying to true
                            end try
                        end tell
                        return nowTitle & "||" & nowArtist & "||" & (isPlaying as string) & "||" & nowArt
                    `;
                } else if (targetApp === 'Music') {
                    fetchScript = `
                        set isPlaying to false
                        set nowTitle to ""
                        set nowArtist to ""
                        set nowArt to ""
                        tell application "Music"
                            try
                                set nowTitle to name of current track
                                set nowArtist to artist of current track
                                if player state is playing then set isPlaying to true
                            end try
                        end tell
                        return nowTitle & "||" & nowArtist & "||" & (isPlaying as string) & "||" & nowArt
                    `;
                } else if (targetApp === 'Chrome') {
                    fetchScript = `
                        set isPlaying to true
                        set nowTitle to ""
                        set nowArtist to "Google Chrome"
                        tell application "Google Chrome"
                            try
                                set nowTitle to title of active tab of front window
                            end try
                        end tell
                        return nowTitle & "||" & nowArtist & "||" & (isPlaying as string) & "||"
                    `;
                } else if (targetApp === 'Safari') {
                    fetchScript = `
                        set isPlaying to true
                        set nowTitle to ""
                        set nowArtist to "Safari"
                        tell application "Safari"
                            try
                                set nowTitle to name of current tab of front window
                            end try
                        end tell
                        return nowTitle & "||" & nowArtist & "||" & (isPlaying as string) & "||"
                    `;
                }

                const child = exec('osascript -', (error, fetchStdout, fetchStderr) => {
                    macMediaPollingBusy = false;
                    if (error || !fetchStdout.trim()) {
                        mainWindow?.webContents.send('media-update', null);
                        return;
                    }
                    const parts = fetchStdout.trim().split('||');
                    if (parts.length >= 3 && (parts[0] || parts[1])) {
                        const macMediaData = {
                            title: parts[0],
                            artist: parts[1] || '',
                            albumArt: parts[3] || null,
                            isPlaying: parts[2] === 'true'
                        };
                        mainWindow?.webContents.send('media-update', macMediaData);
                    } else {
                        mainWindow?.webContents.send('media-update', null);
                    }
                });

                if (child.stdin) {
                    child.stdin.write(fetchScript);
                    child.stdin.end();
                }
            });

            if (checkChild.stdin) {
                checkChild.stdin.write(checkAppsScript);
                checkChild.stdin.end();
            }
        }, 3000); // macOS: 3s polling — balanced between responsiveness and CPU
    }
}

function stopMediaPolling() {
    if (mediaPollingInterval) {
        clearInterval(mediaPollingInterval);
        mediaPollingInterval = null;
    }
    if (smtcWorker) {
        smtcWorker.terminate();
        smtcWorker = null;
    }
}

// ─── KoPlayer: Media Command Handler ───────────────────────────────
ipcMain.on('media-command', (_event, command: string) => {
    if (isWin) {
        // Use existing PowerShell process with user32.dll keybd_event
        // VK_MEDIA_PLAY_PAUSE = 0xB3, VK_MEDIA_NEXT_TRACK = 0xB0, VK_MEDIA_PREV_TRACK = 0xB1
        let vkCode = '';
        switch (command) {
            case 'play':
            case 'pause':
                vkCode = '0xB3';
                break;
            case 'next':
                vkCode = '0xB0';
                break;
            case 'prev':
                vkCode = '0xB1';
                break;
            default:
                return;
        }
        if (psProcess && psProcess.stdin) {
            psProcess.stdin.write(`[K]::keybd_event(${vkCode}, 0, 0, 0)\n[K]::keybd_event(${vkCode}, 0, 2, 0)\n`);
        }
    } else if (isMac) {
        let macCmd = '';
        switch (command) {
            case 'play':
            case 'pause':
                macCmd = 'playpause';
                break;
            case 'next':
                macCmd = 'next track';
                break;
            case 'prev':
                macCmd = 'previous track';
                break;
        }
        if (macCmd) {
            const script = `
                try
                    tell application "System Events"
                        set runningApps to name of every process
                    end tell
                    
                    if runningApps contains "Spotify" then
                        tell application "Spotify" to ${macCmd}
                    else if runningApps contains "Music" then
                        tell application "Music" to ${macCmd}
                    end if
                end try
            `;
            const childP = exec('osascript -');
            if (childP.stdin) {
                childP.stdin.write(script);
                childP.stdin.end();
            }
        }
    }
});

ipcMain.on('open-external', (_event, url: string) => {
    shell.openExternal(url);
});

// ─── Dynamic Extensions IPC Handlers ────────────────────────────────
const extensionsDir = path.join(app.getPath('userData'), 'extensions');
const extensionsConfigPath = path.join(app.getPath('userData'), 'extensions-config.json');

// Ensure extensions directory exists
if (!fs.existsSync(extensionsDir)) {
    fs.mkdirSync(extensionsDir, { recursive: true });
}

function getExtensionsConfig(): Record<string, boolean> {
    if (fs.existsSync(extensionsConfigPath)) {
        try {
            return JSON.parse(fs.readFileSync(extensionsConfigPath, 'utf8'));
        } catch (e) {
            console.error('Failed to parse extensions config:', e);
        }
    }
    return {};
}

function saveExtensionsConfig(config: Record<string, boolean>) {
    try {
        fs.writeFileSync(extensionsConfigPath, JSON.stringify(config, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save extensions config:', e);
    }
}

ipcMain.handle('get-installed-extensions', async () => {
    try {
        if (!fs.existsSync(extensionsDir)) {
            return [];
        }
        const dirs = fs.readdirSync(extensionsDir);
        const config = getExtensionsConfig();
        const installed: any[] = [];

        for (const dirName of dirs) {
            const dirPath = path.join(extensionsDir, dirName);
            if (!fs.statSync(dirPath).isDirectory()) continue;

            const manifestPath = path.join(dirPath, 'manifest.json');
            if (fs.existsSync(manifestPath)) {
                try {
                    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                    const entryPath = path.join(dirPath, manifest.entry || 'index.js');
                    let code = '';
                    if (fs.existsSync(entryPath)) {
                        code = fs.readFileSync(entryPath, 'utf8');
                    }
                    installed.push({
                        id: manifest.id || dirName,
                        name: manifest.name || dirName,
                        version: manifest.version || '1.0.0',
                        description: manifest.description || '',
                        icon: manifest.icon || 'extension',
                        image: manifest.image || '',
                        categories: manifest.categories || [],
                        versionNote: manifest.versionNote || '',
                        githubRepo: manifest.githubRepo || manifest.githubLink || '',
                        enabled: config[manifest.id] !== false, // default to enabled if not explicitly disabled
                        code: code
                    });
                } catch (err) {
                    console.error(`Failed to load manifest for extension ${dirName}:`, err);
                }
            }
        }
        return installed;
    } catch (e) {
        console.error('Failed to get installed extensions:', e);
        return [];
    }
});

ipcMain.handle('check-plugin-updates', async () => {
    try {
        if (!fs.existsSync(extensionsDir)) return [];
        const dirs = fs.readdirSync(extensionsDir);
        const updates: any[] = [];

        for (const dirName of dirs) {
            const dirPath = path.join(extensionsDir, dirName);
            if (!fs.statSync(dirPath).isDirectory()) continue;

            const manifestPath = path.join(dirPath, 'manifest.json');
            if (fs.existsSync(manifestPath)) {
                try {
                    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                    const repo = manifest.githubRepo || manifest.githubLink;
                    if (repo && repo.includes('/')) {
                        const releaseRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
                            headers: {
                                'Accept': 'application/vnd.github.v3+json',
                                'User-Agent': 'KoBar-App'
                            }
                        });
                        
                        if (releaseRes.ok) {
                            const releaseData = await releaseRes.json() as any;
                            const latestVersion = releaseData.tag_name || releaseData.name;
                            
                            const cleanCurrent = (manifest.version || '1.0.0').replace(/^v/, '');
                            const cleanLatest = (latestVersion || '').replace(/^v/, '');
                            
                            if (cleanLatest && cleanLatest !== cleanCurrent) {
                                updates.push({
                                    id: manifest.id || dirName,
                                    name: manifest.name || dirName,
                                    currentVersion: manifest.version || '1.0.0',
                                    latestVersion: cleanLatest,
                                    releaseNotes: releaseData.body || '',
                                    repo: repo
                                });
                            }
                        }
                    }
                } catch (err) {
                    console.error(`Failed to check updates for ${dirName}:`, err);
                }
            }
        }
        return updates;
    } catch (e) {
        console.error('Failed to check plugin updates:', e);
        return [];
    }
});

ipcMain.handle('get-available-extensions', async () => {
    // Marketplace is currently empty (users can load custom extensions via zip files)
    return [];
});

ipcMain.handle('install-extension', async (_event, id: string) => {
    try {
        const destDir = path.join(extensionsDir, id);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        let manifestContent = '';
        let indexJsContent = '';

        // 1. Try to fetch from Vite dev server if running
        try {
            const resManifest = await fetch(`http://localhost:5173/extensions/${id}/manifest.json`);
            const resIndex = await fetch(`http://localhost:5173/extensions/${id}/index.js`);
            if (resManifest.ok && resIndex.ok) {
                manifestContent = await resManifest.text();
                indexJsContent = await resIndex.text();
            }
        } catch (e) {
            // Dev server not available/failed
        }

        // 2. Try to copy from public assets folder in package
        if (!manifestContent || !indexJsContent) {
            try {
                const baseDir = isDev
                    ? path.join(__dirname, '../public/extensions', id)
                    : path.join(app.getAppPath(), 'dist/extensions', id);

                const manifestPath = path.join(baseDir, 'manifest.json');
                const indexPath = path.join(baseDir, 'index.js');

                if (fs.existsSync(manifestPath) && fs.existsSync(indexPath)) {
                    manifestContent = fs.readFileSync(manifestPath, 'utf8');
                    indexJsContent = fs.readFileSync(indexPath, 'utf8');
                }
            } catch (e) {
                // Fallback copy failed
            }
        }



        if (!manifestContent || !indexJsContent) {
            throw new Error('Extension source files not found.');
        }

        fs.writeFileSync(path.join(destDir, 'manifest.json'), manifestContent, 'utf8');
        fs.writeFileSync(path.join(destDir, 'index.js'), indexJsContent, 'utf8');

        // Set as enabled in config
        const config = getExtensionsConfig();
        config[id] = true;
        saveExtensionsConfig(config);

        return true;
    } catch (e) {
        console.error(`Failed to install extension ${id}:`, e);
        return false;
    }
});

ipcMain.handle('uninstall-extension', async (_event, id: string) => {
    try {
        const destDir = path.join(extensionsDir, id);
        if (fs.existsSync(destDir)) {
            fs.rmSync(destDir, { recursive: true, force: true });
        }
        const config = getExtensionsConfig();
        delete config[id];
        saveExtensionsConfig(config);
        return true;
    } catch (e) {
        console.error(`Failed to uninstall extension ${id}:`, e);
        return false;
    }
});

ipcMain.handle('toggle-extension-enabled', async (_event, id: string, enabled: boolean) => {
    try {
        const config = getExtensionsConfig();
        config[id] = enabled;
        saveExtensionsConfig(config);
        return true;
    } catch (e) {
        console.error(`Failed to toggle extension enabled state:`, e);
        return false;
    }
});

// Shared helper: installs an extension from a ZIP file path
async function installExtensionFromZipPath(zipPath: string, sourceRepo?: string, versionOverride?: string): Promise<{ success: boolean; reason?: string }> {
    const zip = new AdmZip(zipPath);
    
    // Extract to a temporary folder inside userData first to inspect manifest.json
    const tempExtractDir = path.join(app.getPath('userData'), 'temp_ext_' + Date.now());
    if (!fs.existsSync(tempExtractDir)) {
        fs.mkdirSync(tempExtractDir, { recursive: true });
    }

    zip.extractAllTo(tempExtractDir, true);

    // Check if manifest.json exists
    // Check both the root directory and the first level subdirectories for manifest.json
    let manifestPath = path.join(tempExtractDir, 'manifest.json');
    let searchDir = tempExtractDir;

    if (!fs.existsSync(manifestPath)) {
        const files = fs.readdirSync(tempExtractDir);
        if (files.length === 1) {
            const subDirPath = path.join(tempExtractDir, files[0]);
            if (fs.statSync(subDirPath).isDirectory()) {
                const subManifestPath = path.join(subDirPath, 'manifest.json');
                if (fs.existsSync(subManifestPath)) {
                    manifestPath = subManifestPath;
                    searchDir = subDirPath;
                }
            }
        } else {
            // Look for any subdirectory containing manifest.json at the top level
            for (const file of files) {
                const subDirPath = path.join(tempExtractDir, file);
                if (fs.statSync(subDirPath).isDirectory()) {
                    const subManifestPath = path.join(subDirPath, 'manifest.json');
                    if (fs.existsSync(subManifestPath)) {
                        manifestPath = subManifestPath;
                        searchDir = subDirPath;
                        break;
                    }
                }
            }
        }
    }

    if (!fs.existsSync(manifestPath)) {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
        return { success: false, reason: 'manifest.json not found in ZIP archive.' };
    }

    let manifest: any;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
        return { success: false, reason: 'Invalid manifest.json file.' };
    }

    if (!manifest.id || !manifest.name) {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
        return { success: false, reason: 'manifest.json is missing required fields "id" or "name".' };
    }

    if (sourceRepo || versionOverride) {
        if (sourceRepo) manifest.githubRepo = sourceRepo;
        if (versionOverride) manifest.version = versionOverride;
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4), 'utf8');
    }

    const extensionId = manifest.id;
    const targetDir = path.join(extensionsDir, extensionId);

    // If target directory already exists, clear it first
    if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
    }

    // Ensure parent extensions folder exists
    if (!fs.existsSync(extensionsDir)) {
        fs.mkdirSync(extensionsDir, { recursive: true });
    }

    // Copy/move searchDir (which contains manifest.json at its root) to targetDir
    fs.renameSync(searchDir, targetDir);

    // Clean up the temp extract root
    if (fs.existsSync(tempExtractDir)) {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
    }

    // Update config to enable this extension
    const config = getExtensionsConfig();
    config[extensionId] = true;
    saveExtensionsConfig(config);

    return { success: true };
}

ipcMain.handle('install-extension-from-file', async () => {
    try {
        // Pass mainWindow as parent so the dialog opens above the always-on-top window
        const parentWin = mainWindow || BrowserWindow.getAllWindows()[0];
        const dialogOptions = {
            title: 'Select Extension ZIP Archive',
            filters: [
                { name: 'ZIP Archives', extensions: ['zip'] }
            ],
            properties: ['openFile' as const]
        };

        const { canceled, filePaths } = parentWin
            ? await dialog.showOpenDialog(parentWin, dialogOptions)
            : await dialog.showOpenDialog(dialogOptions);

        if (canceled || filePaths.length === 0) {
            return { success: false, reason: 'Canceled by user' };
        }

        return await installExtensionFromZipPath(filePaths[0]);
    } catch (e: any) {
        console.error('Failed to install extension from file:', e);
        return { success: false, reason: e.message || 'Unknown error occurred.' };
    }
});

// Install extension from a file path directly (used by drag & drop)
ipcMain.handle('install-extension-from-path', async (_event, filePath: string) => {
    try {
        if (!filePath || typeof filePath !== 'string') {
            return { success: false, reason: 'Invalid file path.' };
        }
        if (!filePath.toLowerCase().endsWith('.zip')) {
            return { success: false, reason: 'Only .zip files are supported.' };
        }
        if (!fs.existsSync(filePath)) {
            return { success: false, reason: 'File not found.' };
        }
        return await installExtensionFromZipPath(filePath);
    } catch (e: any) {
        console.error('Failed to install extension from path:', e);
        return { success: false, reason: e.message || 'Unknown error occurred.' };
    }
});

ipcMain.handle('install-extension-from-github', async (_event, id: string, repo: string) => {
    try {
        if (!repo || !repo.includes('/')) {
            return { success: false, reason: 'Invalid GitHub repository format.' };
        }

        // 1. Fetch latest release metadata
        const releaseRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'KoBar-App'
            }
        });

        if (!releaseRes.ok) {
            return { success: false, reason: `Failed to fetch latest release metadata (${releaseRes.status}).` };
        }

        const releaseData = await releaseRes.json() as any;
        const asset = releaseData.assets?.find((a: any) => a.name.endsWith('.zip'));

        if (!asset && !releaseData.zipball_url) {
            return { success: false, reason: 'No .zip asset or source code found in the latest release.' };
        }

        // 2. Download the asset stream
        const downloadUrl = asset ? asset.url : releaseData.zipball_url;
        const headers: Record<string, string> = { 'User-Agent': 'KoBar-App' };
        if (asset) {
            headers['Accept'] = 'application/octet-stream';
        }

        const assetRes = await fetch(downloadUrl, { headers });

        if (!assetRes.ok || !assetRes.body) {
            return { success: false, reason: `Failed to download asset (${assetRes.status}).` };
        }

        const totalBytes = Number(assetRes.headers.get('content-length') || 0);
        let loadedBytes = 0;
        
        // 3. Pipe stream to temporary file and emit progress
        const tempZipPath = path.join(app.getPath('temp'), `plugin_${id}_${Date.now()}.zip`);
        const { Readable } = require('stream');
        const readableStream = Readable.fromWeb(assetRes.body as any);
        const writeStream = fs.createWriteStream(tempZipPath);

        readableStream.on('data', (chunk: Buffer) => {
            loadedBytes += chunk.length;
            if (totalBytes > 0 && mainWindow) {
                const percent = Math.round((loadedBytes / totalBytes) * 100);
                mainWindow.webContents.send('plugin-install-progress', { id, percent });
            }
        });

        await new Promise((resolve, reject) => {
            readableStream.pipe(writeStream)
                .on('finish', resolve)
                .on('error', reject);
        });

        // 4. Pass to existing installer, overriding the version with the release tag to prevent infinite update loops
        const latestVersion = (releaseData.tag_name || releaseData.name || '').replace(/^v/, '');
        const result = await installExtensionFromZipPath(tempZipPath, repo, latestVersion);
        
        // 5. Cleanup
        if (fs.existsSync(tempZipPath)) {
            fs.unlinkSync(tempZipPath);
        }

        return result;
    } catch (e: any) {
        console.error('Failed to install from GitHub:', e);
        return { success: false, reason: e.message || 'Unknown error occurred.' };
    }
});

ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

ipcMain.handle('is-dev', () => {
    return isDev;
});

ipcMain.handle('start-eyedropper', async () => {
    isEyeDropperActive = true;
    return { x: 0, y: 0 };
});

ipcMain.handle('stop-eyedropper', async () => {
    isEyeDropperActive = false;
});
