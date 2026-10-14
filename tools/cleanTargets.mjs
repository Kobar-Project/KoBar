import path from 'node:path';

/** Names of the compiled-output directories that a clean may remove. Nothing else is ever deleted. */
export const CLEAN_DIR_NAMES = Object.freeze(['dist', 'dist-electron']);

/**
 * Returns the absolute paths of the build output directories under `root`.
 * Pure function (no filesystem access, no side effects) so it can be unit tested.
 */
export function resolveCleanTargets(root) {
    if (typeof root !== 'string' || root.trim() === '') {
        throw new Error('resolveCleanTargets: root must be a non-empty string');
    }
    const resolvedRoot = path.resolve(root);
    if (path.parse(resolvedRoot).root === resolvedRoot) {
        throw new Error('resolveCleanTargets: refusing to use a filesystem root');
    }
    return CLEAN_DIR_NAMES.map((name) => {
        const target = path.resolve(resolvedRoot, name);
        if (path.dirname(target) !== resolvedRoot) {
            throw new Error(`resolveCleanTargets: ${name} escapes the repository root`);
        }
        return target;
    });
}
