// Canlı contrast contract (01-color §5): every preset accent × scheme × tonal on/off passes CONTRAST_RULES,
// and a custom accent tuned by deriveCustomAccent passes them too. Port of the kit's tokens/check-contrast.ts.
import { describe, expect, it } from 'vitest';
import { auditPalette, canliPalette, presetPalette, type CanliScheme } from '../src/theme/canli';
import { deriveCustomAccent, mixOklab } from '../src/theme/color';
import { PRESET_ACCENTS } from '../src/theme/types';

const SCHEMES: CanliScheme[] = ['dark', 'light'];

describe('Canlı palette contrast', () => {
    for (const scheme of SCHEMES) {
        for (const tonal of [true, false]) {
            for (const id of PRESET_ACCENTS) {
                it(`${id} / ${scheme} / tonal ${tonal ? 'on' : 'off'} passes every rule`, () => {
                    const failures = auditPalette(presetPalette(id, scheme, tonal)).map(
                        (f) => `${f.rule.fg} on ${f.rule.bg} = ${f.ratio.toFixed(2)} < ${f.rule.min}`
                    );
                    expect(failures).toEqual([]);
                });
            }
        }
    }

    it('matches the resolved examples of 01-color §4', () => {
        expect(presetPalette('amber', 'dark').shell).toBe('#1e1c1c');
        expect(presetPalette('red', 'light').container).toBe('#f9d7d6');
        expect(presetPalette('blue', 'dark').tile).toBe('#232d3c');
        expect(presetPalette('red', 'light').accentText).toBe('#9d212e');
    });

    it('keeps the selection container tinted when tonal surfaces are off', () => {
        const off = presetPalette('violet', 'dark', false);
        expect(off.shell).toBe('#111318');
        expect(off.container).not.toBe('#171a22');
    });

    it('mixOklab matches color-mix semantics at the ends', () => {
        expect(mixOklab('#ff0000', '#00ff00', 0)).toBe('#00ff00');
        expect(mixOklab('#ff0000', '#00ff00', 100)).toBe('#ff0000');
    });
});

describe('Canlı custom accent', () => {
    // Hard cases: very dark, very light, saturated yellow, low-chroma grey.
    for (const hex of ['#1a237e', '#fff59d', '#ffeb3b', '#7f7f7f', '#00bcd4', '#e91e63']) {
        it(`${hex} is tuned so the Canlı palette passes in both schemes`, () => {
            const values = deriveCustomAccent(hex);
            expect(values).not.toBeNull();
            for (const tonal of [true, false]) {
                const dark = auditPalette(canliPalette(values!.dark, 'dark', tonal, values!.onDark));
                const light = auditPalette(canliPalette(values!.light, 'light', tonal, values!.onLight));
                expect([...dark, ...light].map((f) => `${f.rule.fg}/${f.rule.bg} ${f.ratio.toFixed(2)}`)).toEqual([]);
            }
        });
    }
});
