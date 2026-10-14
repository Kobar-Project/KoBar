// T-612: Settings > Workspaces. Create (save the current layout, optionally isolated), switch, rename and delete workspaces.
// The page reads a small summary (id, name, two flags: src/store/workspaceSummary.ts) through the read-only mirror and only sends
// allow-listed `workspace.*` actions; the main window validates them against its live list and runs the SAME store actions the old
// Workspaces screen used (src/store/workspaceSync.ts). Nothing is optimistic: a row shows what the main window reported.
// The summary holds no notes and no isolated data. Deleting asks first (ConfirmDialog) and says what is lost; the main window then
// takes its automatic backup before deleting, exactly like the old screen.
import { useId, useState, type FormEvent } from 'react';
import type { TranslationKeys } from '../../i18n';
import { WORKSPACE_SUMMARY_LIMITS } from '../../store/workspaceSummary';
import { Button, ConfirmDialog, Dialog, EmptyState, IconButton, ListItem, Surface, TextField, Toggle } from '../../ui';
import { dispatchWorkspaceAction, useSettingsState, useWorkspaceSummary } from '../mirror';
import type { SettingsPageProps } from '../pages';

const HINT = 'text-[0.6875rem] leading-4 text-fg-2';
const SECTION_LABEL = 'text-[0.8125rem] leading-5 font-semibold text-fg-1';

const fill = (text: string, name: string) => text.replace('{name}', () => name);

export function WorkspacesPage({ t }: SettingsPageProps) {
    const ready = useSettingsState((s) => s.status === 'ready' && s.state !== null);
    const summary = useWorkspaceSummary();
    const newId = useId();
    const listId = useId();
    const [name, setName] = useState('');
    const [isolated, setIsolated] = useState(false);
    const [renameId, setRenameId] = useState<string | null>(null);
    const [renameDraft, setRenameDraft] = useState('');
    const [deleteId, setDeleteId] = useState<string | null>(null);

    const items = summary?.items ?? [];
    // The dialogs follow the live list: when the workspace is gone (deleted, or the main window reloaded) they close by themselves.
    const renaming = renameId === null ? undefined : items.find((item) => item.id === renameId);
    const deleting = deleteId === null ? undefined : items.find((item) => item.id === deleteId);
    const canAct = ready && !!summary;
    const trimmed = name.trim();
    const draftTrimmed = renameDraft.trim();

    const create = (event: FormEvent) => {
        event.preventDefault();
        if (!canAct || trimmed === '') return;
        dispatchWorkspaceAction('workspace.create', { name: trimmed, isolated });
        setName('');
        setIsolated(false);
    };

    const submitRename = (event: FormEvent) => {
        event.preventDefault();
        if (renaming && draftTrimmed !== '') dispatchWorkspaceAction('workspace.rename', { id: renaming.id, name: draftTrimmed });
        setRenameId(null);
    };

    const deleteNotes: TranslationKeys[] = [];
    if (deleting) {
        deleteNotes.push('workspaceDeleteConfirm');
        deleteNotes.push(deleting.hasIsolatedData ? 'workspaceDeleteIsoNote' : 'settingsWorkspacesDeleteSharedNote');
        if (deleting.active) deleteNotes.push('workspaceDeleteActiveNote');
    }

    return (
        <div className="flex max-w-xl flex-col gap-4">
            {!ready && (
                <p role="status" className="text-[0.8125rem] leading-5 text-fg-2">
                    {t('settingsWaiting')}
                </p>
            )}
            <p className="text-[0.8125rem] leading-5 text-fg-2">{t('settingsWorkspacesAbout')}</p>
            <Surface as="section" level="surface" elevation="e1" radius="lg" aria-labelledby={newId} className="flex flex-col gap-3 p-4">
                <span id={newId} className={SECTION_LABEL}>
                    {t('settingsWorkspacesNewTitle')}
                </span>
                <form onSubmit={create} className="flex flex-col gap-3">
                    <TextField
                        label={t('settingsWorkspacesNameLabel')}
                        placeholder={t('workspaceNamePlaceholder')}
                        maxLength={WORKSPACE_SUMMARY_LIMITS.name}
                        value={name}
                        disabled={!canAct}
                        onChange={(event) => setName(event.target.value)}
                    />
                    <Toggle
                        label={t('isolateData')}
                        description={t('isolateDataDesc')}
                        checked={isolated}
                        disabled={!canAct}
                        onChange={setIsolated}
                        fullWidth
                    />
                    <div>
                        <Button type="submit" variant="primary" icon="add" disabled={!canAct || trimmed === ''}>
                            {t('settingsWorkspacesCreate')}
                        </Button>
                    </div>
                </form>
            </Surface>
            <Surface as="section" level="surface" elevation="e1" radius="lg" aria-labelledby={listId} className="flex flex-col gap-2 p-4">
                <span id={listId} className={SECTION_LABEL}>
                    {t('settingsWorkspacesListTitle')}
                </span>
                {!summary ? (
                    <span role="status" className={HINT}>
                        {t('settingsWorkspacesLoading')}
                    </span>
                ) : items.length === 0 ? (
                    <EmptyState icon="space_dashboard" title={t('workspacesEmpty')} />
                ) : (
                    <ul aria-labelledby={listId} className="flex flex-col gap-0.5">
                        {items.map((item) => (
                            <ListItem
                                key={item.id}
                                as="li"
                                leading="space_dashboard"
                                title={item.name}
                                selected={item.active}
                                description={[
                                    item.active ? t('activeWorkspace') : null,
                                    item.isolated ? t('isolatedBadge') : t('sharedBadge'),
                                ]
                                    .filter(Boolean)
                                    .join(' · ')}
                                trailing={
                                    <>
                                        {!item.active && (
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                disabled={!canAct}
                                                aria-label={`${t('loadWorkspace')}: ${item.name}`}
                                                onClick={() => dispatchWorkspaceAction('workspace.switch', { id: item.id })}
                                            >
                                                {t('loadWorkspace')}
                                            </Button>
                                        )}
                                        <IconButton
                                            icon="edit"
                                            label={`${t('renameWorkspace')}: ${item.name}`}
                                            tooltip={t('renameWorkspace')}
                                            size={28}
                                            disabled={!canAct}
                                            onClick={() => {
                                                setRenameDraft(item.name);
                                                setRenameId(item.id);
                                            }}
                                        />
                                        <IconButton
                                            icon="delete"
                                            label={`${t('deleteWorkspace')}: ${item.name}`}
                                            tooltip={t('deleteWorkspace')}
                                            size={28}
                                            disabled={!canAct}
                                            onClick={() => setDeleteId(item.id)}
                                        />
                                    </>
                                }
                            />
                        ))}
                    </ul>
                )}
            </Surface>
            <Dialog
                open={!!renaming}
                size="sm"
                title={fill(t('settingsWorkspacesRenameTitle'), renaming?.name ?? '')}
                onClose={() => setRenameId(null)}
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setRenameId(null)}>
                            {t('cancel')}
                        </Button>
                        <Button variant="primary" type="submit" form={`${listId}-rename`} disabled={draftTrimmed === ''}>
                            {t('renameWorkspace')}
                        </Button>
                    </>
                }
            >
                <form id={`${listId}-rename`} onSubmit={submitRename}>
                    <TextField
                        label={t('settingsWorkspacesNameLabel')}
                        maxLength={WORKSPACE_SUMMARY_LIMITS.name}
                        value={renameDraft}
                        onChange={(event) => setRenameDraft(event.target.value)}
                    />
                </form>
            </Dialog>
            <ConfirmDialog
                open={!!deleting}
                danger
                title={fill(t('settingsWorkspacesDeleteTitle'), deleting?.name ?? '')}
                description={
                    <span className="flex flex-col gap-1.5">
                        {deleteNotes.map((key) => (
                            <span key={key}>{fill(t(key), deleting?.name ?? '')}</span>
                        ))}
                    </span>
                }
                confirmLabel={t('deleteWorkspace')}
                cancelLabel={t('cancel')}
                onCancel={() => setDeleteId(null)}
                onConfirm={() => {
                    if (deleting) dispatchWorkspaceAction('workspace.delete', { id: deleting.id });
                    setDeleteId(null);
                }}
            />
        </div>
    );
}
