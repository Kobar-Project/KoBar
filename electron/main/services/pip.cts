// T-310: Video PiP IPC (open/close, the browser video-URL scan, the SMTC source query) and the generic move-window handler, moved
// unchanged out of main.cts. The PiP window itself is created in electron/main/windows/pipWindow.cts. The live SMTC values are
// owned by the media polling code in services/media.cts (T-311), so they are read through injected getters (never copied).
import { BrowserWindow, ipcMain } from 'electron';
import { exec } from 'child_process';
import { appState } from '../state.cjs';
import { createPipWindow, type PipWindowDeps } from '../windows/pipWindow.cjs';

const isWin = process.platform === 'win32';

export interface PipIpcDeps {
    /** What the window modules need from main.cts (a function, evaluated when a PiP window is opened). */
    windowDeps: () => PipWindowDeps;
    getLastSmtcAlbumArt: () => string | null;
    getLastSmtcSourceAppId: () => string;
}

// ─── PIP Video Player (Webview-based mini browser) ───────────────────────────────

/**
 * Extract video URLs from open browsers (shared between on-demand and background scans).
 */
export function runVideoUrlScan(): Promise<string[]> {
    return new Promise<string[]>((resolve) => {
        if (!isWin) {
            resolve([]);
            return;
        }

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
            if (err || !stdout.trim()) {
                resolve([]);
                return;
            }
            const lines = stdout
                .split('\n')
                .map((l: string) => l.trim())
                .filter((l: string) => l.startsWith('http'));
            resolve(lines);
        });
        if (child.stdin) {
            child.stdin.write(psScript);
            child.stdin.end();
        }
    });
}

export function registerPipIpc(deps: PipIpcDeps) {
    const { windowDeps, getLastSmtcAlbumArt, getLastSmtcSourceAppId } = deps;

    // Detect video URLs playing in open browsers using PowerShell UIAutomation
    // Returns an array of video URLs found in Chrome/Edge/Brave/Firefox address bars
    ipcMain.handle('get-active-video-urls', () => runVideoUrlScan());

    // Open PIP with a URL (mini browser approach — no capture needed)
    ipcMain.on('open-pip', (_event, { url, title, albumArt }: { url: string; title: string; albumArt?: string }) => {
        createPipWindow(windowDeps(), url, title, albumArt || getLastSmtcAlbumArt() || undefined);
    });

    // Return current SMTC source app ID (for renderer to query on-demand)
    ipcMain.handle('get-smtc-source', () => getLastSmtcSourceAppId());

    // Close PIP window
    ipcMain.on('close-pip', () => {
        if (appState.pipWindow && !appState.pipWindow.isDestroyed()) {
            appState.pipWindow.close(); // the 'closed' handler clears pipWindow and announces pip-closed
        }
    });

    ipcMain.on('move-window', (event, { dx, dy }) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
            const [x, y] = win.getPosition();
            win.setPosition(Math.round(x + dx), Math.round(y + dy));
        }
    });
}
