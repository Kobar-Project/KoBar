// Pin tracker reply parsing (T-147). The PowerShell position script answers one line per request:
//   POS:l,t,r,b  visible frame rect in physical pixels
//   HIDDEN       window exists but is not visible (minimized, SW_HIDE, cloaked / other virtual desktop)
//   LOST         window handle no longer exists
// Pure logic, unit tested in tests/pinPosition.test.ts.
import type { PinRect } from './pinBorder.cjs';

export type PinPositionReply = { kind: 'pos'; rect: PinRect } | { kind: 'hidden' } | { kind: 'lost' } | { kind: 'invalid' };

/** Far beyond any real multi-monitor desktop; anything larger is a corrupted reply. */
export const PIN_POSITION_MAX_COORD = 100000;

const POS_REPLY = /^POS:(-?\d{1,7}),(-?\d{1,7}),(-?\d{1,7}),(-?\d{1,7})$/;

/** Left/top may be negative (monitors left of / above the primary); the size must be positive and bounded. */
export function isSaneWindowRect(rect: PinRect): boolean {
    const values = [rect.x, rect.y, rect.width, rect.height];
    if (!values.every(Number.isFinite)) return false;
    if (Math.abs(rect.x) > PIN_POSITION_MAX_COORD || Math.abs(rect.y) > PIN_POSITION_MAX_COORD) return false;
    return rect.width > 0 && rect.height > 0 && rect.width <= PIN_POSITION_MAX_COORD && rect.height <= PIN_POSITION_MAX_COORD;
}

/**
 * Parses the payload of a position reply (the part after `id|`). A POS reply with a non-positive or absurd size is
 * `invalid`; the caller ignores it and the next tick asks again.
 */
export function parsePinPositionReply(payload: string | null | undefined): PinPositionReply {
    if (typeof payload !== 'string') return { kind: 'invalid' };
    const text = payload.trim();
    if (text === 'HIDDEN') return { kind: 'hidden' };
    if (text === 'LOST') return { kind: 'lost' };
    const m = POS_REPLY.exec(text);
    if (!m) return { kind: 'invalid' };
    const [left, top, right, bottom] = m.slice(1).map((v) => parseInt(v, 10));
    const rect: PinRect = { x: left, y: top, width: right - left, height: bottom - top };
    return isSaneWindowRect(rect) ? { kind: 'pos', rect } : { kind: 'invalid' };
}
