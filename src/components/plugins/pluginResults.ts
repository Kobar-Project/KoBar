// Result reason the main process returns when the user cancels a plugin install confirmation.
// Must stay in sync with PLUGIN_CANCELED_REASON in electron/lib/pluginConfirm.cts.
export const PLUGIN_CANCELED_REASON = 'Canceled by user';

// Result reason for a plugin that needs a newer KoBar (T-220). Must stay in sync with
// PLUGIN_NEEDS_APP_UPDATE_REASON in electron/lib/pluginApiGate.cts.
export const PLUGIN_NEEDS_APP_UPDATE_REASON = 'needs-app-update';

/**
 * Returns the localised "Please update KoBar" text when `reason` is the needs-app-update code, otherwise null
 * (the caller then shows its normal failure text).
 */
export function needsAppUpdateMessage(reason: string | undefined, t: (key: 'pluginNeedsAppUpdate') => string): string | null {
    return reason === PLUGIN_NEEDS_APP_UPDATE_REASON ? t('pluginNeedsAppUpdate') : null;
}
