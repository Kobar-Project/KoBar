// Pure helper deciding whether a top-level navigation of an app window is allowed (SEC-07).
// No Electron / no I/O so it can be unit-tested.

export interface NavigationPolicy {
    isDev: boolean;
    /** file:// URLs of the app's own HTML entry points (prod). Query and hash are ignored. */
    appFileUrls: string[];
    /** Vite dev server origin, e.g. http://localhost:5173 (dev only). */
    devOrigin: string;
}

function parse(raw: unknown): URL | null {
    if (typeof raw !== 'string') return null;
    try {
        return new URL(raw);
    } catch {
        return null;
    }
}

/** True only when `url` points at the app's own page (dev server origin in dev, bundled file in prod). */
export function isAllowedNavigation(url: unknown, policy: NavigationPolicy): boolean {
    const u = parse(url);
    if (!u) return false;
    // Credentials in the URL are never legitimate for the app's own pages.
    if (u.username || u.password) return false;

    if (policy.isDev) {
        const dev = parse(policy.devOrigin);
        if (!dev) return false;
        return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === dev.origin;
    }

    if (u.protocol !== 'file:') return false;
    return policy.appFileUrls.some((allowed) => {
        const a = parse(allowed);
        return !!a && a.protocol === 'file:' && a.host === u.host && a.pathname === u.pathname;
    });
}
