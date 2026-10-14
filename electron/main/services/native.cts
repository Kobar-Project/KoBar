// T-309: the persistent PowerShell bridge, moved unchanged out of main.cts. This is the ONLY module that owns the PowerShell child
// process: it spawns it, parses its stdout replies (`id|payload` lines, see electron/lib/psRequests.cts), applies the T-142
// respawn policy (electron/lib/respawnBackoff.cts) and kills it on quit. Everything else (pin tracking, global paste, media keys,
// PrintScreen) goes through the small API below. The pure helpers stay in electron/lib.
// T-317 (ARC-04): requests carry an id and a timeout (psRequests.cts, PS_REQUEST_TIMEOUT_MS = 1500 ms by default, null on
// timeout/failure, late replies ignored); stderr, unexpected exits and dropped writes are logged (rate-limited, never script
// bodies, electron/lib/psBridgeLog.cts); after a give-up a user action may restart the bridge (restartPsBridgeIfDown).
import { spawn, type ChildProcess } from 'child_process';
import { createOutageLog, createRateLimitedLog, sanitizePsLogLine } from '../../lib/psBridgeLog.cjs';
import { createLineReader, createPsRequests, type PsRequests } from '../../lib/psRequests.cjs';
import { createRespawnPolicy, createRestartGate, shouldRestartPsBridge } from '../../lib/respawnBackoff.cjs';

let psProcess: ChildProcess | null = null;
const psRequests = createPsRequests({
    send: (script) => {
        if (!psProcess || !psProcess.stdin || psProcess.stdin.destroyed) {
            noteDroppedWrite();
            throw new Error('powershell unavailable');
        }
        psProcess.stdin.write(script);
    },
});
const psRespawn = createRespawnPolicy();
let psQuitting = false;
let psRespawnTimer: ReturnType<typeof setTimeout> | null = null;
// T-317: bridge health, used only for logging and for the user-initiated restart after a give-up.
let psEverStarted = false;
let psGaveUp = false;
const psRestartGate = createRestartGate();
const psOutageLog = createOutageLog({ log: (message) => console.warn(message) });
const psStderrLog = createRateLimitedLog({ label: '[ps] stderr', log: (message) => console.warn(message) });
const psStdinErrorLog = createRateLimitedLog({ label: '[ps] stdin error', log: (message) => console.warn(message) });

/** Logs (rate-limited) that a write was dropped because the bridge is down. Writes are never queued for a later replay. */
function noteDroppedWrite(): void {
    if (psQuitting) return;
    const reason = psRespawnTimer
        ? 'restarting'
        : psGaveUp
          ? 'gave up after repeated crashes'
          : !psEverStarted
            ? 'not started'
            : 'stdin closed';
    psOutageLog.dropped(reason);
}

/** True while a PowerShell child exists (same check the old inline `psProcess && psProcess.stdin` guards used). */
export function isPsAvailable(): boolean {
    return !!(psProcess && psProcess.stdin);
}

/** Writes a script to the persistent PowerShell process if it is running; does nothing otherwise. */
export function psWrite(script: string): void {
    if (psProcess && psProcess.stdin) psProcess.stdin.write(script);
    else noteDroppedWrite();
}

/** Sends a request whose script echoes `id|payload`; resolves null on timeout/failure (see electron/lib/psRequests.cts). */
export const psRequest: PsRequests['request'] = (buildScript, opts) => psRequests.request(buildScript, opts);

/** Spawns the bridge. Windows only: the caller (main.cts) decides, exactly as before. */
export function startPsBridge(): void {
    const proc: ChildProcess = spawn('powershell', ['-NoProfile', '-Command', '-']);
    psProcess = proc;
    psRespawn.markStarted();
    psEverStarted = true;
    psGaveUp = false;
    psOutageLog.recovered();
    // One persistent stdout listener; replies are `id|payload` lines routed to pending requests.
    const psLineReader = createLineReader((line) => {
        psRequests.handleLine(line);
    });
    proc.stdout?.on('data', (chunk: Buffer) => psLineReader.push(chunk));
    // T-317: stderr is drained and logged line by line (control characters stripped, cut to a short prefix, rate-limited).
    const psStderrReader = createLineReader((line) => {
        const text = sanitizePsLogLine(line);
        if (text) psStderrLog.write(text);
    });
    proc.stderr?.on('data', (chunk: Buffer) => psStderrReader.push(chunk));
    proc.stdin?.on('error', (err: NodeJS.ErrnoException) => {
        psRequests.rejectAll();
        if (!psQuitting) psStdinErrorLog.write(sanitizePsLogLine(err.code ?? err.message));
    });
    // T-142: an unexpected exit (crash) respawns the bridge a few times with backoff; a quit never does.
    let handledExit = false;
    const onBridgeDown = (detail: string) => {
        if (handledExit) return;
        handledExit = true;
        if (psProcess !== proc) return;
        psRequests.rejectAll();
        psProcess = null;
        if (psQuitting) return;
        try {
            proc.kill();
        } catch {
            /* already gone */
        }
        const delay = psRespawn.nextDelay();
        if (delay === null) {
            psGaveUp = true;
            console.error(
                `[ps] PowerShell bridge exited (${detail}) and keeps crashing; giving up (pin and paste helpers are unavailable).`
            );
            return;
        }
        console.warn(`[ps] PowerShell bridge exited (${detail}); respawn attempt ${psRespawn.attempts()} in ${delay} ms.`);
        psRespawnTimer = setTimeout(() => {
            psRespawnTimer = null;
            if (!psQuitting && !psProcess) startPsBridge();
        }, delay);
    };
    proc.on('exit', (code, signal) => onBridgeDown(`code ${code}, signal ${signal}`));
    proc.on('error', (err: NodeJS.ErrnoException) => onBridgeDown(`error ${sanitizePsLogLine(err.code ?? err.message)}`));
    proc.stdin?.write(
        `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class K { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo); [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags); [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex); [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong); [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect); [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd); [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int dwAttribute, out RECT pvAttribute, int cbAttribute); [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int dwAttribute, out int pvAttribute, int cbAttribute); [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value); [DllImport("user32.dll")] static extern bool SetProcessDPIAware(); [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int v); public static void InitDpi() { try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch (Exception) { } try { if (SetProcessDpiAwareness(2) == 0) return; } catch (Exception) { } try { SetProcessDPIAware(); } catch (Exception) { } } public static bool IsCloaked(IntPtr h) { try { int c; return DwmGetWindowAttribute(h, 14, out c, 4) == 0 && c != 0; } catch (Exception) { return false; } } public static bool GetVisibleRect(IntPtr h, out RECT r) { try { if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) == 0 && r.Right > r.Left && r.Bottom > r.Top) return true; } catch (Exception) { } return GetWindowRect(h, out r); } [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; } }'\n[K]::InitDpi()\n`
    );
}

/**
 * T-317: for user-initiated actions (pin targeting, PrintScreen). If the bridge gave up after repeated crashes, start a fresh one
 * with a fresh respawn budget, at most once per PS_RESTART_COOLDOWN_MS. No-op while the bridge runs or a respawn is pending, when it
 * never gave up (so it never starts a bridge the lifecycle did not start, e.g. on macOS) and once quitting has begun.
 */
export function restartPsBridgeIfDown(): void {
    const state = { quitting: psQuitting, running: !!psProcess, respawnPending: !!psRespawnTimer, gaveUp: psGaveUp };
    if (!shouldRestartPsBridge(state)) return;
    if (!psRestartGate.tryAcquire()) return;
    console.warn('[ps] Restarting the PowerShell bridge for a user action.');
    psRespawn.reset();
    startPsBridge();
}

/** will-quit: no respawn from now on, cancel a pending respawn and kill the child. */
export function stopPsBridge(): void {
    psQuitting = true;
    if (psRespawnTimer) clearTimeout(psRespawnTimer);
    if (psProcess) psProcess.kill();
}
