// T-607: re-reads the OS login-item state after the Settings window changed `launchAtStartup`. The Settings window has no
// window.api: its `setLaunchAtStartup` action is applied in the main window (src/store/sync.ts), whose store setter sends
// `set-auto-launch` to main. Main may refuse (Cancel in the native confirmation, which is parented to the MAIN window, or another
// dialog busy), so, following the source-of-truth decision T-139 (the OS login-item state wins; the old
// useAutoLaunchSync hook was merged into this module in T-615d), the OS value is read once afterwards: on the main window's next focus (it gets focus back when the confirmation closes) or, when no dialog
// appears (turning it OFF), after a short delay if the main window has focus. Plain setState on purpose: the setter would send
// the value back to main.

export const AUTO_LAUNCH_RESYNC_DELAY_MS = 1500;

export interface AutoLaunchResyncDeps {
    /** The main window (focus events, hasFocus). */
    win: Pick<Window, 'addEventListener' | 'removeEventListener'> & { document: Pick<Document, 'hasFocus'> };
    /** `window.api.getAutoLaunch`, or undefined outside Electron. */
    read: () => Promise<unknown> | undefined;
    /** Writes the OS value into the store without calling the setter. */
    apply: (enabled: boolean) => void;
    delayMs?: number;
}

/** Returns the trigger to call right after an applied `setLaunchAtStartup` action. */
export function createAutoLaunchResync(deps: AutoLaunchResyncDeps): () => void {
    const { win, read, apply } = deps;
    const delayMs = deps.delayMs ?? AUTO_LAUNCH_RESYNC_DELAY_MS;
    let seq = 0;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function readNow(): void {
        const current = ++seq;
        let result: Promise<unknown> | undefined;
        try {
            result = read();
        } catch {
            return;
        }
        result
            ?.then((enabled) => {
                if (current !== seq) return;
                if (typeof enabled === 'boolean') apply(enabled);
            })
            .catch(() => undefined);
    }

    function onFocus(): void {
        if (!pending) return;
        pending = false;
        clearTimeout(timer);
        timer = undefined;
        win.removeEventListener('focus', onFocus);
        readNow();
    }

    return () => {
        // A newer toggle makes any read still in flight stale.
        seq++;
        clearTimeout(timer);
        pending = true;
        win.removeEventListener('focus', onFocus);
        win.addEventListener('focus', onFocus);
        // Fallback when no dialog appears. It never clears `pending`: while a confirmation is open the main window has no focus
        // and a read now would return the not-yet-decided value; the focus event after the dialog closes does the final read.
        timer = setTimeout(() => {
            timer = undefined;
            if (win.document.hasFocus()) readNow();
        }, delayMs);
    };
}
