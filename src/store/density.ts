// T-602 (v27): the density model (compact / normal / comfortable) and its v1 view (`sidebarWidth`). Pure: no store or
// DOM access.
//
// `density` is the source of truth for the new UI (root `data-density`, App.tsx). The v1 field `sidebarWidth` stays
// persisted and readable (plugins read it; the old Sidebar still renders from it until T-618) and
// is kept CONSISTENT with `density`: `densityFromSidebarWidth(sidebarWidth)` equals `density`. A width that already
// describes the density is kept as it is (e.g. 46 stays 46 for 'normal'). `iconScale`, `featureSpacing` and
// `toggleWidth` have no density counterpart and are left alone (see src/store/migrations/v27.ts).

export type Density = 'compact' | 'normal' | 'comfortable';

export const DENSITIES: readonly Density[] = ['compact', 'normal', 'comfortable'];

/** Store default of a fresh install; the default `sidebarWidth` 46 maps to it. */
export const DEFAULT_DENSITY: Density = 'normal';
/** `sidebarWidth` below this is 'compact'. */
export const COMPACT_BELOW = 44;
/** `sidebarWidth` above this is 'comfortable'. */
export const COMFORTABLE_ABOVE = 52;
/** v1 `sidebarWidth` written when a density is chosen and the stored width does not describe it (= --kb-bar-thickness). */
export const SIDEBAR_WIDTH_FOR_DENSITY: Readonly<Record<Density, number>> = Object.freeze({
    compact: 40,
    normal: 48,
    comfortable: 56,
});
/** Store default of `sidebarWidth`, used for a missing value exactly like the store did. */
export const DEFAULT_SIDEBAR_WIDTH = 46;

export const isDensity = (value: unknown): value is Density =>
    typeof value === 'string' && (DENSITIES as readonly string[]).includes(value);

/** Density for a `sidebarWidth` (same rules as the v27 migration; missing or invalid -> 'normal'). */
export function densityFromSidebarWidth(sidebarWidth: unknown): Density {
    if (typeof sidebarWidth !== 'number' || !Number.isFinite(sidebarWidth)) return DEFAULT_DENSITY;
    if (sidebarWidth < 10 || sidebarWidth > 1000) return DEFAULT_DENSITY;
    if (sidebarWidth < COMPACT_BELOW) return 'compact';
    if (sidebarWidth > COMFORTABLE_ABOVE) return 'comfortable';
    return 'normal';
}

/** The v1 width view of `density`; a width that already describes it is kept. */
export function legacySidebarWidth(density: Density, current: unknown): number {
    const width = typeof current === 'number' && Number.isFinite(current) ? current : DEFAULT_SIDEBAR_WIDTH;
    return densityFromSidebarWidth(width) === density ? width : SIDEBAR_WIDTH_FOR_DENSITY[density];
}

/** Density of a stored profile (top level or workspace record): its valid `density`, else derived from `sidebarWidth`. */
export function profileDensity(profile: { density?: unknown; sidebarWidth?: unknown }): Density {
    return isDensity(profile.density) ? profile.density : densityFromSidebarWidth(profile.sidebarWidth);
}
