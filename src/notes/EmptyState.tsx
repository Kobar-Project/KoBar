import { Button, EmptyState } from '../ui';

export interface NotesEmptyStateProps {
    title: string;
    description: string;
    addLabel: string;
    onAdd: () => void;
}

/** Shown in the editor area when there are no notes (T-623, UI-23); replaces the seeded welcome note. */
export function NotesEmptyState({ title, description, addLabel, onAdd }: NotesEmptyStateProps) {
    return (
        <EmptyState
            role="status"
            className="no-drag-region min-h-0 flex-1"
            icon="note_add"
            title={title}
            description={description}
            action={
                <Button variant="primary" icon="add" onClick={onAdd}>
                    {addLabel}
                </Button>
            }
        />
    );
}
