// Dev-only DevTools opt-in. The main window is frameless, transparent and screen-sized, so docked DevTools renders as a grey
// full-screen overlay; a detached window is used instead. Packaged builds never open DevTools through this path.
export function shouldOpenDevTools(isPackaged: boolean, env: Record<string, string | undefined>): boolean {
    return !isPackaged && env.KOBAR_DEVTOOLS === '1';
}
