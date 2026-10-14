import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBackup, serializeBackup } from '../src/backup/buildBackup';
import { classifyBackupKey, UNREADABLE_STORE_COPY_PREFIX } from '../src/backup/keyPolicy';
import { parseBackup } from '../src/backup/parseBackup';
import { translations } from '../src/i18n';
import { KOBAR_STORAGE_VERSION } from '../src/store/migrations';

// T-152: recovery flow after a failed `kobar-storage` hydration. Synthetic corrupt storage only.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const restoreMock = vi.fn();
vi.mock('../src/backup/restoreBackup', () => ({ restoreFullBackup: (...args: unknown[]) => restoreMock(...args) }));

type PersistModule = typeof import('../src/store/persistStorage');

const en = translations.en;
const CORRUPT = '{"state": {"notes": [ broken';
const loaded: PersistModule[] = [];
let host: HTMLDivElement | null = null;
let root: Root | null = null;

/** Fresh module graph so the store hydrates from whatever is in localStorage right now. */
async function loadApp() {
    vi.resetModules();
    const store = await import('../src/store/useAppStore');
    const persist = await import('../src/store/persistStorage');
    const errors = await import('../src/store/hydrationError');
    const recovery = await import('../src/store/hydrationRecovery');
    const component = await import('../src/components/recovery/HydrationRecovery');
    loaded.push(persist);
    return { store, persist, errors, recovery, HydrationRecovery: component.default };
}

async function renderRecovery(Component: React.FC) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
        root!.render(<Component />);
    });
}

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

async function click(id: string) {
    await act(async () => {
        q(id)!.click();
    });
}

function copyKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(UNREADABLE_STORE_COPY_PREFIX)) keys.push(key);
    }
    return keys;
}

const validBackup = () =>
    serializeBackup(
        buildBackup({
            localStorage: {
                'kobar-storage': JSON.stringify({
                    state: { notes: [], globalNotes: [], workspaces: [], language: 'en' },
                    version: KOBAR_STORAGE_VERSION,
                }),
            },
            extensionsConfig: {},
            plugins: [],
            appVersion: '1.1.4',
            now: new Date('2026-10-12T10:00:00.000Z'),
        })
    );

async function pickFile(text: string) {
    const input = q('recovery-file') as HTMLInputElement;
    const file = new File([text], 'backup.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => text });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

function setWindowGeometry(screenX: number, screenY = 0) {
    Object.defineProperty(window, 'screenX', { value: screenX, configurable: true });
    Object.defineProperty(window, 'screenY', { value: screenY, configurable: true });
}

beforeEach(() => {
    restoreMock.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = window.api as unknown as Record<string, ReturnType<typeof vi.fn>>;
    api.getBackupSources.mockResolvedValue({ extensionsConfig: {}, plugins: [] });
    api.getAppVersion.mockResolvedValue('1.1.4');
});

afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = null;
    host?.remove();
    host = null;
    for (const persist of loaded.splice(0)) persist.appPersistStorage.lockWrites('test-teardown');
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('recovery panel after a failed hydration', () => {
    it('shows the panel instead of the banner; writes stay locked and the stored value is untouched', async () => {
        localStorage.setItem('kobar-storage', CORRUPT);
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        const { store, persist, errors, HydrationRecovery } = await loadApp();
        expect(errors.isHydrationFailed()).toBe(true);
        expect(document.getElementById(errors.HYDRATION_ERROR_BANNER_ID)).not.toBeNull();

        await renderRecovery(HydrationRecovery);
        const panel = q('recovery-panel')!;
        expect(panel).not.toBeNull();
        expect(panel.classList.contains('pointer-events-auto')).toBe(true);
        expect(panel.textContent).toContain(en.hydrationFailedTitle);
        expect(q('recovery-restore')!.textContent).toContain(en.recoveryRestore);
        expect(q('recovery-fresh')!.textContent).toContain(en.recoveryStartFresh);
        // The panel replaces the plain banner.
        expect(document.getElementById(errors.HYDRATION_ERROR_BANNER_ID)).toBeNull();

        expect(persist.appPersistStorage.lockReason()).toBe(errors.HYDRATION_FAILED_LOCK_REASON);
        expect(store.useAppStore.getState().isHydrated).toBe(false);
        store.useAppStore.setState({ notePanelWidth: 777 });
        persist.flushAppPersist();
        expect(localStorage.getItem('kobar-storage')).toBe(CORRUPT);
        expect(setItem.mock.calls.filter(([key]) => key === 'kobar-storage')).toEqual([]);
        expect(copyKeys()).toEqual([]);
    });

    it('"Continue without saving" collapses the panel (nothing is written) and it can be reopened', async () => {
        localStorage.setItem('kobar-storage', CORRUPT);
        const { persist, HydrationRecovery } = await loadApp();
        await renderRecovery(HydrationRecovery);
        await click('recovery-later');
        expect(q('recovery-panel')).toBeNull();
        expect(q('recovery-reopen')!.textContent).toContain(en.recoveryReopen);
        expect(persist.appPersistStorage.isLocked()).toBe(true);
        await click('recovery-reopen');
        expect(q('recovery-panel')).not.toBeNull();
        expect(localStorage.getItem('kobar-storage')).toBe(CORRUPT);
    });

    it('"Start fresh" needs a confirmation, keeps a verbatim copy, then unlocks with default state', async () => {
        localStorage.setItem('kobar-storage', CORRUPT);
        const { store, persist, errors, HydrationRecovery } = await loadApp();
        await renderRecovery(HydrationRecovery);
        store.useAppStore.setState({ notePanelWidth: 777 });

        await click('recovery-fresh');
        expect(q('recovery-fresh-panel')!.textContent).toContain(en.recoveryFreshConfirmBody);
        // Nothing happens before the confirmation.
        expect(copyKeys()).toEqual([]);
        expect(persist.appPersistStorage.isLocked()).toBe(true);
        await click('recovery-fresh-cancel');
        expect(q('recovery-fresh-panel')).toBeNull();
        expect(copyKeys()).toEqual([]);

        await click('recovery-fresh');
        await click('recovery-fresh-confirm');

        const keys = copyKeys();
        expect(keys).toHaveLength(1);
        expect(keys[0]).toMatch(/^kobar-storage\.unreadable\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
        expect(localStorage.getItem(keys[0])).toBe(CORRUPT);

        expect(persist.appPersistStorage.isLocked()).toBe(false);
        expect(errors.isHydrationFailed()).toBe(false);
        const state = store.useAppStore.getState();
        expect(state.isHydrated).toBe(true);
        const initial = store.useAppStore.getInitialState();
        expect(state.notePanelWidth).toBe(initial.notePanelWidth);

        const disk = JSON.parse(localStorage.getItem('kobar-storage') as string);
        expect(disk.version).toBe(KOBAR_STORAGE_VERSION);
        expect(disk.state.notePanelWidth).toBe(initial.notePanelWidth);
        expect(disk.state.notes).toEqual(initial.notes);
        expect(q('recovery-panel')).toBeNull();
        expect(q('recovery-reopen')).toBeNull();

        // Saving works normally afterwards.
        store.useAppStore.setState({ notePanelWidth: 345 });
        persist.flushAppPersist();
        expect(JSON.parse(localStorage.getItem('kobar-storage') as string).state.notePanelWidth).toBe(345);
        expect(localStorage.getItem(keys[0])).toBe(CORRUPT);
    });

    it('"Start fresh" changes nothing when the copy cannot be written', async () => {
        localStorage.setItem('kobar-storage', CORRUPT);
        const { store, persist, errors, HydrationRecovery } = await loadApp();
        await renderRecovery(HydrationRecovery);
        const realSetItem = Storage.prototype.setItem;
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
            if (key.startsWith(UNREADABLE_STORE_COPY_PREFIX)) throw new DOMException('full', 'QuotaExceededError');
            return realSetItem.call(this, key, value);
        });

        await click('recovery-fresh');
        await click('recovery-fresh-confirm');

        expect(q('recovery-message')!.textContent).toBe(en.recoveryCopyFailed);
        expect(persist.appPersistStorage.lockReason()).toBe(errors.HYDRATION_FAILED_LOCK_REASON);
        expect(errors.isHydrationFailed()).toBe(true);
        expect(store.useAppStore.getState().isHydrated).toBe(false);
        persist.flushAppPersist();
        expect(localStorage.getItem('kobar-storage')).toBe(CORRUPT);
        expect(copyKeys()).toEqual([]);
    });

    it('restore: picks a file, confirms, keeps the copy first and hands the plan to restoreFullBackup', async () => {
        localStorage.setItem('kobar-storage', CORRUPT);
        const { HydrationRecovery } = await loadApp();
        await renderRecovery(HydrationRecovery);
        let copiesAtRestore: string[] = [];
        restoreMock.mockImplementation(async () => {
            copiesAtRestore = copyKeys().map((key) => localStorage.getItem(key) as string);
            return { success: true };
        });

        await pickFile(validBackup());
        expect(q('recovery-restore-panel')!.textContent).toContain(en.backupConfirmBody);
        expect(restoreMock).not.toHaveBeenCalled();
        await click('recovery-restore-confirm');

        expect(restoreMock).toHaveBeenCalledTimes(1);
        const plan = restoreMock.mock.calls[0][0] as { entries: Array<{ key: string }> };
        expect(plan.entries.map((e) => e.key)).toContain('kobar-storage');
        expect(copiesAtRestore).toEqual([CORRUPT]);
        expect(q('recovery-message')!.textContent).toBe(en.backupRestoring);
        expect((q('recovery-restore') as HTMLButtonElement).disabled).toBe(true);
    });

    it('restore: an invalid file shows the error and a failed restore keeps the lock state from restoreFullBackup', async () => {
        localStorage.setItem('kobar-storage', CORRUPT);
        const { persist, errors, HydrationRecovery } = await loadApp();
        await renderRecovery(HydrationRecovery);

        await pickFile('not a backup');
        expect(q('recovery-message')!.textContent).toBe(en.backupErrInvalid);
        expect(restoreMock).not.toHaveBeenCalled();

        restoreMock.mockResolvedValue({ success: false, reason: 'backup-failed', rolledBack: true });
        await pickFile(validBackup());
        await click('recovery-restore-confirm');
        expect(q('recovery-message')!.textContent).toBe(en.backupRestoreFailed);
        expect(persist.appPersistStorage.lockReason()).toBe(errors.HYDRATION_FAILED_LOCK_REASON);
        expect(localStorage.getItem('kobar-storage')).toBe(CORRUPT);
        expect(q('recovery-panel')).not.toBeNull();
    });

    it('recomputes its position on resize and on a screen/edge change from main', async () => {
        localStorage.setItem('kobar-storage', CORRUPT);
        Object.defineProperty(window.screen, 'availWidth', { value: 1920, configurable: true });
        Object.defineProperty(window.screen, 'availLeft', { value: 0, configurable: true });
        Object.defineProperty(window.screen, 'availTop', { value: 0, configurable: true });
        setWindowGeometry(100);
        try {
            const { store, HydrationRecovery } = await loadApp();
            await renderRecovery(HydrationRecovery);
            expect(q('recovery-panel')!.style.left).toBe('860px');

            setWindowGeometry(500);
            await act(async () => {
                window.dispatchEvent(new Event('resize'));
            });
            expect(q('recovery-panel')!.style.left).toBe('460px');

            setWindowGeometry(300);
            await act(async () => {
                store.useAppStore.getState().setScreenBounds({ x: 0, y: 0, width: 1920, height: 1080 });
            });
            expect(q('recovery-panel')!.style.left).toBe('660px');
        } finally {
            Object.defineProperty(window.screen, 'availWidth', { value: 0, configurable: true });
            setWindowGeometry(0);
        }
    });
});

describe('plain banner position (T-201 banner, T-202 warning)', () => {
    it('re-places the banner on resize', async () => {
        Object.defineProperty(window.screen, 'availWidth', { value: 1920, configurable: true });
        setWindowGeometry(100);
        try {
            const { showBanner } = await import('../src/store/banner');
            const banner = showBanner({ id: 'test-banner', title: 't', body: 'b', dismissLabel: 'x' })!;
            expect(banner.style.left).toBe('860px');
            setWindowGeometry(400);
            window.dispatchEvent(new Event('resize'));
            expect(banner.style.left).toBe('560px');
        } finally {
            Object.defineProperty(window.screen, 'availWidth', { value: 0, configurable: true });
            setWindowGeometry(0);
        }
    });

    it('removeBanner and dismiss detach the resize listener', async () => {
        const { showBanner, removeBanner } = await import('../src/store/banner');
        const add = vi.spyOn(window, 'addEventListener');
        const remove = vi.spyOn(window, 'removeEventListener');

        showBanner({ id: 'test-banner-a', title: 't', body: 'b', dismissLabel: 'x' });
        const listenerA = add.mock.calls.find(([type]) => type === 'resize')![1];
        removeBanner('test-banner-a');
        expect(remove).toHaveBeenCalledWith('resize', listenerA);
        expect(document.getElementById('test-banner-a')).toBeNull();

        add.mockClear();
        const b = showBanner({ id: 'test-banner-b', title: 't', body: 'b', dismissLabel: 'x' })!;
        const listenerB = add.mock.calls.find(([type]) => type === 'resize')![1];
        b.querySelector('button')!.click();
        expect(remove).toHaveBeenCalledWith('resize', listenerB);
        expect(document.getElementById('test-banner-b')).toBeNull();
    });
});

describe('restore flow during a failed hydration', () => {
    async function renderBackupSection() {
        const app = await loadApp();
        const { default: RestoreFlow } = await import('../src/components/notes/RestoreFlow');
        await renderRecovery(RestoreFlow);
        return app;
    }

    async function pickBackupFile(text: string) {
        const input = q('backup-file') as HTMLInputElement;
        const file = new File([text], 'backup.json', { type: 'application/json' });
        Object.defineProperty(file, 'text', { value: async () => text });
        Object.defineProperty(input, 'files', { value: [file], configurable: true });
        await act(async () => {
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }

    it('keeps the verbatim copy before restoring', async () => {
        localStorage.setItem('kobar-storage', CORRUPT);
        await renderBackupSection();
        let copiesAtRestore: string[] = [];
        restoreMock.mockImplementation(async () => {
            copiesAtRestore = copyKeys().map((key) => localStorage.getItem(key) as string);
            return { success: true };
        });
        await pickBackupFile(validBackup());
        await click('backup-confirm-button');
        expect(restoreMock).toHaveBeenCalledTimes(1);
        expect(copiesAtRestore).toEqual([CORRUPT]);
    });

    it('does not restore when the copy cannot be written', async () => {
        localStorage.setItem('kobar-storage', CORRUPT);
        const { persist, errors } = await renderBackupSection();
        const realSetItem = Storage.prototype.setItem;
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
            if (key.startsWith(UNREADABLE_STORE_COPY_PREFIX)) throw new DOMException('full', 'QuotaExceededError');
            return realSetItem.call(this, key, value);
        });
        await pickBackupFile(validBackup());
        await click('backup-confirm-button');
        expect(restoreMock).not.toHaveBeenCalled();
        expect(q('backup-message')!.textContent).toBe(en.recoveryCopyFailed);
        expect(persist.appPersistStorage.lockReason()).toBe(errors.HYDRATION_FAILED_LOCK_REASON);
        expect(localStorage.getItem('kobar-storage')).toBe(CORRUPT);
    });

    it('a healthy profile restores directly without a copy', async () => {
        await renderBackupSection();
        restoreMock.mockResolvedValue({ success: true });
        await pickBackupFile(validBackup());
        await click('backup-confirm-button');
        expect(restoreMock).toHaveBeenCalledTimes(1);
        expect(copyKeys()).toEqual([]);
    });
});

describe('redacted exports of recovery copies', () => {
    it('drops a non-JSON copy unless secrets are included; a JSON copy is redacted normally', () => {
        const broken = `${UNREADABLE_STORE_COPY_PREFIX}2026-10-12T10-00-00-000Z`;
        const parseable = `${UNREADABLE_STORE_COPY_PREFIX}2026-10-12T10-00-00-000Z-1`;
        const snapshot = {
            localStorage: { [broken]: '{"state":{"apiKey":"abc123", broken', [parseable]: '{"state":null,"version":5}' },
            extensionsConfig: {},
            plugins: [],
            appVersion: '1.1.4',
            now: new Date('2026-10-12T10:00:00.000Z'),
        };
        const redacted = buildBackup(snapshot);
        expect(Object.keys(redacted.localStorage)).toEqual([parseable]);
        expect(redacted.redactions.removedKeys).toContainEqual({ key: broken, reason: 'unprocessable' });

        const withSecrets = buildBackup(snapshot, { includeSecrets: true });
        expect(withSecrets.localStorage[broken]).toBe(snapshot.localStorage[broken]);
    });
});

describe('recovery actions (unit)', () => {
    it('preserveUnreadableStore: nothing to keep, reuse of an identical copy, no overwrite on collision, failure', async () => {
        const { recovery } = await loadApp();
        const now = new Date('2026-10-12T10:00:00.000Z');
        expect(recovery.preserveUnreadableStore(localStorage, now)).toEqual({ ok: true, key: null });

        localStorage.setItem('kobar-storage', 'A');
        localStorage.setItem(`${UNREADABLE_STORE_COPY_PREFIX}2026-10-12T10-00-00-000Z`, 'older');
        const first = recovery.preserveUnreadableStore(localStorage, now);
        expect(first).toEqual({ ok: true, key: `${UNREADABLE_STORE_COPY_PREFIX}2026-10-12T10-00-00-000Z-1` });
        expect(localStorage.getItem(`${UNREADABLE_STORE_COPY_PREFIX}2026-10-12T10-00-00-000Z`)).toBe('older');
        expect(recovery.preserveUnreadableStore(localStorage, new Date('2026-10-13T00:00:00.000Z'))).toEqual(first);
        expect(copyKeys()).toHaveLength(2);

        // Every name reported as taken: bounded, refuses instead of overwriting.
        const allTaken = { length: 0, key: () => null, getItem: () => 'B', setItem: vi.fn() };
        expect(recovery.preserveUnreadableStore(allTaken, now)).toEqual({ ok: false });
        expect(allTaken.setItem).not.toHaveBeenCalled();
        // A write that does not stick fails the read-back check.
        const lossy = {
            length: 0,
            key: () => null,
            getItem: (k: string) => (k === 'kobar-storage' ? 'B' : null),
            setItem: () => undefined,
        };
        expect(recovery.preserveUnreadableStore(lossy, now)).toEqual({ ok: false });
    });

    it('startFreshAfterHydrationFailure only runs under the hydration-failed lock and re-locks on errors', async () => {
        const { recovery, errors } = await loadApp();
        const persist = { lockReason: vi.fn(() => 'restore-in-progress'), lockWrites: vi.fn(), unlockWrites: vi.fn(), flush: vi.fn() };
        const preserve = vi.fn(() => ({ ok: true as const, key: 'k' }));
        const resetToDefaults = vi.fn();
        const markHydrated = vi.fn();
        expect(recovery.startFreshAfterHydrationFailure({ persist, preserve, resetToDefaults, markHydrated })).toEqual({
            success: false,
            reason: 'not-failed',
        });
        expect(preserve).not.toHaveBeenCalled();

        persist.lockReason.mockReturnValue(errors.HYDRATION_FAILED_LOCK_REASON);
        markHydrated.mockImplementation(() => {
            throw new Error('boom');
        });
        expect(recovery.startFreshAfterHydrationFailure({ persist, preserve, resetToDefaults, markHydrated })).toEqual({
            success: false,
            reason: 'error',
        });
        expect(persist.lockWrites).toHaveBeenLastCalledWith(errors.HYDRATION_FAILED_LOCK_REASON);
        expect(persist.flush).not.toHaveBeenCalled();
    });

    it('restoreFromRecovery never calls the restore when the copy fails', async () => {
        const { recovery } = await loadApp();
        const restore = vi.fn();
        const result = await recovery.restoreFromRecovery({} as never, { preserve: () => ({ ok: false }), restore });
        expect(result).toEqual({ success: false, reason: 'copy-failed', rolledBack: true });
        expect(restore).not.toHaveBeenCalled();
    });
});

describe('backup key policy for recovery copies', () => {
    it('classifies kobar-storage.unreadable.* as a never-restored recovery copy', () => {
        const key = `${UNREADABLE_STORE_COPY_PREFIX}2026-10-12T10-00-00-000Z`;
        expect(classifyBackupKey(key, new Set(), new Set())).toEqual({ accepted: false, reason: 'recovery-copy' });
        expect(classifyBackupKey('kobar-storage', new Set(), new Set())).toMatchObject({ accepted: true, category: 'core' });

        const text = serializeBackup(
            buildBackup(
                {
                    localStorage: {
                        'kobar-storage': JSON.stringify({ state: { notes: [], workspaces: [] }, version: KOBAR_STORAGE_VERSION }),
                        [key]: CORRUPT,
                    },
                    extensionsConfig: {},
                    plugins: [],
                    appVersion: '1.1.4',
                    now: new Date('2026-10-12T10:00:00.000Z'),
                },
                // Only an export with secrets carries a non-JSON copy (see the redaction test below).
                { includeSecrets: true }
            )
        );
        const parsed = parseBackup(text, { installedPluginIds: [], currentAppVersion: '1.1.4' });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.plan.entries.map((e) => e.key)).not.toContain(key);
        expect(parsed.preview.skipped).toContainEqual({ key, reason: 'recovery-copy' });
    });
});

describe('app wiring', () => {
    it('App renders the recovery panel', () => {
        const source = readFileSync(resolve(__dirname, '../src/App.tsx'), 'utf8');
        expect(source).toContain("import HydrationRecovery from './components/recovery/HydrationRecovery';");
        expect(source).toContain('<HydrationRecovery />');
    });
});
