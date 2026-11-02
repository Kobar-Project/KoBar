// T-612: Settings > Workspaces. Create (save the current layout, optionally isolated), switch, rename and delete workspaces.
// The page reads a small summary (id, name, two flags: src/store/workspaceSummary.ts) through the read-only mirror and only sends
// allow-listed `workspace.*` actions; the main window validates them against its live list and runs the SAME store actions the old
// Workspaces screen used (src/store/workspaceSync.ts). Nothing is optimistic: a row shows what the main window reported.
// The summary holds no notes and no isolated data. Deleting asks first (ConfirmDialog) and says what is lost; the main window then
// takes its automatic backup before deleting, exactly like the old screen.
// CNL-08 (Canlı): a hero card for "save the current layout", a list card (name, mode chip, tonal Activate, a "..." menu with
// Rename / Delete) and an about card. Behaviour, dialogs and actions are unchanged.
import { useId, useState, type FormEvent } from 'react';
import type { TranslationKeys } from '../../i18n';
import { WORKSPACE_SUMMARY_LIMITS } from '../../store/workspaceSummary';
import { Button, Card, ConfirmDialog, Dialog, EmptyState, IconButton, IconTile, Menu, TextField, Toggle } from '../../ui';
import { dispatchWorkspaceAction, useSettingsState, useWorkspaceSummary } from '../mirror';
import type { SettingsPageProps } from '../pages';
import { PAGE_STACK, StaticChip, WaitingNote } from './shared';

const HINT = '[font:var(--kb-type-caption)] text-fg-2';

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
        <div className={PAGE_STACK}>
            {!ready && <WaitingNote>{t('settingsWaiting')}</WaitingNote>}
            <section aria-labelledby={newId} className="flex flex-col gap-3 rounded-xl bg-container p-5 text-on-container">
                <span id={newId} className="[font:var(--kb-type-title)]">
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
                        <Button type="submit" variant="filled" icon="add" disabled={!canAct || trimmed === ''}>
                            {t('settingsWorkspacesCreate')}
                        </Button>
                    </div>
                </form>
            </section>
            <Card as="section" variant="list" aria-labelledby={listId} title={<span id={listId}>{t('settingsWorkspacesListTitle')}</span>}>
                {!summary ? (
                    <span role="status" className={HINT}>
                        {t('settingsWorkspacesLoading')}
                    </span>
                ) : items.length === 0 ? (
                    <EmptyState icon="space_dashboard" title={t('workspacesEmpty')} />
                ) : (
                    <ul aria-labelledby={listId} className="flex flex-col gap-2">
                        {items.map((item) => (
                            <li key={item.id} className="flex min-w-0 items-center gap-3 rounded-lg bg-surface p-3.5">
                                <IconTile icon="space_dashboard" size="md" muted={!item.active} />
                                <div className="flex min-w-0 flex-1 flex-col gap-1">
                                    <span className="truncate [font:var(--kb-type-body-strong)] text-fg-1">{item.name}</span>
                                    <span className="flex flex-wrap gap-1.5">
                                        {item.active && <StaticChip>{t('activeWorkspace')}</StaticChip>}
                                        <StaticChip tone="inset">{item.isolated ? t('isolatedBadge') : t('sharedBadge')}</StaticChip>
                                    </span>
                                </div>
                                {!item.active && (
                                    <Button
                                        size="sm"
                                        variant="tonal"
                                        disabled={!canAct}
                                        aria-label={`${t('loadWorkspace')}: ${item.name}`}
                                        onClick={() => dispatchWorkspaceAction('workspace.switch', { id: item.id })}
                                    >
                                        {t('workspaceActivate')}
                                    </Button>
                                )}
                                <Menu
                                    placement="bottom-end"
                                    aria-label={t('barItemMenu').replace('{name}', item.name)}
                                    trigger={
                                        <IconButton
                                            icon="more_horiz"
                                            label={t('barItemMenu').replace('{name}', item.name)}
                                            size={32}
                                            disabled={!canAct}
                                        />
                                    }
                                    items={[
                                        {
                                            id: 'rename',
                                            icon: 'edit',
                                            label: t('renameWorkspace'),
                                            onSelect: () => {
                                                setRenameDraft(item.name);
                                                setRenameId(item.id);
                                            },
                                        },
                                        { type: 'separator', id: 'sep' },
                                        {
                                            id: 'delete',
                                            icon: 'delete',
                                            label: t('deleteWorkspace'),
                                            danger: true,
                                            onSelect: () => setDeleteId(item.id),
                                        },
                                    ]}
                                />
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
            <Card as="section" icon="info" title={t('settingsWorkspacesAbout')} />
            <Dialog
                open={!!renaming}
                size="sm"
                title={fill(t('settingsWorkspacesRenameTitle'), renaming?.name ?? '')}
                onClose={() => setRenameId(null)}
                footer={
                    <>
                        <Button variant="tonal" onClick={() => setRenameId(null)}>
                            {t('cancel')}
                        </Button>
                        <Button variant="filled" type="submit" form={`${listId}-rename`} disabled={draftTrimmed === ''}>
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
