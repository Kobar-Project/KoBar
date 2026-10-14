// Plugin enabled flags inside a restored `kobar-storage` value (T-415, follow-up of T-409). Pure: no DOM, no Electron,
// no I/O.
//
// Since T-409 a workspace record (`workspaces[].enabledExtensions`) owns the enabled-plugin set while it is active:
// switching to it lays its entries over the current set (src/store/workspace/enabledExtensions.ts), and returning to the
// Default workspace does the same with `defaultExtensionsConfig`. A restored record could therefore enable a plugin on
// the next workspace switch and bypass the T-213 rule that a restore never enables a plugin (main applies only the
// `false` flags of a backup to extensions-config.json, see restrictExtensionsConfig in electron/lib/restoreBackup.cts).
//
// Rule (same source and same direction as restrictExtensionsConfig): a plugin is approved on this machine when it is
// installed now and the current extensions-config.json does not disable it (`!== false`, the loader's own rule; this is
// the set of the context that is active at restore time). In the restored value the `true` entry of every plugin that is
// not approved is removed (not carried over): in each workspace record, in the `currentExtensionsConfig` mirror and in a
// `defaultExtensionsConfig` (never restored from a backup, coreValues.ts, but a hand-made plan could carry one).
// `false` entries and entries of approved plugins are kept. A missing entry keeps the current value when the record
// becomes active (the merge rule in enabledExtensions.ts), so the restore can never enable a plugin T-213 forbids, and a
// restore on a fresh machine does not force-disable plugins the user installs later. Applied when the plan is built
// (parseBackup) and again at write time with fresh data (restoreFullBackup), so a plan made earlier or by hand cannot
// skip it.

import { isPlainObject, parseJsonSafely } from './coreValues';
import { dropUnapprovedEnables } from './pluginFlagRules';

// The rule itself lives in pluginFlagRules.ts (shared with the settings import, T-418); re-exported for existing callers.
export { approvedPluginIds } from './pluginFlagRules';

export interface RestrictedPluginFlags {
    /** The value to write (the input string itself when nothing changed). */
    value: string;
    /**
     * `true` entries removed from workspace records and a saved Default list (shown in the restore preview, T-418).
     * Entries removed from the `currentExtensionsConfig` mirror are not counted: main rebuilds the mirror from
     * extensions-config.json on the first plugin load, so they never change what the user sees.
     */
    dropped: number;
}

/**
 * Removes the `true` entry of every non-approved plugin from the plugin flag records of a `kobar-storage` persist value
 * (`{ state, version }`). Only `true` leaves inside flag records go away; keep-local paths never point at them
 * (redaction blanks secrets to '' or null), so they stay valid. A value that is not such a JSON object is returned
 * unchanged (the store cannot read it either). Never throws.
 */
export function restrictRestoredPluginFlagsCounted(appStoreValue: string, approved: ReadonlySet<string>): RestrictedPluginFlags {
    const parsed = parseJsonSafely(appStoreValue);
    if (!parsed || !isPlainObject(parsed.value) || !isPlainObject(parsed.value.state)) return { value: appStoreValue, dropped: 0 };
    const state = parsed.value.state;
    // parseJsonSafely already dropped prototype names, so every key in a flag record is a plain own data property.
    let dropped = 0;
    if (Array.isArray(state.workspaces)) {
        for (const ws of state.workspaces) if (isPlainObject(ws)) dropped += dropUnapprovedEnables(ws.enabledExtensions, approved);
    }
    dropped += dropUnapprovedEnables(state.defaultExtensionsConfig, approved);
    const mirrorDropped = dropUnapprovedEnables(state.currentExtensionsConfig, approved);
    const changed = dropped + mirrorDropped > 0;
    return { value: changed ? JSON.stringify(parsed.value) : appStoreValue, dropped };
}

/** restrictRestoredPluginFlagsCounted without the count: the value to write. */
export function restrictRestoredPluginFlags(appStoreValue: string, approved: ReadonlySet<string>): string {
    return restrictRestoredPluginFlagsCounted(appStoreValue, approved).value;
}
