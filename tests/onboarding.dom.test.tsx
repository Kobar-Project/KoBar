// T-622: first-run onboarding. Three timer-free cards, a starter pack installed through the plugin sync (the main
// process asks for consent), offline never blocks finishing, and existing users (onboarding `completed`, set by the
// v29 migration, see tests/onboarding.store.dom.test.ts) never see it. The sync is a fake: nothing is installed.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Onboarding } from '../src/onboarding/Onboarding';
import { STARTER_PACK, type StarterSync } from '../src/onboarding/starterPack';
import { OFFICIAL_PLUGIN_ID_LIST } from '../src/backup/keyPolicy';
import { translations } from '../src/i18n';
import { DEFAULT_ONBOARDING } from '../src/store/onboarding';
import { systemSync } from '../src/store/systemSyncHost';
import { useAppStore } from '../src/store/useAppStore';
import { cleanup, fire, render } from './ui/render';

const en = translations.en;
const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
const button = (label: string) =>
    [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label) as
        HTMLButtonElement | undefined;

interface FakeSync extends StarterSync {
    actions: { type: string; payload?: { id?: string } }[];
}

function fakeSync(options: { catalog?: 'ok' | 'offline'; install?: 'ok' | 'fail' | 'canceled' } = {}): FakeSync {
    const actions: FakeSync['actions'] = [];
    let lastInstall: { id: string; result: 'success' | 'failed' | 'canceled' } | null = null;
    return {
        actions,
        getSummary: () =>
            ({
                items: [],
                status: { checked: false, checking: false, updating: false },
                lastUpdate: null,
                catalog: {
                    status: 'ready',
                    error: options.catalog === 'offline' ? 'offline' : null,
                    items: [],
                    installingId: null,
                    lastInstall,
                },
            }) as never,
        subscribe: () => () => {},
        handle: async (action: unknown) => {
            const a = action as { type: string; payload?: { id?: string } };
            actions.push(a);
            if (a.type === 'plugin.refreshCatalog') return options.catalog === 'offline' ? { ok: false, reason: 'failed' } : { ok: true };
            if (options.install === 'fail') return { ok: false, reason: 'failed' };
            lastInstall = { id: a.payload!.id!, result: options.install === 'canceled' ? 'canceled' : 'success' };
            return { ok: true };
        },
    };
}

const flush = () => act(async () => {});

beforeEach(() => {
    useAppStore.setState({
        language: 'en',
        isHydrated: true,
        onboarding: { ...DEFAULT_ONBOARDING },
        isManualTutorialTrigger: false,
        tutorialState: { version: '1.0.0', status: 'pending' },
    });
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('Onboarding (T-622)', () => {
    it('starter pack ids are official plugin ids', () => {
        expect(STARTER_PACK.map((p) => p.name)).toEqual(['ToDo', 'Clipboard Manager', 'Calculator', 'Shortcuts']);
        for (const plugin of STARTER_PACK) expect(OFFICIAL_PLUGIN_ID_LIST).toContain(plugin.id);
    });

    it('is not shown to an existing user (completed) or before hydration', () => {
        useAppStore.setState({ onboarding: { status: 'completed', version: 1, migrated: true } });
        render(<Onboarding sync={fakeSync()} />);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        cleanup();
        useAppStore.setState({ onboarding: { ...DEFAULT_ONBOARDING }, isHydrated: false });
        render(<Onboarding sync={fakeSync()} />);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('walks three cards without any timer and finishes as completed', async () => {
        vi.useFakeTimers();
        const sync = fakeSync();
        render(<Onboarding sync={sync} />);
        const dialog = () => document.querySelector('[role="dialog"]')!;
        expect(dialog().getAttribute('aria-modal')).toBe('true');
        expect(dialog().textContent).toContain(en.onboardingWelcomeTitle);
        act(() => void vi.advanceTimersByTime(10 * 60_000));
        expect(dialog().textContent).toContain(en.onboardingWelcomeTitle);
        expect(sync.actions).toEqual([]);
        click(button(en.onboardingNext)!);
        expect(dialog().textContent).toContain(en.onboardingBarTitle);
        expect(sync.actions).toEqual([]);
        click(button(en.onboardingNext)!);
        await flush();
        expect(dialog().textContent).toContain(en.onboardingPackTitle);
        expect(sync.actions.map((a) => a.type)).toEqual(['plugin.refreshCatalog']);
        click(button(en.onboardingDone)!);
        expect(useAppStore.getState().onboarding.status).toBe('completed');
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('Esc skips and records skipped', () => {
        render(<Onboarding sync={fakeSync()} />);
        fire(document, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(useAppStore.getState().onboarding.status).toBe('skipped');
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('installs a starter plugin with one click through plugin.install', async () => {
        const sync = fakeSync();
        render(<Onboarding sync={sync} />);
        click(button(en.onboardingNext)!);
        click(button(en.onboardingNext)!);
        await flush();
        click(button(`${en.onboardingInstall} ToDo`)!);
        await flush();
        expect(sync.actions.at(-1)).toEqual({ type: 'plugin.install', payload: { id: 'todolist-plugin' } });
        expect(document.body.textContent).toContain(en.onboardingInstalled);
    });

    it('a cancelled consent leaves the plugin installable', async () => {
        render(<Onboarding sync={fakeSync({ install: 'canceled' })} />);
        click(button(en.onboardingNext)!);
        click(button(en.onboardingNext)!);
        await flush();
        click(button(`${en.onboardingInstall} Calculator`)!);
        await flush();
        expect(document.body.textContent).not.toContain(en.onboardingInstalled);
        expect(button(`${en.onboardingInstall} Calculator`)).toBeDefined();
    });

    it('offline: installs are disabled, a note is shown and finishing still works', async () => {
        const sync = fakeSync({ catalog: 'offline' });
        render(<Onboarding sync={sync} />);
        click(button(en.onboardingNext)!);
        click(button(en.onboardingNext)!);
        await flush();
        expect(document.body.textContent).toContain(en.onboardingOffline);
        expect(button(`${en.onboardingInstall} ToDo`)!.disabled).toBe(true);
        click(button(en.onboardingDone)!);
        expect(useAppStore.getState().onboarding.status).toBe('completed');
    });

    it('an install failure shows retry and never blocks finishing', async () => {
        render(<Onboarding sync={fakeSync({ install: 'fail' })} />);
        click(button(en.onboardingNext)!);
        click(button(en.onboardingNext)!);
        await flush();
        click(button(`${en.onboardingInstall} Shortcuts`)!);
        await flush();
        expect(button(en.onboardingRetry)).toBeDefined();
        click(button(en.onboardingDone)!);
        expect(useAppStore.getState().onboarding.status).toBe('completed');
    });

    it('app.restartTutorial reopens it for a finished profile, and finishing clears the trigger', async () => {
        useAppStore.setState({ onboarding: { status: 'completed', version: 1 }, tutorialState: { version: '1.0.0', status: 'completed' } });
        render(<Onboarding sync={fakeSync()} />);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        await act(async () => {
            expect(await systemSync.handle({ type: 'app.restartTutorial', payload: {} })).toEqual({ ok: true });
        });
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
        click(button(en.onboardingSkip)!);
        expect(useAppStore.getState().isManualTutorialTrigger).toBe(false);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('has all strings in all 10 languages', () => {
        for (const lang of Object.keys(translations) as (keyof typeof translations)[]) {
            for (const key of Object.keys(en).filter((k) => k.startsWith('onboarding'))) {
                expect((translations[lang] as Record<string, string>)[key], `${lang}.${key}`).toBeTruthy();
            }
        }
    });
});
