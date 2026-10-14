// Per-window subscription bookkeeping for main-process services that should only run while at least one
// renderer asked for them (clipboard polling, T-114). Pure logic, no Electron imports (see tests/subscribers.test.ts).
//
// Each key (a webContents id) counts once: repeated `add` calls from the same window are idempotent and a single
// `remove` releases it. This matches the Clipboard Manager plugin, which toggles a mode on/off and may call
// stop more often than start.

export class SubscriberSet<K> {
    private readonly keys = new Set<K>();

    /** Registers `key`. Returns true only when it is the first subscriber (the service should start). */
    add(key: K): boolean {
        if (this.keys.has(key)) return false;
        this.keys.add(key);
        return this.keys.size === 1;
    }

    /** Releases `key`. Returns true only when the last subscriber left (the service should stop). */
    remove(key: K): boolean {
        if (!this.keys.delete(key)) return false;
        return this.keys.size === 0;
    }

    has(key: K): boolean {
        return this.keys.has(key);
    }

    get size(): number {
        return this.keys.size;
    }

    values(): K[] {
        return [...this.keys];
    }
}
