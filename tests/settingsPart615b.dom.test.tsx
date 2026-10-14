// T-615b: relayed `data.*` actions, the main window's transfer dialog (shared export/import code) and the Backup page buttons.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IpcSettingsAction, IpcSystemSummary } from '../shared/ipc-contract';

const bridge = vi.hoisted(() => {
    const sent: IpcSettingsAction[] = [];
    const fake = {
        sent,
        onState: (): (() => void) => () => {},
        requestState: () => {},
        dispatch: (action: IpcSettingsAction) => void sent.push(action),
    };
    (globalThis as { settingsBridge?: unknown }).settingsBridge = fake;
    return fake;
});

import { closeRestoreDialog, isRestoreDialogOpen } from '../src/backup/restoreDialog';
import { createSystemSync } from '../src/store/systemSync';
import { closeDataTransferDialog, getDataTransferMode } from '../src/backup/dataTransferDialog';
import DataTransferDialogHost from '../src/components/notes/DataTransferDialogHost';
import { translations } from '../src/i18n';
import { settingsMirror } from '../src/settings/mirror';
import { BackupPage } from '../src/settings/pages/Backup';
import { systemSync } from '../src/store/systemSyncHost';
import { useAppStore } from '../src/store/useAppStore';
import { cleanup, fire, render } from './ui/render';

const en = translations.en;
const t = (key: keyof typeof en) => en[key];
const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
const buttons = (host: HTMLElement, label: string) => [...host.querySelectorAll('button')].filter((b) => b.textContent?.includes(label));

const SUMMARY: IpcSystemSummary = {
    version: '2.0.0',
    updatesEnabled: false,
    update: { status: 'idle', version: '', percent: 0 },
    backup: { busy: false, last: null },
};
let seq = 0;
function publish(state: Record<string, unknown> | null, system?: IpcSystemSummary) {
    seq += 1;
    act(() => settingsMirror.receive({ seq, state, ack: 0, ...(system ? { system } : {}) }));
}

const MODES = [
    ['data.exportSettings', 'exportSettings'],
    ['data.exportNotes', 'exportNotes'],
    ['data.importSettings', 'importSettings'],
    ['data.importNotes', 'importNotes'],
] as const;

afterEach(() => {
    cleanup();
    act(() => closeDataTransferDialog());
    bridge.sent.length = 0;
    publish(null);
    useAppStore.setState({ isHydrated: false });
    vi.restoreAllMocks();
});

describe('main window host', () => {
    vi.spyOn(window, 'focus').mockImplementation(() => {});

    it.each(MODES)('%s is rejected before hydration, with a payload, and opens the dialog otherwise', async (type, mode) => {
        useAppStore.setState({ isHydrated: false });
        expect(await systemSync.handle({ type, payload: {} })).toEqual({ ok: false, reason: 'unavailable' });
        expect(getDataTransferMode()).toBeNull();
        useAppStore.setState({ isHydrated: true });
        for (const bad of [{ text: '{}' }, { path: 'C:/x' }, 'x', [1], null]) {
            expect(await systemSync.handle({ type, payload: bad })).toEqual({ ok: false, reason: 'invalid-payload' });
        }
        expect(getDataTransferMode()).toBeNull();
        expect(await systemSync.handle({ type, payload: {} })).toEqual({ ok: true });
        expect(getDataTransferMode()).toBe(mode);
    });

    it('export dialog downloads on its own button (user gesture) and closes', async () => {
        useAppStore.setState({ isHydrated: true });
        const create = vi.fn(() => 'blob:x');
        (URL as unknown as { createObjectURL: unknown }).createObjectURL = create;
        (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
        const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        render(<DataTransferDialogHost />);
        await act(async () => void (await systemSync.handle({ type: 'data.exportNotes', payload: {} })));
        expect(anchorClick).not.toHaveBeenCalled();
        const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
        click(buttons(dialog, en.downloadJson)[0]);
        expect(create).toHaveBeenCalledTimes(1);
        expect(anchorClick).toHaveBeenCalledTimes(1);
        expect(getDataTransferMode()).toBeNull();
    });

    it('import dialog validates through the shared code: valid notes are added, an invalid file shows an alert', async () => {
        useAppStore.setState({ isHydrated: true });
        render(<DataTransferDialogHost />);
        await act(async () => void (await systemSync.handle({ type: 'data.importNotes', payload: {} })));
        const input = document.querySelector('[data-testid="transfer-file"]') as HTMLInputElement;
        const pick = async (text: string) => {
            const file = new File([text], 'n.json', { type: 'application/json' });
            Object.defineProperty(input, 'files', { value: [file], configurable: true });
            await act(async () => {
                fire(input, new Event('change', { bubbles: true }));
                await new Promise((r) => setTimeout(r, 30));
            });
        };
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await pick('not json');
        expect(document.querySelector('[role="alert"]')!.textContent).toContain(en.importInvalidFile);
        expect(getDataTransferMode()).toBe('importNotes');
        const before = useAppStore.getState().notes.length;
        await pick(JSON.stringify({ notes: [{ title: 'T615b note', content: 'x' }] }));
        expect(useAppStore.getState().notes.length).toBe(before + 1);
        expect(getDataTransferMode()).toBeNull();
    });
});

describe('exclusivity and busy', () => {
    it('the restore and transfer dialogs refuse to open while the other is open', async () => {
        useAppStore.setState({ isHydrated: true });
        await systemSync.handle({ type: 'data.importNotes', payload: {} });
        await systemSync.handle({ type: 'backup.restore', payload: {} });
        expect(isRestoreDialogOpen()).toBe(false);
        closeDataTransferDialog();
        await systemSync.handle({ type: 'backup.restore', payload: {} });
        await systemSync.handle({ type: 'data.importSettings', payload: {} });
        expect(getDataTransferMode()).toBeNull();
        closeRestoreDialog();
    });

    it('data.* actions queue behind a running full backup export (the busy guard mirrors backup.restore)', async () => {
        useAppStore.setState({ isHydrated: true });
        let release: (v: { success: boolean }) => void = () => {};
        const sync = createSystemSync({
            api: () => undefined,
            isHydrated: () => true,
            updatesEnabled: false,
            exportBackup: () => new Promise((r) => (release = r)),
            openDataTransfer: () => {},
        });
        const running = sync.handle({ type: 'backup.export', payload: { includeSecrets: false } });
        await Promise.resolve();
        await Promise.resolve();
        expect(sync.getSummary()?.backup.busy).toBe(true);
        const blocked = sync.handle({ type: 'data.importNotes', payload: {} });
        release({ success: true });
        await running;
        expect(await blocked).toEqual({ ok: true });
    });
});

describe('Backup page', () => {
    it('settings / notes buttons are disabled until the first snapshot, then relay empty data.* actions', () => {
        const first = render(<BackupPage t={t} />);
        expect(buttons(first.host, en.downloadJson).every((b) => b.hasAttribute('disabled'))).toBe(true);
        expect(buttons(first.host, en.import).every((b) => b.hasAttribute('disabled'))).toBe(true);
        cleanup();
        publish({ language: 'en' }, SUMMARY);
        const { host } = render(<BackupPage t={t} />);
        expect(host.querySelectorAll('[role="group"]').length).toBe(2);
        const dl = buttons(host, en.downloadJson);
        const imp = buttons(host, en.import);
        click(dl[0]);
        click(imp[0]);
        click(dl[1]);
        click(imp[1]);
        expect(bridge.sent.map((a) => [a.type, a.payload])).toEqual([
            ['data.exportSettings', {}],
            ['data.importSettings', {}],
            ['data.exportNotes', {}],
            ['data.importNotes', {}],
        ]);
        expect(host.querySelector('input[type="file"]')).toBeNull();
    });
});
