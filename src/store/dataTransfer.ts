// T-615b: the settings / notes JSON export and import, extracted from the old settings panel so the panel and the main window's
// transfer dialog (src/components/notes/DataTransferDialogHost.tsx, opened by the relayed `data.*` actions) run the SAME code.
// Validation stays in src/store/importExport.ts (T-209, T-418); nothing here re-implements it.
import { approvedPluginIdsFromSources } from '../backup/pluginFlagRules';
import { centeredEyePosition, computeVisibleArea } from '../utils/visibleArea';
import { getWindowGeometry } from '../utils/windowGeometry';
import { buildDataExport, buildSettingsExport, buildSettingsImport, IMPORT_LIMITS, parseDataImport } from './importExport';
import { useAppStore } from './useAppStore';

export type TransferKind = 'settings' | 'data';

/** Builds the export JSON and hands it to the browser download (Electron shows its save dialog). Needs a user gesture to be reliable. */
export function downloadExport(kind: TransferKind): void {
    const state = useAppStore.getState();
    const payload = kind === 'settings' ? buildSettingsExport(state) : buildDataExport(state);
    const jsonString = JSON.stringify(payload, null, 2);

    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kobar-${kind}-export.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function readText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(typeof e.target?.result === 'string' ? e.target.result : '');
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

/** Switches to mini mode and teleports to the centre as if it were a fresh start (the behaviour after a settings import). */
function switchToMiniMode(): void {
    const state = useAppStore.getState();
    if (state.isMac) {
        const visibleHeight = state.screenBounds?.height ?? getWindowGeometry().fallbackScreenHeight;
        state.setMiniMode(true, {
            x: Math.floor(window.innerWidth / 2),
            y: Math.floor(visibleHeight / 2),
        });
    } else {
        // T-322: the centre of the usable screen area (work area) in window coordinates.
        state.setMiniMode(true, centeredEyePosition(computeVisibleArea(getWindowGeometry(), state.screenBounds)));
    }
}

/** Reads, validates and applies one import file. Resolves `true` on success, `false` for any invalid / oversized / unreadable file. */
export async function importFromFile(kind: TransferKind, file: File): Promise<boolean> {
    // T-209: an oversized file is refused before it is read (UTF-8 is at most 4 bytes per character).
    if (file.size > IMPORT_LIMITS.maxFileChars * 4) return false;
    try {
        const jsonStr = await readText(file);
        if (kind === 'data') {
            // T-209: validated notes go through the store action so they land in the active data context.
            useAppStore.getState().addNotes(parseDataImport(jsonStr));
        } else {
            // T-418: imported workspace records may only keep enables of plugins approved here (installed and not
            // disabled in extensions-config.json), the same rule as a backup restore (T-415). Unknown: none.
            let sources: unknown = null;
            try {
                sources = await window.api?.getBackupSources?.();
            } catch {
                sources = null;
            }
            // T-209: whitelisted + zod-validated + migrated; workspaces merged by id, local isolatedData kept.
            useAppStore.setState(buildSettingsImport(jsonStr, useAppStore.getState(), approvedPluginIdsFromSources(sources)));
            switchToMiniMode();
        }
        return true;
    } catch (err) {
        console.error('Import failed', err);
        return false;
    }
}
