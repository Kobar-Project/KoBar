import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    DEFAULT_PIN_BORDER_STYLE,
    PIN_BORDER_FADE_EASING_CSS,
    PIN_BORDER_FADE_MS,
    PIN_BORDER_PRESETS,
    PIN_BORDER_STILL_MS,
    PIN_BORDER_VISIBLE_CSS,
    PIN_STYLE_FILE_MAX_BYTES,
    PIN_STYLE_FILE_NAME,
    buildPinBorderPageUrl,
    buildPinBorderStyleCss,
    createCssSlot,
    createMotionDetector,
    isHiddenWindowRect,
    readPinStyleFile,
    rectsEqual,
    validatePinBorderStyle,
    writePinStyleFileAtomic,
} from '../electron/lib/pinBorder.cjs';
import { readMainCts, readMainModule, readMainSources } from './helpers/mainSource';

const R = (x: number, y: number, width = 800, height = 600) => ({ x, y, width, height });

describe('style defaults and presets', () => {
    it('defaults to a thin neon cyan line', () => {
        expect(DEFAULT_PIN_BORDER_STYLE).toEqual({ color: '#00E5FF', width: 2 });
        expect(PIN_STYLE_FILE_NAME).toBe('pin-style.json');
    });
    it('exposes cyan, green and magenta presets that all validate', () => {
        expect(PIN_BORDER_PRESETS.cyan.color).toBe('#00E5FF');
        expect(PIN_BORDER_PRESETS.green.color).toBe('#39FF14');
        expect(PIN_BORDER_PRESETS.magenta.color).toBe('#FF2BD6');
        for (const preset of Object.values(PIN_BORDER_PRESETS)) expect(validatePinBorderStyle(preset)).toEqual(preset);
    });
});

describe('validatePinBorderStyle', () => {
    it('accepts #RRGGBB (any case) and integer widths 1-4, normalized', () => {
        expect(validatePinBorderStyle({ color: '#39ff14', width: 3 })).toEqual({ color: '#39FF14', width: 3 });
        expect(validatePinBorderStyle({ color: '#AbCdEf', width: 1 })).toEqual({ color: '#ABCDEF', width: 1 });
        expect(validatePinBorderStyle({ color: '#000000', width: 4 })).toEqual({ color: '#000000', width: 4 });
    });
    it('drops unknown keys', () => {
        expect(validatePinBorderStyle({ color: '#00E5FF', width: 2, extra: 'x', glow: 99 })).toEqual({ color: '#00E5FF', width: 2 });
    });
    it.each([
        null,
        undefined,
        'x',
        42,
        [],
        ['#00E5FF', 2],
        {},
        { color: '#00E5FF' },
        { width: 2 },
        { color: '00E5FF', width: 2 },
        { color: '#0EF', width: 2 },
        { color: '#00E5FF00', width: 2 },
        { color: '#00E5FG', width: 2 },
        { color: 'red', width: 2 },
        { color: 'rgb(0,0,0)', width: 2 },
        { color: '#000000;background:url(x)', width: 2 },
        { color: '#000000\n', width: 2 },
        { color: ' #000000', width: 2 },
        { color: '#00E5FF', width: 0 },
        { color: '#00E5FF', width: 5 },
        { color: '#00E5FF', width: 2.5 },
        { color: '#00E5FF', width: -1 },
        { color: '#00E5FF', width: '2' },
        { color: '#00E5FF', width: Number.NaN },
        { color: '#00E5FF', width: Number.POSITIVE_INFINITY },
        { color: 0x00e5ff, width: 2 },
    ])('rejects %j', (input) => {
        expect(validatePinBorderStyle(input)).toBeNull();
    });
    it('never throws on hostile getters', () => {
        const evil = Object.defineProperty({}, 'color', {
            get() {
                throw new Error('boom');
            },
        });
        expect(validatePinBorderStyle(evil)).toBeNull();
    });
});

describe('rect helpers', () => {
    it('rectsEqual compares with an optional tolerance', () => {
        expect(rectsEqual(R(0, 0), R(0, 0))).toBe(true);
        expect(rectsEqual(R(0, 0), R(1, 0))).toBe(false);
        expect(rectsEqual(R(0, 0), R(1, 0), 1)).toBe(true);
        expect(rectsEqual(R(0, 0, 10, 10), R(0, 0, 12, 10), 1)).toBe(false);
        expect(rectsEqual(null, null)).toBe(true);
        expect(rectsEqual(R(0, 0), null)).toBe(false);
    });
    it('isHiddenWindowRect detects minimized and empty rects', () => {
        expect(isHiddenWindowRect({ x: -32000, y: -32000, width: 160, height: 28 })).toBe(true);
        expect(isHiddenWindowRect(R(10, 10, 0, 100))).toBe(true);
        expect(isHiddenWindowRect(R(10, 10, 100, -1))).toBe(true);
        expect(isHiddenWindowRect(R(-1920, -8, 800, 600))).toBe(false);
        expect(isHiddenWindowRect(R(100, 100))).toBe(false);
    });
});

describe('createMotionDetector', () => {
    function setup(stillMs = PIN_BORDER_STILL_MS, tolerancePx?: number) {
        let t = 1000;
        const det = createMotionDetector({ stillMs, tolerancePx, now: () => t });
        return { det, advance: (ms: number) => (t += ms) };
    }

    it('uses a 120 ms stillness window by default', () => {
        expect(PIN_BORDER_STILL_MS).toBe(120);
    });

    it('starts moving, becomes still after stillMs without changes, reports the transition once', () => {
        const { det, advance } = setup();
        expect(det.update(R(0, 0))).toEqual({ state: 'moving', becameStill: false });
        advance(50);
        expect(det.update(R(0, 0))).toEqual({ state: 'moving', becameStill: false });
        advance(50);
        expect(det.update(R(0, 0))).toEqual({ state: 'moving', becameStill: false });
        advance(20); // 120 ms since the last change
        expect(det.update(R(0, 0))).toEqual({ state: 'still', becameStill: true });
        advance(50);
        expect(det.update(R(0, 0))).toEqual({ state: 'still', becameStill: false });
        expect(det.state).toBe('still');
    });

    it('any change (move or resize) restarts the moving phase', () => {
        const { det, advance } = setup();
        det.update(R(0, 0));
        advance(200);
        expect(det.update(R(0, 0)).becameStill).toBe(true);
        advance(50);
        expect(det.update(R(5, 0))).toEqual({ state: 'moving', becameStill: false });
        advance(100);
        expect(det.update(R(5, 0)).state).toBe('moving');
        advance(50);
        expect(det.update(R(5, 0, 900, 600))).toEqual({ state: 'moving', becameStill: false });
        advance(119);
        expect(det.update(R(5, 0, 900, 600)).state).toBe('moving');
        advance(1);
        expect(det.update(R(5, 0, 900, 600))).toEqual({ state: 'still', becameStill: true });
    });

    it('a continuous drag never becomes still', () => {
        const { det, advance } = setup();
        for (let i = 0; i < 40; i++) {
            expect(det.update(R(i * 3, i)).state).toBe('moving');
            advance(50);
        }
    });

    it('honours the tolerance', () => {
        const { det, advance } = setup(PIN_BORDER_STILL_MS, 1);
        det.update(R(0, 0));
        advance(60);
        det.update(R(1, 0)); // within 1 px: not a change
        advance(60);
        expect(det.update(R(0, 1)).becameStill).toBe(true);
    });

    it('reset() starts over', () => {
        const { det, advance } = setup();
        det.update(R(0, 0));
        advance(500);
        expect(det.update(R(0, 0)).state).toBe('still');
        det.reset();
        expect(det.state).toBe('moving');
        expect(det.update(R(0, 0))).toEqual({ state: 'moving', becameStill: false });
    });
});

describe('overlay page and CSS', () => {
    it('the page is script-free, starts hidden and draws the style', () => {
        const html = decodeURIComponent(buildPinBorderPageUrl({ color: '#39FF14', width: 3 }).slice('data:text/html,'.length));
        expect(buildPinBorderPageUrl(DEFAULT_PIN_BORDER_STYLE).startsWith('data:text/html,')).toBe(true);
        expect(html.toLowerCase()).not.toContain('<script');
        expect(html).not.toMatch(/\bon\w+=/i);
        expect(html).toContain('border:3px solid #39FF14');
        expect(html).toContain('opacity:0;transition:none');
    });
    it('the page never contains an unvalidated colour', () => {
        const html = decodeURIComponent(buildPinBorderPageUrl({ color: 'red;}</style><script>x()</script>', width: 9 }));
        expect(html).not.toContain('<script');
        expect(html).toContain('border:2px solid #00E5FF');
        expect(buildPinBorderStyleCss({ color: 'url(x)', width: 2 })).toContain('#00E5FF');
    });
    it('the visible sheet fades in with the eased transition and outranks the page rule', () => {
        expect(PIN_BORDER_FADE_MS).toBeGreaterThanOrEqual(150);
        expect(PIN_BORDER_FADE_MS).toBeLessThanOrEqual(200);
        expect(PIN_BORDER_VISIBLE_CSS).toBe(
            `html body{opacity:1;transition:opacity ${PIN_BORDER_FADE_MS}ms ${PIN_BORDER_FADE_EASING_CSS}}`
        );
        expect(buildPinBorderStyleCss({ color: '#FF2BD6', width: 1 })).toMatch(/^html body\{border:1px solid #FF2BD6;/);
    });
});

describe('createCssSlot', () => {
    function fakeOps() {
        const sheets = new Map<string, string>();
        const log: string[] = [];
        let n = 0;
        let failNextInsert = false;
        const pending: Array<() => void> = [];
        let manual = false;
        const gate = () => (manual ? new Promise<void>((resolve) => pending.push(resolve)) : Promise.resolve());
        return {
            sheets,
            log,
            setManual: (m: boolean) => (manual = m),
            releaseAll: async () => {
                while (pending.length) {
                    pending.shift()!();
                    await flush();
                }
            },
            failInsert: () => (failNextInsert = true),
            ops: {
                insert: async (css: string) => {
                    await gate();
                    if (failNextInsert) {
                        failNextInsert = false;
                        throw new Error('page gone');
                    }
                    const key = `k${++n}`;
                    sheets.set(key, css);
                    log.push(`+${css}`);
                    return key;
                },
                remove: async (key: string) => {
                    await gate();
                    log.push(`-${sheets.get(key)}`);
                    sheets.delete(key);
                },
            },
        };
    }
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    it('inserts, replaces (insert before remove) and clears', async () => {
        const f = fakeOps();
        const slot = createCssSlot(f.ops);
        slot.set('a');
        await flush();
        expect([...f.sheets.values()]).toEqual(['a']);
        slot.set('b');
        await flush();
        expect([...f.sheets.values()]).toEqual(['b']);
        expect(f.log).toEqual(['+a', '+b', '-a']);
        slot.set(null);
        await flush();
        expect(f.sheets.size).toBe(0);
    });

    it('coalesces a fast show/hide/show while an insert is in flight', async () => {
        const f = fakeOps();
        f.setManual(true);
        const slot = createCssSlot(f.ops);
        slot.set('v');
        slot.set(null);
        slot.set('v');
        slot.set(null);
        await f.releaseAll();
        expect(f.sheets.size).toBe(0);
        slot.set('v');
        await f.releaseAll();
        expect([...f.sheets.values()]).toEqual(['v']);
    });

    it('a failed insert does not throw and is retried on the next set', async () => {
        const f = fakeOps();
        const slot = createCssSlot(f.ops);
        f.failInsert();
        slot.set('a');
        await flush();
        expect(f.sheets.size).toBe(0);
        slot.set('a');
        await flush();
        expect([...f.sheets.values()]).toEqual(['a']);
    });

    it('does nothing after dispose', async () => {
        const f = fakeOps();
        const slot = createCssSlot(f.ops);
        slot.dispose();
        slot.set('a');
        await flush();
        expect(f.log).toEqual([]);
    });
});

describe('pin-style.json persistence', () => {
    let dir: string;
    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-pinstyle-'));
    });
    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('missing file -> default', () => {
        expect(readPinStyleFile(path.join(dir, 'missing.json'))).toEqual(DEFAULT_PIN_BORDER_STYLE);
    });

    it('round-trips a valid style atomically and leaves no temp files', () => {
        const file = path.join(dir, 'roundtrip', PIN_STYLE_FILE_NAME);
        fs.mkdirSync(path.dirname(file));
        expect(writePinStyleFileAtomic(file, { color: '#ff2bd6', width: 4 })).toBe(true);
        expect(readPinStyleFile(file)).toEqual({ color: '#FF2BD6', width: 4 });
        expect(writePinStyleFileAtomic(file, { color: '#39FF14', width: 1 })).toBe(true);
        expect(readPinStyleFile(file)).toEqual({ color: '#39FF14', width: 1 });
        expect(fs.readdirSync(path.dirname(file))).toEqual([PIN_STYLE_FILE_NAME]);
    });

    it('refuses to write an invalid style and keeps the old file', () => {
        const file = path.join(dir, 'invalid.json');
        expect(writePinStyleFileAtomic(file, { color: '#39FF14', width: 2 })).toBe(true);
        expect(writePinStyleFileAtomic(file, { color: 'red', width: 2 })).toBe(false);
        expect(writePinStyleFileAtomic(file, { color: '#39FF14', width: 7 })).toBe(false);
        expect(readPinStyleFile(file)).toEqual({ color: '#39FF14', width: 2 });
    });

    it('returns false instead of throwing when the folder does not exist', () => {
        expect(writePinStyleFileAtomic(path.join(dir, 'no', 'such', 'dir', 'x.json'), DEFAULT_PIN_BORDER_STYLE)).toBe(false);
    });

    it.each([
        ['corrupt JSON', '{not json'],
        ['empty file', ''],
        ['wrong shape', JSON.stringify({ color: 'red', width: 2 })],
        ['array', JSON.stringify(['#00E5FF', 2])],
        ['out-of-range width', JSON.stringify({ color: '#39FF14', width: 10 })],
    ])('%s -> default', (_label, content) => {
        const file = path.join(dir, `bad-${Math.random().toString(36).slice(2)}.json`);
        fs.writeFileSync(file, content, 'utf8');
        expect(readPinStyleFile(file)).toEqual(DEFAULT_PIN_BORDER_STYLE);
    });

    it('oversized file -> default', () => {
        const file = path.join(dir, 'big.json');
        fs.writeFileSync(file, JSON.stringify({ color: '#39FF14', width: 2, pad: 'x'.repeat(PIN_STYLE_FILE_MAX_BYTES) }), 'utf8');
        expect(readPinStyleFile(file)).toEqual(DEFAULT_PIN_BORDER_STYLE);
    });

    it('a directory in place of the file -> default', () => {
        const file = path.join(dir, 'adir.json');
        fs.mkdirSync(file);
        expect(readPinStyleFile(file)).toEqual(DEFAULT_PIN_BORDER_STYLE);
    });

    it('the default is a fresh copy (callers cannot mutate it)', () => {
        const a = readPinStyleFile(path.join(dir, 'missing.json'));
        a.width = 4;
        expect(DEFAULT_PIN_BORDER_STYLE.width).toBe(2);
    });
});

describe('wiring (source level)', () => {
    const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
    // T-315: main.cts only calls the startup phases; the dev userData redirect is in app/runtime.cts, the pin style init in bootstrap.cts.
    const main = readMainSources();
    const mainEntry = readMainCts();
    const bootstrap = readMainModule('bootstrap.cts');
    const runtime = readMainModule('app/runtime.cts');
    // T-309: the pin feature (tracker, border window, IPC handlers, style state) moved into electron/main/services/pin.cts.
    const pin = read('electron/main/services/pin.cts');
    const preload = read('electron/preload.cts');
    const globalTypes = read('src/types/global.d.ts');

    function block(src: string, startMarker: string, endRe = /\r?\n\}\)?;?\r?\n/): string {
        const start = src.indexOf(startMarker);
        expect(start, startMarker).toBeGreaterThanOrEqual(0);
        const rest = src.slice(start);
        return rest.slice(0, rest.search(endRe));
    }

    it('main loads the style at startup from userData/pin-style.json', () => {
        expect(pin).toMatch(/from '\.\.\/\.\.\/lib\/pinBorder\.cjs'/);
        expect(bootstrap).toContain("initPinBorderStyle(app.getPath('userData'));");
        // The dev userData redirect must run before the style is loaded.
        expect(runtime.indexOf("setPath('userData'")).toBeGreaterThanOrEqual(0);
        expect(mainEntry.indexOf('redirectDevUserData(')).toBeGreaterThanOrEqual(0);
        expect(mainEntry.indexOf('redirectDevUserData(')).toBeLessThan(mainEntry.indexOf('configureStartupServices('));
        expect(pin).toMatch(/path\.join\(userDataPath, PIN_STYLE_FILE_NAME\)/);
        expect(pin).toMatch(/pinBorderStyle = readPinStyleFile\(pinStylePath\)/);
    });

    it('the old thick red border is gone; the page comes from buildPinBorderPageUrl', () => {
        expect(main).not.toContain('%23ef4444');
        expect(pin).not.toContain('%23ef4444');
        expect(pin).toContain('loadURL(buildPinBorderPageUrl(pinBorderStyle))');
        // Visibility/style via inserted CSS only; nothing is executed in the overlay page.
        const tracking = block(pin, 'function startWindowTracking(');
        expect(tracking).toContain('wc.insertCSS(');
        expect(tracking).toContain('wc.removeInsertedCSS(');
        expect(tracking).not.toContain('executeJavaScript');
        expect(tracking).toMatch(/webPreferences: secureWebPreferences\(\)/);
    });

    it('hides while moving/minimized and fades in once still', () => {
        const onRect = block(pin, 'function onPinnedRect(');
        expect(onRect).toContain('isHiddenWindowRect(phys)');
        expect(onRect).toContain('pinMotion.update(phys)');
        expect(onRect).toContain('borderVisibilitySlot?.set(null)');
        expect(onRect).toContain('borderVisibilitySlot?.set(PIN_BORDER_VISIBLE_CSS)');
        // Bounds are applied before the fade-in starts.
        expect(onRect.indexOf('applyBorderBounds(')).toBeLessThan(onRect.indexOf('PIN_BORDER_VISIBLE_CSS'));
    });

    it('T-142: mixed-DPI conversion and no redundant setBounds/setAlwaysOnTop', () => {
        expect(block(pin, 'function physicalToDipRect(')).toContain('screen.screenToDipRect(null, phys)');
        const apply = block(pin, 'function applyBorderBounds(');
        // Compared with the window's REAL bounds, so a size Electron adjusted after setBounds is re-applied next tick.
        expect(apply).toMatch(/if \(!rectsEqual\(bounds, win\.getBounds\(\)\)\)/);
        expect(apply).toContain('PIN_BORDER_ZORDER_REFRESH_MS');
        // screenToDipRect failures are logged once, not on every tick.
        expect(block(pin, 'function physicalToDipRect(')).toContain('if (!screenToDipFailureLogged)');
        // A throw while handling a tracker result never becomes an unhandled rejection.
        const tracking = block(pin, 'function startWindowTracking(');
        expect(tracking.slice(tracking.indexOf('onPinnedRect('))).toMatch(
            /\}\)\s*\.catch\(\(err\) => \{[\s\S]*?trackRequestPending = false;/
        );
        // The tracker no longer divides by the primary display's scale factor itself.
        expect(block(pin, 'function startWindowTracking(')).not.toContain('scaleFactor');
    });

    it('the PowerShell tracking script only interpolates the numeric hwnd and request id', () => {
        const tracking = block(pin, 'function startWindowTracking(');
        const script = tracking.slice(tracking.search(/psRequest\(\s*\(id\) =>\s*`/), tracking.indexOf("` + '\\n'"));
        expect([...script.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1]).sort()).toEqual(['id', 'id', 'id', 'trackedHwnd']);
    });

    it('IPC handlers validate before doing anything and persist atomically', () => {
        expect(pin).toMatch(/ipcMain\.handle\('get-pin-border-style'/);
        const set = block(pin, "ipcMain.handle('set-pin-border-style'", /\r?\n {4}\}\);\r?\n/);
        const validateAt = set.indexOf('validatePinBorderStyle(input)');
        expect(validateAt).toBeGreaterThanOrEqual(0);
        expect(set).toMatch(/if \(!style\) return \{ success: false, error: 'invalid-style' \}/);
        expect(set.indexOf('if (!style)')).toBeLessThan(set.indexOf('pinBorderStyle = style'));
        expect(set).toContain('writePinStyleFileAtomic(pinStylePath, style)');
        expect(set).toContain('borderStyleSlot?.set(buildPinBorderStyleCss(style))');
    });

    it('preload exposes the two additive invoke methods and global.d.ts declares them', () => {
        expect(preload).toContain("    getPinBorderStyle: () => ipcRenderer.invoke('get-pin-border-style'),");
        expect(preload).toMatch(
            /^ {4}setPinBorderStyle: \(style: \{ color: string; width: number \}\) => ipcRenderer\.invoke\('set-pin-border-style', style\),$/m
        );
        expect(globalTypes).toMatch(/getPinBorderStyle: \(\) => Promise<\{ color: string; width: number \}>;/);
        expect(globalTypes).toMatch(
            /setPinBorderStyle: \(style: \{ color: string; width: number \}\) => Promise<\{ success: boolean; error\?: string \}>;/
        );
    });
});
