// Pure validation for plugin installation (no Electron / no I/O), so it can be unit tested.
import * as nodePath from 'path';
import { isSafeId, resolveInsideWith } from './paths.cjs';
import { isOfficialGithubOwner, isOfficialPluginId } from './officialPlugins.cjs';

/** Where a plugin package comes from. */
export type InstallSource =
    | { kind: 'github'; repo: string }
    /** Local ZIP (file dialog / drag & drop) or any other non-registry source. */
    | { kind: 'local' };

export interface InstallValidationOptions {
    /** Allow non-registry sources to use an official id (only for unpackaged dev runs). */
    allowOfficialFromLocal?: boolean;
}

export type InstallValidationResult = { ok: true; id: string } | { ok: false; reason: string };

const GITHUB_OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const GITHUB_REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Parses a strict `owner/name` GitHub repository string. Returns null for anything else
 * (URLs, extra segments, `..`, whitespace...), so the value is safe to put into an API URL.
 */
export function parseGithubRepo(repo: unknown): { owner: string; name: string } | null {
    if (typeof repo !== 'string') return null;
    const parts = repo.split('/');
    if (parts.length !== 2) return null;
    const [owner, name] = parts;
    if (!GITHUB_OWNER_RE.test(owner)) return null;
    if (!GITHUB_REPO_RE.test(name) || name === '.' || name === '..') return null;
    return { owner, name };
}

/**
 * True when `entry` (manifest.entry) is empty/absent or a relative path that stays inside the
 * plugin folder under both POSIX and Windows path rules.
 */
export function isSafeEntry(entry: unknown): boolean {
    if (entry === undefined || entry === null || entry === '') return true;
    if (typeof entry !== 'string') return false;
    const posix = resolveInsideWith(nodePath.posix, '/plugin', [entry]);
    const win = resolveInsideWith(nodePath.win32, 'C:\\plugin', [entry]);
    // Pointing at the plugin folder itself is not a file either.
    return posix !== null && win !== null && posix !== '/plugin' && win.toLowerCase() !== 'c:\\plugin';
}

/**
 * Validates a parsed manifest before its package is moved into the extensions folder.
 * Checks required fields, the id (it becomes a folder name), `entry`, and that only the
 * official GitHub organisation can deliver an official id.
 */
export function validateManifestForInstall(
    manifest: unknown,
    source: InstallSource,
    options: InstallValidationOptions = {}
): InstallValidationResult {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        return { ok: false, reason: 'Invalid manifest.json file.' };
    }
    const m = manifest as Record<string, unknown>;
    if (!m.id || !m.name) {
        return { ok: false, reason: 'manifest.json is missing required fields "id" or "name".' };
    }
    if (!isSafeId(m.id)) {
        return {
            ok: false,
            reason: 'manifest.json has an invalid "id": use 2-64 lowercase letters, digits, ".", "_" or "-".',
        };
    }
    if (!isSafeEntry(m.entry)) {
        return { ok: false, reason: 'manifest.json has an invalid "entry": it must be a file inside the plugin.' };
    }
    if (isOfficialPluginId(m.id)) {
        const fromOfficialRepo = source.kind === 'github' && isOfficialGithubOwner(parseGithubRepo(source.repo)?.owner);
        if (!fromOfficialRepo && !(source.kind === 'local' && options.allowOfficialFromLocal)) {
            return {
                ok: false,
                reason: `The id "${m.id}" belongs to an official KoBar plugin. Install it from the KoBar plugin store.`,
            };
        }
    }
    return { ok: true, id: m.id };
}
