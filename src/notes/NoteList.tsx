import { useMemo, useState, type ReactNode } from 'react';
import { Chip, Icon, IconButton, TextField } from '../ui';
import { cx, INTERACTIVE } from '../ui/cx';
import { NoteListResizer } from './NoteListResizer';
import { filterNoteEntries, noteHueIndex, noteInitial, type NoteFilter, type NoteListEntry } from './noteListModel';

export type { NoteListEntry } from './noteListModel';

export interface NoteListLabels {
    /** aria-label of the list. */
    list: string;
    /** Visible column title. */
    title: string;
    add: string;
    /** Label of the import (.txt / .md files) button next to add. */
    import: string;
    changeIcon: string;
    close: string;
    /** aria-label of the resize separator. */
    resize: string;
    search: string;
    noMatch: string;
    filterAll: string;
    filterRecent: string;
}

export interface NoteListProps {
    entries: readonly NoteListEntry[];
    activeNoteId: number | null;
    labels: NoteListLabels;
    onSelect: (id: number) => void;
    onAdd: () => void;
    onImport: () => void;
    onClose: (id: number, event: React.MouseEvent<HTMLButtonElement>) => void;
    onChangeIcon: (id: number, event: React.MouseEvent<HTMLButtonElement>) => void;
    /** Extra footer controls next to the import button (panel shortcuts). */
    footer?: ReactNode;
    /** Column width in px (R-11). */
    width: number;
    onWidthChange: (width: number) => void;
    onWidthReset: () => void;
}

const HUE_CLASS: Record<number, string> = {
    1: 'bg-[var(--kb-note-hue-1)]',
    2: 'bg-[var(--kb-note-hue-2)]',
    3: 'bg-[var(--kb-note-hue-3)]',
    4: 'bg-[var(--kb-note-hue-4)]',
    5: 'bg-[var(--kb-note-hue-5)]',
    6: 'bg-[var(--kb-note-hue-6)]',
};

function NoteTile({ entry, selected }: { entry: NoteListEntry; selected: boolean }) {
    const base = 'flex size-[34px] shrink-0 items-center justify-center rounded-[11px]';
    if (entry.pseudo) {
        return (
            <span aria-hidden="true" className={cx(base, selected ? 'bg-accent text-on-accent' : 'bg-inset text-fg-2')}>
                <Icon name={entry.icon} size={18} filled={selected} />
            </span>
        );
    }
    return (
        <span
            aria-hidden="true"
            className={cx(
                base,
                selected ? 'bg-accent text-on-accent' : cx(HUE_CLASS[noteHueIndex(entry.id)], 'text-fg-1'),
                entry.emoji ? 'text-[18px] leading-none' : 'font-heading text-[16px] leading-none font-semibold'
            )}
        >
            {entry.emoji || noteInitial(entry.title)}
        </span>
    );
}

/** Left column of the note panel (T-616): header with the add button, search, filter chips and one card per note. */
export function NoteList({
    entries,
    activeNoteId,
    labels,
    onSelect,
    onAdd,
    onImport,
    onClose,
    onChangeIcon,
    footer,
    width,
    onWidthChange,
    onWidthReset,
}: NoteListProps) {
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<NoteFilter>('all');
    const visible = useMemo(() => filterNoteEntries(entries, filter, query), [entries, filter, query]);

    return (
        <div className="no-drag-region relative flex h-full shrink-0 flex-col gap-3" style={{ width }}>
            <div className="flex items-center justify-between gap-2 ps-2 pt-1">
                <h2 className="truncate font-heading text-[26px] leading-8 font-semibold text-fg-1">{labels.title}</h2>
                <button
                    type="button"
                    aria-label={labels.add}
                    onClick={onAdd}
                    className={cx(
                        INTERACTIVE,
                        'flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-[16px] bg-container text-accent transition-colors duration-[var(--kb-dur-fast)] hover:bg-[color-mix(in_oklab,var(--kb-fg-1)_6%,var(--kb-bg-container))] active:bg-[color-mix(in_oklab,var(--kb-fg-1)_10%,var(--kb-bg-container))]'
                    )}
                >
                    <Icon name="add" size={24} />
                </button>
            </div>
            <TextField
                variant="search"
                label={labels.search}
                hideLabel
                placeholder={labels.search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
            />
            <div className="flex items-center gap-2">
                <Chip selected={filter === 'all'} onClick={() => setFilter('all')}>
                    {labels.filterAll}
                </Chip>
                <Chip selected={filter === 'recent'} onClick={() => setFilter('recent')}>
                    {labels.filterRecent}
                </Chip>
            </div>
            <ul aria-label={labels.list} className="m-0 flex min-h-0 flex-1 list-none flex-col gap-1.5 overflow-y-auto p-0">
                {visible.map((entry) => {
                    const selected = entry.id === activeNoteId;
                    return (
                        <li
                            key={entry.id}
                            data-note-id={entry.id}
                            className={cx(
                                'group no-drag-region pointer-events-auto relative flex h-14 shrink-0 items-center rounded-[18px] transition-colors duration-[var(--kb-dur-fast)]',
                                selected ? 'bg-container text-on-container' : 'bg-tile text-fg-1 hover:bg-[var(--kb-fill-hover)]'
                            )}
                        >
                            <button
                                type="button"
                                aria-current={selected ? 'true' : undefined}
                                onClick={() => onSelect(entry.id)}
                                className={cx(
                                    INTERACTIVE,
                                    'flex h-full min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-[18px] ps-3 text-start'
                                )}
                            >
                                <NoteTile entry={entry} selected={selected} />
                                <span className="min-w-0 flex-1 truncate [font:var(--kb-type-body-strong)] text-[15px]">{entry.title}</span>
                            </button>
                            <span
                                className={cx(
                                    // Out of the layout until the card is hovered or focused, so titles use the full width.
                                    'shrink-0 items-center gap-0.5 pe-2 group-focus-within:flex group-hover:flex',
                                    selected ? 'flex' : 'hidden'
                                )}
                            >
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
                            </span>
                        </li>
                    );
                })}
                {visible.length === 0 && entries.length > 0 && (
                    <li role="status" className="px-3 py-6 text-center [font:var(--kb-type-caption)] text-fg-2">
                        {labels.noMatch}
                    </li>
                )}
            </ul>
            <div className="flex shrink-0 items-center gap-1 pb-1">
                <IconButton icon="upload_file" label={labels.import} size={32} tooltip={false} onClick={onImport} />
                {footer}
            </div>
            <NoteListResizer width={width} label={labels.resize} onChange={onWidthChange} onReset={onWidthReset} />
        </div>
    );
}
