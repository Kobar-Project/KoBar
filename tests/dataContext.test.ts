import { describe, expect, it } from 'vitest';
import { isSameDataContext, resolveDataContext, shouldSwitchDataContext, type DataContextState } from '../src/store/workspace/dataContext';

// T-206 (WS-03): the pure "does this workspace action switch the plugin data context?" rule.

const shared = (id: string) => ({ id, isIsolated: false });
const iso = (id: string) => ({ id, isIsolated: true });

function st(activeWorkspaceId: string | null, workspaces: DataContextState['workspaces']): DataContextState {
    return { activeWorkspaceId, workspaces };
}

describe('resolveDataContext', () => {
    it('isolated active workspace gets the _iso_<id> suffix, shared/none/unknown get none', () => {
        expect(resolveDataContext(st('A', [iso('A')]))).toEqual({ workspaceId: 'A', isolationSuffix: '_iso_A' });
        expect(resolveDataContext(st('S', [shared('S')]))).toEqual({ workspaceId: 'S', isolationSuffix: '' });
        expect(resolveDataContext(st(null, [iso('A')]))).toEqual({ workspaceId: null, isolationSuffix: '' });
        expect(resolveDataContext(st('missing', [iso('A')]))).toEqual({ workspaceId: 'missing', isolationSuffix: '' });
    });

    it('isSameDataContext compares id and suffix', () => {
        expect(isSameDataContext({ workspaceId: 'A', isolationSuffix: '' }, { workspaceId: 'A', isolationSuffix: '' })).toBe(true);
        expect(isSameDataContext({ workspaceId: 'A', isolationSuffix: '' }, { workspaceId: 'B', isolationSuffix: '' })).toBe(false);
        expect(isSameDataContext({ workspaceId: 'A', isolationSuffix: '' }, { workspaceId: 'A', isolationSuffix: '_iso_A' })).toBe(false);
    });
});

describe('shouldSwitchDataContext', () => {
    it('load always switches, even when nothing changes', () => {
        const s = st('S', [shared('S')]);
        expect(shouldSwitchDataContext('load', s, s)).toBe(true);
    });

    it('save switches when the active id changes (shared -> shared included)', () => {
        expect(shouldSwitchDataContext('save', st(null, []), st('N', [shared('N')]))).toBe(true);
        expect(shouldSwitchDataContext('save', st('S', [shared('S')]), st('N', [shared('S'), shared('N')]))).toBe(true);
    });

    it('toggle switches only when the ACTIVE workspace flips', () => {
        expect(shouldSwitchDataContext('toggle-isolation', st('A', [shared('A')]), st('A', [iso('A')]))).toBe(true);
        expect(shouldSwitchDataContext('toggle-isolation', st('A', [iso('A')]), st('A', [shared('A')]))).toBe(true);
        expect(shouldSwitchDataContext('toggle-isolation', st('A', [iso('A'), shared('B')]), st('A', [iso('A'), iso('B')]))).toBe(false);
    });

    it('delete switches only when the active workspace is removed', () => {
        expect(shouldSwitchDataContext('delete', st('A', [iso('A')]), st(null, []))).toBe(true);
        expect(shouldSwitchDataContext('delete', st('S', [shared('S')]), st(null, []))).toBe(true);
        expect(shouldSwitchDataContext('delete', st('A', [iso('A'), iso('B')]), st('A', [iso('A')]))).toBe(false);
    });
});
