// T-314: install origins (where each plugin came from) moved unchanged out of main.cts: the origins file in userData, this session's overlay,
// the legacy snapshot, the update target lookup and the installed-state read/compare used by the T-137 replace decision.
import * as fs from 'fs';
import * as path from 'path';
import type { PluginUpdateTarget } from '../../../lib/pluginConfirm.cjs';
import {
    type OriginRecord,
    type OriginsMap,
    type OriginsOverlay,
    ORIGINS_FILE_NAME,
    applyOriginsOverlay,
    cleanupStaleTempFiles,
    findOriginKey,
    installedVersionOf,
    legacyOrigin as snapshotLegacyOrigin,
    readOriginsFile,
    reposEqual,
    snapshotMissingOrigins,
    withOrigin,
    withoutOrigin,
    writeOriginsFileWithBackup,
} from '../../../lib/pluginOrigins.cjs';
import { listPluginDirs } from '../../../lib/pluginScan.cjs';
import { manifestDisplayName, readManifestSafe } from '../../lib/pluginManifest.cjs';

// Folder names ignore case on Windows, so origin keys are looked up case-insensitively there.
export const ORIGIN_KEYS_IGNORE_CASE = process.platform === 'win32' || process.platform === 'darwin';

export interface InstalledPluginState {
    /** Origin from the origins file (with this session's changes); null when there is no record. */
    recorded: OriginRecord | null;
    /** `recorded`, or an in-memory legacy snapshot of the installed manifest (nothing is written here). */
    effective: OriginRecord;
    installedVersion: string | null;
}

export function createExtensionOrigins(deps: { userData: string; extensionsDir: string }) {
    const { userData, extensionsDir } = deps;
    // Install origins live in userData (not in the plugin folder), so a plugin cannot redirect its own updates.
    const extensionOriginsPath = path.join(userData, ORIGINS_FILE_NAME);
    // Every origin change of this session (snapshots, installs, uninstalls), applied on top of the file:
    // if a write fails, later reads still see the frozen snapshot instead of re-reading an editable manifest.
    const sessionOriginChanges: OriginsOverlay = new Map();
    let originTempFilesCleaned = false;

    function saveExtensionOrigins(origins: OriginsMap): void {
        try {
            // T-137: a corrupt file is copied aside (`.corrupt`) first; if that copy fails it is not overwritten.
            const backup = writeOriginsFileWithBackup(extensionOriginsPath, origins);
            if (backup) {
                console.warn(
                    `[Extensions] Corrupt ${ORIGINS_FILE_NAME} was backed up to ${path.basename(backup.backupPath)} before it was rewritten.`
                );
                for (const pruned of backup.pruned)
                    console.warn(`[Extensions] Removed an older corrupt origins backup: ${path.basename(pruned)}`);
            }
        } catch (e) {
            console.error('[Extensions] Failed to save extension origins (kept in memory for this session):', e);
        }
    }

    /** File content with this session's changes applied. Never throws. */
    function readCurrentOrigins(): OriginsMap {
        if (!originTempFilesCleaned) {
            originTempFilesCleaned = true;
            cleanupStaleTempFiles(extensionOriginsPath);
        }
        return applyOriginsOverlay(readOriginsFile(extensionOriginsPath), sessionOriginChanges);
    }

    /**
     * Recorded origins of the installed plugins. Plugins installed before origin tracking get a legacy
     * snapshot of the repository their manifest names; it is saved so later manifest edits do not change it.
     * Never throws: a missing or corrupt file degrades to legacy snapshots.
     */
    function loadExtensionOrigins(): OriginsMap {
        const origins = readCurrentOrigins();
        try {
            if (!fs.existsSync(extensionsDir)) return origins;
            const installed: Array<{ name: string; manifest: unknown }> = [];
            for (const dirName of listPluginDirs(extensionsDir)) {
                if (findOriginKey(origins, dirName, ORIGIN_KEYS_IGNORE_CASE) !== null) continue;
                const dirPath = path.join(extensionsDir, dirName);
                const manifestPath = path.join(dirPath, 'manifest.json');
                if (!fs.existsSync(manifestPath)) continue;
                installed.push({ name: dirName, manifest: readManifestSafe(manifestPath) });
            }
            const snapshot = snapshotMissingOrigins(origins, installed, new Date().toISOString(), ORIGIN_KEYS_IGNORE_CASE);
            if (snapshot.added.length === 0) return origins;
            for (const name of snapshot.added) sessionOriginChanges.set(name, snapshot.origins[name]);
            saveExtensionOrigins(snapshot.origins);
            return snapshot.origins;
        } catch (e) {
            console.error('[Extensions] Failed to snapshot legacy extension origins:', e);
            return origins;
        }
    }

    function recordExtensionOrigin(id: string, record: OriginRecord): void {
        const origins = readCurrentOrigins();
        // Replace a differently-cased legacy key (Windows) instead of keeping two records for one folder.
        const existing = findOriginKey(origins, id, ORIGIN_KEYS_IGNORE_CASE);
        let next = origins;
        if (existing !== null && existing !== id) {
            next = withoutOrigin(next, existing);
            sessionOriginChanges.set(existing, null);
        }
        next = withOrigin(next, id, record);
        if (Object.prototype.hasOwnProperty.call(next, id)) sessionOriginChanges.set(id, next[id]);
        saveExtensionOrigins(next);
    }

    function forgetExtensionOrigin(id: string): void {
        const origins = readCurrentOrigins();
        const key = findOriginKey(origins, id, ORIGIN_KEYS_IGNORE_CASE);
        if (key === null) return;
        sessionOriginChanges.set(key, null);
        saveExtensionOrigins(withoutOrigin(origins, key));
    }

    /** The installed plugin whose recorded origin is `repo` (the target of an update), if any. */
    function findUpdateTarget(repo: string): PluginUpdateTarget | undefined {
        const origins = loadExtensionOrigins();
        for (const key of Object.keys(origins)) {
            const record = origins[key];
            if (!reposEqual(record.repo, repo)) continue;
            const manifest = readManifestSafe(path.join(extensionsDir, key, 'manifest.json'));
            // Stale record of a folder removed outside the app: not an update.
            if (!manifest) continue;
            const name = manifestDisplayName(manifest, key);
            return { name, legacyOrigin: record.source === 'legacy' };
        }
        return undefined;
    }

    /** The plugin installed in `targetDir` (T-137), or null when there is none. Read-only: never writes a file. */
    function readInstalledPluginState(extensionId: string, targetDir: string): InstalledPluginState | null {
        const manifestPath = path.join(targetDir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) return null;
        const manifest = readManifestSafe(manifestPath);
        const origins = readCurrentOrigins();
        const key = findOriginKey(origins, extensionId, ORIGIN_KEYS_IGNORE_CASE);
        const recorded = key !== null ? origins[key] : null;
        const effective = recorded ?? snapshotLegacyOrigin(extensionId, manifest, new Date().toISOString());
        return { recorded, effective, installedVersion: installedVersionOf(effective, manifest) };
    }

    /** Same installed version and origin (source + repo; the timestamp of a legacy snapshot may differ). */
    function sameInstalledState(a: InstalledPluginState, b: InstalledPluginState | null): boolean {
        return (
            !!b &&
            a.installedVersion === b.installedVersion &&
            a.effective.source === b.effective.source &&
            a.effective.repo === b.effective.repo
        );
    }

    return {
        loadExtensionOrigins,
        recordExtensionOrigin,
        forgetExtensionOrigin,
        findUpdateTarget,
        readInstalledPluginState,
        sameInstalledState,
    };
}

export type ExtensionOrigins = ReturnType<typeof createExtensionOrigins>;
