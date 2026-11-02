import { describe, expect, it } from 'vitest';
import { sanitizeBarBlock } from '../shared/barManifest';
import { validateManifestForInstall } from '../electron/lib/pluginInstall.cjs';

describe('sanitizeBarBlock', () => {
    it('accepts no block', () => {
        expect(sanitizeBarBlock(undefined)).toEqual({ bar: undefined, warnings: [] });
    });

    it('keeps a valid block', () => {
        const input = { tile: { template: 'ring', sensitive: false, live: true, pinnable: true }, defaultSize: 'tile' };
        expect(sanitizeBarBlock(input)).toEqual({ bar: input, warnings: [] });
    });

    it('ignores a block that is not an object', () => {
        for (const bad of ['x', 3, true, [], [{ tile: {} }]]) {
            const r = sanitizeBarBlock(bad);
            expect(r.bar).toBeUndefined();
            expect(r.warnings).toHaveLength(1);
        }
    });

    it('drops invalid parts with a warning', () => {
        const r = sanitizeBarBlock({
            tile: { template: 'sparkle', live: 'yes', sensitive: true },
            defaultSize: 'huge',
            extra: 1,
        });
        expect(r.bar).toEqual({ tile: { sensitive: true } });
        expect(r.warnings).toHaveLength(4);
    });

    it('ignores a tile that is not an object', () => {
        expect(sanitizeBarBlock({ tile: 'ring' })).toMatchObject({ bar: undefined, warnings: [expect.any(String)] });
    });

    it('never keeps a render function', () => {
        const r = sanitizeBarBlock({ tile: { template: 'custom', render: () => null } });
        expect(r.bar).toEqual({ tile: { template: 'custom' } });
    });
});

describe('validateManifestForInstall with a bar block', () => {
    const base = { id: 'my-plugin', name: 'My plugin' };

    it('never refuses because of the bar block', () => {
        const r = validateManifestForInstall({ ...base, bar: 'garbage' }, { kind: 'local' });
        expect(r).toMatchObject({ ok: true, id: 'my-plugin' });
        expect(r.ok && r.warnings?.length).toBe(1);
    });

    it('adds no warnings field for a valid or missing block', () => {
        expect(validateManifestForInstall(base, { kind: 'local' })).toEqual({ ok: true, id: 'my-plugin' });
        const valid = validateManifestForInstall({ ...base, bar: { defaultSize: 'icon' } }, { kind: 'local' });
        expect(valid).toEqual({ ok: true, id: 'my-plugin' });
    });
});
