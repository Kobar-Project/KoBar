import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cx, INTERACTIVE } from '../ui/cx';
import { clampNoteListWidth, noteListWidthForKey, NOTE_LIST_WIDTH_MAX, NOTE_LIST_WIDTH_MIN } from './noteListWidth';

export interface NoteListResizerProps {
    width: number;
    /** Accessible name of the separator. */
    label: string;
    onChange: (width: number) => void;
    /** Double click: back to the default width. */
    onReset: () => void;
}

const isRtl = (el: HTMLElement) => getComputedStyle(el).direction === 'rtl';

/**
 * Draggable divider on the inline-end edge of the note list (R-11). Pointer drag with pointer capture, arrow keys move by
 * 16 px (Home/End jump to the bounds), double click resets. Exposed as a vertical `separator` with aria-value* in px.
 */
export function NoteListResizer({ width, label, onChange, onReset }: NoteListResizerProps) {
    const drag = useRef<{ startX: number; startWidth: number; sign: 1 | -1 } | null>(null);
    const [dragging, setDragging] = useState(false);

    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { startX: e.clientX, startWidth: width, sign: isRtl(e.currentTarget) ? -1 : 1 };
        setDragging(true);
        e.preventDefault();
    };
    const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
        const d = drag.current;
        if (!d) return;
        onChange(clampNoteListWidth(d.startWidth + d.sign * (e.clientX - d.startX)));
    };
    const endDrag = (e: PointerEvent<HTMLDivElement>) => {
        if (!drag.current) return;
        drag.current = null;
        setDragging(false);
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    };
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const next = noteListWidthForKey(e.key, width, isRtl(e.currentTarget));
        if (next === null) return;
        e.preventDefault();
        onChange(next);
    };

    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label={label}
            aria-valuenow={width}
            aria-valuemin={NOTE_LIST_WIDTH_MIN}
            aria-valuemax={NOTE_LIST_WIDTH_MAX}
            tabIndex={0}
            data-dragging={dragging ? 'true' : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
            onDoubleClick={onReset}
            className={cx(INTERACTIVE, 'group absolute inset-y-0 -end-1.5 z-10 flex w-3 cursor-col-resize touch-none justify-center')}
        >
            <span
                aria-hidden="true"
                className={cx(
                    'h-full w-0.5 rounded-full transition-colors duration-[var(--kb-dur-fast)] group-hover:bg-[var(--kb-accent)]',
                    dragging ? 'bg-[var(--kb-accent)]' : 'bg-transparent'
                )}
            />
        </div>
    );
}
