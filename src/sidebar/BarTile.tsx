import { Component, type ComponentPropsWithRef, type ErrorInfo, type ReactNode } from 'react';
import { useBarItem, reportTileRenderError } from '../components/extensions/barPresentation';
import { useAppStore } from '../store/useAppStore';
import { cx, INTERACTIVE } from '../ui/cx';
import { ProgressRing } from '../ui/ProgressRing';
import { SlotMeter } from '../ui/SlotMeter';
import { Tooltip } from '../ui/Tooltip';
import type { BarItemState, CustomTileContext } from '../../shared/barPresentation';
import { tooltipSideForEdge, type BarEdge } from './barEdge';
import { ActiveIndicator, BarBadge, BarGlyph } from './BarItem';

export interface BarTileProps extends Omit<ComponentPropsWithRef<'button'>, 'aria-label' | 'children' | 'id'> {
    /** Button id in the extension registry (also the key of the presentation state). */
    id: string;
    /** Plugin display name: the label template text and the accessible name when no state is available. */
    name: string;
    /** Material Symbols name from the button registration. */
    icon: string;
    active?: boolean;
    privacy?: boolean;
    /** A file is being dragged over the tile (dashed accent outline). */
    dropTarget?: boolean;
    /** Tile edge length in px (density token mirror), passed to custom renderers. */
    tileSize: number;
    /** The tile opens a panel: advertises it to assistive technology. */
    opensPanel?: boolean;
    edge: BarEdge;
    orientation: 'vertical' | 'horizontal';
    tooltipDisabled?: boolean;
}

function prefersReducedMotion(): boolean {
    return (
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
}

function customContext(tileSize: number, privacy: boolean, locale: string): CustomTileContext {
    const root = typeof document !== 'undefined' ? document.documentElement : null;
    const accent = root ? getComputedStyle(root).getPropertyValue('--kb-accent').trim() : '';
    return {
        width: tileSize,
        height: tileSize,
        scheme: root?.dataset.scheme === 'light' ? 'light' : 'dark',
        accent,
        reducedMotion: prefersReducedMotion(),
        locale,
        privacy,
    };
}

/** A throwing custom renderer is reported to the host (3 errors in a minute disable it) and replaced by the label template. */
class TileErrorBoundary extends Component<{ id: string; fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch(error: Error, info: ErrorInfo) {
        console.warn(`[KoBar] custom tile "${this.props.id}" failed to render:`, error, info.componentStack);
        reportTileRenderError(this.props.id);
    }
    render() {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}

function LabelBody({ name, glyph, active, showName }: { name: string; glyph: string; active?: boolean; showName: boolean }) {
    return (
        <>
            <BarGlyph name={glyph} filled={active} size="24px" className={active ? 'text-[var(--kb-accent)]' : 'text-fg-2'} />
            {/* Several words wrap to two lines ("Screenshot Studio"); a single long word stays on one line with an ellipsis,
                never split mid-word. The full name is the accessible name and tooltip. */}
            {showName && (
                <span
                    className={cx(
                        'max-w-[calc(100%-8px)] text-center text-[0.6875rem] leading-3 font-semibold text-fg-2',
                        /\s/.test(name.trim()) ? 'line-clamp-2' : 'truncate'
                    )}
                >
                    {name}
                </span>
            )}
        </>
    );
}

function TemplateBody({
    template,
    state,
    name,
    glyph,
    active,
}: {
    template: string;
    state: BarItemState | null;
    name: string;
    glyph: string;
    active?: boolean;
}) {
    if (template === 'value-caption' && state) {
        return (
            <>
                {state.caption && (
                    <span className="text-[0.6875rem] leading-3 font-bold text-[var(--kb-accent-text)]">{state.caption}</span>
                )}
                <span data-tile-value="" className="kb-num font-[var(--kb-font-display)] text-2xl leading-none font-semibold">
                    {state.value}
                </span>
                {state.sub && <span className="text-[0.6875rem] leading-3 font-semibold text-fg-2">{state.sub}</span>}
            </>
        );
    }
    if (template === 'ring' && state) {
        return (
            <>
                <ProgressRing value={state.progress ?? 0} size="tile" className="absolute" />
                {state.value ? (
                    <span
                        data-tile-value=""
                        className="kb-num relative font-[var(--kb-font-display)] text-[0.8125rem] leading-none font-bold"
                    >
                        {state.value}
                    </span>
                ) : (
                    // An idle timer sends no value yet: its icon sits inside the empty ring.
                    <BarGlyph name={glyph} filled={active} size="20px" className="relative text-fg-2" />
                )}
            </>
        );
    }
    // Bars while playing, or while paused with visible heights; at rest (no levels or near-zero ones) the icon reads better
    // than five 4 px dots.
    if (template === 'level' && state && (state.levels ?? []).length > 0 && (state.playing || (state.levels ?? []).some((v) => v > 0.25))) {
        return (
            <span className="flex h-6 items-end gap-1" aria-hidden="true" data-tile-value="">
                {(state.levels ?? []).slice(0, 5).map((v, i) => (
                    <i
                        key={i}
                        className="block w-[5px] rounded-[3px] bg-[var(--kb-accent)]"
                        style={{ height: `${Math.max(4, Math.min(1, Math.max(0, v)) * 24)}px` }}
                    />
                ))}
            </span>
        );
    }
    if (template === 'meter' && state) {
        return (
            <>
                <span className="flex items-center gap-[3px]">
                    <BarGlyph name={glyph} size="1rem" className="text-fg-2" />
                    <span data-tile-value="" className="kb-num font-[var(--kb-font-display)] text-[0.8125rem] leading-none font-bold">
                        {state.value}
                    </span>
                </span>
                {state.slots && (
                    <span className="w-11" data-tile-value="">
                        <SlotMeter total={state.slots.total} filled={state.slots.filled} showNext={state.slots.next !== undefined} />
                    </span>
                )}
            </>
        );
    }
    return <LabelBody name={name} glyph={glyph} active={active} showName={template === 'label'} />;
}

/**
 * Wide-bar tile: one square block that shows the plugin's live state through a host template (value-caption, ring,
 * level, meter, badge, label) or a plugin-drawn custom body. Without state, in privacy mode (sensitive tiles) or when a
 * custom body is disabled it falls back to the label template. A stale live tile is greyed. The accessible name is the
 * plugin's sentence (never announced live).
 */
export function BarTile({
    id,
    name,
    icon,
    active,
    privacy = false,
    dropTarget,
    tileSize,
    opensPanel = true,
    edge,
    orientation,
    tooltipDisabled,
    className,
    type = 'button',
    ...rest
}: BarTileProps) {
    const { declaration, state, stale, customDisabled } = useBarItem(id);
    const hidden = privacy && !!declaration.sensitive;
    const wanted = hidden || !state ? 'label' : (declaration.template ?? 'label');
    const template = wanted === 'custom' && (customDisabled || !declaration.render) ? 'label' : wanted;
    const label = hidden ? name : (state?.label ?? name);
    const glyph = hidden ? icon : (state?.icon ?? icon);
    const locale = useAppStore((s) => s.language);

    const fallback = <LabelBody name={name} glyph={glyph} active={active} showName />;

    return (
        <Tooltip content={label} side={tooltipSideForEdge(edge)} disabled={tooltipDisabled} describe={false}>
            <button
                {...rest}
                type={type}
                data-bar-item=""
                data-bar-tile=""
                data-template={template}
                data-tile-sensitive={declaration.sensitive ? '' : undefined}
                data-tile-live={declaration.live && state?.playing ? '' : undefined}
                data-stale={stale ? '' : undefined}
                data-state={state?.tone === 'error' ? 'error' : undefined}
                aria-label={label}
                aria-pressed={active}
                aria-haspopup={opensPanel ? 'dialog' : undefined}
                data-active={active ? 'true' : undefined}
                className={cx(
                    INTERACTIVE,
                    'relative flex size-[var(--kb-tile)] shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg',
                    'transition-colors duration-[var(--kb-dur-fast)]',
                    active
                        ? 'bg-[var(--kb-bg-container)] text-[var(--kb-on-container)]'
                        : 'bg-[var(--kb-bg-tile)] text-fg-1 hover:bg-[color-mix(in_srgb,var(--kb-fg-1)_6%,var(--kb-bg-tile))]',
                    dropTarget && 'bg-[var(--kb-bg-container)] outline-2 -outline-offset-2 outline-[var(--kb-accent)] outline-dashed',
                    state?.tone === 'error' && !active && 'text-[var(--kb-danger)]',
                    className
                )}
            >
                {active && <ActiveIndicator orientation={orientation} edge={edge} length={24} outset="calc(1px - var(--kb-bar-pad))" />}
                <span
                    data-tile-body=""
                    className={cx(
                        'pointer-events-none flex size-full flex-col items-center justify-center gap-0.5',
                        stale && 'opacity-50 grayscale'
                    )}
                >
                    {template === 'custom' && declaration.render ? (
                        <span className="absolute inset-0 overflow-hidden rounded-[inherit] [contain:strict]">
                            <TileErrorBoundary id={id} fallback={fallback}>
                                {declaration.render(customContext(tileSize, privacy, locale)) as ReactNode}
                            </TileErrorBoundary>
                        </span>
                    ) : (
                        <TemplateBody template={template} state={state} name={name} glyph={glyph} active={active} />
                    )}
                </span>
                {!hidden && <BarBadge value={state?.badge} />}
            </button>
        </Tooltip>
    );
}
