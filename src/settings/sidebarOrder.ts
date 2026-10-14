// T-609: pure helpers of the Settings › Sidebar order list.

/** Moves `order[index]` by `delta` places; returns an unchanged copy when the move is out of range. Pure. */
export function moveItem<T>(order: readonly T[], index: number, delta: number): T[] {
    const target = index + delta;
    const next = [...order];
    if (index < 0 || index >= order.length || target < 0 || target >= order.length) return next;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    return next;
}

/** The Settings window has no plugin registry, so a button is named after its id ("todolist-plugin-btn" -> "Todolist"). */
export function featureLabel(id: string): string {
    const base = id
        .replace(/^com\.kobar\./, '')
        .replace(/[-.]?(plugin-)?btn$/, '')
        .replace(/^kobar-/, '')
        .replace(/-plugin$/, '')
        .replace(/[-_.]+/g, ' ')
        .trim();
    const text = base || id;
    return text.charAt(0).toUpperCase() + text.slice(1);
}
