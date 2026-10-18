// T-614: Settings > Backup page. Reads the system summary through the read-only mirror and only sends allow-listed actions.
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

import { translations } from '../src/i18n';
import { settingsMirror } from '../src/settings/mirror';
import { BackupPage } from '../src/settings/pages/Backup';
import { cleanup, fire, render } from './ui/render';

const en = translations.en;
const t = (key: keyof typeof en) => en[key];
const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
const button = (host: HTMLElement, label: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(label)) as HTMLButtonElement | undefined;

const BASE: IpcSystemSummary = {
    version: '2.0.0',
    updatesEnabled: true,
    update: { status: 'idle', version: '', percent: 0 },
    backup: { busy: false, last: null },
};

let seq = 0;
function publish(system: IpcSystemSummary | undefined, state: Record<string, unknown> | null = { language: 'en' }) {
    seq += 1;
    act(() => settingsMirror.receive({ seq, state, ack: 0, ...(system === undefined ? {} : { system }) }));
}

afterEach(() => {
    cleanup();
    bridge.sent.length = 0;
    publish(undefined, null);
});

describe('BackupPage', () => {
    it('waits for the main window and disables the actions', () => {
        publish(undefined, null);
        const { host } = render(<BackupPage t={t} />);
        expect(host.textContent).toContain(en.settingsWaiting);
        expect(button(host, en.fullBackupCreate)!.hasAttribute('disabled')).toBe(true);
    });

    it('exports without secrets by default, and with secrets after the toggle plus a warning', () => {
        publish(BASE);
        const { host } = render(<BackupPage t={t} />);
        click(button(host, en.fullBackupCreate)!);
        expect(bridge.sent.at(-1)).toMatchObject({ type: 'backup.export', payload: { includeSecrets: false } });
        expect(host.querySelector('[role="alert"]')).toBeNull();
        click(host.querySelector('[role="switch"], input[type="checkbox"]')!);
        expect(host.querySelector('[role="alert"]')!.textContent).toContain(en.fullBackupSecretsWarning);
        click(button(host, en.fullBackupCreate)!);
        expect(bridge.sent.at(-1)).toMatchObject({ type: 'backup.export', payload: { includeSecrets: true } });
    });

    it('shows the export outcome, and never offers a file input', () => {
        publish({ ...BASE, backup: { busy: false, last: 'done' } });
        const { host } = render(<BackupPage t={t} />);
        expect(host.textContent).toContain(en.fullBackupDone);
        expect(host.querySelector('input[type="file"]')).toBeNull();
        publish({ ...BASE, backup: { busy: false, last: 'failed' } });
        expect(host.textContent).toContain(en.fullBackupFailed);
    });

    it('Restore relays an empty backup.restore action and is disabled until the first snapshot', () => {
        publish(undefined, null);
        const first = render(<BackupPage t={t} />);
        expect(button(first.host, en.backupRestorePick)!.hasAttribute('disabled')).toBe(true);
        cleanup();
        publish(BASE);
        const { host } = render(<BackupPage t={t} />);
        click(button(host, en.backupRestorePick)!);
        expect(bridge.sent.at(-1)).toMatchObject({ type: 'backup.restore', payload: {} });
    });

    it('update centre: check, available then download, downloaded then restart', () => {
        publish(BASE);
        const { host } = render(<BackupPage t={t} />);
        expect(host.textContent).toContain('2.0.0');
        click(button(host, en.checkForUpdates)!);
        expect(bridge.sent.at(-1)).toMatchObject({ type: 'update.check' });
        publish({ ...BASE, update: { status: 'available', version: '2.1.0', percent: 0 } });
        click(button(host, en.downloadAndInstall)!);
        expect(bridge.sent.at(-1)).toMatchObject({ type: 'update.download' });
        publish({ ...BASE, update: { status: 'downloading', version: '2.1.0', percent: 40 } });
        expect(host.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('40');
        publish({ ...BASE, update: { status: 'downloaded', version: '2.1.0', percent: 100 } });
        click(button(host, en.restartAndInstall)!);
        expect(bridge.sent.at(-1)).toMatchObject({ type: 'update.install' });
    });

    it('shows a generic error state', () => {
        publish({ ...BASE, update: { status: 'error', version: '', percent: 0 } });
        const { host } = render(<BackupPage t={t} />);
        expect(host.textContent).toContain(en.updateError);
        expect(button(host, en.checkForUpdates)).toBeTruthy();
    });

    it('hides the update centre in the Store build', () => {
        publish({ ...BASE, updatesEnabled: false });
        const { host } = render(<BackupPage t={t} />);
        expect(host.textContent).not.toContain(en.updateCenter);
        expect(button(host, en.checkForUpdates)).toBeUndefined();
        expect(button(host, en.fullBackupCreate)).toBeTruthy();
    });

    it('MAC-016: an unsigned macOS build shows a manual-download link instead of the update buttons', () => {
        publish({ ...BASE, updatesEnabled: false, manualUpdate: true });
        const { host } = render(<BackupPage t={t} />);
        expect(host.textContent).toContain(en.updateManualDesc);
        expect(button(host, en.checkForUpdates)).toBeUndefined();
        const link = Array.from(host.querySelectorAll('a')).find((a) => a.textContent === en.updateManualLink);
        expect(link?.getAttribute('href')).toBe('https://github.com/Kobar-Project/KoBar/releases');
        expect(link?.getAttribute('target')).toBe('_blank');
    });
});
