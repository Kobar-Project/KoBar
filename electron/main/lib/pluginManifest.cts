// T-305: reading and normalising a plugin's manifest.json. Moved unchanged out of main.cts (the filesystem is injectable);
// no Electron imports so it is unit-tested with fake manifests.
import * as nodeFs from 'fs';

/** The manifest as a plain object, or null when the file is missing, unreadable, not JSON or not a JSON object. Never throws. */
export function readManifestSafe(manifestPath: string, fs: Pick<typeof nodeFs, 'readFileSync'> = nodeFs): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/** Display name of an installed plugin: the manifest name when it is a non-empty string, else the folder name. */
export function manifestDisplayName(manifest: Record<string, unknown>, folderName: string): string {
    return typeof manifest.name === 'string' && manifest.name ? manifest.name : folderName;
}

/** The manifest fields `buildInstalledPlugin` reads (all optional; a manifest is plugin-authored JSON). */
export interface InstalledManifestFields {
    id?: string;
    name?: string;
    version?: string;
    description?: string;
    icon?: string;
    image?: string;
    isBeta?: unknown;
    storeImage?: unknown;
    categories?: string[];
    versionNote?: string;
    githubRepo?: string;
    githubLink?: string;
}

/** What `get-installed-extensions` reports for one plugin folder (`manifest` is the parsed manifest.json, `code` its entry script). */
export function buildInstalledPlugin(
    manifest: InstalledManifestFields,
    dirName: string,
    isPlayground: boolean,
    config: Record<string, boolean>,
    code: string
) {
    let extName = manifest.name || dirName;
    let extId = manifest.id || dirName;
    if (isPlayground) {
        extName = `[DEV] ${extName}`;
        extId = `dev-${extId}`;
    }

    return {
        id: extId,
        name: extName,
        version: manifest.version || '1.0.0',
        description: manifest.description || '',
        icon: manifest.icon || 'extension',
        image: manifest.image || '',
        isBeta: isPlayground ? true : manifest.isBeta === true,
        isPlayground: isPlayground,
        storeImage: Array.isArray(manifest.storeImage) ? manifest.storeImage.slice(0, 3) : [],
        categories: manifest.categories || [],
        versionNote: manifest.versionNote || '',
        githubRepo: manifest.githubRepo || manifest.githubLink || '',
        enabled: config[extId] !== false, // default to enabled
        code: code,
    };
}
