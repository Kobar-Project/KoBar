// R2-11: the inventory of items KoBar moved into KoBox, and the cleanup that sends expired items to the Recycle Bin.
// No Electron imports: the "trash" function is injected (the app passes shell.trashItem), so everything is unit-tested in temp folders.
//
// Inventory file (userData/kobox-inventory.json, next to the KoBox folder, never inside it):
//   { "version": 1, "items": { "<name in KoBox>": { "movedAt": <ms>, "ino": <number>, "kind": "file" | "dir" } } }
// A move keeps the original timestamps, so "24 hours" must count from `movedAt`, not from the file's mtime. Entries that are NOT in
// the inventory (everything KoBox held before this version, items copied by older versions, files a user put there by hand) stay
// valid and are judged by their mtime exactly as before. A record whose inode no longer matches (the name was reused) is ignored.
// The inventory is never required: a missing, unreadable or newer-version file is read as empty, so cleanup keeps working.
// Cleanup touches direct children of the KoBox folder only, never follows links, and never deletes permanently: an item the
// Recycle Bin cannot take stays where it is.
import * as fs from 'fs';
import * as nodePath from 'path';
import { resolveInside } from './paths.cjs';

export const KOBOX_INVENTORY_VERSION = 1;
export const KOBOX_EXPIRY_MS = 24 * 60 * 60 * 1000;

export interface InventoryItem {
    movedAt: number;
    ino: number;
    kind: 'file' | 'dir';
}
export interface KoBoxInventory {
    version: number;
    items: Record<string, InventoryItem>;
}

// MAC-017: fold ASCII on Windows and macOS (case-insensitive volumes). The key only looks up inventory records; a folded key
// that does not exist on a case-sensitive volume just gets pruned, and the mtime rule (refreshed on move) applies instead.
export const inventoryKeyFor = (name: string, platform: string = process.platform): string =>
    platform === 'win32' || platform === 'darwin' ? name.replace(/[A-Z]/g, (c) => c.toLowerCase()) : name;
const keyOf = (name: string): string => inventoryKeyFor(name);

export function readInventory(file: string): KoBoxInventory {
    const empty: KoBoxInventory = { version: KOBOX_INVENTORY_VERSION, items: {} };
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<KoBoxInventory> | null;
        if (!parsed || parsed.version !== KOBOX_INVENTORY_VERSION || !parsed.items || typeof parsed.items !== 'object') return empty;
        const items: Record<string, InventoryItem> = {};
        for (const [name, v] of Object.entries(parsed.items)) {
            if (v && typeof v.movedAt === 'number' && Number.isFinite(v.movedAt) && typeof v.ino === 'number') {
                items[name] = { movedAt: v.movedAt, ino: v.ino, kind: v.kind === 'dir' ? 'dir' : 'file' };
            }
        }
        return { version: KOBOX_INVENTORY_VERSION, items };
    } catch {
        return empty;
    }
}

function writeInventory(file: string, inv: KoBoxInventory): void {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(inv));
    fs.renameSync(tmp, file);
}

/** Records one moved item (by its final name inside KoBox). Never throws: a failed write only means the mtime rule applies. */
export function recordMovedItem(file: string, koBoxPath: string, dest: string, kind: 'file' | 'dir', movedAt: number = Date.now()): void {
    // A rename keeps the old mtime; refresh it so the mtime fallback never trashes a just-moved item if the inventory is lost.
    try {
        const t = new Date();
        fs.utimesSync(dest, t, t);
    } catch {
        // best effort
    }
    try {
        const name = nodePath.basename(dest);
        const st = fs.lstatSync(dest);
        const inv = readInventory(file);
        inv.items[keyOf(name)] = { movedAt, ino: st.ino, kind };
        // Forget items that left KoBox (dragged out, deleted by the user).
        for (const k of Object.keys(inv.items)) {
            const p = resolveInside(koBoxPath, k);
            if (!p || !fs.existsSync(p)) delete inv.items[k];
        }
        writeInventory(file, inv);
    } catch (e) {
        console.error('KoBox inventory write failed:', e);
    }
}

export interface CleanupOptions {
    koBoxPath: string;
    inventoryFile: string;
    mode: '24h' | 'quit';
    /** Sends one path to the Recycle Bin (rejects when it cannot). */
    trash: (p: string) => Promise<void>;
    now?: number;
}
export interface CleanupResult {
    trashed: string[];
    failed: string[];
}

/** Sends the expired ('24h') or all ('quit') direct children of KoBox to the Recycle Bin. Never rejects. */
export async function cleanKoBoxItems(opts: CleanupOptions): Promise<CleanupResult> {
    const result: CleanupResult = { trashed: [], failed: [] };
    const { koBoxPath, inventoryFile, mode, trash } = opts;
    const now = opts.now ?? Date.now();
    try {
        const names = await fs.promises.readdir(koBoxPath);
        const inv = readInventory(inventoryFile);
        let dirty = false;
        for (const name of names) {
            const filePath = resolveInside(koBoxPath, name);
            if (!filePath || filePath === nodePath.resolve(koBoxPath)) continue;
            let stats: fs.Stats;
            try {
                stats = await fs.promises.lstat(filePath);
            } catch {
                continue;
            }
            const rec = inv.items[keyOf(name)];
            const trusted = rec && (rec.ino === 0 || stats.ino === 0 || rec.ino === stats.ino) ? rec : undefined;
            const since = trusted ? trusted.movedAt : stats.mtimeMs;
            if (mode === '24h' && !(now - since > KOBOX_EXPIRY_MS)) continue;
            // The pass yields: keep an entry that was replaced or touched meanwhile, skip one that is already gone.
            let current: fs.Stats;
            try {
                current = await fs.promises.lstat(filePath);
            } catch {
                continue;
            }
            if (current.ino !== stats.ino || current.mtimeMs !== stats.mtimeMs) continue;
            try {
                await trash(filePath);
                result.trashed.push(name);
                if (rec) {
                    delete inv.items[keyOf(name)];
                    dirty = true;
                }
            } catch (e) {
                console.error('KoBox Cleanup: could not send an item to the Recycle Bin:', e);
                result.failed.push(name);
            }
        }
        if (dirty) {
            try {
                writeInventory(inventoryFile, inv);
            } catch {
                /* the inventory is advisory */
            }
        }
    } catch (e) {
        console.error('KoBox Cleanup Error:', e);
    }
    return result;
}
