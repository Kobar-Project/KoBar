import { describe, expect, it, vi } from 'vitest';
import { swallowSaveShortcut } from '../src/components/notes/saveShortcut';
import { translations } from '../src/i18n';

describe('note save shortcut', () => {
    it('swallows Ctrl+S and Cmd+S without side effects', () => {
        const preventDefault = vi.fn();
        expect(swallowSaveShortcut({ ctrlKey: true, metaKey: false, key: 's', preventDefault })).toBe(true);
        expect(swallowSaveShortcut({ ctrlKey: false, metaKey: true, key: 'S', preventDefault })).toBe(true);
        expect(preventDefault).toHaveBeenCalledTimes(2);
    });
    it('ignores other keys', () => {
        const preventDefault = vi.fn();
        expect(swallowSaveShortcut({ ctrlKey: false, metaKey: false, key: 's', preventDefault })).toBe(false);
        expect(swallowSaveShortcut({ ctrlKey: true, metaKey: false, key: 'a', preventDefault })).toBe(false);
        expect(preventDefault).not.toHaveBeenCalled();
    });
});

describe('untitledNote i18n', () => {
    it('exists in every language', () => {
        const langs = Object.keys(translations);
        expect(langs.length).toBe(10);
        for (const l of langs) expect((translations as Record<string, Record<string, string>>)[l].untitledNote).toBeTruthy();
    });
});
