import { describe, expect, it } from 'vitest';
import { isPluginSupportedOn, PLUGIN_PLATFORM_ONLY } from '../shared/pluginPlatforms';

describe('isPluginSupportedOn', () => {
    it('restricts pin-window-to-top to win32', () => {
        expect(PLUGIN_PLATFORM_ONLY['pin-window-to-top']).toEqual(['win32']);
        expect(isPluginSupportedOn('pin-window-to-top', 'win32')).toBe(true);
        expect(isPluginSupportedOn('pin-window-to-top', 'darwin')).toBe(false);
        expect(isPluginSupportedOn('pin-window-to-top', 'linux')).toBe(false);
    });
    it('treats unknown ids and unknown platforms as supported', () => {
        expect(isPluginSupportedOn('com.kobar.aihub', 'darwin')).toBe(true);
        expect(isPluginSupportedOn('pin-window-to-top', null)).toBe(true);
        expect(isPluginSupportedOn('pin-window-to-top', 'freebsd')).toBe(true);
        expect(isPluginSupportedOn('toString', 'darwin')).toBe(true);
    });
});
