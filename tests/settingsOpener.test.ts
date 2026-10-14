import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSettingsPage, setSettingsOpener } from '../src/store/settingsOpener';
import { parseSettingsParams } from '../src/settings/params';

// T-615: the host opener and the ?page= parameter of the Settings window.
describe('settingsOpener', () => {
    afterEach(() => setSettingsOpener(null));

    it('is a no-op that reports false without an opener', () => {
        expect(openSettingsPage('plugins')).toBe(false);
    });

    it('forwards the page and reports true', () => {
        const opener = vi.fn();
        setSettingsOpener(opener);
        expect(openSettingsPage('plugins')).toBe(true);
        expect(opener).toHaveBeenCalledWith('plugins');
    });

    it('never throws when the opener does', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        setSettingsOpener(() => {
            throw new Error('boom');
        });
        expect(openSettingsPage('general')).toBe(false);
        spy.mockRestore();
    });
});

describe('parseSettingsParams page', () => {
    it('accepts a known page and drops an unknown one', () => {
        expect(parseSettingsParams('?lang=en&page=plugins').page).toBe('plugins');
        expect(parseSettingsParams('?lang=en&page=evil').page).toBeUndefined();
        expect(parseSettingsParams('?lang=en').page).toBeUndefined();
    });
});
