// T-609: Settings › Sidebar. Density, orientation + edge and the button order are read from the mirror and changed only with
// allow-listed actions; the order list is keyboard-accessible (move buttons + live region).
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IpcSettingsAction } from '../shared/ipc-contract';

// The Settings window's mirror is created from `globalThis.settingsBridge` when src/settings/mirror.ts is first imported.
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

import { translations, type LanguageCode } from '../src/i18n';
import { SettingsApp } from '../src/settings/SettingsApp';
import { settingsMirror } from '../src/settings/mirror';
import { SidebarPage } from '../src/settings/pages/Sidebar';
import { featureLabel, moveItem } from '../src/settings/sidebarOrder';
import { applySettingsAction } from '../src/store/sync';
import { useAppStore } from '../src/store/useAppStore';
import { cleanup, fire, render } from './ui/render';

const NEW_KEYS = [
    'settingsDensity',
    'settingsDensityCompact',
    'settingsDensityNormal',
    'settingsDensityComfortable',
    'settingsDensityHint',
    'settingsOrientation',
    'settingsOrientationVertical',
    'settingsOrientationHorizontal',
    'settingsOrientationHint',
    'settingsEdge',
    'settingsEdgeLeft',
    'settingsEdgeRight',
    'settingsEdgeTop',
    'settingsEdgeBottom',
    'settingsFeatureOrder',
    'settingsFeatureOrderHint',
    'settingsFeatureOrderEmpty',
    'settingsMoveUp',
    'settingsMoveDown',
    'settingsMovedAnnounce',
] as const;

let seq = 0;
function snapshot(state: Record<string, unknown> | null) {
    seq += 1;
    act(() => settingsMirror.receive({ seq, state, ack: 0 }));
}
const ORDER = ['com.kobar.aihub.btn', 'todolist-plugin-btn', 'kobox'];
const ready = (patch: Record<string, unknown> = {}) =>
    snapshot({
        language: 'en',
        density: 'normal',
        sidebarWidth: 46,
        orientation: 'vertical',
        edgePosition: 'right',
        featureOrder: ORDER,
        ...patch,
    });

const tEn = (key: keyof typeof translations.en) => translations.en[key];
const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
const sent = () => bridge.sent.map(({ type, payload }) => ({ type, payload }));
const groups = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[role="radiogroup"]')];
const radios = (group: HTMLElement) => [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
const labelOf = (group: HTMLElement) => document.getElementById(group.getAttribute('aria-labelledby')!)!.textContent;
const rows = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('ol > li')];
const moveButtons = (row: HTMLElement) => [...row.querySelectorAll<HTMLButtonElement>('button')];

afterEach(() => {
    cleanup();
    bridge.sent.length = 0;
    snapshot(null);
});

describe('i18n', () => {
    it('every new string exists in all 10 languages', () => {
        const langs = Object.keys(translations) as LanguageCode[];
        expect(langs).toHaveLength(10);
        for (const lang of langs) {
            for (const key of NEW_KEYS) expect((translations[lang] as Record<string, string>)[key], `${lang}.${key}`).toBeTruthy();
            const announce = translations[lang].settingsMovedAnnounce;
            for (const token of ['{name}', '{position}', '{total}']) expect(announce, lang).toContain(token);
        }
    });
});

describe('helpers', () => {
    it('moveItem moves one place and ignores out-of-range moves', () => {
        expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
        expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
        expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
        expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
    });

    it('featureLabel names a button after its id', () => {
        expect(featureLabel('todolist-plugin-btn')).toBe('Todolist');
        expect(featureLabel('com.kobar.aihub.btn')).toBe('Aihub');
        expect(featureLabel('kobox')).toBe('Kobox');
    });
});

describe('SidebarPage', () => {
    it('is disabled with a status message until the main window sent a snapshot', () => {
        const { host } = render(<SidebarPage t={tEn} />);
        expect(host.querySelector('[role="status"]')!.textContent).toBe(tEn('settingsWaiting'));
        const all = groups(host).flatMap(radios);
        expect(all.length).toBeGreaterThan(0);
        expect(all.every((r) => r.disabled)).toBe(true);
        all.forEach(click);
        expect(bridge.sent).toEqual([]);
    });

    it('shows the mirrored values in labelled radiogroups and has no Smart Popup option', () => {
        ready({ density: 'comfortable', orientation: 'horizontal', edgePosition: 'top' });
        const { host } = render(<SidebarPage t={tEn} />);
        const [density, orientation, edge] = groups(host);
        expect([labelOf(density), labelOf(orientation), labelOf(edge)]).toEqual([
            tEn('settingsDensity'),
            tEn('settingsOrientation'),
            tEn('settingsEdge'),
        ]);
        const checked = (g: HTMLElement) => radios(g).find((r) => r.getAttribute('aria-checked') === 'true')!;
        expect(checked(density).textContent).toContain(tEn('settingsDensityComfortable'));
        expect(checked(orientation).textContent).toContain(tEn('settingsOrientationHorizontal'));
        expect(radios(edge).map((r) => r.textContent)).toEqual([
            expect.stringContaining(tEn('settingsEdgeTop')),
            expect.stringContaining(tEn('settingsEdgeBottom')),
        ]);
        expect(checked(edge).textContent).toContain(tEn('settingsEdgeTop'));
        expect(host.textContent?.toLowerCase()).not.toContain('smart');
        expect(host.querySelector('[role="switch"]')).toBeNull();
    });

    it('falls back to the density derived from sidebarWidth', () => {
        ready({ density: undefined, sidebarWidth: 56 });
        const { host } = render(<SidebarPage t={tEn} />);
        const checked = radios(groups(host)[0]).find((r) => r.getAttribute('aria-checked') === 'true')!;
        expect(checked.textContent).toContain(tEn('settingsDensityComfortable'));
    });

    it('dispatches allow-listed actions and never changes a value by itself', () => {
        ready();
        const { host } = render(<SidebarPage t={tEn} />);
        const [density, orientation, edge] = groups(host);
        click(radios(density)[0]);
        click(radios(density)[1]); // already selected: nothing is sent
        click(radios(edge)[0]);
        click(radios(orientation)[1]);
        expect(sent()).toEqual([
            { type: 'setDensity', payload: 'compact' },
            { type: 'setEdgePosition', payload: 'left' },
            { type: 'setOrientation', payload: 'horizontal' },
        ]);
        expect(radios(density)[1].getAttribute('aria-checked')).toBe('true');
        useAppStore.setState({ isHydrated: true });
        for (const action of bridge.sent)
            expect(
                applySettingsAction(useAppStore, action, () => {}),
                action.type
            ).toMatchObject({ ok: true });
    });

    it('reorders with the move buttons, announces the move and sends the whole new order', () => {
        ready();
        const { host } = render(<SidebarPage t={tEn} />);
        const list = rows(host);
        expect(list).toHaveLength(3);
        expect(host.querySelector('ol')!.getAttribute('aria-labelledby')).toBeTruthy();
        // The first row cannot move up, the last cannot move down.
        expect(moveButtons(list[0])[0].disabled).toBe(true);
        expect(moveButtons(list[2])[1].disabled).toBe(true);
        expect(moveButtons(list[1])[0].getAttribute('aria-label')).toContain(tEn('settingsMoveUp'));
        click(moveButtons(list[1])[0]);
        expect(sent()).toEqual([{ type: 'setFeatureOrder', payload: ['todolist-plugin-btn', 'com.kobar.aihub.btn', 'kobox'] }]);
        expect(host.querySelector('[data-testid="order-announcement"]')!.textContent).toBe('Todolist moved to position 1 of 3');
        // Read-only mirror: the list only changes with the next snapshot.
        expect(rows(host)[0].textContent).toContain('Aihub');
        ready({ featureOrder: ['todolist-plugin-btn', 'com.kobar.aihub.btn', 'kobox'] });
        expect(rows(host)[0].textContent).toContain('Todolist');
        useAppStore.setState({ isHydrated: true });
        expect(applySettingsAction(useAppStore, bridge.sent[0], () => {})).toMatchObject({ ok: true });
    });

    it('is mounted by the Settings shell as the Sidebar page', () => {
        ready();
        const { host } = render(<SettingsApp lang="en" />);
        click([...host.querySelectorAll<HTMLButtonElement>('nav button')].find((b) => b.textContent?.includes(tEn('settingsSidebar')))!);
        expect(host.querySelector('ol')).not.toBeNull();
        expect(groups(host)).toHaveLength(3);
    });
});
