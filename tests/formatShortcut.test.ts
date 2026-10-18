import { describe, expect, it } from 'vitest';
import { formatShortcut, modifierLabel } from '../src/utils/formatShortcut';

describe('formatShortcut', () => {
    it('keeps Windows/Linux strings as before', () => {
        expect(formatShortcut('Mod+S', { mac: false })).toBe('Ctrl+S');
        expect(formatShortcut('Ctrl+S', { mac: false })).toBe('Ctrl+S');
        expect(formatShortcut('Mod+Shift+S', { mac: false })).toBe('Ctrl+Shift+S');
        expect(formatShortcut('Alt+ArrowUp', { mac: false })).toBe('Alt+ArrowUp');
    });
    it('uses Apple glyphs and order on macOS', () => {
        expect(formatShortcut('Mod+S', { mac: true })).toBe('⌘S');
        expect(formatShortcut('Mod+Shift+S', { mac: true })).toBe('⇧⌘S');
        expect(formatShortcut('Alt+ArrowUp', { mac: true })).toBe('⌥ArrowUp');
        expect(formatShortcut('Shift+Ctrl+Alt+Mod+K', { mac: true })).toBe('⌃⌥⇧⌘K');
    });
    it('defaults to non-mac without a platform attribute', () => {
        expect(formatShortcut('Mod+S')).toBe('Ctrl+S');
    });
});

describe('modifierLabel', () => {
    it('matches the old literals on Windows', () => {
        expect(modifierLabel('mod', { mac: false })).toBe('Ctrl');
        expect(modifierLabel('mod', { mac: false, language: 'de' })).toBe('Strg');
        expect(modifierLabel('alt', { mac: false, language: 'de' })).toBe('Alt');
    });
    it('uses glyphs on macOS', () => {
        expect(modifierLabel('mod', { mac: true, language: 'de' })).toBe('⌘');
        expect(modifierLabel('alt', { mac: true })).toBe('Option');
    });
});
