// Pure helpers for the main-process confirmation of plugin management (install / uninstall) and for
// restricting the extensions config to installed plugins. No Electron or fs access here.

import { MAIN_STRINGS, t } from './mainStrings.cjs';
import { isOfficialGithubOwner } from './officialPlugins.cjs';
import { parseGithubRepo } from './pluginInstall.cjs';

/** An installed plugin that a GitHub install would update (found by its recorded origin). */
export interface PluginUpdateTarget {
    name: string;
    /** True when the origin was taken from the plugin's own manifest (installed before origin tracking). */
    legacyOrigin: boolean;
}

/** Recorded install origin as shown in a dialog (structural, so this file needs no pluginOrigins import). */
export interface ShownOrigin {
    source: string;
    repo: string | null;
}

/** Second confirmation before a package replaces the installed plugin with the same id (T-137). */
export interface PluginReplaceAction {
    kind: 'replace';
    id: string;
    change: 'reinstall' | 'upgrade';
    installedVersion: string;
    newVersion: string;
    /** Recorded origin of the installed plugin; null when there is no record. */
    origin: ShownOrigin | null;
    incoming: { kind: 'zip'; fileName: string } | { kind: 'github'; repo: string };
}

export type PluginAction =
    | { kind: 'uninstall'; id: string }
    | { kind: 'github'; repo: string; update?: PluginUpdateTarget }
    | { kind: 'zip'; fileName: string }
    | PluginReplaceAction;

export interface PluginConfirmation {
    message: string;
    detail: string;
    confirmLabel: string;
    /** True when the source is outside the official registry (the warning is part of `detail`). */
    unverified: boolean;
}

/** Reason returned to the renderer when the user cancels (the renderer shows no error for it). */
export const PLUGIN_CANCELED_REASON = 'Canceled by user';
/** Reason returned when another confirmation dialog is already open. */
export const PLUGIN_BUSY_REASON = 'Another confirmation is already open.';

/** English texts, kept for callers that compare against them; the dialog itself is localised via `lang`. */
export const UNVERIFIED_WARNING = MAIN_STRINGS.en.unverifiedWarning;

export const LEGACY_ORIGIN_WARNING = MAIN_STRINGS.en.legacyOriginWarning;

const MAX_SHOWN = 120;

function shown(value: unknown): string {
    const text = typeof value === 'string' ? value : '';
    // Control characters are dropped so a name cannot fake extra dialog lines.
    // eslint-disable-next-line no-control-regex
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ');
    return clean.length > MAX_SHOWN ? clean.slice(0, MAX_SHOWN) + '...' : clean;
}

/** True when a GitHub "owner/name" repo belongs to the official organisation. */
export function isOfficialRepo(repo: unknown): boolean {
    const parsed = parseGithubRepo(repo);
    return !!parsed && isOfficialGithubOwner(parsed.owner);
}

/** Localised description of a recorded install origin ('unknown' when there is no record). */
export function describeOrigin(origin: ShownOrigin | null, lang: unknown = 'en'): string {
    if (!origin) return t(lang, 'originUnknown');
    switch (origin.source) {
        case 'registry':
            return origin.repo ? t(lang, 'originRegistry', { repo: shown(origin.repo) }) : t(lang, 'originUnknown');
        case 'github':
            return origin.repo ? t(lang, 'originGithub', { repo: shown(origin.repo) }) : t(lang, 'originUnknown');
        case 'zip':
            return t(lang, 'originZip');
        case 'legacy':
            return t(lang, 'originLegacy');
        default:
            return t(lang, 'originUnknown');
    }
}

/** Localised refusal text for a package that may not replace the installed plugin `id` (T-137). */
export function buildReplaceRefusal(
    code: 'downgrade' | 'version-uncomparable',
    input: { id: string; installedVersion: string | null; newVersion: string | null },
    lang: unknown = 'en'
): string {
    const params = {
        name: shown(input.id),
        installed: shown(input.installedVersion ?? '?') || '?',
        version: shown(input.newVersion ?? '?') || '?',
    };
    return t(lang, code === 'downgrade' ? 'pluginDowngradeRefused' : 'pluginVersionUncomparable', params);
}

/** Builds the text of the native confirmation dialog for a plugin action, in `lang` (English by default). */
export function buildPluginConfirmation(action: PluginAction, lang: unknown = 'en'): PluginConfirmation {
    switch (action.kind) {
        case 'uninstall':
            return {
                message: t(lang, 'uninstallPlugin', { name: shown(action.id) }),
                detail: t(lang, 'uninstallPluginDetail'),
                confirmLabel: t(lang, 'uninstall'),
                unverified: false,
            };
        case 'zip':
            return {
                message: t(lang, 'installFromZip', { name: shown(action.fileName) }),
                detail: t(lang, 'unverifiedWarning'),
                confirmLabel: t(lang, 'install'),
                unverified: true,
            };
        case 'replace': {
            const name = shown(action.id);
            const version = shown(action.newVersion);
            const message =
                action.change === 'upgrade'
                    ? t(lang, 'replacePluginUpgrade', { name, installed: shown(action.installedVersion), version })
                    : t(lang, 'replacePluginReinstall', { name, version });
            const incoming = action.incoming;
            const source =
                incoming.kind === 'zip'
                    ? t(lang, 'incomingZip', { name: shown(incoming.fileName) })
                    : t(lang, isOfficialRepo(incoming.repo) ? 'originRegistry' : 'originGithub', { repo: shown(incoming.repo) });
            const official = incoming.kind === 'github' && isOfficialRepo(incoming.repo);
            const details = t(lang, 'replacePluginDetail', { origin: describeOrigin(action.origin, lang), source });
            return {
                message,
                detail: `${details}\n\n${official ? t(lang, 'officialSource') : t(lang, 'unverifiedWarning')}`,
                confirmLabel: t(lang, 'replace'),
                unverified: !official,
            };
        }
        case 'github': {
            const official = isOfficialRepo(action.repo);
            const sourceText = official ? t(lang, 'officialSource') : t(lang, 'unverifiedWarning');
            if (action.update) {
                // Matched by repository only: the release package is checked (id, origin, version) after download.
                const legacy = action.update.legacyOrigin === true;
                const note = t(lang, 'updateNote', { name: shown(action.update.name) });
                return {
                    message: t(lang, 'installLatestRelease', { repo: shown(action.repo) }),
                    detail: legacy ? `${note}\n\n${sourceText}\n\n${t(lang, 'legacyOriginWarning')}` : `${note}\n\n${sourceText}`,
                    confirmLabel: t(lang, 'install'),
                    unverified: !official || legacy,
                };
            }
            return {
                message: t(lang, 'installOrUpdateFromGithub', { repo: shown(action.repo) }),
                detail: sourceText,
                confirmLabel: t(lang, 'install'),
                unverified: !official,
            };
        }
    }
}

/**
 * Keeps only entries of `config` whose key is an installed extension id and whose value is a boolean.
 * Unknown ids, reserved keys and non-boolean values are dropped.
 */
export function filterExtensionsConfig(config: unknown, installedIds: Iterable<string>): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    if (!config || typeof config !== 'object' || Array.isArray(config)) return result;
    const allowed = new Set(installedIds);
    for (const key of Object.keys(config)) {
        if (key === '__proto__' || !allowed.has(key)) continue;
        const value = (config as Record<string, unknown>)[key];
        if (typeof value !== 'boolean') continue;
        result[key] = value;
    }
    return result;
}

/**
 * Result of a set-extensions-config call: entries of ids that are not installed stay untouched, and
 * for installed ids exactly the accepted entries of the caller are used (installed ids missing from
 * `incoming` are dropped, like a whole-config replacement did before).
 */
export function mergeExtensionsConfig(existing: unknown, incoming: unknown, installedIds: Iterable<string>): Record<string, boolean> {
    const installed = new Set(installedIds);
    const result: Record<string, boolean> = {};
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        for (const key of Object.keys(existing)) {
            if (key === '__proto__' || installed.has(key)) continue;
            result[key] = (existing as Record<string, boolean>)[key];
        }
    }
    return { ...result, ...filterExtensionsConfig(incoming, installed) };
}
