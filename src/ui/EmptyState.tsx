import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import { hasContent } from './fieldProps';
import { Icon } from './Icon';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
    /** Decorative Material Symbols icon name. */
    icon?: string;
    title: ReactNode;
    description?: ReactNode;
    /** Usually one Button ("Try again", "Browse plugins"). */
    action?: ReactNode;
}

/** Placeholder for empty or failed lists: icon, title, description and an optional action. */
export function EmptyState({ icon, title, description, action, className, ...rest }: EmptyStateProps) {
    return (
        <div {...rest} className={cx('flex flex-col items-center justify-center gap-2 px-4 py-8 text-center', className)}>
            {icon && (
                <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-[var(--kb-fill-hover)] text-fg-2">
                    <Icon name={icon} size={24} />
                </span>
            )}
            <p className="text-[0.8125rem] leading-5 font-semibold text-fg-1">{title}</p>
            {hasContent(description) && <p className="max-w-64 text-[0.75rem] leading-4 text-fg-2">{description}</p>}
            {hasContent(action) && <div className="pointer-events-auto mt-2 flex items-center gap-2">{action}</div>}
        </div>
    );
}
