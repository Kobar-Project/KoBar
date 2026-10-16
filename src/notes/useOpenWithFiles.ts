// "Open with KoBar": text files handed over by the main process (launch argument or second instance) become new notes, never edits of
// the original file. Waits for the store to hydrate, otherwise the persisted notes would replace the freshly added ones.
import { useEffect } from 'react';
import { translate } from '../i18n/translate';
import { useAppStore } from '../store/useAppStore';
import { finishTextImport } from './importTextFiles';

export function useOpenWithFiles(isHydrated: boolean): void {
    useEffect(() => {
        if (!isHydrated || !window.api?.takeOpenTextFiles) return;
        const collect = async () => {
            const { files, rejected } = await window.api.takeOpenTextFiles();
            // No `disposed` check on purpose: the queue is already drained here, dropping the result would lose the files (StrictMode remount).
            if (files.length === 0 && rejected.length === 0) return;
            const state = useAppStore.getState();
            const added = finishTextImport((key) => translate(state.language, key), files, rejected);
            if (added === 0) return;
            const { notes } = useAppStore.getState();
            const last = notes[notes.length - 1];
            if (last) useAppStore.getState().setActiveNoteId(last.id);
            useAppStore.getState().setMiniMode(false);
            useAppStore.getState().setNotePanelOpen(true);
        };
        void collect();
        const unsubscribe = window.api.onOpenTextFilesAvailable?.(() => void collect());
        return () => {
            unsubscribe?.();
        };
    }, [isHydrated]);
}
