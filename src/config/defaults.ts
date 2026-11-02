// Default order of the sidebar feature buttons (initial state and fallback when no order is stored).
// Always copy before storing it in state: `[...DEFAULT_FEATURE_ORDER]`.
export const DEFAULT_FEATURE_ORDER: readonly string[] = [
    'com.kobar.aihub.btn',
    'ko-calender-plugin-btn',
    'todolist-plugin-btn',
    'snippetvault-plugin-btn',
    'pininjector',
    'kobox',
    'kobar-colorpicker-plugin-btn',
    'calculator',
];

// Canlı (CNL-03): bar items a FRESH install shows as tiles; every other item starts as an icon, and a store migrated from
// v32 or older starts with no tiles at all (its bar stays thin and in the same order). The ids are the ids `featureOrder`
// holds: To-Do List registers the sidebar button "todolist-plugin-btn" (also in DEFAULT_FEATURE_ORDER above); Clipboard
// Manager currently registers only the inline widget "kobar-clipboard-manager-inline" (no sidebar button), whose id is
// what the sidebar adds to `featureOrder`. A size entry for an id that is not installed is inert.
export const DEFAULT_TILE_BAR_ITEM_IDS: readonly string[] = ['todolist-plugin-btn', 'kobar-clipboard-manager-inline'];
