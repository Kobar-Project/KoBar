// T-609: Settings › Sidebar. Density (compact / normal / comfortable), orientation + screen edge, and the order of the bar's
// buttons (`featureOrder`). Like the other pages it reads the main window's settings through the read-only mirror and changes
// them only with allow-listed actions (setDensity / setOrientation / setEdgePosition / setFeatureOrder, src/store/sync.ts).
// `setDensity` keeps the v1 `sidebarWidth` consistent in the store; this page never writes it. There is no "Smart Popup" option.
// The order list is keyboard-first: each row has Move up / Move down buttons and the move is announced in a live region.
// CNL-08 (Canlı): density as OptionTiles with mini bars, an orientation/edge card with a monitor illustration, the order list with a
// per-button size (`barItemSizes`), hidden buttons (`barHiddenItems`) and the notes tab switch (`notesTabVisible`).
import { useId, useState, type DragEvent, type KeyboardEvent } from 'react';
import type { TranslationKeys } from '../../i18n';
import { defaultBarItemSizes, sanitizeBarItemSizes, type BarItemSize } from '../../store/barPresentation';
import { DENSITIES, densityFromSidebarWidth, isDensity, type Density } from '../../store/density';
import { Card, Icon, IconButton, IconTile, OptionTile, Segmented, Surface, Toggle, type SegmentedItem } from '../../ui';
import { moveRovingFocus } from '../../ui/choice';
import { cx } from '../../ui/cx';
import { dispatchSettingsAction, useSettingsState } from '../mirror';
import type { SettingsPageProps } from '../pages';
import { featureLabel, moveItem } from '../sidebarOrder';
import { PAGE_STACK, WaitingNote } from './shared';

type Orientation = 'vertical' | 'horizontal';
type Edge = 'left' | 'right' | 'top' | 'bottom';

const SECTION_LABEL = '[font:var(--kb-type-subtitle)] text-fg-1';
const HINT = '[font:var(--kb-type-caption)] text-fg-2';

export const DENSITY_LABEL_KEYS: Readonly<Record<Density, TranslationKeys>> = Object.freeze({
    compact: 'settingsDensityCompact',
    normal: 'settingsDensityNormal',
    comfortable: 'settingsDensityComfortable',
});

const DENSITY_ICONS: Readonly<Record<Density, string>> = {
    compact: 'density_small',
    normal: 'density_medium',
    comfortable: 'density_large',
};
/** Bar thickness (px) and button count of the density illustrations. */
const DENSITY_ART: Readonly<Record<Density, { thickness: number; gap: number }>> = {
    compact: { thickness: 14, gap: 3 },
    normal: { thickness: 18, gap: 5 },
    comfortable: { thickness: 22, gap: 7 },
};

const EDGE_ITEMS: Readonly<Record<Orientation, readonly { value: Edge; key: TranslationKeys; icon: string }[]>> = {
    vertical: [
        { value: 'left', key: 'settingsEdgeLeft', icon: 'align_horizontal_left' },
        { value: 'right', key: 'settingsEdgeRight', icon: 'align_horizontal_right' },
    ],
    horizontal: [
        { value: 'top', key: 'settingsEdgeTop', icon: 'align_vertical_top' },
        { value: 'bottom', key: 'settingsEdgeBottom', icon: 'align_vertical_bottom' },
    ],
};

const asEdge = (value: unknown, orientation: Orientation): Edge => {
    const allowed = EDGE_ITEMS[orientation].map((i) => i.value);
    return allowed.find((v) => v === value) ?? allowed[allowed.length - 1];
};

/** Density illustration: a bar with three buttons whose size and spacing follow the density. */
function DensityArt({ density }: { density: Density }) {
    const { thickness, gap } = DENSITY_ART[density];
    return (
        <span className="flex items-center rounded-sm bg-surface px-1.5 py-1" style={{ gap }}>
            {[0, 1, 2].map((i) => (
                <span key={i} className="rounded-xs bg-container" style={{ width: thickness, height: thickness }} />
            ))}
        </span>
    );
}

/** Monitor with the bar drawn on the chosen edge. */
function MonitorArt({ orientation, edge }: { orientation: Orientation; edge: Edge }) {
    const horizontal = orientation === 'horizontal';
    const bar = cx(
        'absolute rounded-xs bg-[var(--kb-accent)]',
        horizontal ? 'inset-x-2 h-2' : 'inset-y-2 w-2',
        edge === 'left' && 'start-1.5',
        edge === 'right' && 'end-1.5',
        edge === 'top' && 'top-1.5',
        edge === 'bottom' && 'bottom-1.5'
    );
    const physical = edge === 'left' ? 'left-1.5 right-auto' : edge === 'right' ? 'right-1.5 left-auto' : '';
    return (
        <span aria-hidden="true" data-testid="monitor-art" data-edge={edge} className="flex shrink-0 flex-col items-center gap-1">
            <span className="relative block h-[84px] w-[132px] overflow-hidden rounded-md border-2 border-[var(--kb-fg-3)] bg-inset">
                <span className={cx(bar, physical)} />
            </span>
            <span className="block h-1.5 w-10 rounded-full bg-[var(--kb-fg-3)]" />
        </span>
    );
}

export function SidebarPage({ t }: SettingsPageProps) {
    const ready = useSettingsState((s) => s.status === 'ready' && s.state !== null);
    const state = useSettingsState((s) => s.state);
    const raw = (state ?? {}) as unknown as Partial<Record<string, unknown>>;
    const rawDensity = state?.density;
    const density: Density = isDensity(rawDensity) ? rawDensity : densityFromSidebarWidth(state?.sidebarWidth);
    const orientation: Orientation = state?.orientation === 'horizontal' ? 'horizontal' : 'vertical';
    const edge = asEdge(state?.edgePosition, orientation);
    const rawOrder: unknown = state?.featureOrder;
    const order = Array.isArray(rawOrder) ? rawOrder.filter((id): id is string => typeof id === 'string') : [];
    const sizes = raw.barItemSizes === undefined ? defaultBarItemSizes() : sanitizeBarItemSizes(raw.barItemSizes);
    const notesTabVisible = typeof raw.notesTabVisible === 'boolean' ? raw.notesTabVisible : true;
    // Every enabled button is on the bar (owner decision: no hidden items, no "More" overflow).
    const visible = order;
    const densityLabelId = useId();
    const orientationLabelId = useId();
    const edgeLabelId = useId();
    const orderLabelId = useId();
    const [announcement, setAnnouncement] = useState('');
    const [dragId, setDragId] = useState<string | null>(null);

    const densityFocus = ready ? Math.max(0, DENSITIES.indexOf(density)) : -1;
    const orientationItems: SegmentedItem<Orientation>[] = [
        { value: 'vertical', label: t('settingsOrientationVertical'), icon: 'vertical_split', disabled: !ready },
        { value: 'horizontal', label: t('settingsOrientationHorizontal'), icon: 'horizontal_split', disabled: !ready },
    ];
    const edgeItems: SegmentedItem<Edge>[] = EDGE_ITEMS[orientation].map((i) => ({
        value: i.value,
        label: t(i.key),
        icon: i.icon,
        disabled: !ready,
    }));
    const sizeItems: SegmentedItem<BarItemSize>[] = [
        { value: 'icon', label: t('settingsItemSizeIcon'), disabled: !ready },
        { value: 'tile', label: t('settingsItemSizeTile'), disabled: !ready },
    ];

    const onDensityKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const items = DENSITIES.map((value) => ({ value, label: t(DENSITY_LABEL_KEYS[value]), disabled: !ready }));
        const index = moveRovingFocus(event, items, true);
        if (index !== null && DENSITIES[index] !== density) dispatchSettingsAction('setDensity', DENSITIES[index]);
    };

    /** Moves a visible button `delta` places among the visible ones (hidden buttons keep their place in the stored order). */
    const move = (index: number, delta: number) => {
        if (!ready) return;
        const id = visible[index];
        const neighbour = visible[index + delta];
        if (id === undefined || neighbour === undefined) return;
        const next = moveItem(order, order.indexOf(id), order.indexOf(neighbour) - order.indexOf(id));
        if (dispatchSettingsAction('setFeatureOrder', next) === null) return;
        setAnnouncement(
            t('settingsMovedAnnounce')
                .replace('{name}', featureLabel(id))
                .replace('{position}', String(index + delta + 1))
                .replace('{total}', String(visible.length))
        );
    };

    const onDrop = (event: DragEvent<HTMLElement>, targetIndex: number) => {
        event.preventDefault();
        const from = dragId === null ? -1 : visible.indexOf(dragId);
        setDragId(null);
        if (from >= 0 && from !== targetIndex) move(from, targetIndex - from);
    };

    const setSize = (id: string, size: BarItemSize) => {
        if ((sizes[id] ?? 'icon') !== size) dispatchSettingsAction('setBarItemSizes', { ...sizes, [id]: size });
    };

    return (
        <div className={PAGE_STACK}>
            {!ready && <WaitingNote>{t('settingsWaiting')}</WaitingNote>}
            <Surface
                as="section"
                level="surface"
                radius="xl"
                data-kb-card=""
                aria-label={t('settingsSidebar')}
                className="flex flex-col gap-3 px-5 py-[18px]"
            >
                <span id={densityLabelId} className={SECTION_LABEL}>
                    {t('settingsDensity')}
                </span>
                <div role="radiogroup" aria-labelledby={densityLabelId} onKeyDown={onDensityKeyDown} className="grid grid-cols-3 gap-3">
                    {DENSITIES.map((value, index) => (
                        <OptionTile
                            key={value}
                            label={t(DENSITY_LABEL_KEYS[value])}
                            icon={DENSITY_ICONS[value]}
                            art={<DensityArt density={value} />}
                            selected={density === value}
                            disabled={!ready}
                            tabIndex={index === densityFocus ? 0 : -1}
                            onClick={() => value !== density && dispatchSettingsAction('setDensity', value)}
                        />
                    ))}
                </div>
                <span className={HINT}>{t('settingsDensityHint')}</span>
            </Surface>
            <Surface
                as="section"
                level="surface"
                radius="xl"
                data-kb-card=""
                aria-label={t('settingsOrientationEdge')}
                className="px-5 py-[18px]"
            >
                <div className="flex items-center gap-6">
                    <div className="flex min-w-0 flex-1 flex-col gap-3">
                        <span className={SECTION_LABEL}>{t('settingsOrientationEdge')}</span>
                        <div className="flex flex-col gap-1.5">
                            <span id={orientationLabelId} className={HINT}>
                                {t('settingsOrientation')}
                            </span>
                            <Segmented
                                aria-labelledby={orientationLabelId}
                                items={orientationItems}
                                value={orientation}
                                onChange={(value) => dispatchSettingsAction('setOrientation', value)}
                            />
                            <span className={HINT}>{t('settingsOrientationHint')}</span>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <span id={edgeLabelId} className={HINT}>
                                {t('settingsEdge')}
                            </span>
                            <Segmented
                                aria-labelledby={edgeLabelId}
                                items={edgeItems}
                                value={edge}
                                onChange={(value) => dispatchSettingsAction('setEdgePosition', value)}
                            />
                        </div>
                    </div>
                    <MonitorArt orientation={orientation} edge={edge} />
                </div>
            </Surface>
            <Card
                variant="list"
                title={<span id={orderLabelId}>{t('settingsFeatureOrder')}</span>}
                description={`${t('settingsFeatureOrderHintCanli')} ${t('settingsFeatureCount').replace('{count}', String(order.length))}`}
            >
                {order.length === 0 ? (
                    <span className={HINT}>{t('settingsFeatureOrderEmpty')}</span>
                ) : (
                    <ol aria-labelledby={orderLabelId} className="flex flex-col gap-1.5">
                        {visible.map((id, index) => {
                            const name = featureLabel(id);
                            return (
                                <li
                                    key={id}
                                    onDragOver={(event) => dragId !== null && event.preventDefault()}
                                    onDrop={(event) => onDrop(event, index)}
                                    className={cx(
                                        'flex min-h-[var(--kb-row-h)] items-center gap-2.5 rounded-md bg-inset px-3 py-1.5',
                                        dragId === id && 'opacity-60'
                                    )}
                                >
                                    <span
                                        draggable={ready}
                                        onDragStart={(event) => {
                                            event.dataTransfer.effectAllowed = 'move';
                                            setDragId(id);
                                        }}
                                        onDragEnd={() => setDragId(null)}
                                        title={t('settingsFeatureDragHandle').replace('{name}', name)}
                                        className="inline-flex shrink-0 cursor-grab text-fg-3"
                                    >
                                        <Icon name="drag_indicator" size={20} />
                                    </span>
                                    <span className="w-5 shrink-0 text-center [font:var(--kb-type-label)] text-fg-2">{index + 1}</span>
                                    <IconTile icon="extension" size="sm" />
                                    <span className="min-w-0 flex-1 truncate [font:var(--kb-type-body-strong)] text-fg-1" title={id}>
                                        {name}
                                    </span>
                                    <Segmented
                                        aria-label={`${t('settingsItemSize')}: ${name}`}
                                        items={sizeItems}
                                        value={sizes[id] ?? 'icon'}
                                        onChange={(value) => setSize(id, value)}
                                    />
                                    <IconButton
                                        icon="arrow_upward"
                                        label={`${t('settingsMoveUp')}: ${name}`}
                                        tooltip={t('settingsMoveUp')}
                                        size={28}
                                        disabled={!ready || index === 0}
                                        onClick={() => move(index, -1)}
                                    />
                                    <IconButton
                                        icon="arrow_downward"
                                        label={`${t('settingsMoveDown')}: ${name}`}
                                        tooltip={t('settingsMoveDown')}
                                        size={28}
                                        disabled={!ready || index === visible.length - 1}
                                        onClick={() => move(index, 1)}
                                    />
                                </li>
                            );
                        })}
                    </ol>
                )}
                <span role="status" aria-live="polite" className="sr-only" data-testid="order-announcement">
                    {announcement}
                </span>
            </Card>
            <Card
                icon="sticky_note_2"
                title={t('settingsNotesTabTitle')}
                description={t('settingsNotesTab')}
                control={
                    <Toggle
                        hideLabel
                        label={t('settingsNotesTab')}
                        checked={notesTabVisible}
                        disabled={!ready}
                        onChange={(value) => dispatchSettingsAction('setNotesTabVisible', value)}
                    />
                }
            />
        </div>
    );
}
