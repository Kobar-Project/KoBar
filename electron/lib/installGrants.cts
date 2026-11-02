// CNL (owner request 2026-11-01): a plugin install or update the owner starts with a click in the Settings window does not ask
// again in a native dialog. The click arrives on `settings:action`, whose sender policy accepts only the Settings window's top
// frame (no plugin code runs there), and main turns it into a short-lived grant here. The GitHub install handler consumes a grant
// instead of confirming. Without a grant (a call made by a plugin through window.api, or a late one) the confirmation stays.
// A single install / update grant is bound to the plugin id the owner clicked, so a plugin running in the main window cannot
// spend it on a different plugin during those seconds. "Update all" grants updates only; an update always targets the recorded
// origin of a plugin that is already installed.
// Pure, no Electron import (tests/installGrants.test.ts).

export type InstallGrantKind = 'install' | 'update';

/** Settings actions that grant, and for how long / how many installs. */
export const INSTALL_GRANT_RULES: Readonly<Record<string, { kind: InstallGrantKind; ttlMs: number; uses: number }>> = {
    // One catalogue install, consumed by the GitHub install the main window starts right after the relayed action.
    'plugin.install': { kind: 'install', ttlMs: 15_000, uses: 1 },
    'plugin.update': { kind: 'update', ttlMs: 15_000, uses: 1 },
    // "Update all" runs one update per plugin, one after another.
    'plugin.updateAll': { kind: 'update', ttlMs: 120_000, uses: 50 },
};

interface Grant {
    kind: InstallGrantKind;
    /** The plugin id the grant is for; null = any id (update all). */
    id: string | null;
    expiresAt: number;
    uses: number;
}

const MAX_GRANT_ID_LENGTH = 200;

function payloadId(payload: unknown): string | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const id = (payload as { id?: unknown }).id;
    return typeof id === 'string' && id.length > 0 && id.length <= MAX_GRANT_ID_LENGTH ? id : null;
}

export function createInstallGrants(now: () => number = Date.now) {
    let grants: Grant[] = [];
    const prune = () => {
        const t = now();
        grants = grants.filter((g) => g.expiresAt > t && g.uses > 0);
    };
    return {
        /**
         * Called for every action from the Settings window; only the action types in INSTALL_GRANT_RULES grant anything. A
         * single install / update needs the plugin id in its payload (no id, no grant).
         */
        grantFromSettingsAction(type: string, payload?: unknown): void {
            const rule = Object.prototype.hasOwnProperty.call(INSTALL_GRANT_RULES, type) ? INSTALL_GRANT_RULES[type] : undefined;
            if (!rule) return;
            const id = rule.uses === 1 ? payloadId(payload) : null;
            if (rule.uses === 1 && id === null) return;
            prune();
            grants.push({ kind: rule.kind, id, expiresAt: now() + rule.ttlMs, uses: rule.uses });
        },
        /** True (and one use spent) when a live grant of `kind` exists for plugin `id`. */
        consume(kind: InstallGrantKind, id: string): boolean {
            prune();
            const grant = grants.find((g) => g.kind === kind && (g.id === null || g.id === id));
            if (!grant) return false;
            grant.uses -= 1;
            prune();
            return true;
        },
    };
}

export type InstallGrants = ReturnType<typeof createInstallGrants>;
