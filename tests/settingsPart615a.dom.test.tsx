// T-615a: restore dialog in the main window (transient state), the relayed `backup.restore` / `app.restartTutorial` host wiring,
// the Restore button, the tutorial restart button and the eye animation toggle on the Settings pages.
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
import RestoreDialogHost from '../src/components/notes/RestoreDialogHost';
import { translations } from '../src/i18n';
import { settingsMirror } from '../src/settings/mirror';
import { AppearancePage } from '../src/settings/pages/Appearance';
import { GeneralPage } from '../src/settings/pages/General';
import { systemSync } from '../src/store/systemSyncHost';
import { useAppStore } from '../src/store/useAppStore';
import { cleanup, fire, render } from './ui/render';

const en = translations.en;
const t = (key: keyof typeof en) => en[key];
const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
const button = (host: HTMLElement, label: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(label)) as HTMLButtonElement | undefined;

const SUMMARY: IpcSystemSummary = {
    version: '2.0.0',
    updatesEnabled: true,
    update: { status: 'idle', version: '', percent: 0 },
    backup: { busy: false, last: null },
};
let seq = 0;
function publish(state: Record<string, unknown> | null, system?: IpcSystemSummary) {
    seq += 1;
    act(() => settingsMirror.receive({ seq, state, ack: 0, ...(system ? { system } : {}) }));
}

afterEach(() => {
    cleanup();
    act(() => closeRestoreDialog());
    bridge.sent.length = 0;
    publish(null);
    useAppStore.setState({ isHydrated: false, isManualTutorialTrigger: false });
});

describe('main window host', () => {
    vi.spyOn(window, 'focus').mockImplementation(() => {});

    it('opens the restore dialog (transient) only after hydration, and the dialog holds the shared restore flow', async () => {
        useAppStore.setState({ isHydrated: false });
        expect(await systemSync.handle({ type: 'backup.restore', payload: {} })).toEqual({ ok: false, reason: 'unavailable' });
        expect(isRestoreDialogOpen()).toBe(false);
        useAppStore.setState({ isHydrated: true });
        expect(await systemSync.handle({ type: 'backup.restore', payload: { x: 1 } })).toEqual({ ok: false, reason: 'invalid-payload' });
        expect(isRestoreDialogOpen()).toBe(false);
        render(<RestoreDialogHost />);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        await act(async () => {
            expect(await systemSync.handle({ type: 'backup.restore', payload: {} })).toEqual({ ok: true });
        });
        expect(isRestoreDialogOpen()).toBe(true);
        const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
        expect(dialog.querySelector('[data-testid="backup-file"]')).not.toBeNull();
        expect(dialog.textContent).toContain(en.backupRestorePick);
        click(dialog.querySelector('[data-kb-dialog-close]')!);
        expect(isRestoreDialogOpen()).toBe(false);
    });

    it('the dialog ignores Esc while a restore step is running', async () => {
        useAppStore.setState({ isHydrated: true });
        render(<RestoreDialogHost />);
        await act(async () => void (await systemSync.handle({ type: 'backup.restore', payload: {} })));
        const input = document.querySelector('[data-testid="backup-file"]') as HTMLInputElement;
        let release: (v: string) => void = () => {};
        const file = new File(['{}'], 'b.json', { type: 'application/json' });
        vi.spyOn(file, 'text').mockImplementation(() => new Promise<string>((r) => (release = r)));
        Object.defineProperty(input, 'files', { value: [file], configurable: true });
        fire(input, new Event('change', { bubbles: true }));
        fire(document, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(isRestoreDialogOpen()).toBe(true);
        await act(async () => release('{}'));
        fire(document, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(isRestoreDialogOpen()).toBe(false);
    });

    it('app.restartTutorial sets the same store values as the old panel', async () => {
        useAppStore.setState({
            isHydrated: true,
            isManualTutorialTrigger: false,
            tutorialState: { version: '1.0.0', status: 'completed' },
        });
        await act(async () => {
            expect(await systemSync.handle({ type: 'app.restartTutorial', payload: {} })).toEqual({ ok: true });
        });
        expect(useAppStore.getState().isManualTutorialTrigger).toBe(true);
        expect(useAppStore.getState().tutorialState.status).toBe('pending');
    });
});

describe('Settings pages', () => {
    it('General: restart tutorial is disabled until the first snapshot, then relays an empty action', () => {
        const first = render(<GeneralPage t={t} storeFlavor />);
        expect(button(first.host, en.restartTutorial)!.hasAttribute('disabled')).toBe(true);
        cleanup();
        publish({ language: 'en' }, SUMMARY);
        const { host } = render(<GeneralPage t={t} storeFlavor />);
        click(button(host, en.restartTutorial)!);
        expect(bridge.sent.at(-1)).toMatchObject({ type: 'app.restartTutorial', payload: {} });
    });

    it('Appearance: eye animation toggle mirrors the setting and dispatches setEnableEyeAnimation', () => {
        const first = render(<AppearancePage t={t} />);
        const off = [...first.host.querySelectorAll<HTMLButtonElement>('[role="switch"]')].at(-1)!;
        expect(off.hasAttribute('disabled')).toBe(true);
        cleanup();
        publish({ language: 'en', enableEyeAnimation: true });
        const { host } = render(<AppearancePage t={t} />);
        const sw = [...host.querySelectorAll<HTMLButtonElement>('[role="switch"]')].at(-1)!;
        expect(sw.getAttribute('aria-checked')).toBe('true');
        expect(host.textContent).toContain(en.enableEyeAnimation);
        click(sw);
        expect(bridge.sent.at(-1)).toMatchObject({ type: 'setEnableEyeAnimation', payload: false });
    });
});
