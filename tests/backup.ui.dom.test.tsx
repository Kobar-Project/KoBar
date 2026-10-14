import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBackup, serializeBackup } from '../src/backup/buildBackup';
import { parseBackup } from '../src/backup/parseBackup';
import { BACKUP_HINT_KEY, markBackupHintShown, shouldShowBackupHint } from '../src/backup/backupHint';
import { translations } from '../src/i18n';
import { KOBAR_STORAGE_VERSION } from '../src/store/migrations';
import { useAppStore } from '../src/store/useAppStore';

// T-215: backup UI wiring (restore flow with a mocked restoreFullBackup, one-time hint). Synthetic data only.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const restoreMock = vi.fn();
vi.mock('../src/backup/restoreBackup', () => ({ restoreFullBackup: (...args: unknown[]) => restoreMock(...args) }));

import RestoreFlow from '../src/components/notes/RestoreFlow';

const en = translations.en;
let host: HTMLDivElement;
let root: Root;

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
    const input = host.querySelector<HTMLInputElement>('[data-testid="backup-file"]')!;
    const file = new File([text], 'backup.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => text });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

beforeEach(async () => {
    restoreMock.mockReset();
    useAppStore.setState({ language: 'en' });
    const api = window.api as unknown as Record<string, ReturnType<typeof vi.fn>>;
    api.getBackupSources.mockResolvedValue({ extensionsConfig: {}, plugins: [] });
    api.getAppVersion.mockResolvedValue('1.1.4');
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
        root.render(<RestoreFlow />);
    });
});

afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});

describe('RestoreFlow (restore dialog content)', () => {
    it('shows the preview and confirmation first, restores only after confirming', async () => {
        await pickFile(validBackup());
        expect(q('backup-confirm')).not.toBeNull();
        expect(q('backup-confirm')!.textContent).toContain(en.backupConfirmBody);
        expect(restoreMock).not.toHaveBeenCalled();

        restoreMock.mockResolvedValue({ success: true });
        await act(async () => q('backup-confirm-button')!.click());
        expect(restoreMock).toHaveBeenCalledTimes(1);
        const plan = restoreMock.mock.calls[0][0] as { entries: Array<{ key: string }> };
        expect(plan.entries.map((e) => e.key)).toContain('kobar-storage');
        expect(q('backup-message')!.textContent).toBe(en.backupRestoring);
        expect(q('backup-confirm')).toBeNull();
        // Success keeps the controls disabled until the relaunch.
        expect((q('backup-pick') as HTMLButtonElement).disabled).toBe(true);
    });

    it('cancel leaves everything untouched', async () => {
        await pickFile(validBackup());
        await act(async () => q('backup-cancel')!.click());
        expect(q('backup-confirm')).toBeNull();
        expect(restoreMock).not.toHaveBeenCalled();
    });

    it('rejects an invalid file with a message and no confirmation', async () => {
        await pickFile('not json at all');
        expect(q('backup-confirm')).toBeNull();
        expect(q('backup-message')!.textContent).toBe(en.backupErrInvalid);
        expect((q('backup-pick') as HTMLButtonElement).disabled).toBe(false);
    });

    it('reports a failed restore (data untouched) and re-enables the buttons', async () => {
        restoreMock.mockResolvedValue({ success: false, reason: 'backup-failed', rolledBack: true });
        await pickFile(validBackup());
        await act(async () => q('backup-confirm-button')!.click());
        expect(q('backup-message')!.textContent).toBe(en.backupRestoreFailed);
        expect(q('backup-confirm')).toBeNull();
        expect((q('backup-pick') as HTMLButtonElement).disabled).toBe(false);
    });

    it('points to the pre-restore backup when the rollback did not complete', async () => {
        restoreMock.mockResolvedValue({ success: false, reason: 'write-failed', rolledBack: false });
        await pickFile(validBackup());
        await act(async () => q('backup-confirm-button')!.click());
        expect(q('backup-message')!.textContent).toBe(en.backupRestoreFailedPartial);
        expect(en.backupRestoreFailedPartial).toContain('kobar-full-backup.pre-restore.');
    });

    it('does not get stuck when restoreFullBackup throws, and disables the button while running', async () => {
        let release!: (v: unknown) => void;
        restoreMock.mockReturnValue(new Promise((r) => (release = r)));
        await pickFile(validBackup());
        await act(async () => q('backup-confirm-button')!.click());
        expect((q('backup-confirm-button') as HTMLButtonElement).disabled).toBe(true);
        expect((q('backup-pick') as HTMLButtonElement).disabled).toBe(true);
        await act(async () => release({ success: false, reason: 'error', rolledBack: true }));
        expect((q('backup-pick') as HTMLButtonElement).disabled).toBe(false);

        restoreMock.mockRejectedValue(new Error('boom'));
        await pickFile(validBackup());
        await act(async () => q('backup-confirm-button')!.click());
        expect(q('backup-message')!.textContent).toBe(en.backupRestoreFailed);
        expect((q('backup-pick') as HTMLButtonElement).disabled).toBe(false);
    });
});

describe('backup hint flag', () => {
    it('is shown once: the flag lives in its own localStorage key, outside kobar-storage', () => {
        expect(shouldShowBackupHint()).toBe(true);
        markBackupHintShown();
        expect(shouldShowBackupHint()).toBe(false);
        expect(localStorage.getItem(BACKUP_HINT_KEY)).toBe('1');
        expect(localStorage.getItem('kobar-storage')).toBeNull();
    });

    it('is a known system key: a backup containing it skips nothing', () => {
        const text = serializeBackup(
            buildBackup({
                localStorage: {
                    [BACKUP_HINT_KEY]: '1',
                    'kobar-storage': JSON.stringify({
                        state: { notes: [], globalNotes: [], workspaces: [], language: 'en' },
                        version: KOBAR_STORAGE_VERSION,
                    }),
                },
                extensionsConfig: {},
                plugins: [],
                appVersion: '1.1.4',
                now: new Date(0),
            })
        );
        const result = parseBackup(text, { installedPluginIds: [], currentAppVersion: '1.1.4' });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.preview.counts.skippedKeys).toBe(0);
            expect(result.plan.entries.map((e) => e.key)).toContain(BACKUP_HINT_KEY);
        }
    });
});
