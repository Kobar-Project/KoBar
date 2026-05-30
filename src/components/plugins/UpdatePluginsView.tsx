import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';

const UpdatePluginsView: React.FC = () => {
    const triggerExtensionReload = useAppStore(state => state.triggerExtensionReload);
    
    const [updates, setUpdates] = useState<any[]>([]);
    const [checking, setChecking] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [updating, setUpdating] = useState(false);
    const [updateStatus, setUpdateStatus] = useState<Record<string, 'pending' | 'updating' | 'success' | 'error'>>({});

    const checkForUpdates = async () => {
        setChecking(true);
        setUpdates([]);
        setSelectedIds(new Set());
        setUpdateStatus({});
        try {
            const availableUpdates = await window.api.checkPluginUpdates();
            setUpdates(availableUpdates);
            
            // Auto-select all by default
            const allIds = new Set<string>();
            availableUpdates.forEach((u: any) => allIds.add(u.id));
            setSelectedIds(allIds);
        } catch (err) {
            console.error("Error checking updates", err);
        } finally {
            setChecking(false);
        }
    };

    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedIds(newSet);
    };

    const selectAll = () => {
        if (selectedIds.size === updates.length) {
            setSelectedIds(new Set());
        } else {
            const allIds = new Set<string>();
            updates.forEach(u => allIds.add(u.id));
            setSelectedIds(allIds);
        }
    };

    const updateSelected = async () => {
        if (selectedIds.size === 0) return;
        setUpdating(true);
        
        const newStatus = { ...updateStatus };
        Array.from(selectedIds).forEach(id => newStatus[id] = 'updating');
        setUpdateStatus(newStatus);

        for (const id of Array.from(selectedIds)) {
            const plugin = updates.find(u => u.id === id);
            if (plugin && plugin.repo) {
                try {
                    const result = await window.api.installExtensionFromGithub(plugin.name, plugin.repo);
                    if (result.success) {
                        setUpdateStatus(prev => ({ ...prev, [id]: 'success' }));
                    } else {
                        setUpdateStatus(prev => ({ ...prev, [id]: 'error' }));
                    }
                } catch (err) {
                    setUpdateStatus(prev => ({ ...prev, [id]: 'error' }));
                }
            }
        }
        
        setUpdating(false);
        triggerExtensionReload();
    };

    return (
        <div className="flex flex-col h-full overflow-hidden text-slate-200">
            <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-primary text-2xl">update</span>
                    <h3 className="text-xl font-medium">Update Plugins</h3>
                </div>
                <button
                    onClick={checkForUpdates}
                    disabled={checking || updating}
                    className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                        checking || updating ? 'bg-slate-700/50 text-slate-400 cursor-not-allowed' : 'bg-primary/20 text-primary hover:bg-primary/30'
                    }`}
                >
                    <span className={`material-symbols-outlined text-sm ${checking ? 'animate-spin' : ''}`}>sync</span>
                    {checking ? 'Checking...' : 'Check for Updates'}
                </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-10">
                {updates.length === 0 && !checking && (
                    <div className="flex flex-col items-center justify-center h-40 text-slate-400 border border-white/5 rounded-xl bg-black/10">
                        <span className="material-symbols-outlined text-4xl mb-2 opacity-50">check_circle</span>
                        <p>All plugins are up to date.</p>
                    </div>
                )}
                
                {updates.length > 0 && (
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between mb-2">
                            <label className="flex items-center gap-2 cursor-pointer text-sm">
                                <input 
                                    type="checkbox" 
                                    className="accent-primary"
                                    checked={selectedIds.size === updates.length && updates.length > 0}
                                    onChange={selectAll}
                                    disabled={updating}
                                />
                                Select All
                            </label>
                            
                            <button
                                onClick={updateSelected}
                                disabled={selectedIds.size === 0 || updating}
                                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                                    selectedIds.size === 0 || updating 
                                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed' 
                                        : 'bg-primary text-black hover:bg-primary/90'
                                }`}
                            >
                                <span className={`material-symbols-outlined text-[18px] ${updating ? 'animate-spin' : ''}`}>
                                    {updating ? 'sync' : 'download'}
                                </span>
                                {updating ? 'Updating...' : `Update Selected (${selectedIds.size})`}
                            </button>
                        </div>
                        
                        <div className="flex flex-col gap-3">
                            {updates.map((plugin) => (
                                <div 
                                    key={plugin.id}
                                    className={`flex items-center gap-4 p-4 rounded-xl border border-white/10 transition-colors ${
                                        selectedIds.has(plugin.id) ? 'bg-primary/5 border-primary/30' : 'bg-black/20 hover:bg-black/30'
                                    }`}
                                >
                                    <input 
                                        type="checkbox"
                                        className="accent-primary w-4 h-4 cursor-pointer"
                                        checked={selectedIds.has(plugin.id)}
                                        onChange={() => toggleSelection(plugin.id)}
                                        disabled={updating || updateStatus[plugin.id] === 'success'}
                                    />
                                    
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                            <h4 className="font-medium text-base truncate">{plugin.name}</h4>
                                            <div className="flex items-center gap-2 text-xs font-mono">
                                                <span className="text-slate-400 bg-black/40 px-2 py-0.5 rounded">v{plugin.currentVersion}</span>
                                                <span className="material-symbols-outlined text-[14px] text-slate-500">arrow_forward</span>
                                                <span className="text-green-400 bg-green-400/10 px-2 py-0.5 rounded">v{plugin.latestVersion}</span>
                                            </div>
                                        </div>
                                        {plugin.releaseNotes && (
                                            <p className="text-sm text-slate-400 mt-1 line-clamp-2">{plugin.releaseNotes}</p>
                                        )}
                                    </div>
                                    
                                    <div className="w-24 flex justify-end">
                                        {updateStatus[plugin.id] === 'updating' && <span className="material-symbols-outlined animate-spin text-primary">sync</span>}
                                        {updateStatus[plugin.id] === 'success' && <span className="material-symbols-outlined text-green-400">check_circle</span>}
                                        {updateStatus[plugin.id] === 'error' && <span className="material-symbols-outlined text-red-400" title="Update failed">error</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default UpdatePluginsView;
