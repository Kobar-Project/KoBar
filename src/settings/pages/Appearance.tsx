// T-608: Settings › Appearance. Colour mode (System / Light / Dark), the 8 accents plus
// "Custom…" (a popover with a colour picker and a hex field) and transparency (Off = solid / Light = translucent). Like the General
// page it reads the main window's settings through the read-only mirror and changes them only with allow-listed actions
// (setScheme / setAccent / setCustomThemeColor / setMaterial, src/store/sync.ts); the window itself previews the result once the
// main window's snapshot comes back (src/settings/appearance.ts).
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
import { Button, Icon, Popover, Segmented, Surface, TextField, Toggle, usePopoverClose, type SegmentedItem } from '../../ui';
import { cx, INTERACTIVE } from '../../ui/cx';
import { readMirroredAppearance } from '../appearance';
import { dispatchSettingsAction, useSettingsState } from '../mirror';
import type { SettingsPageProps } from '../pages';

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

const SECTION_LABEL = 'text-[0.8125rem] leading-5 text-fg-1';
const HINT = 'text-[0.6875rem] leading-4 text-fg-2';

// The swatch colour follows the rendered scheme: --kb-swatch-* are set inline from the accent palette (src/theme/color.ts).
const SWATCH =
    'relative inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-stroke bg-[var(--kb-swatch-dark)] text-[var(--kb-swatch-on-dark)] [[data-scheme=light]_&]:bg-[var(--kb-swatch-light)] [[data-scheme=light]_&]:text-[var(--kb-swatch-on-light)] disabled:cursor-not-allowed disabled:opacity-50';
const SWATCH_SELECTED = 'shadow-[0_0_0_2px_var(--kb-bg-surface),0_0_0_4px_var(--kb-fg-1)]';

function swatchStyle(values: { dark: string; onDark: string; light: string; onLight: string }): CSSProperties {
    return {
        '--kb-swatch-dark': values.dark,
        '--kb-swatch-on-dark': values.onDark,
        '--kb-swatch-light': values.light,
        '--kb-swatch-on-light': values.onLight,
    } as CSSProperties;
}

/** "Custom…" while no custom colour is selected: a neutral swatch with a palette icon. */
const NEUTRAL_SWATCH = { dark: 'var(--kb-fill-hover)', onDark: 'var(--kb-fg-1)', light: 'var(--kb-fill-hover)', onLight: 'var(--kb-fg-1)' };

/** Attribute that marks the accent radios (the custom one sits inside the popover's wrapper, so not a direct child). */
const SWATCH_ATTR = 'data-kb-swatch';

export function AppearancePage({ t }: SettingsPageProps) {
    const ready = useSettingsState((s) => s.status === 'ready' && s.state !== null);
    const state = useSettingsState((s) => s.state);
    const appearance = readMirroredAppearance((state ?? {}) as Partial<Record<string, unknown>>);
    const schemeLabelId = useId();
    const accentLabelId = useId();
    const materialLabelId = useId();

    const schemeItems: SegmentedItem<Scheme>[] = [
        { value: 'system', label: t('settingsSchemeSystem'), icon: 'computer', disabled: !ready },
        { value: 'light', label: t('settingsSchemeLight'), icon: 'light_mode', disabled: !ready },
        { value: 'dark', label: t('settingsSchemeDark'), icon: 'dark_mode', disabled: !ready },
    ];
    const materialItems: SegmentedItem<Material>[] = [
        { value: 'solid', label: t('settingsTransparencyOff'), disabled: !ready },
        { value: 'translucent', label: t('settingsTransparencyLow'), disabled: !ready },
    ];

    const accentName = appearance.accent === 'custom' ? t('settingsCustomColorTitle') : t(ACCENT_LABEL_KEYS[appearance.accent]);

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
                aria-label={t('appearance')}
                className="flex flex-col divide-y divide-stroke"
            >
                <div className="flex flex-col gap-2 p-4">
                    <span id={schemeLabelId} className={SECTION_LABEL}>
                        {t('settingsScheme')}
                    </span>
                    <Segmented
                        aria-labelledby={schemeLabelId}
                        items={schemeItems}
                        value={appearance.scheme}
                        onChange={(value) => dispatchSettingsAction('setScheme', value)}
                    />
                </div>
                <div className="flex flex-col gap-2 p-4">
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
                        disabled={!ready}
                    />
                </div>
                <div className="flex flex-col gap-2 p-4">
                    <span id={materialLabelId} className={SECTION_LABEL}>
                        {t('settingsTransparency')}
                    </span>
                    <Segmented
                        aria-labelledby={materialLabelId}
                        items={materialItems}
                        value={appearance.material}
                        onChange={(value) => dispatchSettingsAction('setMaterial', value)}
                    />
                    <span className={HINT}>{t('settingsTransparencyHint')}</span>
                </div>
                <div className="p-4">
                    {/* T-615a: the sidebar's mini-mode eye animation (setEnableEyeAnimation, already a synced setting). */}
                    <Toggle
                        fullWidth
                        label={t('enableEyeAnimation')}
                        checked={state?.enableEyeAnimation === true}
                        disabled={!ready}
                        onChange={(value) => dispatchSettingsAction('setEnableEyeAnimation', value)}
                    />
                </div>
            </Surface>
        </div>
    );
}

interface AccentPickerProps {
    t: T;
    labelledBy: string;
    accent: Accent;
    customThemeColor: string;
    disabled: boolean;
}

/**
 * The accent radiogroup: roving tabindex; the arrows (Left/Right mirrored in RTL), Home and End move focus and select a preset like
 * native radios. "Custom…" only takes focus by keyboard: Enter / Space (or a click) opens its popover, and the colour is chosen there.
 */
function AccentPicker({ t, labelledBy, accent, customThemeColor, disabled }: AccentPickerProps) {
    const [open, setOpen] = useState(false);
    const values: readonly Accent[] = [...PRESET_ACCENTS, 'custom'];
    const focusIndex = disabled ? -1 : Math.max(0, values.indexOf(accent));
    const customValues = accent === 'custom' ? deriveCustomAccent(customThemeColor) : null;

    const select = (value: Accent) => {
        if (value === 'custom' || value === accent) return;
        dispatchSettingsAction('setAccent', value);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (disabled || event.altKey || event.ctrlKey || event.metaKey) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(`[${SWATCH_ATTR}]`));
        const current = buttons.indexOf(event.target as HTMLButtonElement);
        if (current < 0) return;
        const rtl =
            getComputedStyle(event.currentTarget).direction === 'rtl' ||
            event.currentTarget.closest('[dir]')?.getAttribute('dir') === 'rtl';
        const forward = rtl ? -1 : 1;
        let next: number;
        switch (event.key) {
            case 'ArrowRight':
                next = current + forward;
                break;
            case 'ArrowLeft':
                next = current - forward;
                break;
            case 'ArrowDown':
                next = current + 1;
                break;
            case 'ArrowUp':
                next = current - 1;
                break;
            case 'Home':
                next = 0;
                break;
            case 'End':
                next = buttons.length - 1;
                break;
            default:
                return;
        }
        event.preventDefault();
        next = (next + buttons.length) % buttons.length;
        buttons[next].focus();
        select(values[next]);
    };

    return (
        <div role="radiogroup" aria-labelledby={labelledBy} onKeyDown={onKeyDown} className="flex flex-wrap items-center gap-3 p-1">
            {PRESET_ACCENTS.map((id, index) => {
                const selected = accent === id;
                return (
                    <button
                        key={id}
                        type="button"
                        role="radio"
                        {...{ [SWATCH_ATTR]: id }}
                        aria-checked={selected}
                        aria-label={t(ACCENT_LABEL_KEYS[id])}
                        title={t(ACCENT_LABEL_KEYS[id])}
                        tabIndex={index === focusIndex ? 0 : -1}
                        disabled={disabled}
                        onClick={() => select(id)}
                        style={swatchStyle(PRESET_ACCENT_VALUES[id])}
                        className={cx(INTERACTIVE, SWATCH, selected && SWATCH_SELECTED)}
                    >
                        {selected && <Icon name="check" size={16} />}
                    </button>
                );
            })}
            <Popover
                // Never opens (and closes) while the controls are disabled, e.g. the main window is reloading.
                open={open && !disabled}
                onOpenChange={(next) => setOpen(next && !disabled)}
                placement="bottom-start"
                aria-label={t('settingsCustomColorTitle')}
                className="w-72"
                trigger={
                    <button
                        type="button"
                        role="radio"
                        {...{ [SWATCH_ATTR]: 'custom' }}
                        aria-checked={accent === 'custom'}
                        aria-label={t('settingsAccentCustom')}
                        title={t('settingsAccentCustom')}
                        tabIndex={focusIndex === values.length - 1 ? 0 : -1}
                        disabled={disabled}
                        style={swatchStyle(customValues ?? NEUTRAL_SWATCH)}
                        className={cx(INTERACTIVE, SWATCH, accent === 'custom' && SWATCH_SELECTED)}
                    >
                        <Icon name={accent === 'custom' ? 'check' : 'palette'} size={16} />
                    </button>
                }
            >
                <CustomColorForm t={t} initial={customThemeColor} disabled={disabled} />
            </Popover>
        </div>
    );
}

interface CustomColorFormProps {
    t: T;
    initial: string;
    disabled: boolean;
}

/** Content of the "Custom…" popover. Only a valid hex can be applied; it is sent normalised (`#rrggbb`). */
export function CustomColorForm({ t, initial, disabled }: CustomColorFormProps) {
    const close = usePopoverClose();
    const [draft, setDraft] = useState(() => normalizeHex(initial) ?? DEFAULT_CUSTOM_THEME_COLOR);
    const pickerId = useId();
    const hex = normalizeHex(draft);
    const derived = hex ? deriveCustomAccent(hex) : null;
    // The colour is tuned for 4.5:1 against the shell; say so when the rendered (dark) value differs from the input.
    const adjusted = Boolean(hex && derived && derived.dark !== hex);

    const onSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!hex || disabled) return;
        if (dispatchSettingsAction('setCustomThemeColor', hex) !== null) close('select');
    };

    return (
        <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
            <span className="font-semibold text-fg-1">{t('settingsCustomColorTitle')}</span>
            <div className="flex items-end gap-3">
                <div className="flex flex-col gap-1">
                    <label htmlFor={pickerId} className="text-[0.8125rem] leading-5 text-fg-1">
                        {t('settingsCustomColorPicker')}
                    </label>
                    <input
                        id={pickerId}
                        type="color"
                        value={hex ?? DEFAULT_CUSTOM_THEME_COLOR}
                        onChange={(event) => setDraft(event.target.value)}
                        className={cx(
                            INTERACTIVE,
                            'h-[var(--kb-control-h)] w-12 cursor-pointer rounded-sm border border-stroke bg-transparent p-0.5'
                        )}
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
            {derived && (
                <div className="flex items-center gap-2">
                    <span
                        aria-hidden
                        style={swatchStyle(derived)}
                        className={cx(SWATCH, 'w-12 rounded-sm text-[0.75rem] font-semibold')}
                        data-testid="custom-preview"
                    >
                        Aa
                    </span>
                    {adjusted && (
                        <span className="text-[0.6875rem] leading-4 text-fg-2" data-testid="custom-adjusted">
                            {t('settingsCustomColorAdjusted')}
                        </span>
                    )}
                </div>
            )}
            <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => close('escape')}>
                    {t('cancel')}
                </Button>
                <Button type="submit" variant="primary" size="sm" disabled={!hex || disabled}>
                    {t('settingsApply')}
                </Button>
            </div>
        </form>
    );
}
