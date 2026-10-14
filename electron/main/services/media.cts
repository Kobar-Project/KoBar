// T-311: OS media polling (Windows SMTC worker thread, macOS osascript), the media-update / video-urls-update change filter, the
// media-command / media-resync handlers and the bundled melodies, moved unchanged out of main.cts. The module owns its state
// (poll interval, worker, last SMTC source/album art); pip.cts reads the SMTC values through the exported getters and the window
// modules receive `mediaChangeFilter` through main.cts's windowDeps(). registerMediaIpc() runs at the position the handlers were
// registered before. T-316: polling is lazy. updateMediaDemand() (whenReady, extensions config changes, PiP open/close) starts it
// only while the media plugin is enabled or a PiP window is open (policy: services/mediaDemand.cts); will-quit still stops it.
import { ipcMain } from 'electron';
import * as fs from 'fs';
import { exec } from 'child_process';
import { Worker } from 'worker_threads';
import { createChangeFilter } from '../../lib/dedupe.cjs';
import { resolveInside } from '../../lib/paths.cjs';
import type { AppPaths } from '../lib/appPaths.cjs';
import { appState } from '../state.cjs';
import { isPsAvailable, psWrite } from './native.cjs';
import { runVideoUrlScan } from './pip.cjs';
import { createMediaDemandController } from './mediaDemand.cjs';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

export interface MediaDeps {
    appPaths: AppPaths;
}

let smtcWorker: Worker | null = null;
// KoPlayer Media Polling
let mediaPollingInterval: ReturnType<typeof setInterval> | null = null;
// Bumped by every stop: results of a stopped polling session (late worker message, scan or osascript callback) are dropped (T-316).
let mediaPollGeneration = 0;

// Video PiP — background URL scan debounce
const BROWSER_APP_IDS = ['chrome', 'msedge', 'brave', 'firefox', 'opera', 'vivaldi'];
let lastVideoScanAt = 0;
const VIDEO_SCAN_DEBOUNCE_MS = 5000;
let lastSmtcSourceAppId = '';
let lastSmtcAlbumArt: string | null = null;

export function getLastSmtcAlbumArt(): string | null {
    return lastSmtcAlbumArt;
}

export function getLastSmtcSourceAppId(): string {
    return lastSmtcSourceAppId;
}

// ─── KoPlayer: OS Media Polling ────────────────────────────────────
// Only changed payloads reach the renderer (T-128). Late subscribers (reload, HMR) get the current state through the
// `media-resync` handler below (main path); the reset on did-finish-load is only a fallback.
export const mediaChangeFilter = createChangeFilter();

function sendMediaChannel(channel: 'media-update' | 'video-urls-update', payload: unknown) {
    if (!appState.mainWindow || appState.mainWindow.isDestroyed()) return;
    if (!mediaChangeFilter.shouldSend(channel, payload)) return;
    appState.mainWindow.webContents.send(channel, payload);
    // The PiP window (narrow pip-preload) shows the live title/art, so it also receives media-update (T-136).
    if (
        channel === 'media-update' &&
        appState.pipWindow &&
        !appState.pipWindow.isDestroyed() &&
        !appState.pipWindow.webContents.isDestroyed()
    ) {
        appState.pipWindow.webContents.send(channel, payload);
    }
}

export function startMediaPolling(deps: MediaDeps) {
    if (mediaPollingInterval) return;
    // A fresh session forgets what was sent, so its first poll pushes the current state (T-316: also after a lazy start).
    mediaChangeFilter.reset();
    const generation = mediaPollGeneration;
    const isCurrent = () => generation === mediaPollGeneration;
    const send: typeof sendMediaChannel = (channel, payload) => {
        if (isCurrent()) sendMediaChannel(channel, payload);
    };

    if (isWin) {
        // Use Worker thread for Windows SMTC to prevent main thread lock
        try {
            const workerPath = deps.appPaths.smtcWorker;

            smtcWorker = new Worker(workerPath);
            smtcWorker.on('message', (msg) => {
                if (!isCurrent()) return;
                if (msg.type === 'poll-result' && appState.mainWindow) {
                    const mediaData = msg.data;
                    send('media-update', mediaData);

                    // Video PiP: if the current media source is a browser, run a
                    // background URL scan (debounced) and cache results for instant PiP open.
                    if (mediaData) {
                        const appId: string = (mediaData.sourceAppId || '').toLowerCase();
                        lastSmtcSourceAppId = appId;
                        lastSmtcAlbumArt = mediaData.albumArt || null;
                        const isBrowser = BROWSER_APP_IDS.some((b) => appId.includes(b));
                        if (isBrowser) {
                            const now = Date.now();
                            if (now - lastVideoScanAt >= VIDEO_SCAN_DEBOUNCE_MS) {
                                lastVideoScanAt = now;
                                runVideoUrlScan()
                                    .then((urls) => {
                                        send('video-urls-update', urls);
                                    })
                                    .catch(() => {});
                            }
                        } else {
                            // Non-browser source: clear cached video URLs
                            send('video-urls-update', []);
                        }
                    } else {
                        lastSmtcSourceAppId = '';
                        lastSmtcAlbumArt = null;
                        send('video-urls-update', []);
                    }
                }
            });
            smtcWorker.on('error', (err) => {
                // A terminated worker of an earlier session must not stop the current one.
                if (!isCurrent()) return;
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
            if (!appState.mainWindow || macMediaPollingBusy) return;
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
                // Stopped meanwhile (T-316): do not spawn the second osascript for a dead session.
                if (!isCurrent()) {
                    macMediaPollingBusy = false;
                    return;
                }
                if (err) {
                    macMediaPollingBusy = false;
                    if (err.message && err.message.includes('-1743')) {
                        send('media-update', {
                            title: 'Permission Required',
                            artist: 'Enable Automation in System Settings',
                            albumArt: null,
                            isPlaying: false,
                        });
                    } else {
                        send('media-update', null);
                    }
                    return;
                }
                const targetApp = (stdout || '').trim();

                // If none of our supported apps are running
                if (!targetApp) {
                    macMediaPollingBusy = false;
                    send('media-update', null);
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

                const child = exec('osascript -', (error, fetchStdout) => {
                    macMediaPollingBusy = false;
                    if (error || !fetchStdout.trim()) {
                        send('media-update', null);
                        return;
                    }
                    const parts = fetchStdout.trim().split('||');
                    if (parts.length >= 3 && (parts[0] || parts[1])) {
                        const macMediaData = {
                            title: parts[0],
                            artist: parts[1] || '',
                            albumArt: parts[3] || null,
                            isPlaying: parts[2] === 'true',
                        };
                        send('media-update', macMediaData);
                    } else {
                        send('media-update', null);
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

export function stopMediaPolling() {
    mediaPollGeneration++;
    if (mediaPollingInterval) {
        clearInterval(mediaPollingInterval);
        mediaPollingInterval = null;
    }
    if (smtcWorker) {
        smtcWorker.terminate();
        smtcWorker = null;
    }
}

// ─── T-316: lazy start/stop ───────────────────────────────────────
let mediaDeps: MediaDeps | null = null;
let mediaPluginProbe: () => boolean = () => false;

/** The polling stopped because nobody needs it: the renderer (and an open PiP) must not keep showing the last track. */
function clearMediaState(): void {
    lastSmtcSourceAppId = '';
    lastSmtcAlbumArt = null;
    const lastMedia = mediaChangeFilter.last('media-update');
    if (lastMedia && lastMedia.payload !== null) sendMediaChannel('media-update', null);
    const lastUrls = mediaChangeFilter.last('video-urls-update');
    if (lastUrls && Array.isArray(lastUrls.payload) && lastUrls.payload.length > 0) sendMediaChannel('video-urls-update', []);
}

const mediaDemand = createMediaDemandController({
    isMediaPluginEnabled: () => mediaPluginProbe(),
    isPipOpen: () => !!appState.pipWindow && !appState.pipWindow.isDestroyed(),
    isRunning: () => mediaPollingInterval !== null,
    start: () => {
        if (mediaDeps) startMediaPolling(mediaDeps);
    },
    stop: () => stopMediaPolling(),
    clearMedia: () => clearMediaState(),
});

/** Where the controller learns whether the media plugin is enabled (bootstrap.cts, once the extensions config exists). */
export function setMediaPluginProbe(probe: () => boolean): void {
    mediaPluginProbe = probe;
}

/**
 * Starts or stops media polling for the current demand (media plugin enabled, PiP open). Idempotent: called at startup (with the
 * deps, replacing the old unconditional start), after every extensions config change and when a PiP window opens or closes.
 */
export function updateMediaDemand(deps?: MediaDeps): boolean {
    if (deps) mediaDeps = deps;
    try {
        return mediaDemand.update();
    } catch (e) {
        // Never break the caller (startup, an extensions IPC reply, PiP window creation) over media polling.
        console.error('[KoPlayer] Failed to update media polling demand:', e);
        return false;
    }
}

export function registerMediaIpc(deps: MediaDeps): void {
    const { appPaths } = deps;

    // Melodies shipped in Assets/Melody (exact file names, without extension).
    const MELODY_NAMES = new Set(['Alarm', 'Bells', 'Calming', 'Cosmic', 'Guitar', 'Hiphop', 'Ringtones']);

    ipcMain.handle('get-melody-audio', async (_event, melodyName: string) => {
        try {
            if (typeof melodyName !== 'string' || !MELODY_NAMES.has(melodyName)) return null;
            const audioPath = resolveInside(appPaths.melodyDir, `${melodyName}.ogg`);
            if (audioPath && fs.existsSync(audioPath)) {
                const buf = await fs.promises.readFile(audioPath);
                return `data:audio/ogg;base64,${buf.toString('base64')}`;
            }
            return null;
        } catch (e) {
            console.error('Failed to load melody audio:', e);
            return null;
        }
    });

    // A renderer that subscribes late (reload, HMR, plugin) asks for the current state; the filter would otherwise
    // never resend an unchanged payload. Only the main window is served (T-112).
    ipcMain.on('media-resync', (event, channel: unknown) => {
        if (!appState.mainWindow || appState.mainWindow.isDestroyed() || event.sender !== appState.mainWindow.webContents) return;
        if (channel !== 'media-update' && channel !== 'video-urls-update') return;
        const last = mediaChangeFilter.last(channel);
        if (last) appState.mainWindow.webContents.send(channel, last.payload);
        else mediaChangeFilter.reset();
    });

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
            if (isPsAvailable()) {
                psWrite(`[K]::keybd_event(${vkCode}, 0, 0, 0)\n[K]::keybd_event(${vkCode}, 0, 2, 0)\n`);
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
}
