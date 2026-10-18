// MAC-010: platform flags and the always-on-top level bound to the running OS (the pure rule is in electron/lib/platform.cts).
import { topmostLevelFor, type TopmostLevel } from '../lib/platform.cjs';

export const isMac = process.platform === 'darwin';
export const isWin = process.platform === 'win32';

export function topmostLevel(): TopmostLevel {
    return topmostLevelFor(process.platform);
}
