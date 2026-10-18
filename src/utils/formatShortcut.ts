// MAC-023: platform-aware shortcut labels. Pure; the platform is injectable for tests and defaults to the <html data-platform> hook.
import { isMacPlatform } from '../platform';

export interface ShortcutOptions {
    mac?: boolean;
}

export interface ModifierLabelOptions extends ShortcutOptions {
    language?: string;
}

const MAC_GLYPHS: Record<string, string> = { ctrl: '⌃', alt: '⌥', option: '⌥', shift: '⇧', mod: '⌘', cmd: '⌘', meta: '⌘' };
const MAC_ORDER = ['⌃', '⌥', '⇧', '⌘'];

/** `Mod+Shift+S` -> `⇧⌘S` on macOS, `Ctrl+Shift+S` elsewhere. `Mod` is Cmd on macOS and Ctrl elsewhere. */
export function formatShortcut(combo: string, opts: ShortcutOptions = {}): string {
    const mac = opts.mac ?? isMacPlatform();
    const parts = combo.split('+');
    if (!mac) return parts.map((p) => (p === 'Mod' ? 'Ctrl' : p)).join('+');
    const mods: string[] = [];
    const keys: string[] = [];
    for (const p of parts) {
        const glyph = MAC_GLYPHS[p.toLowerCase()];
        if (glyph) mods.push(glyph);
        else keys.push(p);
    }
    mods.sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b));
    return mods.join('') + keys.join('+');
}

/**
 * Single modifier word for sentences: mac `⌘` / `Option` (Apple writes the word, not the glyph, in running text, and screen
 * readers say it); elsewhere `Ctrl` (`Strg` in German) / `Alt`.
 */
export function modifierLabel(name: 'mod' | 'alt', opts: ModifierLabelOptions = {}): string {
    const mac = opts.mac ?? isMacPlatform();
    if (name === 'alt') return mac ? 'Option' : 'Alt';
    if (mac) return '⌘';
    return opts.language === 'de' ? 'Strg' : 'Ctrl';
}
