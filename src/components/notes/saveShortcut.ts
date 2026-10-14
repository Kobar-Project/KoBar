// Ctrl+S / Cmd+S inside the note editor. Notes are autosaved on every edit, so the shortcut must
// not export or download anything; it only has to stop the browser's own "save page" behaviour.
export function isSaveShortcut(e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'key'>): boolean {
    return (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's';
}

export function swallowSaveShortcut(e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'key' | 'preventDefault'>): boolean {
    if (!isSaveShortcut(e)) return false;
    e.preventDefault();
    return true;
}
