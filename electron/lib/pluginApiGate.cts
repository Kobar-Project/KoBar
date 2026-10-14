// Plugin API / app version gate (T-220, E2). Pure (no Electron, no I/O) so it can be unit tested.
// This host speaks plugin API v1. A manifest that declares `apiVersion` major >= 2, or a `minAppVersion` newer than
// the running app, must be refused before anything is written to extensions/. A missing `apiVersion` means v1.
import { compareVersions, parseVersion } from './semver.cjs';

/** Highest plugin API major version this host can run. */
export const HOST_PLUGIN_API_MAJOR = 1;

/**
 * Result `reason` returned to the renderer when a plugin needs a newer KoBar. It is a code, not a sentence: the UI
 * maps it to the localised "Please update KoBar" text. Must stay in sync with src/components/plugins/pluginResults.ts.
 */
export const PLUGIN_NEEDS_APP_UPDATE_REASON = 'needs-app-update';

export type PluginGateResult =
    { ok: true } | { ok: false; code: 'needs-app-update'; reason: string } | { ok: false; code: 'invalid'; reason: string };

/**
 * Turns a manifest version field into a parseable string: a string as it is, a finite non-negative number through
 * String(). Anything else (null, boolean, object, array, NaN, Infinity, negative) yields null.
 */
function versionText(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return String(value);
    return null;
}

const NEEDS_UPDATE: PluginGateResult = { ok: false, code: 'needs-app-update', reason: PLUGIN_NEEDS_APP_UPDATE_REASON };

/**
 * Decides whether this host may install a plugin with the given parsed manifest. Fails closed: a present but
 * unparsable `apiVersion` / `minAppVersion` is rejected as an invalid manifest, never allowed.
 */
export function checkPluginApiGate(manifest: unknown, appVersion: unknown): PluginGateResult {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        return { ok: false, code: 'invalid', reason: 'Invalid manifest.json file.' };
    }
    const m = manifest as Record<string, unknown>;

    if (Object.prototype.hasOwnProperty.call(m, 'apiVersion') && m.apiVersion !== undefined) {
        const text = versionText(m.apiVersion);
        const parsed = text === null ? null : parseVersion(text);
        if (!parsed) {
            return { ok: false, code: 'invalid', reason: 'manifest.json has an invalid "apiVersion": use a version such as 1 or 2.' };
        }
        if (parsed.major > HOST_PLUGIN_API_MAJOR) return NEEDS_UPDATE;
    }

    if (Object.prototype.hasOwnProperty.call(m, 'minAppVersion') && m.minAppVersion !== undefined) {
        const text = versionText(m.minAppVersion);
        if (text === null || !parseVersion(text)) {
            return { ok: false, code: 'invalid', reason: 'manifest.json has an invalid "minAppVersion": use a version such as 1.2.0.' };
        }
        const order = compareVersions(text, appVersion);
        // The running app version is unreadable: cannot prove the plugin is compatible, so refuse.
        if (order === null) return NEEDS_UPDATE;
        if (order === 1) return NEEDS_UPDATE;
    }

    return { ok: true };
}
