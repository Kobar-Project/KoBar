import { describe, expect, it } from 'vitest';
import { readMainModule, readMainSources } from './helpers/mainSource';
import { PASTE_TOKEN_TTL_MS, createPasteToken } from '../electron/lib/pasteToken.cjs';

function setup() {
    let t = 1000;
    const token = createPasteToken(() => t);
    return { token, advance: (ms: number) => (t += ms) };
}

describe('pasteToken', () => {
    it('refuses when no token was issued', () => {
        expect(setup().token.consume(1)).toBe(false);
    });

    it('accepts once after issue', () => {
        const { token } = setup();
        token.issue(1);
        expect(token.consume(1)).toBe(true);
        expect(token.consume(1)).toBe(false);
    });

    it('refuses after expiry', () => {
        const { token, advance } = setup();
        token.issue(1);
        advance(PASTE_TOKEN_TTL_MS);
        expect(token.consume(1)).toBe(false);
    });

    it('accepts just before expiry', () => {
        const { token, advance } = setup();
        token.issue(1);
        advance(PASTE_TOKEN_TTL_MS - 1);
        expect(token.consume(1)).toBe(true);
    });

    it('refuses a wrong sender and burns the token', () => {
        const { token } = setup();
        token.issue(1);
        expect(token.consume(2)).toBe(false);
        expect(token.consume(1)).toBe(false);
    });

    it('a newer issue replaces the older token', () => {
        const { token, advance } = setup();
        token.issue(1);
        advance(2000);
        token.issue(1);
        advance(2000);
        expect(token.consume(1)).toBe(true);
    });
});

describe('pasteToken wiring in electron/main/services/globalPaste.cts', () => {
    // T-308: global paste moved out of main.cts.
    const src = readMainModule('services/globalPaste.cts');
    const allSources = readMainSources();

    it('execute-global-paste hands the sender to the session, which consumes the token before writing (R4)', () => {
        const start = src.indexOf("ipcMain.on('execute-global-paste'");
        expect(start).toBeGreaterThan(-1);
        expect(src.slice(start)).toContain('session.item(event.sender.id, data)');
        // The session's token check is the real pasteToken (tests/pasteSession.test.ts: consumeToken runs before writeAndVerify).
        expect(src).toContain('consumeToken: consumePasteToken');
        const consume = src.slice(src.indexOf('function consumePasteToken('));
        expect(consume.slice(0, consume.search(/\r?\n\}/))).toContain('pasteToken.consume(senderId)');
    });

    it('every request-next-paste send is preceded by a token issue', () => {
        const needle = "send('request-next-paste')";
        let count = 0;
        for (let i = allSources.indexOf(needle); i !== -1; i = allSources.indexOf(needle, i + 1)) {
            count++;
            expect(allSources.slice(Math.max(0, i - 200), i)).toContain('pasteToken.issue(');
        }
        // R4: one send left (requestNextPaste, called by the paste session).
        expect(count).toBe(1);
    });
});
