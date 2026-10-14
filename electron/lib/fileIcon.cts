// Pure helpers for the `get-file-icon` IPC handler. No shell, no file reads: the main process only
// asks the OS for an icon of a path, so the only thing to guard is the shape of the input.
import * as nodePath from 'path';

const MAX_ICON_PATH_LENGTH = 4096;
// Unexpanded environment variable such as %SystemRoot% (a lone "%" in "100% Tools" is fine).
const ENV_VAR_PATTERN = /%[^%\\/]+%/;

/**
 * Returns the path when it is a plausible absolute local file-system path, otherwise null.
 * UNC paths (`\\host\share`, `//host/share`) are rejected: asking the OS for their icon would
 * make a network connection and can leak NTLM credentials.
 */
export function validateIconPath(input: unknown): string | null {
    if (typeof input !== 'string') return null;
    if (input.length === 0 || input.length > MAX_ICON_PATH_LENGTH) return null;
    if (input.includes('\0')) return null;
    if (input.startsWith('\\\\') || input.startsWith('//')) return null;
    if (!nodePath.isAbsolute(input)) return null;
    return input;
}

/**
 * Chooses which path the OS should draw the icon of, given the result of `shell.readShortcutLink`.
 * Uses the shortcut's target; when it is missing, relative, UNC or contains an unexpanded
 * environment variable, falls back to the shortcut file itself. The shortcut's own `icon` field is
 * deliberately ignored because `app.getFileIcon` cannot honor `iconIndex`.
 */
export function pickShortcutIconSource(shortcutPath: string, details: { target?: unknown } | null | undefined): string {
    const target = details?.target;
    if (typeof target === 'string' && !ENV_VAR_PATTERN.test(target)) {
        const valid = validateIconPath(target);
        if (valid) return valid;
    }
    return shortcutPath;
}
