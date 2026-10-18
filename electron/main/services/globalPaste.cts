// T-308: global paste mode (Ctrl+V capture, paste token, simulated paste), moved out of main.cts.
// R4: the flow is the state machine in electron/lib/pasteSession.cts (one paste at a time, key repeat folded, verified clipboard
// write, injection only after V is up, shortcut re-registered only after the injection ran). This module only wires it to
// Electron, the renderer and the PowerShell bridge (native.cts psRequest; scripts in electron/lib/pasteScripts.cts). Pure helpers
// stay in electron/lib/globalPaste.cts and electron/lib/pasteToken.cts. KOBAR_DEBUG_PASTE logs steps only, never content.
import { exec } from 'child_process';
import { globalShortcut, ipcMain } from 'electron';
import { createPasteToken } from '../../lib/pasteToken.cjs';
import { pasteDbg } from '../../lib/pasteDebug.cjs';
import { decideGlobalPasteMode } from '../../lib/globalPaste.cjs';
import { createPasteSession, type PasteSession } from '../../lib/pasteSession.cjs';
import { injectPasteScript, isKeyDownScript, parseKeyDownReply } from '../../lib/pasteScripts.cjs';
import type { PsRequests } from '../../lib/psRequests.cjs';
import { appState } from '../state.cjs';
import { topmostLevel } from '../platform.cjs';
import { runClipboardTask, writeClipboardEntryVerified } from './clipboard.cjs';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

/** How long one key-state query may take before it counts as "unknown" (treated as released by the session). */
const KEY_QUERY_TIMEOUT_MS = 1000;
/** The injection script starts a PowerShell SendInput call; allow more than the 1500 ms default before it counts as not run. */
const INJECT_TIMEOUT_MS = 5000;
/** Non-Windows has no key-state query, so key repeat is folded by time instead. */
const REPEAT_GUARD_MS = 150;

type PasteItem = Parameters<typeof writeClipboardEntryVerified>[0];

export interface GlobalPasteDeps {
    /** native.cts psRequest: sends a script that echoes `id|payload`; resolves null when the bridge is down or times out. */
    psRequest: PsRequests['request'];
}

const pasteToken = createPasteToken();
// R3-01 (diagnostics only): when/for whom the last token was issued, to explain a refusal in the debug log.
let dbgIssuedAt = 0;
let dbgIssuedOwner = -1;
function dbgNoteIssue(senderId: number) {
    dbgIssuedAt = Date.now();
    dbgIssuedOwner = senderId;
}
function dbgRefusalReason(senderId: number): string {
    if (dbgIssuedAt === 0) return 'no token issued (or already consumed)';
    if (dbgIssuedOwner !== senderId) return 'sender mismatch';
    return 'token expired';
}

// Only this path (main's own Ctrl+V shortcut, through the session) issues the token that execute-global-paste requires.
function requestNextPaste(): boolean {
    const win = appState.mainWindow;
    if (!win) return false;
    pasteToken.issue(win.webContents.id);
    win.webContents.send('request-next-paste');
    dbgNoteIssue(win.webContents.id);
    pasteDbg('paste token issued, request-next-paste sent');
    return true;
}

// SEC-13: honour only a reply to a recent main-initiated request-next-paste, once.
function consumePasteToken(senderId: number): boolean {
    const ok = pasteToken.consume(senderId);
    pasteDbg(ok ? 'paste token consumed' : `paste token refused: ${dbgRefusalReason(senderId)}`);
    dbgIssuedAt = 0;
    return ok;
}

async function isKeyDownWin(deps: GlobalPasteDeps, vk: number): Promise<boolean | null> {
    return parseKeyDownReply(await deps.psRequest((id) => isKeyDownScript(id, vk), { timeoutMs: KEY_QUERY_TIMEOUT_MS }));
}

async function injectWin(deps: GlobalPasteDeps): Promise<boolean> {
    pasteDbg('simulated Ctrl+V sent to PowerShell bridge');
    const reply = await deps.psRequest((id) => injectPasteScript(id), { timeoutMs: INJECT_TIMEOUT_MS });
    // An elevated target app (UIPI) silently drops injected keys; the script still runs, so this cannot be detected here.
    pasteDbg(reply === 'OK' ? 'simulated Ctrl+V ran' : 'simulated Ctrl+V got no confirmation (bridge down or timeout)');
    return reply === 'OK';
}

// macOS: unchanged osascript flow, as one injection step. The 150 ms after the keystroke is the old wait before re-registering.
function injectMac(): Promise<boolean> {
    const macSysPrefs = require('electron').systemPreferences;
    if (!macSysPrefs.isTrustedAccessibilityClient(false)) {
        // Prompt the user to grant Accessibility (required for keystroke injection); no paste this time.
        macSysPrefs.isTrustedAccessibilityClient(true);
        appState.mainWindow?.webContents.send('clipboard-paste-error', {
            error: 'accessibility_required',
            message: 'Enable Accessibility for KoBar in System Settings',
        });
        return Promise.resolve(false);
    }
    // Hide KoBar so the target app has focus for the keystroke.
    if (appState.mainWindow) appState.mainWindow.hide();
    return new Promise((resolve) => {
        setTimeout(() => {
            exec(
                'osascript -e \'tell application "System Events"\n  delay 0.05\n  keystroke "v" using command down\nend tell\'',
                (err, _stdout, stderr) => {
                    if (err) console.error('[Clipboard] macOS Paste Error:', stderr || err);
                    if (appState.mainWindow) {
                        appState.mainWindow.show();
                        appState.mainWindow.setAlwaysOnTop(true, topmostLevel(), 1);
                    }
                    setTimeout(() => resolve(!err), 150);
                }
            );
        }, 100);
    });
}

function createGlobalPasteSession(deps: GlobalPasteDeps): PasteSession<PasteItem> {
    const session: PasteSession<PasteItem> = createPasteSession<PasteItem>(
        {
            register: () =>
                globalShortcut.register('CommandOrControl+V', () => {
                    pasteDbg('shortcut Ctrl+V captured');
                    session.hotkey();
                }),
            unregister: () => globalShortcut.unregister('CommandOrControl+V'),
            requestItem: requestNextPaste,
            consumeToken: consumePasteToken,
            // The clipboard queue serializes this with the poller and the other writers.
            writeAndVerify: (item) => runClipboardTask(() => writeClipboardEntryVerified(item)),
            // Only Windows can query the physical key state; elsewhere the key counts as released (the old behaviour).
            isKeyDown: (vk) => (isWin ? isKeyDownWin(deps, vk) : Promise.resolve(false)),
            inject: () => {
                if (isWin) return injectWin(deps);
                if (isMac) return injectMac();
                // Other platforms never simulated a keypress; keep the old 600 ms before the shortcut comes back.
                return new Promise((resolve) => setTimeout(() => resolve(false), 600));
            },
            sendError: (reason) => {
                appState.mainWindow?.webContents.send('clipboard-paste-error', {
                    error: reason,
                    message: 'The clipboard could not be written, so nothing was pasted.',
                });
            },
            now: Date.now,
            setTimer: (fn, ms) => setTimeout(fn, ms),
            clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
            log: pasteDbg,
        },
        { repeatGuardMs: isWin ? 0 : REPEAT_GUARD_MS }
    );
    return session;
}

export function registerGlobalPasteIpc(deps: GlobalPasteDeps) {
    const session = createGlobalPasteSession(deps);

    ipcMain.on('set-global-paste-mode', (_event, isActive: unknown) => {
        // T-037: ignore non-boolean input and calls that do not change the mode (no repeated register/unregister).
        pasteDbg(
            `set-global-paste-mode received: ${typeof isActive === 'boolean' ? isActive : 'non-boolean'} (current=${session.isModeOn()})`
        );
        const action = decideGlobalPasteMode(session.isModeOn(), isActive);
        if (action === 'ignore') {
            pasteDbg('set-global-paste-mode ignored (no change or invalid)');
            return;
        }
        // Enable registers Ctrl+V (a failure leaves the mode off, so a later setGlobalPasteMode(true) retries). Disable releases
        // it; an authorized paste in flight still completes (R-01) and no modifier key-ups are injected (R4).
        const active = session.setMode(action === 'enable');
        pasteDbg(`mode active=${active}`);
    });

    ipcMain.on('execute-global-paste', (event, data) => {
        pasteDbg(`renderer IPC execute-global-paste received (slot index=${typeof data?.index === 'number' ? data.index : 'n/a'})`);
        // The session consumes the paste token first (SEC-13) and accepts one item per request.
        session.item(event.sender.id, data);
    });
}
