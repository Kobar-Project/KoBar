import React, { useState } from 'react';
import { closeRestoreDialog, useRestoreDialogOpen } from '../../backup/restoreDialog';
import { useT } from '../../i18n/useT';
import { Dialog } from '../../ui';
import RestoreFlow from './RestoreFlow';

// T-615a: the main window's restore dialog. The Settings window cannot hand a file to this window, so its Restore button relays
// `backup.restore` (src/store/systemSync.ts) and this dialog (transient state, src/backup/restoreDialog.ts) runs the SAME restore
// flow as the old settings panel: file pick, validation, automatic pre-restore backup, confirmation, relaunch.
const RestoreDialogHost: React.FC = () => {
    const t = useT();
    const open = useRestoreDialogOpen();
    const [busy, setBusy] = useState(false);
    return (
        <Dialog
            open={open}
            onClose={() => {
                // Never close while a restore step is running (the app relaunches itself when it succeeds).
                if (!busy) closeRestoreDialog();
            }}
            title={t('backupRestore')}
            size="md"
            closeOnBackdrop={false}
            closeLabel={t('backupCancel')}
        >
            <RestoreFlow onBusyChange={setBusy} />
        </Dialog>
    );
};

export default RestoreDialogHost;
