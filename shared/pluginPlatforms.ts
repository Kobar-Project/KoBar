// MAC-060: host-side platform map for plugins (interim; an optional manifest `platforms` field may follow in MAC-061). Pure, no Electron:
// the Settings window uses it to mark a plugin as unsupported on the current OS. Only listed ids are restricted.
export type PluginPlatform = 'win32' | 'darwin' | 'linux';

export const PLUGIN_PLATFORM_ONLY: Readonly<Record<string, readonly PluginPlatform[]>> = Object.freeze({
    'pin-window-to-top': ['win32'],
});

/** Unknown id or unknown platform means supported. */
export function isPluginSupportedOn(id: string, platform: string | null | undefined): boolean {
    if (!platform || !Object.prototype.hasOwnProperty.call(PLUGIN_PLATFORM_ONLY, id)) return true;
    if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux') return true;
    return PLUGIN_PLATFORM_ONLY[id].includes(platform);
}

/** Display name of a platform (a product name, not translated). */
export function platformDisplayName(platform: PluginPlatform): string {
    return platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux';
}
