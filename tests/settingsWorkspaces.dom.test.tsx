// T-612: Settings > Workspaces page. Reads the summary through the read-only mirror and only sends allow-listed `workspace.*` actions.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IpcSettingsAction, IpcWorkspaceSummary } from '../shared/ipc-contract';

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
import { WorkspacesPage } from '../src/settings/pages/Workspaces';
import { cleanup, fire, render } from './ui/render';

const en = translations.en;
const t = (key: keyof typeof en) => en[key];
const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
const byLabel = (label: string) => document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`);

const SUMMARY: IpcWorkspaceSummary = {
    items: [
        { id: 'a', name: 'Alpha', isolated: false, hasIsolatedData: false, active: true },
        { id: 'b', name: 'Beta', isolated: true, hasIsolatedData: true, active: false },
    ],
};

let seq = 0;
function publish(workspaces: IpcWorkspaceSummary | undefined, state: Record<string, unknown> | null = { language: 'en' }) {
    seq += 1;
    act(() => settingsMirror.receive({ seq, state, ack: 0, ...(workspaces === undefined ? {} : { workspaces }) }));
}
const type = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
};

afterEach(() => {
    cleanup();
    bridge.sent.length = 0;
    publish(undefined, null);
});

describe('WorkspacesPage states', () => {
    it('shows the waiting message before the first snapshot', () => {
        publish(undefined, null);
        const { host } = render(<WorkspacesPage t={t} />);
        expect(host.textContent).toContain(en.settingsWaiting);
        expect(host.querySelector('button[type="submit"]')!.hasAttribute('disabled')).toBe(true);
    });

    it('shows a loading state while the summary has not arrived, then the empty state', () => {
        publish(undefined);
        const { host } = render(<WorkspacesPage t={t} />);
        expect(host.textContent).toContain(en.settingsWorkspacesLoading);
        publish({ items: [] });
        expect(host.textContent).toContain(en.workspacesEmpty);
    });

    it('lists workspaces with active and isolation badges', () => {
        publish(SUMMARY);
        const { host } = render(<WorkspacesPage t={t} />);
        expect(host.textContent).toContain('Alpha');
        expect(host.textContent).toContain(en.activeWorkspace);
        expect(host.textContent).toContain(en.isolatedBadge);
        expect(byLabel(`${en.loadWorkspace}: Alpha`)).toBeNull();
        expect(byLabel(`${en.loadWorkspace}: Beta`)).not.toBeNull();
    });
});

describe('WorkspacesPage actions', () => {
    it('create sends the trimmed name and the isolation choice, and ignores an empty name', () => {
        publish(SUMMARY);
        const { host } = render(<WorkspacesPage t={t} />);
        const submit = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
        expect(submit.disabled).toBe(true);
        const input = host.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')!;
        type(input, '   ');
        expect(submit.disabled).toBe(true);
        type(input, '  Fresh  ');
        click(submit);
        expect(bridge.sent.map((a) => [a.type, a.payload])).toEqual([['workspace.create', { name: 'Fresh', isolated: false }]]);
    });

    it('switch sends the id', () => {
        publish(SUMMARY);
        render(<WorkspacesPage t={t} />);
        click(byLabel(`${en.loadWorkspace}: Beta`)!);
        expect(bridge.sent.map((a) => [a.type, a.payload])).toEqual([['workspace.switch', { id: 'b' }]]);
    });

    it('rename opens a dialog and sends the new name', () => {
        publish(SUMMARY);
        render(<WorkspacesPage t={t} />);
        click(byLabel(`${en.renameWorkspace}: Beta`)!);
        const input = document.body.querySelector<HTMLInputElement>('[role="dialog"] input')!;
        expect(input.value).toBe('Beta');
        type(input, ' Bee ');
        click(document.body.querySelector<HTMLButtonElement>('[role="dialog"] button[type="submit"]')!);
        expect(bridge.sent.map((a) => [a.type, a.payload])).toEqual([['workspace.rename', { id: 'b', name: 'Bee' }]]);
    });

    it('delete asks first, warns about isolated data, and only then sends the id', () => {
        publish(SUMMARY);
        render(<WorkspacesPage t={t} />);
        click(byLabel(`${en.deleteWorkspace}: Beta`)!);
        const dialog = document.body.querySelector('[role="alertdialog"], [role="dialog"]')!;
        expect(dialog.textContent).toContain(en.workspaceDeleteIsoNote);
        expect(bridge.sent).toEqual([]);
        const confirm = [...dialog.querySelectorAll('button')].find((b) => b.textContent === en.deleteWorkspace)!;
        click(confirm);
        expect(bridge.sent.map((a) => [a.type, a.payload])).toEqual([['workspace.delete', { id: 'b' }]]);
    });

    it('delete of a shared active workspace uses the shared and active notes', () => {
        publish(SUMMARY);
        render(<WorkspacesPage t={t} />);
        click(byLabel(`${en.deleteWorkspace}: Alpha`)!);
        const text = document.body.textContent ?? '';
        expect(text).toContain(en.settingsWorkspacesDeleteSharedNote);
        expect(text).toContain(en.workspaceDeleteActiveNote);
    });

    it('the delete dialog closes by itself when the workspace disappears from the live list', () => {
        publish(SUMMARY);
        render(<WorkspacesPage t={t} />);
        click(byLabel(`${en.deleteWorkspace}: Beta`)!);
        expect(document.body.textContent).toContain(en.workspaceDeleteIsoNote);
        publish({ items: [SUMMARY.items[0]] });
        expect(document.body.textContent).not.toContain(en.workspaceDeleteIsoNote);
        expect(bridge.sent).toEqual([]);
    });
});
