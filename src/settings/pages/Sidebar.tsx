// T-609: Settings › Sidebar. Density (compact / normal / comfortable), orientation + screen edge, and the order of the bar's
// buttons (`featureOrder`). Like the other pages it reads the main window's settings through the read-only mirror and changes
// them only with allow-listed actions (setDensity / setOrientation / setEdgePosition / setFeatureOrder, src/store/sync.ts).
// `setDensity` keeps the v1 `sidebarWidth` consistent in the store; this page never writes it. There is no "Smart Popup" option.
// The order list is keyboard-first: each row has Move up / Move down buttons and the move is announced in a live region.
import { useId, useState } from 'react';
import type { TranslationKeys } from '../../i18n';
import { DENSITIES, densityFromSidebarWidth, isDensity, type Density } from '../../store/density';
import { IconButton, Segmented, Surface, type SegmentedItem } from '../../ui';
import { dispatchSettingsAction, useSettingsState } from '../mirror';
import type { SettingsPageProps } from '../pages';
import { featureLabel, moveItem } from '../sidebarOrder';

type Orientation = 'vertical' | 'horizontal';
type Edge = 'left' | 'right' | 'top' | 'bottom';

const SECTION_LABEL = 'text-[0.8125rem] leading-5 text-fg-1';
const HINT = 'text-[0.6875rem] leading-4 text-fg-2';

export const DENSITY_LABEL_KEYS: Readonly<Record<Density, TranslationKeys>> = Object.freeze({
    compact: 'settingsDensityCompact',
    normal: 'settingsDensityNormal',
    comfortable: 'settingsDensityComfortable',
});

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

export function SidebarPage({ t }: SettingsPageProps) {
    const ready = useSettingsState((s) => s.status === 'ready' && s.state !== null);
    const state = useSettingsState((s) => s.state);
    const rawDensity = state?.density;
    const density: Density = isDensity(rawDensity) ? rawDensity : densityFromSidebarWidth(state?.sidebarWidth);
    const orientation: Orientation = state?.orientation === 'horizontal' ? 'horizontal' : 'vertical';
    const edge = asEdge(state?.edgePosition, orientation);
    const rawOrder: unknown = state?.featureOrder;
    const order = Array.isArray(rawOrder) ? rawOrder.filter((id): id is string => typeof id === 'string') : [];
    const densityLabelId = useId();
    const orientationLabelId = useId();
    const edgeLabelId = useId();
    const orderLabelId = useId();
    const [announcement, setAnnouncement] = useState('');

    const densityItems: SegmentedItem<Density>[] = DENSITIES.map((value) => ({
        value,
        label: t(DENSITY_LABEL_KEYS[value]),
        disabled: !ready,
    }));
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

    const move = (index: number, delta: number) => {
        if (!ready) return;
        const next = moveItem(order, index, delta);
        if (next.every((id, i) => id === order[i])) return;
        if (dispatchSettingsAction('setFeatureOrder', next) === null) return;
        setAnnouncement(
            t('settingsMovedAnnounce')
                .replace('{name}', featureLabel(order[index]))
                .replace('{position}', String(index + delta + 1))
                .replace('{total}', String(order.length))
        );
    };

    return (
        <div className="flex max-w-xl flex-col gap-4">
            {!ready && (
                <p role="status" className="text-[0.8125rem] leading-5 text-fg-2">
                    {t('settingsWaiting')}
                </p>
            )}
            <Surface
                as="section"
                level="surface"
                elevation="e1"
                radius="lg"
                aria-label={t('settingsSidebar')}
                className="flex flex-col divide-y divide-stroke"
            >
                <div className="flex flex-col gap-2 p-4">
                    <span id={densityLabelId} className={SECTION_LABEL}>
                        {t('settingsDensity')}
                    </span>
                    <Segmented
                        aria-labelledby={densityLabelId}
                        items={densityItems}
                        value={density}
                        onChange={(value) => dispatchSettingsAction('setDensity', value)}
                    />
                    <span className={HINT}>{t('settingsDensityHint')}</span>
                </div>
                <div className="flex flex-col gap-2 p-4">
                    <span id={orientationLabelId} className={SECTION_LABEL}>
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
                <div className="flex flex-col gap-2 p-4">
                    <span id={edgeLabelId} className={SECTION_LABEL}>
                        {t('settingsEdge')}
                    </span>
                    <Segmented
                        aria-labelledby={edgeLabelId}
                        items={edgeItems}
                        value={edge}
                        onChange={(value) => dispatchSettingsAction('setEdgePosition', value)}
                    />
                </div>
                <div className="flex flex-col gap-2 p-4">
                    <span id={orderLabelId} className={SECTION_LABEL}>
                        {t('settingsFeatureOrder')}
                    </span>
                    <span className={HINT}>{t('settingsFeatureOrderHint')}</span>
                    {order.length === 0 ? (
                        <span className={HINT}>{t('settingsFeatureOrderEmpty')}</span>
                    ) : (
                        <ol aria-labelledby={orderLabelId} className="flex flex-col gap-1">
                            {order.map((id, index) => (
                                <li
                                    key={id}
                                    className="flex min-h-[var(--kb-row-h)] items-center gap-2 rounded-md border border-stroke px-3 py-1"
                                >
                                    <span className="min-w-0 flex-1 truncate text-[0.8125rem] leading-5 text-fg-1" title={id}>
                                        {featureLabel(id)}
                                    </span>
                                    <IconButton
                                        icon="arrow_upward"
                                        label={`${t('settingsMoveUp')}: ${featureLabel(id)}`}
                                        tooltip={t('settingsMoveUp')}
                                        size={28}
                                        disabled={!ready || index === 0}
                                        onClick={() => move(index, -1)}
                                    />
                                    <IconButton
                                        icon="arrow_downward"
                                        label={`${t('settingsMoveDown')}: ${featureLabel(id)}`}
                                        tooltip={t('settingsMoveDown')}
                                        size={28}
                                        disabled={!ready || index === order.length - 1}
                                        onClick={() => move(index, 1)}
                                    />
                                </li>
                            ))}
                        </ol>
                    )}
                    <span role="status" aria-live="polite" className="sr-only" data-testid="order-announcement">
                        {announcement}
                    </span>
                </div>
            </Surface>
        </div>
    );
}
