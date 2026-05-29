import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
const WorkspacesView: React.FC = () => {
    const language = useAppStore(state => state.language);
    const design = useAppStore(state => state.design);
    const t = useAppStore(state => state.t);
    const workspaces = useAppStore(state => state.workspaces);
    const saveCurrentAsWorkspace = useAppStore(state => state.saveCurrentAsWorkspace);
    const loadWorkspace = useAppStore(state => state.loadWorkspace);
    const deleteWorkspace = useAppStore(state => state.deleteWorkspace);
    const updateWorkspaceName = useAppStore(state => state.updateWorkspaceName);
    const updateWorkspaceSettings = useAppStore(state => state.updateWorkspaceSettings);
    
    // Using local state to avoid bleeding into global store for simple UI toggles
    const [workspaceViewMode, setWorkspaceViewMode] = useState<'list' | 'cards'>('cards');
    const [isRenamingIdx, setIsRenamingIdx] = useState<number | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [newPresetName, setNewPresetName] = useState('');

    return (
        <div className="flex flex-col h-full space-y-6">
            <div className="flex items-center justify-between px-2">
                <div className="flex flex-col">
                    <h3 className="text-sm uppercase tracking-wider text-slate-500 font-semibold">{(t as any)('workspaces') || 'Workspaces'}</h3>
                    <p className="text-xs text-slate-500 mt-1">{(t as any)('workspacesDesc') || 'Save and load your favorite KoBar configurations.'}</p>
                </div>
                <button
                    onClick={() => setWorkspaceViewMode(workspaceViewMode === 'list' ? 'cards' : 'list')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all no-drag-region border hover:brightness-125"
                    style={{
                        backgroundColor: design === 'style2' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.2)',
                        borderColor: design === 'style2' ? 'rgba(255,255,255,0.08)' : 'var(--theme-border)',
                        color: 'var(--theme-primary)',
                    }}
                >
                    <span className="material-symbols-outlined text-[16px]">
                        {workspaceViewMode === 'list' ? 'grid_view' : 'view_list'}
                    </span>
                    {workspaceViewMode === 'list'
                        ? (language === 'tr' ? 'Kartlar' : 'Cards')
                        : (language === 'tr' ? 'Liste' : 'List')}
                </button>
            </div>

            {workspaceViewMode === 'list' ? (
                /* ─── LIST VIEW ─── */
                <div className="space-y-4">
                    <div className="flex flex-col gap-3">
                        {workspaces.map((preset, idx) => (
                            <div key={preset.id} className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${design === 'style2' ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-black/20 border-[#2a241c] hover:border-primary/30'}`}>
                                
                                {isRenamingIdx === idx ? (
                                    <input 
                                        autoFocus
                                        type="text" 
                                        value={renameValue}
                                        onChange={e => setRenameValue(e.target.value)}
                                        onBlur={() => {
                                            if (renameValue.trim()) {
                                                updateWorkspaceName(preset.id, renameValue.trim());
                                            }
                                            setIsRenamingIdx(null);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                if (renameValue.trim()) {
                                                    updateWorkspaceName(preset.id, renameValue.trim());
                                                }
                                                setIsRenamingIdx(null);
                                            }
                                            if (e.key === 'Escape') {
                                                setIsRenamingIdx(null);
                                            }
                                        }}
                                        className="flex-1 bg-transparent border-b border-primary text-sm text-white focus:outline-none px-1 py-0.5 no-drag-region mr-4"
                                    />
                                ) : (
                                    <div 
                                        className="flex-1 flex items-center gap-2 cursor-pointer group no-drag-region"
                                        onClick={() => loadWorkspace(preset.id)}
                                        title={(t as any)('loadWorkspace') || 'Load'}
                                    >
                                        <span className="material-symbols-outlined text-[18px] text-primary">play_circle</span>
                                        <span className="text-sm font-medium text-slate-200 group-hover:text-primary transition-colors">{preset.name}</span>
                                    </div>
                                )}

                                <div className="flex items-center gap-1 no-drag-region">
                                    <button 
                                        onClick={() => updateWorkspaceSettings(preset.id)}
                                        className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-green-400 hover:bg-green-400/10 transition-colors"
                                        title={(t as any)('updateWorkspaceSettings') || 'Update Settings'}
                                    >
                                        <span className="material-symbols-outlined text-[16px]">save</span>
                                    </button>
                                    <button 
                                        onClick={() => {
                                            setIsRenamingIdx(idx);
                                            setRenameValue(preset.name);
                                        }}
                                        className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                                        title={(t as any)('renameWorkspace') || 'Rename'}
                                    >
                                        <span className="material-symbols-outlined text-[16px]">edit</span>
                                    </button>
                                    <button 
                                        onClick={() => deleteWorkspace(preset.id)}
                                        className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                                        title={(t as any)('deleteWorkspace') || 'Delete'}
                                    >
                                        <span className="material-symbols-outlined text-[16px]">delete</span>
                                    </button>
                                </div>
                            </div>
                        ))}

                        {workspaces.length === 0 && (
                            <div className="p-4 border border-dashed border-white/10 rounded-lg text-center text-slate-500 text-sm">
                                {language === 'tr' ? 'Henüz kayıtlı preset yok.' : 'No presets saved yet.'}
                            </div>
                        )}
                    </div>

                    <div className="flex gap-2 items-center mt-4 no-drag-region">
                        <input 
                            type="text" 
                            value={newPresetName}
                            onChange={e => setNewPresetName(e.target.value)}
                            placeholder={(t as any)('workspaceNamePlaceholder') || 'Preset name...'}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && newPresetName.trim()) {
                                    saveCurrentAsWorkspace(newPresetName.trim());
                                    setNewPresetName('');
                                }
                            }}
                            className="flex-1 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition-colors"
                        />
                        <button
                            onClick={() => {
                                if (newPresetName.trim()) {
                                    saveCurrentAsWorkspace(newPresetName.trim());
                                    setNewPresetName('');
                                }
                            }}
                            disabled={!newPresetName.trim()}
                            className="px-4 py-2 bg-primary/20 text-primary border border-primary/50 hover:bg-primary/30 rounded-lg text-sm font-medium transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {(t as any)('saveCurrentSettings') || 'Save Current Settings'}
                        </button>
                    </div>
                </div>
            ) : (
                /* ─── CARD VIEW ─── */
                <div className="space-y-4">
                    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                        {workspaces.map((preset, idx) => (
                            <div
                                key={preset.id}
                                className="relative rounded-xl border overflow-hidden transition-all duration-300"
                                style={{
                                    backgroundColor: design === 'style2' ? 'rgba(255,255,255,0.03)' : 'var(--theme-bg-dark)',
                                    borderColor: 'rgba(96, 165, 250, 0.2)',
                                    boxShadow: '0 0 24px -6px rgba(96, 165, 250, 0.25), inset 0 1px 0 rgba(96, 165, 250, 0.08)',
                                }}
                            >
                                <div className="flex flex-col items-center gap-3 p-5 pt-6">
                                    <div
                                        className="w-12 h-12 rounded-xl flex items-center justify-center"
                                        style={{ backgroundColor: 'rgba(96, 165, 250, 0.12)' }}
                                    >
                                        <span className="material-symbols-outlined text-[24px]" style={{ color: '#60a5fa' }}>
                                            tune
                                        </span>
                                    </div>

                                    {isRenamingIdx === idx ? (
                                        <input
                                            autoFocus
                                            type="text"
                                            value={renameValue}
                                            onChange={e => setRenameValue(e.target.value)}
                                            onBlur={() => {
                                                if (renameValue.trim()) updateWorkspaceName(preset.id, renameValue.trim());
                                                setIsRenamingIdx(null);
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    if (renameValue.trim()) updateWorkspaceName(preset.id, renameValue.trim());
                                                    setIsRenamingIdx(null);
                                                }
                                                if (e.key === 'Escape') setIsRenamingIdx(null);
                                            }}
                                            className="w-full bg-transparent border-b border-primary text-sm text-white text-center focus:outline-none px-1 py-0.5 no-drag-region"
                                        />
                                    ) : (
                                        <span className="text-sm font-medium text-slate-300 text-center leading-tight min-h-[1.25rem]">
                                            {preset.name}
                                        </span>
                                    )}

                                    <div className="flex items-center gap-1 no-drag-region mt-1">
                                        <button
                                            onClick={() => loadWorkspace(preset.id)}
                                            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-green-400 hover:bg-green-400/10 transition-colors"
                                            title={(t as any)('loadWorkspace') || 'Load'}
                                        >
                                            <span className="material-symbols-outlined text-[18px]">play_circle</span>
                                        </button>
                                        <button
                                            onClick={() => updateWorkspaceSettings(preset.id)}
                                            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-blue-400 hover:bg-blue-400/10 transition-colors"
                                            title={(t as any)('updateWorkspaceSettings') || 'Update'}
                                        >
                                            <span className="material-symbols-outlined text-[16px]">save</span>
                                        </button>
                                        <button
                                            onClick={() => { setIsRenamingIdx(idx); setRenameValue(preset.name); }}
                                            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                                            title={(t as any)('renameWorkspace') || 'Rename'}
                                        >
                                            <span className="material-symbols-outlined text-[16px]">edit</span>
                                        </button>
                                        <button
                                            onClick={() => deleteWorkspace(preset.id)}
                                            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                                            title={(t as any)('deleteWorkspace') || 'Delete'}
                                        >
                                            <span className="material-symbols-outlined text-[16px]">delete</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}

                        <div
                            className="relative rounded-xl border-2 border-dashed overflow-hidden transition-all duration-300 cursor-pointer group no-drag-region"
                            style={{ borderColor: design === 'style2' ? 'rgba(255,255,255,0.08)' : 'var(--theme-border)' }}
                            onClick={() => {
                                if (newPresetName.trim()) {
                                    saveCurrentAsWorkspace(newPresetName.trim());
                                    setNewPresetName('');
                                }
                            }}
                        >
                            <div className="flex flex-col items-center justify-center gap-3 p-5 pt-6 min-h-[160px]">
                                <div
                                    className="w-12 h-12 rounded-xl flex items-center justify-center transition-colors group-hover:bg-primary/20"
                                    style={{ backgroundColor: design === 'style2' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.2)' }}
                                >
                                    <span className="material-symbols-outlined text-[24px] text-slate-500 group-hover:text-primary transition-colors">add</span>
                                </div>
                                <input
                                    type="text"
                                    value={newPresetName}
                                    onChange={e => setNewPresetName(e.target.value)}
                                    onClick={e => e.stopPropagation()}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && newPresetName.trim()) {
                                            saveCurrentAsWorkspace(newPresetName.trim());
                                            setNewPresetName('');
                                        }
                                    }}
                                    placeholder={language === 'tr' ? 'Preset adı...' : 'Preset name...'}
                                    className="w-full bg-transparent border-b border-white/10 focus:border-primary text-sm text-white text-center focus:outline-none px-1 py-1 no-drag-region transition-colors"
                                />
                                <span className="text-[11px] text-slate-500 group-hover:text-primary transition-colors">
                                    {language === 'tr' ? 'Yeni Kaydet' : 'Save New'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorkspacesView;
