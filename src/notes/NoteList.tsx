import type { ReactNode } from 'react';
import { IconButton, ListItem } from '../ui';
import { NoteListResizer } from './NoteListResizer';

export interface NoteListEntry {
    id: number;
    title: string;
    icon: string;
    emoji: string | null;
    /** Pseudo-notes (the plugin host) have no emoji picker. */
    pseudo: boolean;
}

export interface NoteListLabels {
    /** aria-label of the list. */
    list: string;
    add: string;
    changeIcon: string;
    close: string;
    /** aria-label of the resize separator. */
    resize: string;
}

export interface NoteListProps {
    entries: readonly NoteListEntry[];
    activeNoteId: number | null;
    labels: NoteListLabels;
    onSelect: (id: number) => void;
    onAdd: () => void;
    onClose: (id: number, event: React.MouseEvent<HTMLButtonElement>) => void;
    onChangeIcon: (id: number, event: React.MouseEvent<HTMLButtonElement>) => void;
    /** Extra footer controls next to the add button (panel shortcuts). */
    footer?: ReactNode;
    /** Column width in px (R-11). */
    width: number;
    onWidthChange: (width: number) => void;
    onWidthReset: () => void;
}

/** Left column of the note panel (T-616): one row per note, selection by click or Enter/Space, an add button below. */
export function NoteList({
    entries,
    activeNoteId,
    labels,
    onSelect,
    onAdd,
    onClose,
    onChangeIcon,
    footer,
    width,
    onWidthChange,
    onWidthReset,
}: NoteListProps) {
    return (
        <div className="no-drag-region relative flex h-full shrink-0 flex-col border-e border-stroke" style={{ width }}>
            <ul aria-label={labels.list} className="m-0 flex min-h-0 flex-1 list-none flex-col gap-0.5 overflow-y-auto p-2">
                {entries.map((entry) => (
                    <ListItem
                        key={entry.id}
                        as="li"
                        data-note-id={entry.id}
                        title={entry.title}
                        leading={
                            entry.emoji ? (
                                <span aria-hidden="true" className="text-[18px] leading-none">
                                    {entry.emoji}
                                </span>
                            ) : (
                                entry.icon
                            )
                        }
                        selected={entry.id === activeNoteId}
                        onClick={() => onSelect(entry.id)}
                        trailing={
                            <>
                                {!entry.pseudo && (
                                    <IconButton
                                        icon="add_reaction"
                                        label={labels.changeIcon}
                                        size={28}
                                        tooltip={false}
                                        className="emoji-trigger"
                                        onClick={(e) => onChangeIcon(entry.id, e)}
                                    />
                                )}
                                <IconButton
                                    icon="close"
                                    label={labels.close}
                                    size={28}
                                    tooltip={false}
                                    onClick={(e) => onClose(entry.id, e)}
                                />
                            </>
                        }
                    />
                ))}
            </ul>
            <div className="flex shrink-0 items-center gap-1 border-t border-stroke p-2">
                <IconButton icon="add" label={labels.add} size={32} tooltip={false} onClick={onAdd} />
                {footer}
            </div>
            <NoteListResizer width={width} label={labels.resize} onChange={onWidthChange} onReset={onWidthReset} />
        </div>
    );
}
