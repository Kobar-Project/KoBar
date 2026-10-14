import React, { useRef, useState } from 'react';
import { closeDataTransferDialog, useDataTransferMode, type TransferMode } from '../../backup/dataTransferDialog';
import { useT } from '../../i18n/useT';
import { downloadExport, importFromFile } from '../../store/dataTransfer';
import { Button, Dialog } from '../../ui';

// T-615b: the main window's settings / notes export-import dialog. The Settings window cannot pick or read a file for this window, so
// its buttons relay `data.exportSettings` / `data.exportNotes` / `data.importSettings` / `data.importNotes` (src/store/systemSync.ts);
// this dialog then runs the SAME code as the old settings panel (src/store/dataTransfer.ts, validation in src/store/importExport.ts).
// Export has its own button here: the browser download needs a user gesture, which the relayed action does not carry.
const COPY: Record<
    TransferMode,
    { title: 'exportSettings' | 'exportData' | 'importSettings' | 'importData'; desc: 'exportSettingsDesc' | 'exportDataDesc' | null }
> = {
    exportSettings: { title: 'exportSettings', desc: 'exportSettingsDesc' },
    exportNotes: { title: 'exportData', desc: 'exportDataDesc' },
    importSettings: { title: 'importSettings', desc: null },
    importNotes: { title: 'importData', desc: null },
};

const TransferBody: React.FC<{ mode: TransferMode }> = ({ mode }) => {
    const t = useT();
    const fileRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    const isExport = mode === 'exportSettings' || mode === 'exportNotes';
    const kind = mode === 'exportSettings' || mode === 'importSettings' ? 'settings' : 'data';
    const copy = COPY[mode];

    const notify = (title: string, body: string) => window.api?.sendNotification?.(title, body);

    const handleExport = () => {
        downloadExport(kind);
        notify(t('exportDone'), t(kind === 'settings' ? 'exportSettingsSuccess' : 'exportDataSuccess'));
        closeDataTransferDialog();
    };

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const input = e.target;
        const file = input.files?.[0];
        input.value = '';
        if (!file || busy) return;
        setBusy(true);
        setError(false);
        const ok = await importFromFile(kind, file);
        if (!ok) {
            notify(t('import'), t('importInvalidFile'));
            setError(true);
            setBusy(false);
            return;
        }
        notify(t('import'), t(kind === 'settings' ? 'importSettingsSuccess' : 'importDataSuccess'));
        closeDataTransferDialog();
    };

    return (
        <div className="flex flex-col gap-3">
            {copy.desc && <p className="text-[0.8125rem] leading-5 text-fg-2">{t(copy.desc)}</p>}
            {isExport ? (
                <div>
                    <Button variant="primary" icon="download" onClick={handleExport}>
                        {t('downloadJson')}
                    </Button>
                </div>
            ) : (
                <div>
                    <input
                        data-testid="transfer-file"
                        type="file"
                        accept=".json"
                        className="hidden"
                        ref={fileRef}
                        onChange={(e) => void handleFile(e)}
                    />
                    <Button variant="primary" icon="upload" loading={busy} disabled={busy} onClick={() => fileRef.current?.click()}>
                        {t('import')}
                    </Button>
                </div>
            )}
            {error && (
                <p role="alert" className="rounded-sm border border-stroke px-2 py-1.5 text-[0.8125rem] leading-5 text-fg-1">
                    {t('importInvalidFile')}
                </p>
            )}
        </div>
    );
};

const DataTransferDialogHost: React.FC = () => {
    const t = useT();
    const mode = useDataTransferMode();
    const title = t(COPY[mode ?? 'exportSettings'].title);
    return (
        <Dialog
            open={mode !== null}
            onClose={closeDataTransferDialog}
            title={title}
            size="sm"
            closeOnBackdrop={false}
            closeLabel={t('backupCancel')}
        >
            {mode && <TransferBody key={mode} mode={mode} />}
        </Dialog>
    );
};

export default DataTransferDialogHost;
