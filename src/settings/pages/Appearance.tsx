// T-608: Settings › Appearance. Colour mode (System / Light / Dark), the 8 accents plus
// "Custom…" (a popover with a colour picker and a hex field) and transparency (Off = solid / Light = translucent). Like the General
// page it reads the main window's settings through the read-only mirror and changes them only with allow-listed actions
// (setScheme / setAccent / setCustomThemeColor / setMaterial / setTonalSurfaces / setEnableEyeAnimation, src/store/sync.ts); the window
// itself previews the result once the main window's snapshot comes back (src/settings/appearance.ts).
// CNL-08: bento cards, a live preview, colour mode as OptionTiles, accents as Swatches and the "Tinted surfaces" switch.
import { useId, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react';
import {
    PRESET_ACCENTS,
    PRESET_ACCENT_VALUES,
    deriveCustomAccent,
    normalizeHex,
    type Accent,
    type PresetAccent,
    type Scheme,
} from '../../theme';
import type { TranslationKeys } from '../../i18n';
import { DEFAULT_CUSTOM_THEME_COLOR, type Material } from '../../store/appearance';
import { Button, Card, Icon, OptionTile, Popover, Segmented, Surface, SwatchGroup, TextField, Toggle, usePopoverClose } from '../../ui';
import type { SegmentedItem, SwatchOption } from '../../ui';
import { moveRovingFocus } from '../../ui/choice';
import { cx, INTERACTIVE } from '../../ui/cx';
import KoBarHead from '../../components/layout/KoBarHead';
import { readMirroredAppearance, readMirroredCanli } from '../appearance';
import { dispatchSettingsAction, useSettingsState } from '../mirror';
import type { SettingsPageProps } from '../pages';
import { PAGE_STACK, WaitingNote } from './shared';

type T = SettingsPageProps['t'];

export const ACCENT_LABEL_KEYS: Readonly<Record<PresetAccent, TranslationKeys>> = Object.freeze({
    amber: 'settingsAccentAmber',
    orange: 'settingsAccentOrange',
    red: 'settingsAccentRed',
    pink: 'settingsAccentPink',
    violet: 'settingsAccentViolet',
    blue: 'settingsAccentBlue',
    green: 'settingsAccentGreen',
    graphite: 'settingsAccentGraphite',
});

const SECTION_LABEL = '[font:var(--kb-type-subtitle)] text-fg-1';

/** The scheme the window renders: "system" follows the OS (dark when it cannot be asked). */
function resolveScheme(scheme: Scheme): 'light' | 'dark' {
    if (scheme === 'light' || scheme === 'dark') return scheme;
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

type AccentColors = { dark: string; onDark: string; light: string; onLight: string };

/** Colour (and its readable foreground) of an accent in the rendered scheme. */
function accentIn(values: AccentColors, scheme: 'light' | 'dark') {
    return scheme === 'light' ? { bg: values.light, fg: values.onLight } : { bg: values.dark, fg: values.onDark };
}

/** Miniature of the bar on a ground, so every setting of this page shows its effect (the page itself updates with the main window). */
function AppearancePreview({
    t,
    scheme,
    accent,
    customThemeColor,
    material,
    tonal,
    privacy,
}: {
    t: T;
    scheme: Scheme;
    accent: Accent;
    customThemeColor: string;
    material: Material;
    tonal: boolean;
    privacy: boolean;
}) {
    const rendered = resolveScheme(scheme);
    const values: AccentColors =
        accent === 'custom' ? (deriveCustomAccent(customThemeColor) ?? PRESET_ACCENT_VALUES.amber) : PRESET_ACCENT_VALUES[accent];
    const color = accentIn(values, rendered);
    const accentStyle = { '--kb-accent': color.bg, '--kb-on-accent': color.fg } as CSSProperties;
    // Tonal surfaces follow the window's own data-tonal (mirrored from the main window); the nested data-scheme root
    // re-resolves every surface against this preview's scheme and accent.
    return (
        <Card variant="list" title={t('settingsPreview')} aria-label={t('settingsPreview')}>
            <div
                data-testid="appearance-preview"
                data-preview-scheme={rendered}
                data-preview-tonal={tonal ? 'on' : 'off'}
                data-preview-material={material}
                data-scheme={rendered}
                style={accentStyle}
                aria-hidden="true"
                className="flex h-[116px] items-center justify-center overflow-hidden rounded-lg bg-inset"
            >
                <PreviewBar material={material} privacy={privacy} />
            </div>
        </Card>
    );
}

const PREVIEW_RING_R = 23;
const PREVIEW_RING_C = 2 * Math.PI * PREVIEW_RING_R;

/** A horizontal wide bar in miniature (date tile, timer ring, icon grid, mini button), drawn from tokens only. */
function PreviewBar({ material, privacy }: { material: Material; privacy: boolean }) {
    const lang = useSettingsState((s) => s.state?.language) ?? 'en';
    const now = new Date();
    const part = (options: Intl.DateTimeFormatOptions) => {
        try {
            return new Intl.DateTimeFormat(lang, options).format(now).replace(/\.$/, '');
        } catch {
            return new Intl.DateTimeFormat('en', options).format(now);
        }
    };
    return (
        <div
            className={cx(
                'flex items-center gap-2 rounded-2xl p-2 shadow-[inset_0_0_0_1px_var(--kb-stroke-subtle)]',
                material === 'translucent' ? 'bg-[var(--kb-material-bg)]' : 'bg-shell'
            )}
        >
            <span className="flex size-16 flex-col items-center justify-center gap-0.5 rounded-lg bg-tile">
                <span className="[font:var(--kb-type-micro)] text-accent-text">{part({ weekday: 'short' })}</span>
                <span className="kb-num [font:var(--kb-type-tile-value)] text-fg-1">{part({ day: 'numeric' })}</span>
                <span className="text-[0.6875rem] leading-3 font-semibold text-fg-2">{part({ month: 'short' })}</span>
            </span>
            <span className="relative flex size-16 items-center justify-center rounded-lg bg-container">
                <svg className="absolute inset-[5px]" viewBox="0 0 54 54">
                    <circle cx="27" cy="27" r={PREVIEW_RING_R} fill="none" strokeWidth="4" className="stroke-[var(--kb-ring-track)]" />
                    <circle
                        cx="27"
                        cy="27"
                        r={PREVIEW_RING_R}
                        fill="none"
                        strokeWidth="4"
                        strokeLinecap="round"
                        transform="rotate(-90 27 27)"
                        strokeDasharray={`${(PREVIEW_RING_C * 0.75).toFixed(1)} ${PREVIEW_RING_C.toFixed(1)}`}
                        className="stroke-[var(--kb-accent)]"
                    />
                </svg>
                <span className="kb-num relative [font:var(--kb-type-tile-small)] text-on-container" data-testid="appearance-preview-value">
                    {privacy ? '••' : '18:42'}
                </span>
            </span>
            <span className="mx-1 h-8 w-px bg-[var(--kb-stroke-subtle)]" />
            <span className="grid grid-flow-col grid-rows-2 gap-1">
                {['checklist', 'content_paste', 'calculate', 'music_note'].map((icon) => (
                    <span key={icon} className="inline-flex size-[30px] items-center justify-center rounded-sm text-fg-2">
                        <Icon name={icon} size={18} />
                    </span>
                ))}
            </span>
            <span className="inline-flex h-12 w-16 items-center justify-center rounded-lg bg-[var(--kb-accent)] text-[var(--kb-on-accent)]">
                <KoBarHead size={28} />
            </span>
        </div>
    );
}

/** Mini art of a colour-mode tile: system = split light/dark, otherwise one scheme. */
function SchemeArt({ scheme }: { scheme: Scheme }) {
    const half = (mode: 'light' | 'dark', className?: string) => (
        <span data-scheme={mode} className={cx('flex h-full flex-1 items-center justify-center bg-shell', className)}>
            <span className="h-7 w-9 rounded-sm bg-surface" />
        </span>
    );
    if (scheme === 'system') {
        return (
            <span className="flex size-full">
                {half('light')}
                {half('dark')}
            </span>
        );
    }
    return <span className="flex size-full">{half(scheme)}</span>;
}

export function AppearancePage({ t }: SettingsPageProps) {
    const ready = useSettingsState((s) => s.status === 'ready' && s.state !== null);
    const state = useSettingsState((s) => s.state);
    const raw = (state ?? {}) as unknown as Partial<Record<string, unknown>>;
    const appearance = readMirroredAppearance(raw);
    const canli = readMirroredCanli(raw);
    const schemeLabelId = useId();
    const accentLabelId = useId();
    const materialLabelId = useId();

    const schemeIcons: Record<Scheme, string> = { system: 'computer', light: 'light_mode', dark: 'dark_mode' };
    const schemes: { value: Scheme; label: string }[] = [
        { value: 'system', label: t('settingsSchemeSystem') },
        { value: 'light', label: t('settingsSchemeLight') },
        { value: 'dark', label: t('settingsSchemeDark') },
    ];
    const schemeFocus = ready
        ? Math.max(
              0,
              schemes.findIndex((s) => s.value === appearance.scheme)
          )
        : -1;
    const materialItems: SegmentedItem<Material>[] = [
        { value: 'solid', label: t('settingsTransparencyOff'), disabled: !ready },
        { value: 'translucent', label: t('settingsTransparencyLow'), disabled: !ready },
    ];

    const onSchemeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const items = schemes.map((s) => ({ value: s.value, label: s.label, disabled: !ready }));
        const index = moveRovingFocus(event, items, true);
        if (index !== null && schemes[index].value !== appearance.scheme) dispatchSettingsAction('setScheme', schemes[index].value);
    };

    const accentName = appearance.accent === 'custom' ? t('settingsCustomColorTitle') : t(ACCENT_LABEL_KEYS[appearance.accent]);

    return (
        <div className={PAGE_STACK}>
            {!ready && <WaitingNote>{t('settingsWaiting')}</WaitingNote>}
            <AppearancePreview
                t={t}
                scheme={appearance.scheme}
                accent={appearance.accent}
                customThemeColor={appearance.customThemeColor}
                material={appearance.material}
                tonal={canli.tonalSurfaces}
                privacy={canli.privacyMode}
            />
            <Surface
                as="section"
                level="surface"
                radius="xl"
                data-kb-card=""
                aria-label={t('appearance')}
                className="flex flex-col gap-5 px-5 py-[18px]"
            >
                <div className="flex flex-col gap-3">
                    <span id={schemeLabelId} className={SECTION_LABEL}>
                        {t('settingsScheme')}
                    </span>
                    <div role="radiogroup" aria-labelledby={schemeLabelId} onKeyDown={onSchemeKeyDown} className="grid grid-cols-3 gap-3">
                        {schemes.map((item, index) => (
                            <OptionTile
                                key={item.value}
                                label={item.label}
                                icon={schemeIcons[item.value]}
                                art={<SchemeArt scheme={item.value} />}
                                selected={appearance.scheme === item.value}
                                disabled={!ready}
                                tabIndex={index === schemeFocus ? 0 : -1}
                                onClick={() => {
                                    if (item.value !== appearance.scheme) dispatchSettingsAction('setScheme', item.value);
                                }}
                            />
                        ))}
                    </div>
                </div>
                <div className="flex flex-col gap-3">
                    <span className={SECTION_LABEL}>
                        <span id={accentLabelId}>{t('settingsAccent')}</span>
                        <span className="text-fg-2" data-testid="accent-name">
                            {' · '}
                            {accentName}
                        </span>
                    </span>
                    <AccentPicker
                        t={t}
                        labelledBy={accentLabelId}
                        accent={appearance.accent}
                        customThemeColor={appearance.customThemeColor}
                        scheme={resolveScheme(appearance.scheme)}
                        disabled={!ready}
                    />
                </div>
            </Surface>
            <div className="grid grid-cols-2 gap-3">
                <Card
                    variant="list"
                    title={<span id={materialLabelId}>{t('settingsTransparency')}</span>}
                    description={t('settingsTransparencyHint')}
                >
                    <Segmented
                        aria-labelledby={materialLabelId}
                        items={materialItems}
                        value={appearance.material}
                        onChange={(value) => dispatchSettingsAction('setMaterial', value)}
                    />
                </Card>
                <Card
                    variant="list"
                    title={t('settingsTonalSurfaces')}
                    description={t('settingsTonalSurfacesHint')}
                    control={
                        <Toggle
                            hideLabel
                            label={t('settingsTonalSurfaces')}
                            checked={canli.tonalSurfaces}
                            disabled={!ready}
                            onChange={(value) => dispatchSettingsAction('setTonalSurfaces', value)}
                        />
                    }
                />
            </div>
            {/* T-615a: the sidebar's mini-mode eye animation (setEnableEyeAnimation, already a synced setting). */}
            <Card
                icon="pets"
                title={t('settingsEyeAnimationTitle')}
                description={t('settingsEyeAnimationHint')}
                control={
                    <Toggle
                        hideLabel
                        label={t('enableEyeAnimation')}
                        checked={state?.enableEyeAnimation === true}
                        disabled={!ready}
                        onChange={(value) => dispatchSettingsAction('setEnableEyeAnimation', value)}
                    />
                }
            />
        </div>
    );
}

interface AccentPickerProps {
    t: T;
    labelledBy: string;
    accent: Accent;
    customThemeColor: string;
    scheme: 'light' | 'dark';
    disabled: boolean;
}

/**
 * The accent swatches (a radiogroup with roving tabindex; arrows, Home and End select a preset like native radios) and a tonal
 * "Custom…" button that opens the colour popover; the colour itself is chosen there.
 */
function AccentPicker({ t, labelledBy, accent, customThemeColor, scheme, disabled }: AccentPickerProps) {
    const [open, setOpen] = useState(false);
    const customValues = accent === 'custom' ? deriveCustomAccent(customThemeColor) : null;
    const options: SwatchOption[] = PRESET_ACCENTS.map((id) => ({
        value: id,
        label: t(ACCENT_LABEL_KEYS[id]),
        color: accentIn(PRESET_ACCENT_VALUES[id], scheme).bg,
        disabled,
    }));

    return (
        <div className="flex flex-wrap items-center gap-3">
            <SwatchGroup
                aria-labelledby={labelledBy}
                options={options}
                value={accent}
                onChange={(value) => dispatchSettingsAction('setAccent', value as PresetAccent)}
            />
            <Popover
                // Never opens (and closes) while the controls are disabled, e.g. the main window is reloading.
                open={open && !disabled}
                onOpenChange={(next) => setOpen(next && !disabled)}
                placement="bottom-start"
                aria-label={t('settingsCustomColorTitle')}
                className="w-72"
                trigger={
                    <Button variant="tonal" size="sm" disabled={disabled} data-testid="accent-custom" aria-pressed={accent === 'custom'}>
                        {customValues ? (
                            <span
                                aria-hidden
                                data-testid="accent-custom-dot"
                                style={{ backgroundColor: accentIn(customValues, scheme).bg }}
                                className="size-4 rounded-full"
                            />
                        ) : (
                            <Icon name="palette" size={18} />
                        )}
                        {t('settingsAccentCustom')}
                    </Button>
                }
            >
                <CustomColorForm t={t} initial={customThemeColor} scheme={scheme} disabled={disabled} />
            </Popover>
        </div>
    );
}

interface CustomColorFormProps {
    t: T;
    initial: string;
    disabled: boolean;
    /** Scheme the preview tile is drawn in. */
    scheme?: 'light' | 'dark';
}

/** Content of the "Custom…" popover. Only a valid hex can be applied; it is sent normalised (`#rrggbb`). */
export function CustomColorForm({ t, initial, disabled, scheme = 'dark' }: CustomColorFormProps) {
    const close = usePopoverClose();
    const [draft, setDraft] = useState(() => normalizeHex(initial) ?? DEFAULT_CUSTOM_THEME_COLOR);
    const pickerId = useId();
    const hex = normalizeHex(draft);
    const derived = hex ? deriveCustomAccent(hex) : null;
    // The colour is tuned for 4.5:1 against the shell; say so when the rendered (dark) value differs from the input.
    const adjusted = Boolean(hex && derived && derived.dark !== hex);
    const preview = derived ? accentIn(derived, scheme) : null;

    const onSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!hex || disabled) return;
        if (dispatchSettingsAction('setCustomThemeColor', hex) !== null) close('select');
    };

    return (
        <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
            <span className="[font:var(--kb-type-subtitle)] text-fg-1">{t('settingsCustomColorTitle')}</span>
            <div className="flex items-end gap-3">
                <div className="flex flex-col gap-1">
                    <label htmlFor={pickerId} className="[font:var(--kb-type-label)] text-fg-1">
                        {t('settingsCustomColorPicker')}
                    </label>
                    <input
                        id={pickerId}
                        type="color"
                        value={hex ?? DEFAULT_CUSTOM_THEME_COLOR}
                        onChange={(event) => setDraft(event.target.value)}
                        className={cx(INTERACTIVE, 'h-[var(--kb-control-h)] w-12 cursor-pointer rounded-sm border-0 bg-inset p-0.5')}
                    />
                </div>
                <TextField
                    label={t('settingsCustomColorHex')}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    maxLength={9}
                    spellCheck={false}
                    autoComplete="off"
                    dir="ltr"
                    error={hex ? undefined : t('settingsCustomColorInvalid')}
                    className="min-w-0 flex-1"
                />
            </div>
            {preview && (
                <div className="flex items-center gap-2">
                    <span
                        aria-hidden
                        style={{ backgroundColor: preview.bg, color: preview.fg }}
                        className="inline-flex h-10 w-14 items-center justify-center rounded-md [font:var(--kb-type-label)]"
                        data-testid="custom-preview"
                    >
                        Aa
                    </span>
                    {adjusted && (
                        <span className="[font:var(--kb-type-caption)] text-fg-2" data-testid="custom-adjusted">
                            {t('settingsCustomColorAdjusted')}
                        </span>
                    )}
                </div>
            )}
            <div className="flex justify-end gap-2">
                <Button type="button" variant="text" size="sm" onClick={() => close('escape')}>
                    {t('cancel')}
                </Button>
                <Button type="submit" variant="tonal" size="sm" disabled={!hex || disabled}>
                    {t('settingsApply')}
                </Button>
            </div>
        </form>
    );
}
