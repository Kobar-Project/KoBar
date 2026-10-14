import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../src/store/useAppStore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyEdgeChanged, applyWindowGeometryChange, installWindowLayoutSync } from '../src/store/windowLayoutSync';
import { getWindowGeometry, resetWindowGeometryCacheForTests } from '../src/utils/windowGeometry';
import { installWindowApiMock } from './helpers/windowApi';

// T-322 (window model A): main re-fits the window to a display and announces it with window-geometry-changed; the bar and the
// mini-mode eye must stay on screen (through the existing store actions, nothing persisted) and screenBounds keeps its meaning.

type Rect = { x: number; y: number; width: number; height: number };
type Listener = Parameters<Window['api']['onWindowGeometryChanged']>[0];

function fitted(displayBounds: Rect, workArea: Rect) {
    return {
        width: displayBounds.width,
        height: displayBounds.height,
        centerX: Math.floor(displayBounds.width / 2),
        centerY: Math.floor(displayBounds.height / 2),
        fallbackScreenWidth: 1920,
        fallbackScreenHeight: 800,
        displayId: displayBounds.x + 1,
        displayBounds,
        workArea,
        scaleFactor: 1,
    };
}

const FHD = fitted({ x: 0, y: 0, width: 1920, height: 1080 }, { x: 0, y: 0, width: 1920, height: 1040 });
/** The same display at 125% scale. */
const FHD_125 = fitted({ x: 0, y: 0, width: 1536, height: 864 }, { x: 0, y: 0, width: 1536, height: 824 });
const FHD_TASKBAR_TOP = fitted({ x: 0, y: 0, width: 1920, height: 1080 }, { x: 0, y: 40, width: 1920, height: 1040 });
const FHD_TASKBAR_LEFT = fitted({ x: 0, y: 0, width: 1920, height: 1080 }, { x: 80, y: 0, width: 1840, height: 1080 });

const initial = useAppStore.getState();

let emit: (geometry: unknown) => void;
let uninstall: (() => void) | null = null;

function start(first = FHD) {
    const api = installWindowApiMock();
    api.getWindowGeometry.mockReturnValue(first);
    let listener: Listener | null = null;
    api.onWindowGeometryChanged.mockImplementation((callback) => {
        listener = callback;
        return () => {
            listener = null;
        };
    });
    emit = (geometry) => listener?.(geometry as never);
    uninstall = installWindowLayoutSync();
    return api;
}

describe('window layout sync (T-322)', () => {
    beforeEach(() => {
        resetWindowGeometryCacheForTests();
        useAppStore.setState({
            isMac: false,
            isDraggingGlobal: false,
            isMiniMode: false,
            miniModePosition: null,
            sidebarPosition: null,
            screenBounds: { x: 0, y: 0, width: 1920, height: 1040 },
            orientation: 'vertical',
            edgePosition: 'right',
            sidebarWidth: 64,
            lastSidebarHeight: 400,
            lastSidebarWidth: 600,
            iconScale: 1,
        });
    });

    afterEach(() => {
        uninstall?.();
        uninstall = null;
        resetWindowGeometryCacheForTests();
        useAppStore.setState(initial, true);
        vi.restoreAllMocks();
    });

    it('re-snaps a bar docked to the right edge after a scale change (100% -> 125%)', () => {
        start();
        useAppStore.getState().setSidebarPosition({ x: 1920 - 64, y: 20 });
        emit(FHD_125);
        expect(useAppStore.getState().sidebarPosition).toEqual({ x: 1536 - 64, y: 20 });
        expect(useAppStore.getState().edgePosition).toBe('right');
    });

    it('clamps a free-floating bar into the smaller area and leaves one that still fits alone', () => {
        start();
        useAppStore.getState().setSidebarPosition({ x: 1700, y: 700 });
        emit(FHD_125);
        expect(useAppStore.getState().sidebarPosition).toEqual({ x: 1536 - 64, y: 824 - 400 });

        const inside = { x: 300, y: 100 };
        useAppStore.getState().setSidebarPosition(inside);
        emit(FHD);
        expect(useAppStore.getState().sidebarPosition).toBe(inside);
    });

    it('moves a bar docked at the top below a taskbar that moved to the top (horizontal bar)', () => {
        start();
        useAppStore.setState({ orientation: 'horizontal', edgePosition: 'top' });
        useAppStore.getState().setSidebarPosition({ x: 500, y: 0 });
        emit(FHD_TASKBAR_TOP);
        expect(useAppStore.getState().sidebarPosition).toEqual({ x: 500, y: 40 });
    });

    it('keeps a bar docked left next to a taskbar that moved to the left', () => {
        start();
        useAppStore.getState().setSidebarPosition({ x: 0, y: 20 });
        emit(FHD_TASKBAR_LEFT);
        expect(useAppStore.getState().sidebarPosition).toEqual({ x: 80, y: 20 });
    });

    it('updates screenBounds with the new work area (screen coordinates, same meaning as edge-changed)', () => {
        start();
        const secondary = fitted({ x: 1920, y: -200, width: 2560, height: 1440 }, { x: 1920, y: -200, width: 2560, height: 1400 });
        emit(secondary);
        expect(useAppStore.getState().screenBounds).toEqual({ x: 1920, y: -200, width: 2560, height: 1400 });
    });

    it('does not replace an equal screenBounds object', () => {
        start();
        const before = useAppStore.getState().screenBounds;
        emit(fitted({ x: 0, y: 0, width: 1920, height: 1080 }, { x: 0, y: 0, width: 1920, height: 1040 }));
        expect(useAppStore.getState().screenBounds).toBe(before);
    });

    it('clamps the mini-mode eye into the new area', () => {
        start();
        useAppStore.getState().setMiniMode(true, { x: 1900, y: 1000 });
        emit(FHD_125);
        expect(useAppStore.getState().miniModePosition).toEqual({ x: 1536 - 24, y: 824 - 24 });
        expect(useAppStore.getState().isMiniMode).toBe(true);
    });

    it('gives the eye the default spot of the new area when it had none', () => {
        start();
        useAppStore.setState({ isMiniMode: true, miniModePosition: null, edgePosition: 'right' });
        emit(FHD_TASKBAR_TOP);
        expect(useAppStore.getState().miniModePosition).toEqual({ x: 1920 - 60, y: 40 + 20 + 520 });
    });

    it('does nothing to positions while a drag owns them (the drop path places them)', () => {
        start();
        useAppStore.setState({ isDraggingGlobal: true });
        const pos = { x: 1900, y: 1000 };
        useAppStore.getState().setSidebarPosition(pos);
        emit(FHD_125);
        expect(useAppStore.getState().sidebarPosition).toBe(pos);
    });

    it('does nothing on macOS', () => {
        start();
        useAppStore.setState({ isMac: true });
        const pos = { x: 1900, y: 1000 };
        useAppStore.getState().setSidebarPosition(pos);
        const bounds = useAppStore.getState().screenBounds;
        emit(FHD_125);
        expect(useAppStore.getState().sidebarPosition).toBe(pos);
        expect(useAppStore.getState().screenBounds).toBe(bounds);
    });

    it('ignores an invalid geometry event (keeps the previous geometry and the positions)', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        start();
        const pos = { x: 1900, y: 1000 };
        useAppStore.getState().setSidebarPosition(pos);
        emit({ ...FHD_125, workArea: { x: 0, y: 0, width: Number.NaN, height: 10 } });
        expect(useAppStore.getState().sidebarPosition).toBe(pos);
        expect(getWindowGeometry().width).toBe(1920);
    });

    it('stops reacting after uninstall', () => {
        start();
        uninstall?.();
        uninstall = null;
        const pos = { x: 1900, y: 1000 };
        useAppStore.getState().setSidebarPosition(pos);
        emit(FHD_125);
        expect(useAppStore.getState().sidebarPosition).toBe(pos);
    });

    it('applyWindowGeometryChange without a previous geometry only clamps', () => {
        useAppStore.getState().setSidebarPosition({ x: 1900, y: 0 });
        applyWindowGeometryChange(FHD_125, null);
        expect(useAppStore.getState().sidebarPosition).toEqual({ x: 1536 - 64, y: 0 });
    });
});

describe('setMiniMode edge choice uses the visible area off macOS (T-322)', () => {
    afterEach(() => {
        resetWindowGeometryCacheForTests();
        useAppStore.setState(initial, true);
    });

    it('vertical: the bar left of the visible centre docks left, right of it docks right', () => {
        resetWindowGeometryCacheForTests();
        installWindowApiMock().getWindowGeometry.mockReturnValue(FHD_TASKBAR_LEFT);
        useAppStore.setState({ isMac: false, orientation: 'vertical', sidebarWidth: 64, iconScale: 1, lastSidebarHeight: 400 });
        // Visible centre x = 80 + 920 = 1000; the window centre (960) would say "right" for x = 980.
        useAppStore.getState().setMiniMode(false, { x: 980, y: 500 });
        expect(useAppStore.getState().edgePosition).toBe('left');
        useAppStore.getState().setMiniMode(false, { x: 1040, y: 500 });
        expect(useAppStore.getState().edgePosition).toBe('right');
    });

    it('horizontal: compares with the visible vertical centre (taskbar at the top)', () => {
        resetWindowGeometryCacheForTests();
        installWindowApiMock().getWindowGeometry.mockReturnValue(FHD_TASKBAR_TOP);
        useAppStore.setState({ isMac: false, orientation: 'horizontal', sidebarWidth: 64, iconScale: 1, lastSidebarWidth: 600 });
        // Visible centre y = 40 + 520 = 560; the bar centre lands at the eye's y.
        useAppStore.getState().setMiniMode(false, { x: 900, y: 550 });
        expect(useAppStore.getState().edgePosition).toBe('top');
        useAppStore.getState().setMiniMode(false, { x: 900, y: 570 });
        expect(useAppStore.getState().edgePosition).toBe('bottom');
    });

    it('macOS keeps the old screenBounds-based centre', () => {
        resetWindowGeometryCacheForTests();
        installWindowApiMock().getWindowGeometry.mockReturnValue(FHD_TASKBAR_LEFT);
        useAppStore.setState({
            isMac: true,
            orientation: 'vertical',
            sidebarWidth: 64,
            iconScale: 1,
            screenBounds: { x: 0, y: 0, width: 1920, height: 1040 },
        });
        useAppStore.getState().setMiniMode(false, { x: 980, y: 500 });
        expect(useAppStore.getState().edgePosition).toBe('right');
    });
});

describe('edge-changed after a re-fit (T-322 review)', () => {
    const WS_ID = 'ws-1';
    const persistedEdge = () => {
        const partialize = useAppStore.persist.getOptions().partialize!;
        const saved = partialize(useAppStore.getState()) as {
            edgePosition?: string;
            workspaces?: Array<{ id: string; edgePosition?: string }>;
        };
        return { edge: saved.edgePosition, workspaceEdge: saved.workspaces?.find((w) => w.id === WS_ID)?.edgePosition };
    };

    function setupWorkspace(orientation: 'vertical' | 'horizontal', edgePosition: 'right' | 'bottom') {
        useAppStore.setState({
            isMac: false,
            isDraggingGlobal: false,
            isMiniMode: false,
            orientation,
            edgePosition,
            sidebarWidth: 64,
            lastSidebarHeight: 400,
            lastSidebarWidth: 600,
            screenBounds: { x: 0, y: 0, width: 1920, height: 1040 },
            activeWorkspaceId: WS_ID,
            workspaces: [{ ...(useAppStore.getState().workspaces[0] ?? {}), id: WS_ID, edgePosition } as never],
        });
    }

    beforeEach(() => resetWindowGeometryCacheForTests());
    afterEach(() => {
        uninstall?.();
        uninstall = null;
        resetWindowGeometryCacheForTests();
        useAppStore.setState(initial, true);
    });

    it('Windows: a right-snapped vertical bar stays right when main reports edge "left" after a scale change', () => {
        start();
        setupWorkspace('vertical', 'right');
        useAppStore.getState().setSidebarPosition({ x: 1920 - 64, y: 20 });
        const before = persistedEdge();
        emit(FHD_125);
        applyEdgeChanged('left', FHD_125.workArea);
        expect(useAppStore.getState().edgePosition).toBe('right');
        expect(useAppStore.getState().sidebarPosition).toEqual({ x: 1536 - 64, y: 20 });
        expect(useAppStore.getState().screenBounds).toEqual(FHD_125.workArea);
        expect(persistedEdge()).toEqual(before);
        expect(before).toEqual({ edge: 'right', workspaceEdge: 'right' });
    });

    it('Windows: a bottom-snapped horizontal bar stays bottom', () => {
        start();
        setupWorkspace('horizontal', 'bottom');
        useAppStore.getState().setSidebarPosition({ x: 300, y: 1040 - 64 });
        emit(FHD_TASKBAR_TOP);
        applyEdgeChanged('left', FHD_TASKBAR_TOP.workArea);
        expect(useAppStore.getState().edgePosition).toBe('bottom');
        expect(useAppStore.getState().sidebarPosition).toEqual({ x: 300, y: 1080 - 64 });
        expect(persistedEdge()).toEqual({ edge: 'bottom', workspaceEdge: 'bottom' });
    });

    it('macOS / Linux keep taking the edge from main', () => {
        for (const platform of ['darwin', 'linux']) {
            installWindowApiMock().getPlatform.mockReturnValue(platform);
            setupWorkspace('vertical', 'right');
            applyEdgeChanged('left', { x: 0, y: 0, width: 1440, height: 900 });
            expect(useAppStore.getState().edgePosition, platform).toBe('left');
            expect(useAppStore.getState().screenBounds, platform).toEqual({ x: 0, y: 0, width: 1440, height: 900 });
        }
    });

    it('App routes edge-changed through applyEdgeChanged', () => {
        const app = readFileSync(resolve(__dirname, '../src/App.tsx'), 'utf8');
        expect(app).toMatch(/onEdgeChanged\(\(edge, bounds\) => applyEdgeChanged\(edge, bounds\)\)/);
        expect(app).not.toMatch(/setEdgePosition\(edge\)/);
    });
});

describe('drop handlers always end the drag; docked placement is held during a drag (T-322 review)', () => {
    const code = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');

    it('Sidebar: the drop maths is in try/catch and the three flags are cleared after it', () => {
        const source = code('../src/components/layout/Sidebar.tsx');
        const end = source.slice(source.indexOf('const handleSidebarDragEnd'), source.indexOf('let unsubscribeGeometry'));
        expect(end).toMatch(
            /setSidebarPosition\(pos\);\s*\} catch \(err\) \{[^}]*\}\s*(\/\/.*\s*)*setIsSidebarDragging\(false\);\s*setIsResizingGlobal\(false\);\s*useAppStore\.getState\(\)\.setIsDraggingGlobal\(false\);/
        );
    });

    it('FloatingEye: flags cleared before the await, isDraggingGlobal after the committed drop (also after a failure)', () => {
        const source = code('../src/components/layout/FloatingEye.tsx');
        const up = source.slice(source.indexOf('const handleMouseUp'), source.indexOf('let unsubscribeGeometry'));
        expect(up.indexOf('setIsDragging(false)')).toBeLessThan(up.indexOf('await'));
        expect(up.indexOf('setIsResizingGlobal(false)')).toBeLessThan(up.indexOf('await'));
        expect(up).toMatch(
            /setMiniMode\(true, finalPos\);\s*\}\s*\} catch \(err\) \{[^}]*\}\s*(\/\/.*\s*)*useAppStore\.getState\(\)\.setIsDraggingGlobal\(false\);/
        );
    });

    it('App holds the docked area while isDraggingGlobal', () => {
        const app = code('../src/App.tsx');
        expect(app).toContain('const dockArea = isDraggingGlobal ? heldDockArea : visibleArea;');
        expect(app).not.toMatch(/left: `\$\{visibleArea\./);
    });
});
