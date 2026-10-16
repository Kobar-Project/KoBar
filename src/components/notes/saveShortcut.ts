// Ctrl+S / Ctrl+Shift+S / Cmd+S inside the note editor: opens the "save note as text file" dialog (see NoteEditor).
// The swallow helper below is kept for callers that only need to stop the browser's own "save page" behaviour.
export function isSaveShortcut(e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'key'>): boolean {
    return (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's';
}

export function swallowSaveShortcut(e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'key' | 'preventDefault'>): boolean {
    if (!isSaveShortcut(e)) return false;
    e.preventDefault();
    return true;
}
