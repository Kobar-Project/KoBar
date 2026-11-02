import type { ReactNode } from 'react';
import { cx } from './cx';
import { hasContent } from './fieldProps';
import { IconTile } from './IconTile';
import { Surface, type SurfaceProps } from './Surface';

export type CardVariant = 'setting' | 'stat' | 'list';

export interface CardProps extends Omit<SurfaceProps, 'title' | 'level' | 'elevation' | 'material' | 'radius'> {
    /**
     * `setting`: icon tile + text + control in one row. `stat`: icon tile top-left, control top-right, title and description
     * below (2-column bento). `list`: title row (+ control) with `children` underneath.
     */
    variant?: CardVariant;
    /** Material Symbols name for the icon tile (setting and stat). */
    icon?: string;
    title: ReactNode;
    description?: ReactNode;
    /** Trailing control (Toggle, Select, IconButton...). Give a Toggle `hideLabel`: the card's title is its visible label. */
    control?: ReactNode;
}

/** Card on `Surface` (surface fill, radius 24, no shadow, light-scheme line). Marked `data-kb-card` for the forced-colors border. */
export function Card({ variant = 'setting', icon, title, description, control, children, className, ...rest }: CardProps) {
    const text = (
        <div className="flex min-w-0 flex-1 flex-col">
            <span className="[font:var(--kb-type-subtitle)] text-fg-1">{title}</span>
            {hasContent(description) && <span className="[font:var(--kb-type-caption)] text-fg-2">{description}</span>}
        </div>
    );
    const trailing = hasContent(control) && <div className="flex shrink-0 items-center gap-2">{control}</div>;

    return (
        <Surface {...rest} radius="xl" data-kb-card="" data-variant={variant} className={cx('px-5 py-[18px]', className)}>
            {variant === 'setting' && (
                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3.5">
                        {icon && <IconTile icon={icon} />}
                        {text}
                        {trailing}
                    </div>
                    {children}
                </div>
            )}
            {variant === 'stat' && (
                <div className="flex flex-col gap-3">
                    {(icon || trailing) && (
                        <div className="flex items-start justify-between gap-3">
                            {icon ? <IconTile icon={icon} /> : <span />}
                            {trailing}
                        </div>
                    )}
                    {text}
                    {children}
                </div>
            )}
            {variant === 'list' && (
                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                        {text}
                        {trailing}
                    </div>
                    {children}
                </div>
            )}
        </Surface>
    );
}
