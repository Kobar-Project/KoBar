import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import { hasContent } from './fieldProps';
import { IconTile } from './IconTile';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
    /** Decorative Material Symbols icon name. */
    icon?: string;
    title: ReactNode;
    description?: ReactNode;
    /** Usually one Button ("Try again", "Browse plugins"). */
    action?: ReactNode;
}

/** Placeholder for empty or failed lists: dashed outline, icon tile, title, one sentence and one action (filled if it is the screen's main action, else tonal). */
export function EmptyState({ icon, title, description, action, className, ...rest }: EmptyStateProps) {
    return (
        <div
            {...rest}
            className={cx(
                'flex flex-col items-center justify-center gap-2 rounded-[28px] border-2 border-dashed border-stroke px-5 py-7 text-center',
                className
            )}
        >
            {icon && <IconTile icon={icon} size="xl" className="mb-1" />}
            <p className="[font:var(--kb-type-subtitle)] text-fg-1">{title}</p>
            {hasContent(description) && <p className="max-w-64 [font:var(--kb-type-caption)] text-fg-2">{description}</p>}
            {hasContent(action) && <div className="pointer-events-auto mt-2 flex items-center gap-2">{action}</div>}
        </div>
    );
}
