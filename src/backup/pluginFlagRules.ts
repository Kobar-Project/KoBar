// The approval rule for plugin enabled flags that arrive from outside this machine (T-415, T-418). Pure and free of
// imports on purpose: the settings import (src/store/importExport.ts) uses it too, and src/backup/coreValues.ts imports
// that module, so a dependency on coreValues here would create an import cycle.
//
// A plugin is approved on this machine when it is installed now and the current extensions-config.json does not disable
// it (`!== false`, the loader's own rule). A `true` flag of any other plugin is removed (never turned into `false`): a
// missing entry keeps the current value when the record becomes active (src/store/workspace/enabledExtensions.ts), so
// nothing from outside can enable a plugin the user did not enable here, and nothing is force-disabled either.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Ids that may stay enabled: installed now and not disabled in `extensionsConfig`. Non-string ids are ignored.
 * A config that is not a plain object (unknown state) approves nothing (fail closed).
 */
export function approvedPluginIds(installedIds: Iterable<unknown>, extensionsConfig: unknown): Set<string> {
    const approved = new Set<string>();
    if (!isRecord(extensionsConfig)) return approved;
    for (const id of installedIds) {
        if (typeof id !== 'string' || id.length === 0) continue;
        const flag = Object.prototype.hasOwnProperty.call(extensionsConfig, id) ? extensionsConfig[id] : undefined;
        if (flag !== false) approved.add(id);
    }
    return approved;
}

/**
 * approvedPluginIds for the result of main's `getBackupSources()` (`{ extensionsConfig, plugins: [{ id }] }`). A missing
 * or malformed result approves nothing (fail closed).
 */
export function approvedPluginIdsFromSources(sources: unknown): Set<string> {
    if (!isRecord(sources)) return new Set();
    const plugins = Array.isArray(sources.plugins) ? sources.plugins : [];
    return approvedPluginIds(
        plugins.map((p: unknown) => (isRecord(p) ? p.id : undefined)),
        sources.extensionsConfig
    );
}

/**
 * Deletes, in place, the `true` entry of every plugin in `flags` that is not in `approved`, and returns how many were
 * deleted. `false` entries and entries of approved plugins stay. Anything that is not a plain object is left alone (0).
 * Only own keys are visited; callers pass objects from a parser that already dropped prototype names.
 */
export function dropUnapprovedEnables(flags: unknown, approved: ReadonlySet<string>): number {
    if (!isRecord(flags)) return 0;
    let dropped = 0;
    for (const id of Object.keys(flags)) {
        if (flags[id] === true && !approved.has(id)) {
            delete flags[id];
            dropped++;
        }
    }
    return dropped;
}
