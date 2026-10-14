import { describe, expect, it } from 'vitest';

describe('test runner (jsdom environment)', () => {
    it('provides a DOM', () => {
        document.body.innerHTML = '<div id="root">KoBar</div>';
        expect(document.getElementById('root')?.textContent).toBe('KoBar');
    });

    it('installs the window.api mock before each test', async () => {
        expect(window.api).toBeDefined();
        window.api.hideApp();
        expect(window.api.hideApp).toHaveBeenCalledTimes(1);
        await expect(window.api.getAppVersion()).resolves.toBeUndefined();
    });

    it('gives every test a fresh window.api mock', () => {
        expect(window.api.hideApp).not.toHaveBeenCalled();
    });

    // The next two tests depend on running in order (vitest's default within a file).
    it('lets a test write to localStorage', () => {
        window.localStorage.setItem('kobar-smoke', '1');
        expect(window.localStorage.getItem('kobar-smoke')).toBe('1');
    });

    it('resets localStorage between tests', () => {
        expect(window.localStorage.getItem('kobar-smoke')).toBeNull();
        expect(window.localStorage.length).toBe(0);
    });
});
