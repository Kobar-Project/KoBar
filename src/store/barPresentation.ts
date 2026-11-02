// Canlı (CNL-03): helpers for the persisted bar presentation fields (`barItemSizes`, `barHiddenItems`). Pure.
// The v33 migration (./migrations/v33.ts) keeps its own frozen copy of this validation.
import { DEFAULT_TILE_BAR_ITEM_IDS } from '../config/defaults';

export type BarItemSize = 'icon' | 'tile';

const MAX_ENTRIES = 500;
const MAX_ID_LENGTH = 200;

const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH && id !== '__proto__';

/** Fresh-install sizes: the starter tiles, everything else (missing key) is an icon. */
export function defaultBarItemSizes(): Record<string, BarItemSize> {
    return Object.fromEntries(DEFAULT_TILE_BAR_ITEM_IDS.map((id) => [id, 'tile' as const]));
}

/** Keeps string keys with an 'icon' | 'tile' value; anything else is dropped. */
export function sanitizeBarItemSizes(value: unknown): Record<string, BarItemSize> {
    const out: Record<string, BarItemSize> = {};
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return out;
    let count = 0;
    for (const [id, size] of Object.entries(value)) {
        if (!validId(id) || (size !== 'icon' && size !== 'tile') || count >= MAX_ENTRIES) continue;
        out[id] = size;
        count++;
    }
    return out;
}

/** Keeps string ids, first occurrence wins. */
export function sanitizeBarHiddenItems(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const id of value) {
        if (validId(id) && seen.size < MAX_ENTRIES) seen.add(id);
    }
    return [...seen];
}
