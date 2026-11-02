// Canlı bar presentation (plugin API v1 additions), host side.
//
// The registry (extensionRegistry.ts) exposes setBarItemState / onBarItemChange to plugins and forwards registrations
// here. The bar reads everything through `useBarItem(id)` and feeds the host facts back with `setBarHostContext` and
// `setBarItemPresentation`. None of the host-only functions below is reachable from window.KoBarExtensions.
//
// There is no isolation in v1: setBarItemState has no ownership check, a plugin could set another plugin's state.
import { useSyncExternalStore } from 'react';
import { cleanTileFields, isBarItemSize, sanitizeBarBlock } from '../../../shared/barManifest';
import {
    BAR_LIMITS,
    BAR_TONES,
    type BarItemChange,
    type BarItemSize,
    type BarItemState,
    type ManifestBarBlock,
    type TileDeclaration,
} from '../../../shared/barPresentation';

export type { BarItemChange, BarItemSize, BarItemState, ManifestBarBlock, TileDeclaration };

/** What the bar renders a tile from. Stable object identity until something changes. */
export interface BarItemSnapshot {
    /** Effective declaration: registration `tile` over the manifest `bar.tile`. */
    declaration: TileDeclaration;
    /** Last applied (sanitised, throttled) state; null until the plugin called setBarItemState. */
    state: BarItemState | null;
    /** A `live` tile that was visible and got no update for BAR_LIMITS.heartbeatMs: show the last value greyed. */
    stale: boolean;
    /** Custom render threw too often: draw the label template instead for the rest of the session. */
    customDisabled: boolean;
    /** Host facts (set with setBarItemPresentation / setBarHostContext), repeated here for convenience. */
    size: BarItemSize;
    autoCollapsed: boolean;
    visible: boolean;
}

export interface BarHostContext {
    privacy: boolean;
    locale: string;
    barVisible: boolean;
}

const TEXT_INTERVAL_MS = 1000 / BAR_LIMITS.textUpdatesPerSecond;
const FAST_INTERVAL_MS = 1000 / BAR_LIMITS.progressUpdatesPerSecond;
const ERROR_WINDOW_MS = 60_000;
const ELLIPSIS = '…';
const PLACEHOLDER = '—';
const MAX_ICON_NAME = 64;

const isDev = (): boolean => {
    try {
        return !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;
    } catch {
        return false;
    }
};

// ---- Sanitising ---------------------------------------------------------------------------------------------------

type Warn = (field: string, message: string) => void;

const segmenter: { segment(s: string): Iterable<unknown> } | null =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
        ? new (Intl as unknown as { Segmenter: new (l?: string, o?: object) => { segment(s: string): Iterable<unknown> } }).Segmenter(
              undefined,
              { granularity: 'grapheme' }
          )
        : null;

/** A grapheme is a bounded number of UTF-16 units: over-long input is rejected or cut before segmenting (a plugin may pass megabytes). */
const MAX_UNITS_PER_GRAPHEME = 16;

function graphemes(text: string): string[] {
    if (!segmenter) return Array.from(text);
    return Array.from(segmenter.segment(text), (s) => (s as { segment: string }).segment);
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function shortText(raw: unknown, max: number, field: string, warn: Warn): string | undefined {
    if (raw === undefined || raw === null) return undefined;
    const text = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : raw;
    if (typeof text !== 'string') {
        warn(field, `"${field}" must be a string; ignored.`);
        return undefined;
    }
    if (text === '') return undefined;
    if (text.length > max * MAX_UNITS_PER_GRAPHEME || graphemes(text).length > max) {
        warn(field, `"${field}" is longer than ${max} characters; the tile shows "${PLACEHOLDER}".`);
        return PLACEHOLDER;
    }
    return text;
}

/** Turns what a plugin passed into a valid BarItemState, or null when it is unusable (no label). */
export function sanitizeBarItemState(raw: unknown, warn: Warn = () => undefined): BarItemState | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        warn('state', 'setBarItemState needs a state object; ignored.');
        return null;
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.label !== 'string' || r.label.trim() === '') {
        warn('label', '"label" is required (a full sentence used as accessible name); the update is ignored.');
        return null;
    }
    let label = r.label;
    const maxUnits = BAR_LIMITS.labelChars * MAX_UNITS_PER_GRAPHEME;
    const bounded = label.length > maxUnits ? label.slice(0, maxUnits) : label;
    const labelChars = graphemes(bounded);
    if (labelChars.length > BAR_LIMITS.labelChars || bounded !== label) {
        warn('label', `"label" is longer than ${BAR_LIMITS.labelChars} characters; cut.`);
        label = labelChars.slice(0, BAR_LIMITS.labelChars - 1).join('') + ELLIPSIS;
    }
    const state: BarItemState = { label };

    const value = shortText(r.value, BAR_LIMITS.valueChars, 'value', warn);
    if (value !== undefined) state.value = value;
    const caption = shortText(r.caption, BAR_LIMITS.captionChars, 'caption', warn);
    if (caption !== undefined) state.caption = caption;
    const sub = shortText(r.sub, BAR_LIMITS.subChars, 'sub', warn);
    if (sub !== undefined) state.sub = sub;

    if (r.progress !== undefined) {
        if (typeof r.progress === 'number' && Number.isFinite(r.progress)) state.progress = clamp01(r.progress);
        else warn('progress', '"progress" must be a finite number; ignored.');
    }
    if (r.levels !== undefined) {
        const ok =
            Array.isArray(r.levels) &&
            r.levels.length >= BAR_LIMITS.minLevels &&
            r.levels.length <= BAR_LIMITS.maxLevels &&
            r.levels.every((n) => typeof n === 'number' && Number.isFinite(n));
        if (ok) state.levels = (r.levels as number[]).map(clamp01);
        else warn('levels', `"levels" needs ${BAR_LIMITS.minLevels} to ${BAR_LIMITS.maxLevels} numbers; ignored.`);
    }
    if (r.playing !== undefined) {
        if (typeof r.playing === 'boolean') state.playing = r.playing;
        else warn('playing', '"playing" must be true or false; ignored.');
    }
    if (r.slots !== undefined) {
        const s = r.slots as Record<string, unknown> | null;
        if (
            s &&
            typeof s === 'object' &&
            typeof s.total === 'number' &&
            typeof s.filled === 'number' &&
            Number.isFinite(s.total) &&
            Number.isFinite(s.filled)
        ) {
            const total = Math.min(BAR_LIMITS.maxSlots, Math.max(0, Math.floor(s.total)));
            if (s.total > BAR_LIMITS.maxSlots) warn('slots', `"slots.total" is above ${BAR_LIMITS.maxSlots}; clamped.`);
            const slots: NonNullable<BarItemState['slots']> = {
                total,
                filled: Math.min(total, Math.max(0, Math.floor(s.filled))),
            };
            if (typeof s.next === 'number' && Number.isFinite(s.next)) {
                slots.next = Math.min(Math.max(0, total - 1), Math.max(0, Math.floor(s.next)));
            }
            state.slots = slots;
        } else warn('slots', '"slots" needs numeric "filled" and "total"; ignored.');
    }
    if (r.badge !== undefined) {
        if (r.badge === 'dot') state.badge = 'dot';
        else if (typeof r.badge === 'number' && Number.isFinite(r.badge) && r.badge >= 0) state.badge = Math.floor(r.badge);
        else warn('badge', '"badge" must be a number of 0 or more, or "dot"; ignored.');
    }
    if (r.tone !== undefined) {
        if ((BAR_TONES as readonly string[]).includes(r.tone as string)) state.tone = r.tone as BarItemState['tone'];
        else warn('tone', '"tone" must be "default", "attention" or "error"; ignored.');
    }
    if (r.icon !== undefined) {
        if (typeof r.icon === 'string' && r.icon !== '' && r.icon.length <= MAX_ICON_NAME) state.icon = r.icon;
        else warn('icon', '"icon" must be a Material Symbols name; ignored.');
    }
    return state;
}

/** Effective tile declaration from a manifest `bar.tile` and a registration `tile` (registration wins per field). */
export function mergeTileDeclaration(manifestTile: unknown, registrationTile: unknown): TileDeclaration {
    const clean = (input: unknown): TileDeclaration => {
        if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
        const fields = input as Record<string, unknown>;
        const sink: string[] = [];
        const tile: TileDeclaration = cleanTileFields(fields, sink, 'tile');
        if (typeof fields.render === 'function') tile.render = fields.render as TileDeclaration['render'];
        return tile;
    };
    const merged = { ...clean(manifestTile), ...clean(registrationTile) };
    // A custom template without a render function cannot draw anything: the host label template is used.
    if (merged.template === 'custom' && typeof merged.render !== 'function') delete merged.template;
    if (merged.template !== 'custom') delete merged.render;
    return merged;
}

// ---- Store --------------------------------------------------------------------------------------------------------

interface Entry {
    owner: string | null;
    registrationTile: unknown;
    declaration: TileDeclaration;
    applied: BarItemState | null;
    desired: BarItemState | null;
    lastTextAt: number;
    lastFastAt: number;
    throttleTimer: ReturnType<typeof setTimeout> | null;
    lastUpdateAt: number;
    stale: boolean;
    heartbeatTimer: ReturnType<typeof setTimeout> | null;
    errorTimes: number[];
    customDisabled: boolean;
    visible: boolean;
    lastChange: BarItemChange | null;
    changeListeners: Set<(change: BarItemChange) => void>;
    storeListeners: Set<() => void>;
    snapshot: BarItemSnapshot | null;
}

const entries = new Map<string, Entry>();
/** Per plugin id: the cleaned manifest `bar` block. */
const manifestBars = new Map<string, ManifestBarBlock>();
/** Host facts per item id; they outlive registry clears (the bar keeps feeding them). */
const presentation = new Map<string, { size: BarItemSize; autoCollapsed: boolean }>();
let hostContext: BarHostContext = { privacy: false, locale: 'en', barVisible: true };

const warned = new Set<string>();
function warnOnce(id: string, field: string, message: string): void {
    if (!isDev()) return;
    const key = `${id}|${field}`;
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`[KoBar bar] "${id}": ${message}`);
}

/**
 * Upper bound for items that exist only because a plugin called setBarItemState / onBarItemChange with an id no button
 * uses (arbitrary ids, or a removed plugin's timer) — they must not grow the map without limit.
 */
const MAX_UNREGISTERED_ENTRIES = 256;

function getEntry(id: string): Entry;
function getEntry(id: string, registered: boolean): Entry | null;
function getEntry(id: string, registered = true): Entry | null {
    let e = entries.get(id);
    if (!e) {
        if (!registered && entries.size >= MAX_UNREGISTERED_ENTRIES) return null;
        e = {
            owner: null,
            registrationTile: undefined,
            declaration: {},
            applied: null,
            desired: null,
            lastTextAt: -Infinity,
            lastFastAt: -Infinity,
            throttleTimer: null,
            lastUpdateAt: 0,
            stale: false,
            heartbeatTimer: null,
            errorTimes: [],
            customDisabled: false,
            visible: false,
            lastChange: null,
            changeListeners: new Set(),
            storeListeners: new Set(),
            snapshot: null,
        };
        e.visible = computeVisible(e);
        entries.set(id, e);
    }
    return e;
}

function computeVisible(e: Entry): boolean {
    return hostContext.barVisible && !(hostContext.privacy && e.declaration.sensitive === true);
}

function computeDeclaration(e: Entry): TileDeclaration {
    const manifestTile = e.owner ? manifestBars.get(e.owner)?.tile : undefined;
    return mergeTileDeclaration(manifestTile, e.registrationTile);
}

function sameDeclaration(a: TileDeclaration, b: TileDeclaration): boolean {
    return (
        a.template === b.template && a.sensitive === b.sensitive && a.live === b.live && a.pinnable === b.pinnable && a.render === b.render
    );
}

function changeFor(e: Entry, id: string): BarItemChange {
    const p = presentation.get(id);
    return {
        size: p?.size ?? 'icon',
        visible: e.visible,
        privacy: hostContext.privacy,
        locale: hostContext.locale,
        autoCollapsed: p?.autoCollapsed ?? false,
    };
}

const sameChange = (a: BarItemChange, b: BarItemChange) =>
    a.size === b.size && a.visible === b.visible && a.privacy === b.privacy && a.locale === b.locale && a.autoCollapsed === b.autoCollapsed;

function callListener(listener: (change: BarItemChange) => void, change: BarItemChange): void {
    try {
        listener({ ...change });
    } catch (err) {
        console.error('[KoBar bar] onBarItemChange listener threw:', err);
    }
}

function buildSnapshot(id: string, e: Entry): BarItemSnapshot {
    const p = presentation.get(id);
    return {
        declaration: e.declaration,
        state: e.applied,
        stale: e.stale,
        customDisabled: e.customDisabled,
        size: p?.size ?? 'icon',
        autoCollapsed: p?.autoCollapsed ?? false,
        visible: e.visible,
    };
}

/** Rebuilds the snapshot when something visible changed, then tells store subscribers and change listeners. */
function refresh(id: string, e: Entry): void {
    const prev = e.snapshot;
    const next = buildSnapshot(id, e);
    const snapshotChanged =
        !prev ||
        prev.declaration !== next.declaration ||
        prev.state !== next.state ||
        prev.stale !== next.stale ||
        prev.customDisabled !== next.customDisabled ||
        prev.size !== next.size ||
        prev.autoCollapsed !== next.autoCollapsed ||
        prev.visible !== next.visible;
    if (snapshotChanged) {
        e.snapshot = next;
        e.storeListeners.forEach((l) => l());
    }
    const change = changeFor(e, id);
    if (!e.lastChange || !sameChange(e.lastChange, change)) {
        e.lastChange = change;
        Array.from(e.changeListeners).forEach((l) => callListener(l, change));
    }
}

function armHeartbeat(e: Entry, id: string): void {
    if (e.heartbeatTimer) {
        clearTimeout(e.heartbeatTimer);
        e.heartbeatTimer = null;
    }
    if (!e.declaration.live || !e.visible || !e.applied || e.stale) return;
    const wait = Math.max(0, e.lastUpdateAt + BAR_LIMITS.heartbeatMs - Date.now());
    e.heartbeatTimer = setTimeout(() => {
        e.heartbeatTimer = null;
        if (!e.declaration.live || !e.visible || !e.applied) return;
        e.stale = true;
        refresh(id, e);
    }, wait);
}

const TEXT_KEYS = ['label', 'value', 'caption', 'sub', 'badge', 'icon', 'tone'] as const;

function sameLevels(a?: number[], b?: number[]): boolean {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    return a.every((n, i) => n === b[i]);
}

function diff(from: BarItemState | null, to: BarItemState): { text: boolean; fast: boolean } {
    if (!from) return { text: true, fast: true };
    const text = TEXT_KEYS.some((k) => from[k] !== to[k]);
    const fast =
        from.progress !== to.progress ||
        from.playing !== to.playing ||
        !sameLevels(from.levels, to.levels) ||
        from.slots?.filled !== to.slots?.filled ||
        from.slots?.total !== to.slots?.total ||
        from.slots?.next !== to.slots?.next;
    return { text, fast };
}

/** Applies `e.desired` now or schedules it (latest wins, the final state is never dropped). */
function flush(id: string, e: Entry): void {
    if (e.throttleTimer) {
        clearTimeout(e.throttleTimer);
        e.throttleTimer = null;
    }
    const desired = e.desired;
    if (!desired) return;
    const d = diff(e.applied, desired);
    if (!d.text && !d.fast) {
        e.desired = null;
        return;
    }
    const now = Date.now();
    const allowedAt = Math.max(d.text ? e.lastTextAt + TEXT_INTERVAL_MS : -Infinity, d.fast ? e.lastFastAt + FAST_INTERVAL_MS : -Infinity);
    if (now >= allowedAt) {
        if (d.text) e.lastTextAt = now;
        if (d.fast) e.lastFastAt = now;
        e.applied = desired;
        e.desired = null;
        if (e.stale) e.stale = false;
        refresh(id, e);
        armHeartbeat(e, id);
        return;
    }
    e.throttleTimer = setTimeout(() => {
        e.throttleTimer = null;
        flush(id, e);
    }, allowedAt - now);
}

/**
 * Forgets everything a plugin gave about this item. Entries a mounted bar item still subscribes to are reset in place
 * (so the subscription survives a reload and the same id registering again); the others are deleted.
 */
function dropEntry(id: string, e: Entry): void {
    if (e.throttleTimer) clearTimeout(e.throttleTimer);
    if (e.heartbeatTimer) clearTimeout(e.heartbeatTimer);
    e.throttleTimer = null;
    e.heartbeatTimer = null;
    e.changeListeners.clear();
    e.owner = null;
    e.registrationTile = undefined;
    e.declaration = {};
    e.applied = null;
    e.desired = null;
    e.lastTextAt = -Infinity;
    e.lastFastAt = -Infinity;
    e.stale = false;
    e.errorTimes = [];
    e.customDisabled = false;
    e.visible = computeVisible(e);
    e.lastChange = null;
    if (e.storeListeners.size === 0) entries.delete(id);
    else refresh(id, e);
}

// ---- Plugin-facing operations (called by the registry) -------------------------------------------------------------

/**
 * Registry hook: a sidebar button was (re)registered. `tile` is the plugin-supplied declaration, if any.
 * Never throws: registerSidebarButton could not throw before Canlı, and a hostile `tile` (throwing getter, Proxy) must
 * not leave the registry half-updated.
 */
export function barRegisterButton(id: string, owner: string | null, tile: unknown): void {
    try {
        const e = getEntry(id);
        e.owner = owner;
        e.registrationTile = tile;
        const next = computeDeclaration(e);
        if (!sameDeclaration(next, e.declaration)) e.declaration = next;
        e.visible = computeVisible(e);
        refresh(id, e);
        armHeartbeat(e, id);
    } catch (err) {
        console.error(`[KoBar bar] "${id}": tile declaration ignored:`, err);
    }
}

/** Registry hook: a manifest was registered for plugin `pluginId`. Invalid `bar` blocks are ignored with a warning. Never throws. */
export function barRegisterManifest(pluginId: string, manifest: unknown): void {
    try {
        const raw = manifest && typeof manifest === 'object' ? (manifest as Record<string, unknown>).bar : undefined;
        const { bar, warnings } = sanitizeBarBlock(raw);
        if (warnings.length > 0) warnOnce(pluginId, 'manifest.bar', warnings.join(' '));
        if (bar) manifestBars.set(pluginId, bar);
        else manifestBars.delete(pluginId);
        recomputeDeclarations((e) => e.owner === pluginId);
    } catch (err) {
        console.error(`[KoBar bar] "${pluginId}": manifest bar block ignored:`, err);
    }
}

function recomputeDeclarations(match: (e: Entry) => boolean): void {
    for (const [id, e] of entries) {
        if (!match(e)) continue;
        const next = computeDeclaration(e);
        if (!sameDeclaration(next, e.declaration)) e.declaration = next;
        e.visible = computeVisible(e);
        refresh(id, e);
        armHeartbeat(e, id);
    }
}

/** KoBarExtensions.setBarItemState. Never throws. */
export function barSetItemState(id: string, state: unknown): void {
    try {
        if (typeof id !== 'string' || id === '') return;
        const clean = sanitizeBarItemState(state, (field, message) => warnOnce(id, field, message));
        if (!clean) return;
        const e = getEntry(id, false);
        if (!e) return;
        e.lastUpdateAt = Date.now();
        e.desired = clean;
        if (e.stale) {
            // Any update ends the stale state, even one with unchanged values.
            e.stale = false;
            refresh(id, e);
        }
        flush(id, e);
        armHeartbeat(e, id);
    } catch (err) {
        console.error('[KoBar bar] setBarItemState failed:', err);
    }
}

/** KoBarExtensions.onBarItemChange. Fires once now with the current values, then only when one of them changes. */
export function barOnItemChange(id: string, listener: (change: BarItemChange) => void): () => void {
    if (typeof listener !== 'function' || typeof id !== 'string') return () => undefined;
    const e = getEntry(id, false);
    if (!e) return () => undefined;
    const current = changeFor(e, id);
    e.lastChange = current;
    e.changeListeners.add(listener);
    callListener(listener, current);
    return () => {
        entries.get(id)?.changeListeners.delete(listener);
    };
}

/** Drops presentation state and listeners of every item owned by `extensionId` (and of `itemIds`). */
export function barDropExtension(extensionId: string, itemIds: readonly string[] = []): void {
    for (const [id, e] of Array.from(entries)) {
        if (e.owner !== extensionId && !itemIds.includes(id)) continue;
        dropEntry(id, e);
    }
    manifestBars.delete(extensionId);
}

/** Drops all presentation state and listeners (registry.clear). Host facts (sizes, context) are kept. */
export function barClear(): void {
    for (const [id, e] of Array.from(entries)) dropEntry(id, e);
    manifestBars.clear();
}

// ---- Host-only API (the bar) ---------------------------------------------------------------------------------------

/** Privacy mode, UI language and "bar is on screen" (false while the window is hidden or in mini mode). */
export function setBarHostContext(next: Partial<BarHostContext>): void {
    const merged = { ...hostContext, ...next };
    if (merged.privacy === hostContext.privacy && merged.locale === hostContext.locale && merged.barVisible === hostContext.barVisible)
        return;
    hostContext = merged;
    for (const [id, e] of entries) {
        const wasVisible = e.visible;
        e.visible = computeVisible(e);
        if (e.visible && !wasVisible) {
            // Back on screen: give a live tile a full heartbeat period before it counts as stale.
            e.lastUpdateAt = Date.now();
            e.stale = false;
        }
        if (!e.visible) e.stale = false;
        refresh(id, e);
        armHeartbeat(e, id);
    }
}

/** The user's size choice and whether the bar collapsed the tile to an icon. */
export function setBarItemPresentation(id: string, p: { size: BarItemSize; autoCollapsed?: boolean }): void {
    const prev = presentation.get(id);
    const next = { size: p.size, autoCollapsed: p.autoCollapsed ?? false };
    if (prev && prev.size === next.size && prev.autoCollapsed === next.autoCollapsed) return;
    presentation.set(id, next);
    const e = entries.get(id);
    if (e) refresh(id, e);
}

/** The extension id that registered bar item `buttonId` (recorded at registration), or null if unknown. Host only. */
export function barItemOwner(buttonId: string): string | null {
    return entries.get(buttonId)?.owner ?? null;
}

/** Manifest `bar.defaultSize` of the plugin that registered button `buttonId` (undefined when none or unknown owner). */
export function manifestDefaultSize(buttonId: string): BarItemSize | undefined {
    const owner = entries.get(buttonId)?.owner;
    const size = owner ? manifestBars.get(owner)?.defaultSize : undefined;
    return isBarItemSize(size) ? size : undefined;
}

/** The custom tile threw while rendering. 3 errors within 60 s disable custom render for this item for the session. */
export function reportTileRenderError(id: string): void {
    const e = getEntry(id);
    const now = Date.now();
    e.errorTimes = e.errorTimes.filter((t) => now - t < ERROR_WINDOW_MS);
    e.errorTimes.push(now);
    if (!e.customDisabled && e.errorTimes.length >= BAR_LIMITS.customRenderErrorsPerMinute) {
        e.customDisabled = true;
        refresh(id, e);
    }
}

const EMPTY_SNAPSHOT: BarItemSnapshot = {
    declaration: {},
    state: null,
    stale: false,
    customDisabled: false,
    size: 'icon',
    autoCollapsed: false,
    visible: true,
};

/** useSyncExternalStore-friendly: subscribe to one item. */
export function subscribeBarItem(id: string, listener: () => void): () => void {
    const e = getEntry(id);
    e.storeListeners.add(listener);
    return () => {
        entries.get(id)?.storeListeners.delete(listener);
    };
}

export function getBarItemSnapshot(id: string): BarItemSnapshot {
    const e = entries.get(id);
    if (!e) return EMPTY_SNAPSHOT;
    if (!e.snapshot) e.snapshot = buildSnapshot(id, e);
    return e.snapshot;
}

/** React hook for the bar: everything needed to draw item `id`. */
export function useBarItem(id: string): BarItemSnapshot {
    return useSyncExternalStore(
        (listener) => subscribeBarItem(id, listener),
        () => getBarItemSnapshot(id),
        () => EMPTY_SNAPSHOT
    );
}

/** Test helper: forgets everything including host facts. */
export function resetBarPresentationForTests(): void {
    barClear();
    presentation.clear();
    warned.clear();
    hostContext = { privacy: false, locale: 'en', barVisible: true };
}
