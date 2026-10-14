// R2-15: the Google OAuth client (id + secret) is NOT in the repository. It is read at runtime from `gcal-client.local.json`
// (gitignored; `gcal-client.example.json` documents the shape). A missing or invalid file means "not configured": the feature stays
// off and nothing else is affected. Pure: the file reader is injected. Values are never logged.
export interface GcalClientConfig {
    clientId: string;
    clientSecret: string;
}

export const GCAL_CLIENT_FILE_NAME = 'gcal-client.local.json';

const MAX_VALUE_CHARS = 512;

/** Parses the file text; null for anything that is not `{ clientId, clientSecret }` of non-empty strings. */
export function parseClientConfig(text: string): GcalClientConfig | null {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const { clientId, clientSecret } = value as Record<string, unknown>;
    const valid = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_VALUE_CHARS;
    if (!valid(clientId) || !valid(clientSecret)) return null;
    // The shipped example file holds placeholders; treat it as "not configured".
    if (clientId.startsWith('xxxxxxxx')) return null;
    return { clientId: clientId.trim(), clientSecret: clientSecret.trim() };
}

/** Tries each candidate path in order (app root, resources folder); the first valid file wins. Never throws. */
export async function loadClientConfig(
    candidates: readonly string[],
    readFile: (filePath: string) => Promise<string>
): Promise<GcalClientConfig | null> {
    for (const candidate of candidates) {
        try {
            const parsed = parseClientConfig(await readFile(candidate));
            if (parsed) return parsed;
        } catch {
            // missing / unreadable: try the next location
        }
    }
    return null;
}
