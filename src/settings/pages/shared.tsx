// CNL-08: small pieces shared by the Canlı settings pages.
import type { ReactNode } from 'react';
import { cx } from '../../ui/cx';

/** "Waiting for the main window" line shown until the first mirror snapshot arrived. */
export function WaitingNote({ children }: { children: ReactNode }) {
    return (
        <p role="status" className="[font:var(--kb-type-caption)] text-fg-2">
            {children}
        </p>
    );
}

/** Static (non-interactive) chip: a small tonal label such as "Experimental" or "Dev". */
export function StaticChip({
    children,
    tone = 'container',
    className,
}: {
    children: ReactNode;
    tone?: 'container' | 'inset';
    className?: string;
}) {
    return (
        <span
            className={cx(
                'inline-flex h-6 shrink-0 items-center rounded-full px-2.5 [font:var(--kb-type-label)]',
                tone === 'container' ? 'bg-container text-on-container' : 'bg-inset text-fg-2',
                className
            )}
        >
            {children}
        </span>
    );
}

/** Vertical stack of cards: the page body. */
export const PAGE_STACK = 'flex flex-col gap-3';
