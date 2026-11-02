import { useEffect, useRef, type FocusEvent } from 'react';
import { createPortal } from 'react-dom';
import { cx, INTERACTIVE } from './cx';
import { Icon } from './Icon';
import { toast, useToasts, type ToastRecord, type ToastTone } from './toastStore';

export interface ToastRegionProps {
    /** Accessible label of each toast's close button (translated by the caller). */
    dismissLabel: string;
    position?: 'top' | 'bottom';
    className?: string;
}

const TONE_ICON: Record<ToastTone, string> = {
    info: 'info',
    success: 'check_circle',
    warning: 'warning',
    error: 'error',
};

const STACK = 'flex w-full max-w-[400px] flex-col gap-2 empty:hidden';

/**
 * Renders the `toast` queue: portal on the toast layer (--kb-z-toast). Two live regions exist
 * from the start so screen readers announce insertions: role="status" (polite) and role="alert" (assertive, errors).
 * Mount once near the app root. Presses inside it never dismiss an open popover or dialog.
 */
export function ToastRegion({ dismissLabel, position = 'bottom', className }: ToastRegionProps) {
    const items = useToasts();
    const polite = items.filter((item) => item.tone !== 'error');
    const assertive = items.filter((item) => item.tone === 'error');

    return createPortal(
        <div
            data-kb-layer-ignore=""
            className={cx(
                'pointer-events-none fixed inset-x-0 z-[var(--kb-z-toast)] flex flex-col items-center gap-2 px-3',
                position === 'top' ? 'top-3' : 'bottom-3',
                className
            )}
        >
            <div role="status" aria-live="polite" className={STACK}>
                {polite.map((item) => (
                    <ToastItem key={item.id} record={item} dismissLabel={dismissLabel} />
                ))}
            </div>
            <div role="alert" aria-live="assertive" className={STACK}>
                {assertive.map((item) => (
                    <ToastItem key={item.id} record={item} dismissLabel={dismissLabel} />
                ))}
            </div>
        </div>,
        document.body
    );
}

interface TimerControl {
    pause: () => void;
    resume: () => void;
}

function ToastItem({ record, dismissLabel }: { record: ToastRecord; dismissLabel: string }) {
    const control = useRef<TimerControl | null>(null);
    const holds = useRef({ hover: false, focus: false });

    // Auto-dismiss timer; paused while hovered or focused (WCAG 2.2.1), restarted when the toast is replaced.
    useEffect(() => {
        const { id, duration } = record;
        if (duration <= 0) return;
        let remaining = duration;
        let startedAt = 0;
        let timer: number | undefined;
        const run = () => {
            startedAt = Date.now();
            timer = window.setTimeout(() => toast.dismiss(id), remaining);
        };
        control.current = {
            pause: () => {
                if (timer === undefined) return;
                window.clearTimeout(timer);
                timer = undefined;
                remaining = Math.max(0, remaining - (Date.now() - startedAt));
            },
            resume: () => {
                if (timer === undefined) run();
            },
        };
        if (!holds.current.hover && !holds.current.focus) run();
        return () => {
            window.clearTimeout(timer);
            control.current = null;
        };
    }, [record]);

    const hold = (kind: 'hover' | 'focus', on: boolean) => {
        holds.current[kind] = on;
        if (holds.current.hover || holds.current.focus) control.current?.pause();
        else control.current?.resume();
    };

    const onBlur = (event: FocusEvent<HTMLDivElement>) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node && event.currentTarget.contains(next))) hold('focus', false);
    };

    const { id, tone, title, message, action } = record;
    // Inverse pill: --kb-fg-1 fill with shell-coloured text; the action is a text button in container colour. The tone
    // shows in the icon glyph (not colour), so it reads on both schemes.
    return (
        <div
            data-tone={tone}
            className="kb-pop no-drag-region pointer-events-auto flex min-h-11 w-full items-center gap-2.5 rounded-[18px] bg-[var(--kb-fg-1)] py-2 ps-4 pe-2 text-[var(--kb-bg-shell)] shadow-e2"
            onMouseEnter={() => hold('hover', true)}
            onMouseLeave={() => hold('hover', false)}
            onFocus={() => hold('focus', true)}
            onBlur={onBlur}
        >
            <Icon name={TONE_ICON[tone]} size={20} />
            <div className="min-w-0 flex-1 [font:var(--kb-type-body)]">
                {title && <p className="font-semibold">{title}</p>}
                <p>{message}</p>
            </div>
            {action && (
                <button
                    type="button"
                    className={cx(
                        INTERACTIVE,
                        'inline-flex h-8 shrink-0 items-center rounded-full px-3 [font:var(--kb-type-label)] text-[var(--kb-bg-container)] transition-colors duration-[var(--kb-dur-fast)] hover:bg-[color-mix(in_oklab,var(--kb-bg-shell)_14%,transparent)]'
                    )}
                    onClick={() => {
                        action.onClick();
                        toast.dismiss(id);
                    }}
                >
                    {action.label}
                </button>
            )}
            <button
                type="button"
                aria-label={dismissLabel}
                className={cx(
                    INTERACTIVE,
                    'inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-colors duration-[var(--kb-dur-fast)] hover:bg-[color-mix(in_oklab,var(--kb-bg-shell)_14%,transparent)]'
                )}
                onClick={() => toast.dismiss(id)}
            >
                <Icon name="close" size={18} />
            </button>
        </div>
    );
}
