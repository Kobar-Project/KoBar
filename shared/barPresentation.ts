// KoBar Canlı: bar presentation contract (additive to plugin API v1). Types shared by the renderer, the main process
// (manifest validation) and the plugin docs. `render` returns `unknown` here so no React types leak into the Electron
// build; the renderer narrows it to a React node.

export type BarItemSize = 'icon' | 'tile';

export const BAR_TILE_TEMPLATES = ['value-caption', 'ring', 'level', 'meter', 'badge', 'custom'] as const;
export type TileTemplate = (typeof BAR_TILE_TEMPLATES)[number];

export const BAR_TONES = ['default', 'attention', 'error'] as const;
export type BarTone = (typeof BAR_TONES)[number];

/** Declarative part: manifest.json `bar.tile`, and the optional `tile` field of registerSidebarButton. */
export interface TileDeclaration {
    /** Absent = host "label" template. */
    template?: TileTemplate;
    /** Hide values in privacy mode and from names/tooltips then. */
    sensitive?: boolean;
    /** Value changes on its own (timer, player): heartbeat + pause hints. */
    live?: boolean;
    /** ring only: may be pinned around the mini-mode orb. */
    pinnable?: boolean;
    /** template 'custom' only. Presentational content inside the host's tile button (a React node). */
    render?: (ctx: CustomTileContext) => unknown;
}

export interface ManifestBarBlock {
    tile?: Omit<TileDeclaration, 'render'>;
    /** Suggestion for fresh installs only; the user's choice always wins. */
    defaultSize?: BarItemSize;
}

/** Dynamic part: KoBarExtensions.setBarItemState(id, state). */
export interface BarItemState {
    /** Required. Full sentence used as accessible name and tooltip. At most 80 characters. */
    label: string;
    /** value-caption / ring / meter: at most 5 visible characters. */
    value?: string;
    /** value-caption: at most 4 characters, drawn in --kb-accent-text. */
    caption?: string;
    /** value-caption: at most 4 characters. */
    sub?: string;
    /** ring (and the mini-orb ring): 0 to 1. */
    progress?: number;
    /** level: 3 to 5 values, 0 to 1. */
    levels?: number[];
    /** level: animate only while true (and visible, and motion allowed). */
    playing?: boolean;
    /** meter: total at most 12; `next` = index of the slot that fills next. */
    slots?: { filled: number; total: number; next?: number };
    /** badge template and any icon-mode item. 0 hides; more than 99 renders "99+". */
    badge?: number | 'dot';
    tone?: BarTone;
    /** Material Symbols name overriding the button icon (e.g. 'pause'). */
    icon?: string;
}

export interface BarItemChange {
    size: BarItemSize;
    /** false while the window is hidden, in mini mode, or (for sensitive tiles) in privacy mode. */
    visible: boolean;
    privacy: boolean;
    /** UI language, e.g. 'tr'. Format values with Intl and this locale. */
    locale: string;
    /** true when the host collapsed the tile to an icon because the bar ran out of room. */
    autoCollapsed: boolean;
}

export interface CustomTileContext {
    width: number;
    height: number;
    scheme: 'dark' | 'light';
    /** Resolved accent hex for the current scheme. Prefer var(--kb-accent) in styles. */
    accent: string;
    reducedMotion: boolean;
    locale: string;
    privacy: boolean;
}

/** Additions to window.KoBarExtensions (v1). */
export interface KoBarExtensionsBarAdditions {
    setBarItemState(id: string, state: BarItemState): void;
    /** Returns an unsubscribe function. Fires immediately once with the current values. */
    onBarItemChange(id: string, listener: (change: BarItemChange) => void): () => void;
}

/** Host-side persisted state (per workspace, beside featureOrder). */
export interface BarPresentationPersisted {
    barItemSizes: Record<string, BarItemSize>;
    barHiddenItems: string[];
}

/** Host limits (enforced). */
export const BAR_LIMITS = {
    valueChars: 5,
    captionChars: 4,
    subChars: 4,
    labelChars: 80,
    maxSlots: 12,
    minLevels: 3,
    maxLevels: 5,
    textUpdatesPerSecond: 1,
    progressUpdatesPerSecond: 4,
    heartbeatMs: 10_000,
    customRenderErrorsPerMinute: 3,
} as const;
