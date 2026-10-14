import type { ReactNode } from 'react';
import { cx } from './cx';
import type { FieldIds } from './fieldProps';
import { Icon } from './Icon';

interface FieldShellProps {
    ids: FieldIds;
    label: ReactNode;
    hideLabel: boolean;
    hint?: ReactNode;
    error?: ReactNode;
    disabled?: boolean;
    className?: string;
    children: ReactNode;
}

/** Label + control + hint + error layout shared by TextField and Select (internal, not exported from src/ui). */
export function FieldShell({ ids, label, hideLabel, hint, error, disabled, className, children }: FieldShellProps) {
    return (
        <div className={cx('no-drag-region pointer-events-auto flex min-w-0 flex-col gap-1', className)}>
            <label
                htmlFor={ids.controlId}
                className={cx('text-[0.8125rem] leading-5', disabled ? 'text-fg-3' : 'text-fg-1', hideLabel && 'sr-only')}
            >
                {label}
            </label>
            {children}
            {ids.hintId && (
                <span id={ids.hintId} className="text-[0.6875rem] leading-4 text-fg-2">
                    {hint}
                </span>
            )}
            {ids.errorId && (
                // Icon + text, so the error never relies on colour alone.
                <span id={ids.errorId} className="flex items-center gap-1 text-[0.6875rem] leading-4 text-[var(--kb-danger)]">
                    <Icon name="error" size={16} />
                    <span>{error}</span>
                </span>
            )}
        </div>
    );
}
