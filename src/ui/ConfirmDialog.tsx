import { useRef, type ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

export interface ConfirmDialogProps {
    open: boolean;
    title: ReactNode;
    description?: ReactNode;
    children?: ReactNode;
    /** Translated by the caller (no i18n inside primitives). */
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void;
    /** Cancel button, Esc and backdrop click. */
    onCancel: () => void;
    /** Destructive action: danger confirm button and initial focus on Cancel (UI-26). */
    danger?: boolean;
    /** Confirm in progress: spinner on the confirm button; Cancel (aria-disabled, keeps focus), Esc and backdrop no longer cancel. */
    loading?: boolean;
    closeOnBackdrop?: boolean;
}

/**
 * Confirmation on top of Dialog (role="alertdialog"): Cancel + Confirm buttons, `danger` variant for destructive actions.
 * Focus starts on Confirm, or on Cancel for a danger confirmation so Enter never destroys by accident.
 */
export function ConfirmDialog({
    open,
    title,
    description,
    children,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
    danger = false,
    loading = false,
    closeOnBackdrop = true,
}: ConfirmDialogProps) {
    const confirmRef = useRef<HTMLButtonElement>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);
    const cancel = () => {
        if (!loading) onCancel();
    };

    return (
        <Dialog
            open={open}
            role="alertdialog"
            size="sm"
            title={title}
            description={description}
            closeOnBackdrop={closeOnBackdrop}
            initialFocus={danger ? cancelRef : confirmRef}
            onClose={cancel}
            footer={
                <>
                    <Button ref={cancelRef} variant="secondary" aria-disabled={loading || undefined} onClick={cancel}>
                        {cancelLabel}
                    </Button>
                    <Button ref={confirmRef} variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
                        {confirmLabel}
                    </Button>
                </>
            }
        >
            {children}
        </Dialog>
    );
}
