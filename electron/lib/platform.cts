// MAC-010: the single source of the always-on-top level of KoBar's windows. Pure (no Electron import), so tests/platform.test.ts covers it.
// macOS: 'floating' stays above the Dock and normal windows but below system (TCC / permission) prompts; 'screen-saver' would cover them.
// Windows (and Linux): 'screen-saver' is the highest DWM topmost band, which is what the bar has always used there.
export type TopmostLevel = 'floating' | 'screen-saver';

export function topmostLevelFor(platform: NodeJS.Platform): TopmostLevel {
    return platform === 'darwin' ? 'floating' : 'screen-saver';
}
