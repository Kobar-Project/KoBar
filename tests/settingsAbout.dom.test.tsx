// T-614: Settings > About page: version from the system summary, credits and links through the checked external-open gate.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
    (globalThis as { settingsBridge?: unknown }).settingsBridge = {
        onState: () => () => {},
        requestState: () => {},
        dispatch: () => {},
    };
});

import { CONTACT_MAILTO, OPEN_COLLECTIVE_URL, PATREON_URL, WEBSITE_URL } from '../src/config/links';
import { translations } from '../src/i18n';
import { settingsMirror } from '../src/settings/mirror';
import { AboutPage } from '../src/settings/pages/About';
import { cleanup, render } from './ui/render';

const en = translations.en;
const t = (key: keyof typeof en) => en[key];

let seq = 0;
const publish = (system: unknown, state: Record<string, unknown> | null = { language: 'en' }) => {
    seq += 1;
    act(() => settingsMirror.receive({ seq, state, ack: 0, ...(system === undefined ? {} : { system }) } as never));
};

afterEach(() => {
    cleanup();
    publish(undefined, null);
});

describe('AboutPage', () => {
    it('shows a placeholder until the version arrives, then the version', () => {
        const { host } = render(<AboutPage t={t} />);
        expect(host.textContent).toContain(`${en.version}: …`);
        publish({
            version: '2.0.3',
            updatesEnabled: false,
            update: { status: 'idle', version: '', percent: 0 },
            backup: { busy: false, last: null },
        });
        expect(host.textContent).toContain('2.0.3');
    });

    it('credits and links open through target=_blank and mention no licence', () => {
        const { host } = render(<AboutPage t={t} />);
        const hrefs = [...host.querySelectorAll('a')].map((a) => a.getAttribute('href'));
        for (const url of [CONTACT_MAILTO, WEBSITE_URL, PATREON_URL, OPEN_COLLECTIVE_URL]) expect(hrefs).toContain(url);
        for (const a of host.querySelectorAll('a')) {
            expect(a.getAttribute('target')).toBe('_blank');
            expect(a.getAttribute('rel')).toContain('noopener');
        }
        expect(host.textContent).toContain('KoBar was made by Ekrem EDALI.');
        expect(hrefs).toContain('https://github.com/eedali');
        expect(host.textContent!.toLowerCase()).not.toContain('licen');
    });
});
