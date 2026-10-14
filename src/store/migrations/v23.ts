// kobar-storage v22 -> v23 (T-027, owner decisions on the legacy `migrate` quirks).
// Pure: no store/window imports; works on the loose persisted shape and never throws on garbage.
// Frozen once released: later behaviour changes go into a new version block, never into this file.
//
// 1. Retired fields (colorpicker / todo list leftovers) are moved into the persisted `legacyBackup` field instead of
//    being deleted. The old v<=20 block that deleted them must not change, so the caller snapshots the values
//    BEFORE any block runs (`captureLegacyFieldsV23`) and this block restores them into the backup.
// 2. Duplicate `featureOrder` ids are collapsed, the first occurrence stays. This is also why the frozen v<=3 chain in
//    ./index.ts (append an id, then rename an old id to the same name) is left as it is: any duplicate it leaves behind
//    is cleaned up here, and that chain must not be edited.
// A legacy key is only removed from the live state once its value is verified to be inside `legacyBackup`.

type Loose = Record<string, unknown>;

export const LEGACY_FIELDS_V23 = ['colorPalettes', 'todos', 'isColorPickerEnabled', 'isTodoListEnabled', 'currentColor'] as const;

const MAX_CONFLICT_SLOTS = 50;

const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);

function sameJson(a: unknown, b: unknown): boolean {
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return false;
    }
}

/** Copies the legacy fields present on the raw state (call before any other migration block runs). */
export function captureLegacyFieldsV23(state: unknown): Loose {
    const captured: Loose = {};
    if (!isObject(state)) return captured;
    for (const key of LEGACY_FIELDS_V23) {
        if (Object.prototype.hasOwnProperty.call(state, key) && state[key] !== undefined) {
            try {
                captured[key] = structuredClone(state[key]);
            } catch {
                // Not cloneable (cannot come from JSON): leave it where it is.
            }
        }
    }
    return captured;
}

/** Keeps the first occurrence of every string id; non-string entries are left alone. */
export function dedupeFeatureOrderV23(order: unknown[]): unknown[] {
    const seen = new Set<string>();
    const result: unknown[] = [];
    for (const item of order) {
        if (typeof item === 'string') {
            if (seen.has(item)) continue;
            seen.add(item);
        }
        result.push(item);
    }
    return result;
}

export function migrateToV23(state: unknown, captured: Loose): void {
    if (!isObject(state)) return;

    if (Array.isArray(state.featureOrder)) {
        state.featureOrder = dedupeFeatureOrderV23(state.featureOrder);
    }
    if (Array.isArray(state.workspaces)) {
        for (const ws of state.workspaces) {
            if (isObject(ws) && Array.isArray(ws.featureOrder)) ws.featureOrder = dedupeFeatureOrderV23(ws.featureOrder);
        }
    }

    // Values still present in the state are the freshest; fall back to the pre-migration snapshot.
    const legacy: Loose = { ...captured, ...captureLegacyFieldsV23(state) };
    const keys = Object.keys(legacy);
    if (keys.length === 0) return;

    // An existing backup wins (never overwrite what an earlier run stored). A differing live value is not lost: it is
    // kept under `legacyBackup.conflicts[key]`, or the first free slot `key#2`, `key#3`, ... (first write wins, an
    // identical value already stored in any slot of that key is reused, so reruns do not add slots).
    const existing = isObject(state.legacyBackup) ? state.legacyBackup : {};
    const backup: Loose = { ...legacy, ...existing };
    state.legacyBackup = backup;

    for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(state, key)) continue;
        let kept = sameJson(backup[key], state[key]);
        if (!kept) {
            const conflicts: Loose = isObject(backup.conflicts) ? backup.conflicts : {};
            for (let n = 1; n <= MAX_CONFLICT_SLOTS; n++) {
                const slot = n === 1 ? key : `${key}#${n}`;
                if (!Object.prototype.hasOwnProperty.call(conflicts, slot)) {
                    backup.conflicts = { ...conflicts, [slot]: state[key] };
                    kept = true;
                    break;
                }
                if (sameJson(conflicts[slot], state[key])) {
                    kept = true;
                    break;
                }
            }
        }
        // Delete from the live state only when the move is verified (the value is inside the backup or its conflicts).
        // If every slot is taken by a different value the live value stays where it is.
        if (kept) delete state[key];
    }
}
