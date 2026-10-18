import { describe, expect, it, vi } from 'vitest';
import { buildMacMenuTemplate, type MenuStrings, type MenuTemplateItem } from '../electron/lib/appMenuTemplate.cjs';
import { MAIN_STRING_KEYS } from '../electron/lib/mainStrings.cjs';

const strings = Object.fromEntries(MAIN_STRING_KEYS.map((k) => [k, `S:${k}`])) as unknown as MenuStrings;

function build(isDev: boolean) {
    const onOpenSettings = vi.fn();
    const onCloseWindow = vi.fn();
    const template = buildMacMenuTemplate({ strings, isDev, onOpenSettings, onCloseWindow });
    return { template, onOpenSettings, onCloseWindow };
}

function walk(items: MenuTemplateItem[]): MenuTemplateItem[] {
    return items.flatMap((i) => [i, ...(i.submenu ? walk(i.submenu) : [])]);
}

const DEV_ROLES = ['reload', 'forceReload', 'toggleDevTools'];

describe('buildMacMenuTemplate', () => {
    it('production has no reload / devtools role or accelerator', () => {
        const all = walk(build(false).template);
        expect(all.some((i) => i.role && DEV_ROLES.includes(i.role))).toBe(false);
        const accels = all.map((i) => i.accelerator ?? '');
        expect(accels.some((a) => /\+R$/i.test(a) || /Alt\+.*I$/i.test(a) || (/I$/.test(a) && /Alt|Option/i.test(a)))).toBe(false);
    });

    it('dev has reload, forceReload and toggleDevTools', () => {
        const roles = walk(build(true).template).map((i) => i.role);
        for (const r of DEV_ROLES) expect(roles).toContain(r);
    });

    it('Edit menu has all editing roles', () => {
        const edit = build(false).template.find((m) => m.label === 'S:menuEdit');
        const roles = (edit?.submenu ?? []).map((i) => i.role);
        for (const r of ['undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'delete', 'selectAll']) expect(roles).toContain(r);
    });

    it('never uses role close', () => {
        for (const dev of [false, true]) expect(walk(build(dev).template).some((i) => i.role === 'close')).toBe(false);
    });

    it('Settings uses Command+, and calls onOpenSettings', () => {
        const { template, onOpenSettings } = build(false);
        const item = walk(template).find((i) => i.label === 'S:menuSettings');
        expect(item?.accelerator).toBe('Command+,');
        item?.click?.();
        expect(onOpenSettings).toHaveBeenCalledTimes(1);
    });

    it('Close Window uses Command+W and calls onCloseWindow', () => {
        const { template, onCloseWindow } = build(false);
        const item = walk(template).find((i) => i.label === 'S:menuCloseWindow');
        expect(item?.accelerator).toBe('Command+W');
        item?.click?.();
        expect(onCloseWindow).toHaveBeenCalledTimes(1);
    });

    it('App menu has about, hide, hideOthers, unhide and quit with labels from the strings', () => {
        const app = build(false).template[0].submenu ?? [];
        expect(app.map((i) => i.role).filter(Boolean)).toEqual(['about', 'hide', 'hideOthers', 'unhide', 'quit']);
        expect(app.find((i) => i.role === 'quit')?.label).toBe('S:menuQuit');
        expect(build(false).template.map((m) => m.label)).toEqual(['KoBar', 'S:menuEdit', 'S:menuWindow']);
    });
});
