// T-615: how the main window opens the Settings window. The store's openSettingsTab / openPluginsTab (kept on window.useAppStore for
// v1 plugins) call openSettingsPage(); src/main.tsx registers the claim-once preload bridge's `openSettings` here at startup. Kept in
// its own module so the store does not import the sync module (which imports the store types). Outside Electron (tests, browser)
// nothing is registered and opening is a no-op that reports false.

export type SettingsPageName = 'general' | 'appearance' | 'sidebar' | 'plugins' | 'workspaces' | 'backup' | 'integrations' | 'about';

type Opener = (page?: string) => void;
let opener: Opener | null = null;

/** Registers (or with null, removes) the function that asks main to open the Settings window. */
export function setSettingsOpener(next: Opener | null): void {
    opener = next;
}

/** Opens (or focuses) the Settings window, at `page` when given. Never throws; false when there is no opener. */
export function openSettingsPage(page?: SettingsPageName): boolean {
    if (!opener) return false;
    try {
        opener(page);
        return true;
    } catch (err) {
        console.error('[KoBar] Could not open the Settings window:', err);
        return false;
    }
}
