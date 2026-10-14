import { useEffect, useRef, type FocusEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { cx } from './cx';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
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

const TONE_CLASS: Record<ToastTone, string> = {
    info: 'text-[var(--kb-info)]',
    success: 'text-[var(--kb-success)]',
    warning: 'text-[var(--kb-warning)]',
    error: 'text-[var(--kb-danger)]',
};

const STACK = 'flex w-full max-w-80 flex-col gap-2 empty:hidden';

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
    return (
        <div
            data-tone={tone}
            className="kb-pop no-drag-region pointer-events-auto flex w-full items-start gap-2 rounded-md border border-stroke bg-surface py-2 ps-3 pe-2 text-fg-1 shadow-e2"
            onMouseEnter={() => hold('hover', true)}
            onMouseLeave={() => hold('hover', false)}
            onFocus={() => hold('focus', true)}
            onBlur={onBlur}
        >
            <Icon name={TONE_ICON[tone]} size={20} className={cx('mt-1', TONE_CLASS[tone])} />
            <div className="min-w-0 flex-1 py-1 text-[0.8125rem] leading-5">
                {title && <p className="font-semibold text-fg-1">{title}</p>}
                <p className={title ? 'text-fg-2' : 'text-fg-1'}>{message}</p>
            </div>
            {action && (
                <Button
                    size="sm"
                    variant="subtle"
                    className="mt-0.5"
                    onClick={() => {
                        action.onClick();
                        toast.dismiss(id);
                    }}
                >
                    {action.label}
                </Button>
            )}
            <IconButton icon="close" label={dismissLabel} size={28} tooltip={false} className="mt-0.5" onClick={() => toast.dismiss(id)} />
        </div>
    );
}
