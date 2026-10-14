// T-608: Settings › Appearance. The page reads the main window's settings through the mirror and changes them only with allow-listed
// actions (scheme, accent, custom colour, material); the Settings window applies the mirrored appearance to its own root with the
// same helpers as App.tsx.
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
import { readMirroredAppearance, startSettingsAppearanceSync } from '../src/settings/appearance';
import { createSettingsMirror, settingsMirror } from '../src/settings/mirror';
import { ACCENT_LABEL_KEYS, AppearancePage } from '../src/settings/pages/Appearance';
import { applySettingsAction } from '../src/store/sync';
import { useAppStore } from '../src/store/useAppStore';
import { PRESET_ACCENTS } from '../src/theme';
import { applyRootAppearance, effectiveThemePrefs } from '../src/theme/root';
import { cleanup, fire, keyDown, render } from './ui/render';

const NEW_KEYS = [
    'settingsScheme',
    'settingsSchemeSystem',
    'settingsSchemeLight',
    'settingsSchemeDark',
    'settingsAccent',
    ...Object.values(ACCENT_LABEL_KEYS),
    'settingsAccentCustom',
    'settingsCustomColorTitle',
    'settingsCustomColorPicker',
    'settingsCustomColorHex',
    'settingsCustomColorInvalid',
    'settingsCustomColorAdjusted',
    'settingsApply',
    'settingsTransparency',
    'settingsTransparencyOff',
    'settingsTransparencyLow',
    'settingsTransparencyHint',
] as const;

let seq = 0;
function snapshot(state: Record<string, unknown> | null) {
    seq += 1;
    act(() => settingsMirror.receive({ seq, state, ack: 0 }));
}
const ready = (patch: Record<string, unknown> = {}) =>
    snapshot({
        language: 'en',
        scheme: 'system',
        accent: 'amber',
        customThemeColor: '#f4a125',
        material: 'solid',
        density: 'normal',
        design: 'style1',
        ...patch,
    });

const tEn = (key: keyof typeof translations.en) => translations.en[key];
const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
const sent = () => bridge.sent.map(({ type, payload }) => ({ type, payload }));
const groups = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[role="radiogroup"]')];
const radios = (group: HTMLElement) => [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
const labelOf = (group: HTMLElement) => document.getElementById(group.getAttribute('aria-labelledby')!)!.textContent;
const popover = () => document.body.querySelector<HTMLElement>('[role="dialog"]');

function typeInto(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

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
        }
        expect(Object.keys(ACCENT_LABEL_KEYS)).toEqual([...PRESET_ACCENTS]);
    });
});

describe('AppearancePage', () => {
    it('is disabled with a status message until the main window sent a snapshot', () => {
        const { host } = render(<AppearancePage t={tEn} />);
        expect(host.querySelector('[role="status"]')!.textContent).toBe(tEn('settingsWaiting'));
        const all = groups(host).flatMap(radios);
        expect(all).toHaveLength(3 + 9 + 2);
        expect(all.every((r) => r.disabled)).toBe(true);
        all.forEach(click);
        expect(bridge.sent).toEqual([]);
        expect(popover()).toBeNull();
    });

    it('shows the mirrored values in three labelled radiogroups', () => {
        ready({ scheme: 'dark', accent: 'blue', material: 'translucent' });
        const { host } = render(<AppearancePage t={tEn} />);
        expect(host.querySelector('[role="status"]')).toBeNull();
        const [scheme, accent, material] = groups(host);
        expect([labelOf(scheme), labelOf(accent), labelOf(material)]).toEqual([
            tEn('settingsScheme'),
            tEn('settingsAccent'),
            tEn('settingsTransparency'),
        ]);
        const checked = (g: HTMLElement) => radios(g).find((r) => r.getAttribute('aria-checked') === 'true')!;
        expect(checked(scheme).textContent).toContain(tEn('settingsSchemeDark'));
        expect(checked(accent).getAttribute('aria-label')).toBe(tEn('settingsAccentBlue'));
        expect(checked(material).textContent).toContain(tEn('settingsTransparencyLow'));
        // Every swatch has a name; the selected one is marked with an icon too (not colour alone) and holds the tab stop.
        expect(radios(accent).every((r) => r.getAttribute('aria-label'))).toBe(true);
        expect(checked(accent).textContent).toContain('check');
        expect(radios(accent).filter((r) => r.tabIndex === 0)).toEqual([checked(accent)]);
        expect(host.querySelector('[data-testid="accent-name"]')!.textContent).toContain(tEn('settingsAccentBlue'));
        expect(host.querySelector('[data-testid="scheme-dark-only"]')).toBeNull();
        // No hex in className: swatch colours come from inline custom properties.
        for (const r of radios(accent)) expect(r.className).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    });

    it('dispatches allow-listed actions and never changes a value by itself', () => {
        ready();
        const { host } = render(<AppearancePage t={tEn} />);
        const [scheme, accent, material] = groups(host);
        click(radios(scheme)[2]);
        click(radios(accent)[5]);
        click(radios(material)[1]);
        click(radios(accent)[0]); // already selected: nothing is sent
        expect(sent()).toEqual([
            { type: 'setScheme', payload: 'dark' },
            { type: 'setAccent', payload: 'blue' },
            { type: 'setMaterial', payload: 'translucent' },
        ]);
        // Read-only mirror: still the main window's values until a new snapshot arrives.
        expect(radios(accent)[0].getAttribute('aria-checked')).toBe('true');
        useAppStore.setState({ isHydrated: true });
        for (const action of bridge.sent)
            expect(
                applySettingsAction(useAppStore, action, () => {}),
                action.type
            ).toMatchObject({ ok: true });
    });

    it('arrow keys move through the accents and select presets; "Custom…" only takes focus', () => {
        ready({ accent: 'amber' });
        const { host } = render(<AppearancePage t={tEn} />);
        const accent = groups(host)[1];
        const swatches = radios(accent);
        swatches[0].focus();
        keyDown(swatches[0], 'ArrowRight');
        expect(document.activeElement).toBe(swatches[1]);
        keyDown(swatches[1], 'ArrowLeft');
        keyDown(swatches[0], 'ArrowLeft');
        expect(document.activeElement).toBe(swatches[8]);
        keyDown(swatches[8], 'Home');
        expect(document.activeElement).toBe(swatches[0]);
        // ArrowLeft back to amber and Home send nothing: amber is still the main window's value (read-only mirror).
        expect(sent()).toEqual([{ type: 'setAccent', payload: 'orange' }]);
        expect(popover()).toBeNull();
    });

    it('"Custom…" opens a popover that only applies a valid hex, normalised', () => {
        ready({ accent: 'amber', customThemeColor: '#f4a125' });
        const { host } = render(<AppearancePage t={tEn} />);
        const custom = radios(groups(host)[1])[8];
        expect(custom.getAttribute('aria-label')).toBe(tEn('settingsAccentCustom'));
        click(custom);
        const dialog = popover()!;
        expect(dialog.getAttribute('aria-label')).toBe(tEn('settingsCustomColorTitle'));
        const picker = dialog.querySelector<HTMLInputElement>('input[type="color"]')!;
        const hex = dialog.querySelector<HTMLInputElement>('input[type="text"]')!;
        expect(dialog.querySelector(`label[for="${picker.id}"]`)!.textContent).toBe(tEn('settingsCustomColorPicker'));
        expect(dialog.querySelector(`label[for="${hex.id}"]`)!.textContent).toBe(tEn('settingsCustomColorHex'));
        expect(hex.value).toBe('#f4a125');
        const apply = () => [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === tEn('settingsApply'))!;

        typeInto(hex, 'not a colour');
        expect(hex.getAttribute('aria-invalid')).toBe('true');
        expect(dialog.textContent).toContain(tEn('settingsCustomColorInvalid'));
        expect(apply().disabled).toBe(true);
        fire(dialog.querySelector('form')!, new Event('submit', { bubbles: true, cancelable: true }));
        expect(bridge.sent).toEqual([]);

        typeInto(hex, '#123');
        expect(picker.value).toBe('#112233');
        expect(dialog.querySelector('[data-testid="custom-adjusted"]')).not.toBeNull();
        click(apply());
        expect(sent()).toEqual([{ type: 'setCustomThemeColor', payload: '#112233' }]);
        expect(popover()).toBeNull();
        useAppStore.setState({ isHydrated: true });
        expect(applySettingsAction(useAppStore, bridge.sent[0], () => {})).toMatchObject({ ok: true });
        expect(useAppStore.getState()).toMatchObject({ accent: 'custom', customThemeColor: '#112233', theme: 'custom' });
    });

    it('shows a selected custom colour on its swatch', () => {
        ready({ accent: 'custom', customThemeColor: '#3a7bd5' });
        const { host } = render(<AppearancePage t={tEn} />);
        const custom = radios(groups(host)[1])[8];
        expect(custom.getAttribute('aria-checked')).toBe('true');
        expect(custom.style.getPropertyValue('--kb-swatch-dark')).toMatch(/^#[0-9a-f]{6}$/);
        expect(host.querySelector('[data-testid="accent-name"]')!.textContent).toContain(tEn('settingsCustomColorTitle'));
    });

    it('is registered in the Settings window', () => {
        ready();
        const { host } = render(<SettingsApp lang="en" />);
        const item = [...host.querySelectorAll<HTMLElement>('nav button')].find((b) => b.textContent?.includes(tEn('appearance')))!;
        click(item);
        expect(host.querySelector('h1')!.textContent).toBe(tEn('appearance'));
        expect(groups(host)).toHaveLength(3);
    });
});

describe('Settings window appearance', () => {
    it('effectiveThemePrefs shows dark + amber until ready and renders the stored scheme once ready', () => {
        const source = { scheme: 'light' as const, accent: 'custom' as const, customThemeColor: '#3a7bd5' };
        expect(effectiveThemePrefs(false, source)).toEqual({ scheme: 'dark', accent: 'amber', customAccent: null });
        expect(effectiveThemePrefs(true, source)).toEqual({
            scheme: 'light',
            accent: 'custom',
            customAccent: '#3a7bd5',
        });
        expect(effectiveThemePrefs(true, { ...source, accent: 'blue' }).customAccent).toBeNull();
    });

    it('applies the defaults, then the mirrored accent, custom colour, material and density', () => {
        const mirror = createSettingsMirror(null);
        const root = document.createElement('div');
        const stop = startSettingsAppearanceSync(mirror.store, root);
        const attrs = () => ({
            scheme: root.getAttribute('data-scheme'),
            accent: root.getAttribute('data-accent'),
            theme: root.getAttribute('data-theme'),
            material: root.getAttribute('data-material'),
            density: root.getAttribute('data-density'),
        });
        expect(attrs()).toEqual({ scheme: 'dark', accent: 'amber', theme: null, material: 'solid', density: 'normal' });

        mirror.receive({
            seq: 1,
            ack: 0,
            state: {
                scheme: 'light',
                accent: 'custom',
                customThemeColor: '#3a7bd5',
                material: 'translucent',
                density: 'compact',
                design: 'style2',
            },
        });
        expect(attrs()).toEqual({
            scheme: 'light',
            accent: 'custom',
            theme: 'custom',
            material: 'translucent',
            density: 'compact',
        });
        expect(root.style.getPropertyValue('--kb-accent-dark')).toMatch(/^#[0-9a-f]{6}$/);
        expect(root.getAttribute('data-design')).toBe('style2');

        // Main window reloading: the last look is kept.
        mirror.receive({ seq: 2, ack: 0, state: null });
        expect(attrs().accent).toBe('custom');

        mirror.receive({ seq: 3, ack: 0, state: { accent: 'green', material: 'glass', density: 'huge', scheme: 42 } });
        expect(attrs()).toEqual({ scheme: 'dark', accent: 'green', theme: 'emerald', material: 'solid', density: 'normal' });
        expect(root.style.getPropertyValue('--kb-accent-dark')).toBe('');

        stop();
        mirror.receive({ seq: 4, ack: 0, state: { accent: 'red' } });
        expect(attrs().accent).toBe('green');
    });

    it('readMirroredAppearance and applyRootAppearance match the store defaults and App.tsx attributes', () => {
        expect(readMirroredAppearance({})).toEqual({
            scheme: 'system',
            accent: 'amber',
            customThemeColor: '#f4a125',
            design: 'style1',
            material: 'solid',
            density: 'normal',
        });
        const root = document.createElement('div');
        applyRootAppearance(root, {
            accent: 'custom',
            customThemeColor: '#4ca8f5',
            design: 'style1',
            material: 'solid',
            density: 'comfortable',
        });
        // A custom hex equal to a preset renders as that preset.
        expect(root.getAttribute('data-theme')).toBe('ocean');
        expect(root.getAttribute('data-density')).toBe('comfortable');
    });
});
