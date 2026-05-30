import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';

const LocalInstallView: React.FC = () => {
    const extensionsSubTab = useAppStore(state => state.extensionsSubTab);
    const setExtensionsSubTab = useAppStore(state => state.setExtensionsSubTab);
    const triggerExtensionReload = useAppStore(state => state.triggerExtensionReload);

    const [installedExtensions, setInstalledExtensions] = useState<any[]>([]);
    const [extsLoading, setExtsLoading] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [installMessage, setInstallMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const loadExtensionsData = async () => {
        setExtsLoading(true);
        try {
            if (window.api?.getInstalledExtensions) {
                const installed = await window.api.getInstalledExtensions();
                setInstalledExtensions(installed);
            }
        } catch (e) {
            console.error('Failed to load extensions data:', e);
        } finally {
            setExtsLoading(false);
        }
    };

    useEffect(() => {
        loadExtensionsData();
    }, []);

    const handleToggleExtension = async (id: string, enabled: boolean) => {
        if (window.api?.toggleExtensionEnabled) {
            await window.api.toggleExtensionEnabled(id, enabled);
            triggerExtensionReload();
            loadExtensionsData();
        }
    };

    const handleUninstallExtension = async (id: string) => {
        if (window.api?.uninstallExtension) {
            setExtsLoading(true);
            await window.api.uninstallExtension(id);
            triggerExtensionReload();
            await loadExtensionsData();
        }
    };

    const handleInstallExtensionFromFile = async () => {
        if (window.api?.installExtensionFromFile) {
            setExtsLoading(true);
            setInstallMessage(null);
            try {
                const res = await window.api.installExtensionFromFile();
                if (res.success) {
                    setInstallMessage({ type: 'success', text: 'Extension installed successfully!' });
                    triggerExtensionReload();
                    await loadExtensionsData();
                } else if (res.reason !== 'Canceled by user') {
                    setInstallMessage({ type: 'error', text: `Failed to install: ${res.reason || 'Unknown error'}` });
                }
            } catch (e: any) {
                setInstallMessage({ type: 'error', text: `Error during installation: ${e.message || e}` });
            } finally {
                setExtsLoading(false);
            }
        }
    };

    const handleDropExtension = async (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;

        const file = files[0];
        if (!file.name.toLowerCase().endsWith('.zip')) {
            setInstallMessage({ type: 'error', text: 'Only .zip files are supported.' });
            return;
        }

        // Use Electron's webUtils to get the native file path
        const filePath = window.api?.getFilePath?.(file);
        if (!filePath || !window.api?.installExtensionFromPath) {
            setInstallMessage({ type: 'error', text: 'Drag & drop is not supported in this environment.' });
            return;
        }

        setExtsLoading(true);
        setInstallMessage(null);
        try {
            const res = await window.api.installExtensionFromPath(filePath);
            if (res.success) {
                setInstallMessage({ type: 'success', text: 'Extension installed successfully!' });
                triggerExtensionReload();
                await loadExtensionsData();
            } else {
                setInstallMessage({ type: 'error', text: `Failed to install: ${res.reason || 'Unknown error'}` });
            }
        } catch (e: any) {
            setInstallMessage({ type: 'error', text: `Error during installation: ${e.message || e}` });
        } finally {
            setExtsLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full space-y-6">
            <div className="flex flex-col gap-6 no-drag-region">
                {/* Sub-tabs & Action button */}
                <div className="flex items-center gap-3 px-2">
                    <div className="flex bg-black/20 p-1 rounded-xl border border-white/5 flex-1">
                        <button
                            onClick={() => setExtensionsSubTab('installed')}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                                extensionsSubTab === 'installed' ? 'bg-primary text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                            }`}
                        >
                            Installed
                        </button>
                        <button
                            onClick={() => setExtensionsSubTab('marketplace')}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                                extensionsSubTab === 'marketplace' ? 'bg-primary text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                            }`}
                        >
                            Install Extensions
                        </button>
                    </div>
                </div>

                {installMessage && (
                    <div className={`mx-2 p-3 rounded-xl border flex items-center justify-between ${
                        installMessage.type === 'success' 
                            ? 'bg-green-500/10 border-green-500/20 text-green-400' 
                            : 'bg-red-500/10 border-red-500/20 text-red-400'
                    }`}>
                        <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[18px]">
                                {installMessage.type === 'success' ? 'check_circle' : 'error'}
                            </span>
                            <span className="text-sm">{installMessage.text}</span>
                        </div>
                        <button 
                            onClick={() => setInstallMessage(null)}
                            className="text-slate-400 hover:text-slate-200 p-0.5 rounded transition-all hover:bg-white/5"
                        >
                            <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                    </div>
                )}

                {/* Extensions Loading Indicator */}
                {extsLoading && (
                    <div className="flex items-center justify-center p-8">
                        <span className="material-symbols-outlined text-primary text-[24px] animate-spin">sync</span>
                    </div>
                )}

                {/* Installed Extensions Sub-tab */}
                {!extsLoading && extensionsSubTab === 'installed' && (
                    <div className="space-y-4 px-2">
                        {installedExtensions.length === 0 ? (
                            <div className="p-6 border border-dashed border-white/10 rounded-xl text-center text-slate-500 text-sm">
                                No extensions installed yet. Click "Install Extensions" to add one!
                            </div>
                        ) : (
                            installedExtensions.map((ext) => (
                                <div key={ext.id} className="flex items-center justify-between p-4 rounded-xl border border-[#2a241c] bg-black/20 hover:border-primary/30 transition-all">
                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                                            <span className="material-symbols-outlined text-primary text-[20px]">{ext.icon || 'extension'}</span>
                                        </div>
                                        <div className="flex flex-col min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-semibold text-slate-200 truncate">{ext.name}</span>
                                                <span className="text-[10px] font-mono text-slate-500 shrink-0">v{ext.version}</span>
                                            </div>
                                            <span className="text-xs text-slate-400 leading-normal truncate max-w-xs">{ext.description}</span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3 shrink-0">
                                        {/* Enable/Disable Toggle */}
                                        <button
                                            onClick={() => handleToggleExtension(ext.id, !ext.enabled)}
                                            className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${ext.enabled ? 'bg-green-500' : 'bg-slate-600'}`}
                                        >
                                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${ext.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                                        </button>

                                        {/* Uninstall Button */}
                                        <button
                                            onClick={() => handleUninstallExtension(ext.id)}
                                            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                                            title="Uninstall"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">delete</span>
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {/* Install Extensions Sub-tab */}
                {!extsLoading && extensionsSubTab === 'marketplace' && (
                    <div className="space-y-4 px-2">
                        <div 
                            onClick={handleInstallExtensionFromFile}
                            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
                            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }}
                            onDrop={handleDropExtension}
                            className={`p-8 border border-dashed rounded-xl text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 group ${
                                isDragOver 
                                    ? 'border-primary bg-primary/10 scale-[1.02]' 
                                    : 'border-[#2a241c] hover:border-primary/50 bg-black/20 hover:bg-black/30'
                            }`}
                        >
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                                isDragOver ? 'bg-primary/20 scale-110' : 'bg-primary/10 group-hover:scale-110'
                            }`}>
                                <span className="material-symbols-outlined text-primary text-[28px]">
                                    {isDragOver ? 'download' : 'folder_zip'}
                                </span>
                            </div>
                            <div className="flex flex-col gap-1">
                                <span className="text-sm font-semibold text-slate-200">
                                    {isDragOver ? 'Drop ZIP to Install' : 'Click or Drag & Drop Extension ZIP'}
                                </span>
                                <span className="text-xs text-slate-400">
                                    {isDragOver ? 'Release to start installation' : 'Select or drop a KoBar extension (.zip) file'}
                                </span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default LocalInstallView;
