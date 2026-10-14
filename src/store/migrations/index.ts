// Persisted-state migrations for the `kobar-storage` Zustand persist key.
// Moved verbatim from the inline `migrate` option in src/store/useAppStore.ts (T-006).
// Do not change behaviour here without a fixture test (see T-007) and a version bump.

import { migrateToV22 } from './v22';
import { captureLegacyFieldsV23, migrateToV23 } from './v23';
import { migrateToV24 } from './v24';
import { migrateToV25 } from './v25';
import { migrateToV26 } from './v26';
import { migrateToV27 } from './v27';
import { migrateToV28 } from './v28';
import { migrateToV29 } from './v29';
import { migrateToV30 } from './v30';
import { migrateToV31 } from './v31';
import { migrateToV32 } from './v32';

/** Current `kobar-storage` persist version (useAppStore `persist({ version })`, settings export `version`). */
export const KOBAR_STORAGE_VERSION = 32;

/** Inputs of the persisted-state path that are not part of the persisted state itself. */
export interface KobarStorageMigrateOptions {
    /** Raw `kobar_force_theme_color` localStorage value of this machine (v26). Settings imports never pass it. */
    forcedThemeColor?: unknown;
}

/** localStorage key that <= v25 wrote next to every custom colour change and read on startup (v26 input). */
export const FORCED_THEME_COLOR_KEY = 'kobar_force_theme_color';

const ADD_CALENDAR_TO_STORED_PROFILES = false;

// Version blocks from v22 on. They run in order for every stored version below their target, both after the
// legacy section (stored version <= 20) and on their own (stored version >= 21). Append future blocks here.
function migrateVersionedBlocks<T>(
    persistedState: T,
    version: number,
    legacyFields: Record<string, unknown>,
    options: KobarStorageMigrateOptions
): T {
    // version 22 (T-205): persist toggleWidth/featureSpacing/isPopupSmartPositioning (WS-06)
    // and repair duplicate note ids / stale note counters (WS-08). Logic lives in ./v22.
    if (version < 22) {
        migrateToV22(persistedState);
    }
    // version 23 (T-027): legacy fields move into `legacyBackup` (the old section below deletes them, so they are
    // captured before it runs) and duplicate featureOrder ids collapse. Logic lives in ./v23.
    if (version < 23) {
        migrateToV23(persistedState, legacyFields);
    }
    // version 24 (T-408): workspace model on the v1 fields (Default workspace = no active record, strict isIsolated,
    // active profile record synced from the top level), every replaced value backed up in `legacyBackup`. Logic lives in ./v24.
    if (version < 24) {
        migrateToV24(persistedState);
    }
    // version 25 (T-409): persisted `defaultExtensionsConfig` (the Default workspace's enabled-plugin list while a
    // workspace is active); only a foreign value of that new key is normalized, with a raw backup. Logic lives in ./v25.
    if (version < 25) {
        migrateToV25(persistedState);
    }
    // version 26 (T-601): appearance model (`scheme`, `accent`, `material`; v1 fields kept) and the dead
    // `teleportShortcut` removed (T-144), replaced values backed up in `legacyBackup`. Logic lives in ./v26.
    if (version < 26) {
        migrateToV26(persistedState, options.forcedThemeColor);
    }
    // version 27 (T-602): `density` (top level and workspace records, from `sidebarWidth`; v1 fields kept) and
    // `isPopupSmartPositioning` readable as `true`, replaced values backed up in `legacyBackup`. Logic lives in ./v27.
    if (version < 27) {
        migrateToV27(persistedState);
    }
    // version 28 (T-603): the Settings/Plugins pseudo-notes (`isSettings`/`isPlugins` === true, PROD-18) leave `notes`,
    // `globalNotes` and every `isolatedData.notes`, removed entries backed up in `legacyBackup`. Logic lives in ./v28.
    if (version < 28) {
        migrateToV28(persistedState);
    }
    // version 29 (T-604): `onboarding` (first-run state). Every stored state is an existing user's, so it becomes
    // `completed` whatever the v1 `tutorialState` says (kept unchanged, copied into `legacyBackup`). Logic lives in ./v29.
    if (version < 29) {
        migrateToV29(persistedState);
    }
    // version 30 (T-615d): fake notes created after v28 leave `notes`/`globalNotes`/`isolatedData.notes` again and the dead
    // `settingsWorkspaceViewMode` is deleted, both backed up in `legacyBackup.cleanupV30`. Logic lives in ./v30.
    if (version < 30) {
        migrateToV30(persistedState);
    }
    // version 31 (R-11): optional `noteListWidth` (note list column width); only an already present value is normalized
    // (clamped to 160..420 or deleted), a missing key stays missing. Logic lives in ./v31.
    if (version < 31) {
        migrateToV31(persistedState);
    }
    // version 32 (R-15): optional `pluginPanelOffsets` (pluginId -> { x?, y? } panel offsets); only an already present value is
    // normalized (bad entries dropped, numbers rounded/clamped), a missing key stays missing. Logic lives in ./v32.
    if (version < 32) {
        migrateToV32(persistedState);
    }
    return persistedState;
}

export function migrateKobarStorage(persistedState: any, version: number, options: KobarStorageMigrateOptions = {}) {
    // T-027: snapshot the retired fields before the legacy section (which deletes them) can run.
    const legacyFields = captureLegacyFieldsV23(persistedState);

    // T-205: a stored v21+ state never ran the legacy section below (v21 was current, so Zustand skipped migrate).
    // Keep it that way: only the versioned blocks run for it (owner decision T-027(a): do not touch bar layouts).
    if (version >= 21) {
        return migrateVersionedBlocks(persistedState, version, legacyFields, options);
    }

    if (version <= 20) {
        if (persistedState.globalNotes === undefined) {
            persistedState.globalNotes = persistedState.notes ? [...persistedState.notes] : [];
        }
        if (persistedState.globalPluginData === undefined) {
            persistedState.globalPluginData = {};
        }
        if (persistedState.activeWorkspaceId === undefined) {
            persistedState.activeWorkspaceId = null;
        }
        if (persistedState.workspaces && Array.isArray(persistedState.workspaces)) {
            persistedState.workspaces = persistedState.workspaces.map((w: any) => ({
                ...w,
                isIsolated: w.isIsolated ?? false,
                isolatedData: w.isolatedData || undefined,
            }));
        }
    }
    // version 20 migration for tutorial state
    if (version <= 19) {
        if (persistedState.tutorialState === undefined) {
            persistedState.tutorialState = { version: '1.0.0', status: 'pending' };
        }
    }
    // version 19 migration for tutorial state
    if (version <= 18) {
        if (persistedState.tutorialState === undefined) {
            persistedState.tutorialState = { version: '1.0.0', status: 'pending' };
        }
        if (persistedState.isHighlightingToggleNotes === undefined) {
            persistedState.isHighlightingToggleNotes = false;
        }
        if (persistedState.isHighlightingSettingsBtn === undefined) {
            persistedState.isHighlightingSettingsBtn = false;
        }
        if (persistedState.isHighlightingPluginsBtn === undefined) {
            persistedState.isHighlightingPluginsBtn = false;
        }
    }
    // version 18 migration for orientation
    if (version <= 17) {
        if (persistedState.orientation === undefined) {
            persistedState.orientation = 'vertical';
        }
        if (persistedState.edgePosition === undefined) {
            persistedState.edgePosition = 'right';
        }
    }
    // version 17 migration for enableEyeAnimation
    if (version <= 16) {
        if (persistedState.enableEyeAnimation === undefined) {
            persistedState.enableEyeAnimation = true;
        }
    }
    if (version <= 12) {
        if (persistedState.workspaces === undefined) {
            persistedState.workspaces = [];
        }
    }
    if (version === 0) {
        // Ensure 'calculator' is in the order if it's missing
        if (persistedState.featureOrder && !persistedState.featureOrder.includes('calculator')) {
            persistedState.featureOrder = [...persistedState.featureOrder, 'calculator'];
        }
        // Ensure it's enabled by default if not set

    }

    // version 1 migration for colorpicker
    if (version <= 1) {
        if (persistedState.featureOrder && !persistedState.featureOrder.includes('kobar-colorpicker-plugin-btn')) {
            persistedState.featureOrder = [...persistedState.featureOrder, 'kobar-colorpicker-plugin-btn'];
        }
    }

    if (persistedState.featureOrder) {
        persistedState.featureOrder = persistedState.featureOrder.map((f: string) => f === 'colorpicker' ? 'kobar-colorpicker-plugin-btn' : f);
    }

    delete persistedState.isColorPickerEnabled;
    delete persistedState.colorPalettes;
    delete persistedState.currentColor;

    // version 2 migration for todolist
    if (version <= 2) {
        if (persistedState.featureOrder && !persistedState.featureOrder.includes('todolist-plugin-btn')) {
            persistedState.featureOrder = [...persistedState.featureOrder, 'todolist-plugin-btn'];
        }
    }

    if (persistedState.featureOrder) {
        persistedState.featureOrder = persistedState.featureOrder.map((f: string) => f === 'todolist' ? 'todolist-plugin-btn' : f);
    }

    delete persistedState.isTodoListEnabled;
    delete persistedState.todos;

    // version 3 migration for pininjector
    if (version <= 3) {
        if (persistedState.featureOrder && !persistedState.featureOrder.includes('pininjector')) {
            persistedState.featureOrder = [...persistedState.featureOrder, 'pininjector'];
        }
        if (persistedState.isPinInjectorEnabled === undefined) {
            persistedState.isPinInjectorEnabled = true;
        }
    }

    // T-027 (owner decision a): the calendar button is only added on fresh installs (store defaults), never to a
    // stored profile, so this append is switched off for every stored version (the body is otherwise unchanged).
    if (ADD_CALENDAR_TO_STORED_PROFILES && persistedState.featureOrder && !persistedState.featureOrder.includes('ko-calender-plugin-btn')) {
        persistedState.featureOrder = [...persistedState.featureOrder, 'ko-calender-plugin-btn'];
    }



    // version 4 migration for kobox
    if (version <= 4) {
        if (persistedState.featureOrder && !persistedState.featureOrder.includes('kobox')) {
            persistedState.featureOrder = [...persistedState.featureOrder, 'kobox'];
        }
        if (persistedState.isKoBoxEnabled === undefined) {
            persistedState.isKoBoxEnabled = true;
        }
        if (persistedState.koBoxCleanupMode === undefined) {
            persistedState.koBoxCleanupMode = '24h';
        }
    }

    // version 5/6 migration for snippetvault
    if (version <= 5) {
        if (persistedState.featureOrder && !persistedState.featureOrder.includes('snippetvault-plugin-btn')) {
            persistedState.featureOrder = [...persistedState.featureOrder, 'snippetvault-plugin-btn'];
        }
        if (persistedState.isSnippetVaultEnabled === undefined) {
            persistedState.isSnippetVaultEnabled = true;
        }
        if (persistedState.snippets === undefined) {
            persistedState.snippets = [];
        }
    }

    // version 14 migration for snippet passwords
    if (version <= 13) {
        if (persistedState.snippets) {
            persistedState.snippets = persistedState.snippets.map((s: any) => ({
                ...s,
                password: s.password || undefined
            }));
        }
    }

    // version 15 migration for snippet colors
    if (version <= 14) {
        if (persistedState.snippets) {
            persistedState.snippets = persistedState.snippets.map((s: any) => ({
                ...s,
                color: s.color || undefined
            }));
        }
    }

    // AI hub migration
    if (version <= 6) {
        if (persistedState.featureOrder && !persistedState.featureOrder.includes('com.kobar.aihub.btn')) {
            // Force it to be the first item
            persistedState.featureOrder = ['com.kobar.aihub.btn', ...persistedState.featureOrder.filter((f: string) => f !== 'shortcuts' && f !== 'aihub' && f !== 'com.kobar.aihub.btn')];
        }
        if (persistedState.isAiHubEnabled === undefined) {
            persistedState.isAiHubEnabled = true;
        }
        // Final sanity check for featureOrder array
        if (!persistedState.featureOrder) {
            persistedState.featureOrder = ['com.kobar.aihub.btn', 'copypaste', 'todolist-plugin-btn', 'snippetvault-plugin-btn', 'pininjector', 'kobox', 'kobar-colorpicker-plugin-btn', 'calculator'];
        }
    }

    // version 16 migration for custom theme
    if (version <= 15) {
        if (persistedState.customThemeColor === undefined) {
            persistedState.customThemeColor = '#f4a125';
        }
    }

    return migrateVersionedBlocks(persistedState, version, legacyFields, options);
}

/** This machine's `kobar_force_theme_color` value, or null when localStorage is unavailable or unreadable. */
export function readForcedThemeColor(): string | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage.getItem(FORCED_THEME_COLOR_KEY);
    } catch {
        return null;
    }
}

/**
 * The persist `migrate` option of useAppStore: `migrateKobarStorage` plus the machine-local inputs of the stored state
 * (v26 reads `kobar_force_theme_color`). Imports and backup restores call `migrateKobarStorage` directly.
 */
export function migratePersistedKobarStorage(persistedState: unknown, version: number) {
    return migrateKobarStorage(persistedState, version, { forcedThemeColor: readForcedThemeColor() });
}
