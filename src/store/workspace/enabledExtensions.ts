// Pure helpers for the enabled-plugin set of a workspace context (T-409, PROD-19, WS-09).
// No store imports: the store imports this module, so it must stay free of cycles.
//
// One owner per context:
// - Default workspace (no workspace record is active): `extensions-config.json` in the main process owns the set. The
//   store's `currentExtensionsConfig` is its mirror (refreshed from main on every plugin load).
// - A workspace is active: its record (`workspaces[i].enabledExtensions`) owns the set. Every toggle writes the record
//   AND main (setExtensionEnabledInWorkspace + toggle-extension-enabled), so the file is always the DERIVED copy of the
//   active context; 1.2.x, the media demand and the backup keep reading the file as before. The file is never deleted.
// Merge rule when a context becomes active: the owner's boolean entries over the current mirror (ids the owner has no
// entry for keep their current value; an id main does not know is still treated as enabled, `!== false`).
// Leaving the Default workspace saves the mirror in `defaultExtensionsConfig` (persisted, v25; flushed to disk before
// main overwrites the file), so that returning to it restores the Default list instead of keeping the last workspace's
// set. The saved copy is dropped (null) only once main confirmed writing the restored list (the file owns it again); if
// that write fails the copy stays, toggles made in the Default keep it in sync, and the next departure from the Default
// saves it over the mirror, so the list is never lost. null while a workspace is active = unknown (state from before
// v25): returning keeps the current set, as 1.2.x did.
// At startup nothing is re-derived: the file already is the active context's copy (and after a crash or a backup
// restore it is the newer one; a restore must never enable a plugin, T-213).

import { findActiveWorkspace } from './activeWorkspace';
import { activeContextId } from './contextId';

export type ExtensionsConfig = Record<string, boolean>;

const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface ExtensionsWorkspace {
    id: string;
    isIsolated?: boolean;
    enabledExtensions?: unknown;
}

export interface ExtensionsContextState {
    activeWorkspaceId: string | null;
    workspaces: readonly ExtensionsWorkspace[];
    /** Mirror of extensions-config.json (the active context's set). */
    currentExtensionsConfig: unknown;
    /** The Default workspace's list, saved while a workspace is active (null = Default active, or unknown). */
    defaultExtensionsConfig?: unknown;
}

/** The own `string -> boolean` entries of a plain object; anything else (and prototype names) is skipped. Never throws. */
export function booleanExtensionEntries(raw: unknown): ExtensionsConfig {
    const out: ExtensionsConfig = {};
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
    for (const key of Object.keys(raw)) {
        if (RESERVED_KEYS.has(key)) continue;
        const value = (raw as Record<string, unknown>)[key];
        if (typeof value === 'boolean') out[key] = value;
    }
    return out;
}

/** The merge rule: the owner's boolean entries over `base` (the current mirror). */
export function overlayExtensionsConfig(base: unknown, owner: unknown): ExtensionsConfig {
    return { ...booleanExtensionEntries(base), ...booleanExtensionEntries(owner) };
}

/** True when `next` enables or disables some plugin differently from `base` (a missing entry means enabled). */
export function extensionsConfigDiffers(base: unknown, next: unknown): boolean {
    const a = booleanExtensionEntries(base);
    const b = booleanExtensionEntries(next);
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
        if ((a[key] ?? true) !== (b[key] ?? true)) return true;
    }
    return false;
}

export interface ExtensionsContextSwitch {
    /** The new mirror: the set of the context that becomes active. */
    currentExtensionsConfig: ExtensionsConfig;
    /** The new saved Default list. */
    defaultExtensionsConfig: ExtensionsConfig | null;
    /** The set differs from the old mirror: main must derive extensions-config.json from `currentExtensionsConfig`. */
    changed: boolean;
    /** Default -> workspace: a new Default list was saved; it must reach disk before main overwrites the file. */
    savedNewDefault: boolean;
    /** Workspace -> Default with a changed set: drop the saved list only after main wrote the restored list. */
    clearDefaultAfterWrite: boolean;
}

/**
 * The enabled-set part of a workspace transition `prev -> next` (`next` = state after the action's patch). null when the
 * owner does not change (same workspace record, or the Default workspace on both sides): nothing to derive.
 */
export function planExtensionsContextSwitch(prev: ExtensionsContextState, next: ExtensionsContextState): ExtensionsContextSwitch | null {
    const prevWs = findActiveWorkspace(prev);
    const nextWs = findActiveWorkspace(next);
    if (prevWs === nextWs || (prevWs && nextWs && prevWs.id === nextWs.id)) return null;

    const mirror = booleanExtensionEntries(prev.currentExtensionsConfig);
    const prevSaved = savedDefaultOf(prev.defaultExtensionsConfig);
    if (nextWs) {
        const target = overlayExtensionsConfig(mirror, nextWs.enabledExtensions);
        const changed = extensionsConfigDiffers(mirror, target);
        // Workspace -> workspace keeps the saved copy.
        if (prevWs)
            return {
                currentExtensionsConfig: target,
                defaultExtensionsConfig: prevSaved,
                changed,
                savedNewDefault: false,
                clearDefaultAfterWrite: false,
            };
        // Leaving the Default workspace: the mirror is its list; a copy still there (its restore was never confirmed) wins.
        const savedDefault = prevSaved ? overlayExtensionsConfig(mirror, prevSaved) : { ...mirror };
        return {
            currentExtensionsConfig: target,
            defaultExtensionsConfig: savedDefault,
            changed,
            savedNewDefault: true,
            clearDefaultAfterWrite: false,
        };
    }
    // Back to the Default workspace: its saved list (if any) over the mirror. When that changes the set, the saved copy
    // stays until main confirmed the write; otherwise the file already holds the list and the copy is dropped now.
    const target = overlayExtensionsConfig(mirror, prevSaved);
    const changed = extensionsConfigDiffers(mirror, target);
    return {
        currentExtensionsConfig: target,
        defaultExtensionsConfig: changed ? prevSaved : null,
        changed,
        savedNewDefault: false,
        clearDefaultAfterWrite: changed,
    };
}

/**
 * The set main should hold for the context that is active in `state` right now: the active record's entries (or, in
 * the Default workspace, a saved Default list whose write was not confirmed yet) over the current mirror. Used to retry
 * a failed write with up-to-date data (T-418), so toggles made since the switch are not overwritten.
 */
export function extensionsConfigForActiveContext(state: ExtensionsContextState): ExtensionsConfig {
    const ws = findActiveWorkspace(state);
    return overlayExtensionsConfig(
        state.currentExtensionsConfig,
        ws ? ws.enabledExtensions : savedDefaultOf(state.defaultExtensionsConfig)
    );
}

function savedDefaultOf(raw: unknown): ExtensionsConfig | null {
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? booleanExtensionEntries(raw) : null;
}

/**
 * True when plugins must be re-executed (full reload) after the transition: the data namespace they read through the
 * localStorage isolation changes ('global' <-> 'ws:<id>'). v1 plugins keep data in module scope and have no
 * context-change lifecycle, so only a re-run makes them read the new namespace. Otherwise only the enabled-set diff is
 * loaded or unloaded (plugins get `kobar:workspace-changed` and their roots remount, as before).
 */
export function needsFullPluginReload(prev: ExtensionsContextState, next: ExtensionsContextState): boolean {
    return activeContextId(prev) !== activeContextId(next);
}
