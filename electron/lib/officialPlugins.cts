// The official KoBar plugins (published under the Kobar-Project GitHub organisation and listed in the
// plugin registry). Their ids are reserved: a package from any other source may not claim them.

/** Manifest ids of the 13 official plugins (= their folder names in userData/extensions). */
export const OFFICIAL_PLUGIN_IDS: readonly string[] = Object.freeze([
    'com.kobar.aihub',
    'com.kobar.calculator.plugin',
    'com.kobar.clipboardmanager',
    'com.kobar.kobox',
    'focus-mode-plugin',
    'ko-calender-plugin',
    'kobar-colorpicker-plugin',
    'kobar.shortcuts',
    'koplayer-plugin',
    'pin-window-to-top',
    'screenshot-studio-overlay',
    'snippetvault-plugin',
    'todolist-plugin',
]);

/** GitHub owner of every official plugin repository (GitHub owner names are case-insensitive). */
export const OFFICIAL_GITHUB_OWNER = 'Kobar-Project';

const OFFICIAL_ID_SET = new Set(OFFICIAL_PLUGIN_IDS);

/** True when `id` is exactly one of the reserved official plugin ids. */
export function isOfficialPluginId(id: unknown): boolean {
    return typeof id === 'string' && OFFICIAL_ID_SET.has(id);
}

/** True when `owner` is the official GitHub organisation (case-insensitive, ASCII). */
export function isOfficialGithubOwner(owner: unknown): boolean {
    return typeof owner === 'string' && owner.toLowerCase() === OFFICIAL_GITHUB_OWNER.toLowerCase();
}
