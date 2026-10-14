// T-314: the native confirmation for plugin management, moved unchanged out of main.cts. Fails closed: refused or cancelled means "do not proceed".
// The "a dialog is already open" flag and the dialog itself stay in main.cts (they are shared with the other confirm-class requests), so they are injected.
import { type MainLang } from '../../../lib/mainStrings.cjs';
import { type PluginAction, PLUGIN_BUSY_REASON, PLUGIN_CANCELED_REASON, buildPluginConfirmation } from '../../../lib/pluginConfirm.cjs';

export interface PluginConfirmDeps {
    getUiLanguage: () => Promise<MainLang>;
    confirmWithUser: (message: string, detail?: string, confirmLabel?: string) => Promise<boolean>;
    /** Live read of main.cts's `confirmInFlight` (never a copy). */
    isConfirmInFlight: () => boolean;
}

export function createPluginConfirm(deps: PluginConfirmDeps) {
    const { getUiLanguage, confirmWithUser, isConfirmInFlight } = deps;

    // Native confirmation for plugin management. Fails closed: refused or cancelled means "do not proceed".
    async function confirmPluginAction(action: PluginAction): Promise<'ok' | 'cancel' | 'busy'> {
        if (isConfirmInFlight()) return 'busy';
        const c = buildPluginConfirmation(action, await getUiLanguage());
        // Another dialog may have opened while the language was being read.
        if (isConfirmInFlight()) return 'busy';
        return (await confirmWithUser(c.message, c.detail, c.confirmLabel)) ? 'ok' : 'cancel';
    }

    return { confirmPluginAction };
}

export type PluginConfirm = ReturnType<typeof createPluginConfirm>;

export function declinedReason(outcome: 'cancel' | 'busy'): string {
    return outcome === 'busy' ? PLUGIN_BUSY_REASON : PLUGIN_CANCELED_REASON;
}
