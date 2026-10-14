// T-312: KoBox (the drop-in folder under userData) and the internal grant-path channel: kobox-drop (grant check, then moveIntoKoBox with
// every T-109 check; R2-11 moved from copy to move), kobox-open, kobox-clean and the 24h / quit cleanup (R2-11: Recycle Bin, see
// lib/koboxCleanup.cts). Only the KoBox plugin calls kobox-clean (via window.api.cleanKoBox; since T-410 the shell no longer does). The paths
// (`koBoxPath`, protected roots) stay defined once in main.cts, which also hands them to the screenshot module and the save-dialog
// guard, so they are injected here together with the live collaborators (path grants, the IPC registry).
import * as path from 'path';
import * as fs from 'fs';
import { shell } from 'electron';
import { isPlainAbsolutePath } from '../../lib/fileArgs.cjs';
import { moveIntoKoBox } from '../../lib/koboxMove.cjs';
import { cleanKoBoxItems, recordMovedItem } from '../../lib/koboxCleanup.cjs';
import type { PathGrants } from '../../lib/pathGrants.cjs';
import { resolvePhysicalPath } from '../lib/physicalPath.cjs';
import type { IpcRegistry } from '../ipc/registry.cjs';
import { GRANT_PATH_OPTIONS, KOBOX_CLEAN_OPTIONS, KOBOX_DROP_OPTIONS } from '../ipc/schemas.cjs';
import { appState } from '../state.cjs';
import { notifyBlockedFileAccess, notifyKoBoxCopyFailed, notifyKoBoxLeftover } from './notifications.cjs';

// Quit-time cleanups still running (the Recycle Bin call is asynchronous). Resolves when they settle or after `timeoutMs`;
// null when nothing is pending. lifecycle.cts holds `will-quit` back until then.
const pendingCleanups = new Set<Promise<unknown>>();
export function waitForKoBoxCleanup(timeoutMs = 10_000): Promise<void> | null {
    if (pendingCleanups.size === 0) return null;
    // Forgotten afterwards, so a cleanup that outlives the timeout cannot hold a second quit attempt back.
    return Promise.race([
        Promise.allSettled([...pendingCleanups]).then(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref()),
    ]).then(() => pendingCleanups.clear());
}

export interface KoBoxDeps {
    registry: IpcRegistry;
    pathGrants: PathGrants;
    /** userData/KoBox as the renderer sees it. */
    koBoxPath: string;
    /** The 'not-user-selected' reason string shared with the other path-grant checks in main.cts. */
    notUserSelected: string;
    getProtectedAppRoots: () => string[];
}

export function registerKoboxIpc(deps: KoBoxDeps): void {
    const { registry, pathGrants, koBoxPath, notUserSelected: NOT_USER_SELECTED, getProtectedAppRoots } = deps;

    const inventoryFile = path.join(path.dirname(koBoxPath), 'kobox-inventory.json');

    // R2-11: expired ('24h') or all ('quit') items go to the Recycle Bin, never permanently deleted; an item the bin cannot take stays.
    // Both modes are asynchronous; the quit pass is tracked so will-quit can wait for it (waitForKoBoxCleanup).
    function cleanKoBox(mode: '24h' | 'quit'): void | Promise<void> {
        if (mode !== '24h' && mode !== 'quit') return;
        if (!fs.existsSync(koBoxPath)) return;
        const run = cleanKoBoxItems({ koBoxPath, inventoryFile, mode, trash: (p) => shell.trashItem(p) }).then(() => undefined);
        pendingCleanups.add(run);
        void run.finally(() => pendingCleanups.delete(run));
        return run;
    }

    // Internal channel sent by the preload's getFilePath (not a window.api member). Only the main window's
    // top frame may grant.
    registry.on('grant-path', GRANT_PATH_OPTIONS, (event, filePath: unknown) => {
        if (!appState.mainWindow || appState.mainWindow.isDestroyed() || event.sender !== appState.mainWindow.webContents) return;
        if (event.senderFrame !== appState.mainWindow.webContents.mainFrame) return;
        if (!isPlainAbsolutePath(filePath)) return;
        pathGrants.grant(filePath, 'user-file');
    });

    // R-03: a drop that reaches the channel twice (the KoBox plugin firing two handlers) must not move the same item
    // twice at once; a second request for a path that is still being moved is ignored.
    const copyingNow = new Set<string>();

    registry.on('kobox-drop', KOBOX_DROP_OPTIONS, (_event, filePaths: string[]) => {
        if (!fs.existsSync(koBoxPath)) fs.mkdirSync(koBoxPath, { recursive: true });
        if (!Array.isArray(filePaths)) return;
        const protectedRoots = getProtectedAppRoots();
        const MAX_KOBOX_DROP = 100;
        if (filePaths.length > MAX_KOBOX_DROP)
            console.warn(`KoBox: only the first ${MAX_KOBOX_DROP} of ${filePaths.length} dropped items are moved`);
        filePaths.slice(0, MAX_KOBOX_DROP).forEach((src) => {
            // T-042: only a dropped item itself is accepted (exact grant). Checked before copyIntoKoBox because it
            // is an in-memory lookup that touches no file system; copyIntoKoBox still runs every T-109 check after it.
            if (!pathGrants.isGranted(src)) {
                console.error('KoBox Move rejected:', NOT_USER_SELECTED);
                notifyBlockedFileAccess('kobox-drop');
                return;
            }
            if (typeof src === 'string') {
                if (copyingNow.has(src)) return;
                copyingNow.add(src);
            }
            // R2-11: the dropped item is MOVED into KoBox (see lib/koboxMove.cts: fail-safe, the original is only removed after
            // the destination is verified). Asynchronous so a large drop does not freeze the main process.
            moveIntoKoBox(src, koBoxPath, protectedRoots)
                .then((result) => {
                    if (!result.ok) {
                        console.error('KoBox Move rejected:', result.reason, typeof src === 'string' ? src : '');
                        notifyKoBoxCopyFailed(result.reason);
                        return;
                    }
                    recordMovedItem(inventoryFile, koBoxPath, result.dest, result.kind);
                    if (result.leftover) notifyKoBoxLeftover();
                })
                .catch((e) => {
                    console.error('KoBox Move Error:', e);
                    notifyKoBoxCopyFailed();
                })
                .finally(() => {
                    if (typeof src === 'string') copyingNow.delete(src);
                });
        });
    });

    registry.on('kobox-open', () => {
        if (!fs.existsSync(koBoxPath)) {
            fs.mkdirSync(koBoxPath, { recursive: true });
        }
        const targetPath = resolvePhysicalPath(koBoxPath);
        shell.openPath(targetPath);
    });
    registry.on('kobox-clean', KOBOX_CLEAN_OPTIONS, (_event, mode: '24h' | 'quit') => cleanKoBox(mode));
}
