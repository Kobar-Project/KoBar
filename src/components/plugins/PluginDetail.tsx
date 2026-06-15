import React, { useEffect, useState, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';

const PluginDetail: React.FC = () => {
    const selectedPluginId = useAppStore(state => state.selectedPluginId);
    const setSelectedPluginId = useAppStore(state => state.setSelectedPluginId);
    const externalPluginsList = useAppStore(state => state.externalPluginsList);
    const triggerExtensionReload = useAppStore(state => state.triggerExtensionReload);
    
    const [localPlugins, setLocalPlugins] = useState<any[]>([]);

    useEffect(() => {
        const fetchLocal = async () => {
            if (window.api && window.api.getInstalledExtensions) {
                const exts = await window.api.getInstalledExtensions();
                setLocalPlugins(exts);
            }
        };
        fetchLocal();
    }, []);

    const pluginsArray = Array.isArray(externalPluginsList) ? externalPluginsList : [];
    let pluginData = pluginsArray.find((p: any) => p.id === selectedPluginId);
    let localData = localPlugins.find((p: any) => p.id === selectedPluginId);
    
    if (!pluginData && localData) {
        pluginData = localData;
    }

    // Transform raw JSON plugin into the expected format
    const plugin = useMemo(() => {
        const isInstalledLocally = !!localData;
        return pluginData ? {
            id: pluginData.id,
            name: pluginData.name,
            description: pluginData.description,
            fullDescription: pluginData.description, // Fallback
            author: pluginData.author || ((isInstalledLocally && !pluginsArray.find((p:any)=>p.id===pluginData.id)) ? 'Local Extension' : ''),
            version: localData?.version || pluginData.versionNote || pluginData.version || '1.0.0',
            tags: pluginData.categories ? [...pluginData.categories] : [],
            color: 'primary', // default color
            icon: pluginData.icon || pluginData.image || 'extension',
            repo: pluginData.githubRepo,
            downloads: pluginData.downloads || 0,
            installed: isInstalledLocally,
            active: isInstalledLocally ? localData.enabled : false,
            isBeta: pluginData.isBeta,
            isPlayground: localData?.isPlayground || false,
            storeImage: pluginData.storeImage || []
        } : undefined;
    }, [pluginData, localData, pluginsArray]);
    
    const [githubStats, setGithubStats] = useState<{ stars: number | string; forks: number | string; contributors: number | string } | null>(null);
    const [loadingStats, setLoadingStats] = useState(false);
    const [installProgress, setInstallProgress] = useState<number | null>(null);
    const [isLocalInstalled, setIsLocalInstalled] = useState(false);
    const [isLocalActive, setIsLocalActive] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);

    useEffect(() => {
        if (plugin) {
            setIsLocalInstalled(plugin.installed || plugin.tags.includes('Installed'));
            setIsLocalActive(plugin.active || false);
        }
    }, [plugin]);

    useEffect(() => {
        if (!plugin) return;
        const cleanup = window.api.onPluginInstallProgress((id, percent) => {
            if (id === plugin.id) {
                setInstallProgress(percent);
            }
        });
        return cleanup;
    }, [plugin]);

    useEffect(() => {
        if (plugin?.repo) {
            setLoadingStats(true);
            
            // Normalize repo path safely (supports either "owner/repo" or full GitHub URL)
            let repoPath = (plugin.repo || '').trim();
            try {
                if (/^https?:\/\//i.test(repoPath)) {
                    const parsed = new URL(repoPath);
                    const host = parsed.hostname.toLowerCase();
                    if (host === 'github.com' || host === 'www.github.com') {
                        repoPath = parsed.pathname.replace(/^\/+/, '');
                    }
                }
            } catch {
                // Keep original value if URL parsing fails
            }
            repoPath = repoPath.replace(/\.git$/i, '').trim();

            // Fetch repo stats
            fetch(`https://api.github.com/repos/${repoPath}`)
                .then(res => res.json())
                .then(data => {
                    setGithubStats(prev => ({
                        ...prev,
                        stars: data.stargazers_count !== undefined ? data.stargazers_count : '-',
                        forks: data.forks_count !== undefined ? data.forks_count : '-',
                        contributors: prev?.contributors || '-'
                    }));
                    setLoadingStats(false);

                    // Fetch contributors count
                    fetch(`https://api.github.com/repos/${repoPath}/contributors?per_page=100`)
                        .then(cRes => cRes.json())
                        .then(cData => {
                            setGithubStats(current => ({
                                ...current!,
                                contributors: Array.isArray(cData) ? (cData.length === 100 ? '100+' : cData.length) : (current?.contributors || '-')
                            }));
                        })
                        .catch(() => {});
                })
                .catch(() => {
                    setGithubStats({ stars: '-', forks: '-', contributors: '-' });
                    setLoadingStats(false);
                });
        }
    }, [plugin?.repo]);

    if (!plugin) {
        return (
            <div className="flex flex-col h-full relative no-drag-region overflow-y-auto custom-scrollbar">
                <div className="flex items-center gap-3 px-2 mb-4 sticky top-0 bg-black/40 backdrop-blur-md z-50 py-2 -mx-2 px-4 rounded-b-xl border-b border-white/5">
                    <button 
                        onClick={() => setSelectedPluginId(null)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors"
                    >
                        <span className="material-symbols-outlined text-[20px]">arrow_back</span>
                    </button>
                    <div className="flex-1">
                        <span className="text-sm font-semibold text-slate-200">Back to Store</span>
                    </div>
                </div>
                <div className="flex-1 flex items-center justify-center text-slate-500">
                    Loading plugin details...
                </div>
            </div>
        );
    }

    const handleInstall = async () => {
        if (!plugin) return;
        setInstallProgress(0);
        
        try {
            const result = await window.api.installExtensionFromGithub(plugin.id, plugin.repo);
            if (result.success) {
                setIsLocalInstalled(true);
                triggerExtensionReload();
                if (window.api?.getInstalledExtensions) {
                    const exts = await window.api.getInstalledExtensions();
                    setLocalPlugins(exts);
                }
            } else {
                console.error('Install failed:', result.reason);
                alert(`Installation failed: ${result.reason}`);
            }
        } catch (e) {
            console.error('Install error:', e);
            alert('An error occurred during installation.');
        } finally {
            setInstallProgress(null);
        }
    };

    const getColorClasses = (color: string) => {
        if (color === 'primary') {
            return {
                bg: 'bg-primary/10',
                text: 'text-primary',
                gradient: 'from-primary/30 to-blue-500/20'
            };
        }
        return {
            bg: `bg-${color}/10`,
            text: `text-${color}`,
            gradient: `from-${color}/30 to-teal-500/20`
        };
    };

    const colors = getColorClasses(plugin.color);
    const isApproved = plugin.tags.includes('Approved');

    return (
        <div className="flex flex-col h-full relative no-drag-region overflow-y-auto custom-scrollbar">
            {/* Header / Back Button */}
            <div className="flex items-center gap-3 px-2 mb-4 sticky top-0 bg-black/40 backdrop-blur-md z-50 py-2 -mx-2 px-4 rounded-b-xl border-b border-white/5">
                <button 
                    onClick={() => setSelectedPluginId(null)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors"
                >
                    <span className="material-symbols-outlined text-[20px]">arrow_back</span>
                </button>
                <div className="flex-1">
                    <span className="text-sm font-semibold text-slate-200">Back to Store</span>
                </div>
            </div>

            {/* Media Gallery / Banner */}
            <div className={`w-full aspect-video rounded-2xl bg-gradient-to-br ${colors.gradient} relative overflow-hidden flex-shrink-0 mb-6 border border-white/5`}>
                {plugin.storeImage && plugin.storeImage.length > 0 ? (
                    <>
                        <img 
                            key={plugin.storeImage[currentImageIndex]} 
                            src={plugin.storeImage[currentImageIndex]} 
                            alt={`${plugin.name} screenshot ${currentImageIndex + 1}`} 
                            className="w-full h-full object-cover" 
                        />
                        
                        {/* Navigation Arrows */}
                        {plugin.storeImage.length > 1 && (
                            <>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); setCurrentImageIndex(prev => (prev === 0 ? plugin.storeImage.length - 1 : prev - 1)); }}
                                    className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center backdrop-blur-sm transition-colors border border-white/10"
                                >
                                    <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                                </button>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); setCurrentImageIndex(prev => (prev === plugin.storeImage.length - 1 ? 0 : prev + 1)); }}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center backdrop-blur-sm transition-colors border border-white/10"
                                >
                                    <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                                </button>
                                
                                {/* Dots indicator */}
                                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5 p-1.5 rounded-full bg-black/40 backdrop-blur-md border border-white/10">
                                    {plugin.storeImage.map((_: string, idx: number) => (
                                        <div 
                                            key={idx} 
                                            className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${idx === currentImageIndex ? 'bg-white w-3' : 'bg-white/40'}`}
                                        />
                                    ))}
                                </div>
                            </>
                        )}
                    </>
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center flex-col gap-2">
                        <span className="material-symbols-outlined text-white/20 text-7xl">image</span>
                        <span className="text-white/30 text-sm">Media Gallery (Coming Soon)</span>
                    </div>
                )}
            </div>

            {/* Plugin Header Info */}
            <div className="flex items-start gap-4 mb-6">
                <div className={`w-16 h-16 rounded-2xl ${colors.bg} flex items-center justify-center shrink-0 border-4 border-[#1a1612]`}>
                    <span className={`material-symbols-outlined ${colors.text} text-[32px]`}>{plugin.icon}</span>
                </div>
                <div className="flex flex-col flex-1">
                    <div className="flex items-center gap-2">
                        <h2 className="text-2xl font-bold text-slate-100">{plugin.name}</h2>
                        {isApproved && (
                            <span className="material-symbols-outlined text-blue-400 text-[18px]" title="Official/Approved">verified</span>
                        )}
                    </div>
                    <span className="text-sm text-slate-400 italic mb-2">by {plugin.author} • {plugin.version}</span>
                    
                    <div className="flex flex-wrap gap-2">
                        {isLocalInstalled && (
                            <span className="px-2 py-0.5 rounded-full bg-green-500/20 border border-green-500/30 text-[10px] text-green-400 font-semibold">
                                Installed
                            </span>
                        )}
                        {plugin.tags.filter(t => t !== 'Installed' && t !== 'Not Installed').map(tag => (
                            <span key={tag} className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] text-slate-400">
                                {tag}
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            {/* Actions Bar */}
            <div className="flex items-center gap-3 mb-8 p-3 rounded-xl bg-black/20 border border-white/5">
                {isLocalInstalled ? (
                    <>
                        {!plugin.isPlayground && (
                            <button 
                                onClick={async (e) => {
                                    e.stopPropagation();
                                    if (window.api?.uninstallExtension) {
                                        await window.api.uninstallExtension(plugin.id);
                                        setIsLocalInstalled(false);
                                        setIsLocalActive(false);
                                        triggerExtensionReload();
                                        if (window.api?.getInstalledExtensions) {
                                            const exts = await window.api.getInstalledExtensions();
                                            setLocalPlugins(exts);
                                        }
                                    }
                                }}
                                className="flex-1 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-colors text-sm font-semibold flex items-center justify-center gap-2">
                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                Uninstall
                            </button>
                        )}
                        <button 
                            onClick={async () => {
                                const newState = !isLocalActive;
                                setIsLocalActive(newState);
                                if (window.api?.toggleExtensionEnabled) {
                                    await window.api.toggleExtensionEnabled(plugin.id, newState);
                                    triggerExtensionReload();
                                    if (window.api?.getInstalledExtensions) {
                                        const exts = await window.api.getInstalledExtensions();
                                        setLocalPlugins(exts);
                                    }
                                }
                            }}
                            className={`flex-1 py-2 rounded-lg transition-colors text-sm font-semibold flex items-center justify-center gap-2 shadow-lg ${
                                isLocalActive 
                                    ? 'bg-primary text-slate-900 shadow-primary/20' 
                                    : 'bg-black/40 text-slate-400 border border-white/5 hover:text-slate-200 hover:bg-black/60'
                            }`}
                        >
                            <span className="material-symbols-outlined text-[18px]">
                                {isLocalActive ? 'toggle_on' : 'toggle_off'}
                            </span>
                            {isLocalActive ? 'Disable' : 'Enable'}
                        </button>
                    </>
                ) : installProgress !== null ? (
                    <div className="w-full relative overflow-hidden rounded-lg bg-black/40 h-[42px] border border-primary/30 flex items-center justify-center">
                        <div 
                            className="absolute left-0 top-0 bottom-0 bg-primary/20 transition-all duration-300"
                            style={{ width: `${installProgress}%` }}
                        />
                        <span className="relative z-10 text-sm font-semibold text-primary flex items-center gap-2">
                            <span className="material-symbols-outlined animate-spin text-[16px]">sync</span>
                            Installing... {installProgress}%
                        </span>
                    </div>
                ) : (
                    <button 
                        onClick={handleInstall} 
                        className="w-full py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-slate-900 transition-colors text-sm font-semibold flex items-center justify-center gap-2 shadow-lg shadow-primary/20"
                    >
                        <span className="material-symbols-outlined text-[18px]">download</span>
                        Install Plugin
                    </button>
                )}
            </div>

            {/* GitHub Stats */}
            <div className="grid grid-cols-3 gap-3 mb-8">
                <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-white/5 border border-white/5">
                    <span className="material-symbols-outlined text-yellow-500 text-[20px] mb-1">star</span>
                    <span className="text-lg font-bold text-slate-200">{loadingStats ? '...' : githubStats?.stars || '-'}</span>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">Stars</span>
                </div>
                <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-white/5 border border-white/5">
                    <span className="material-symbols-outlined text-blue-500 text-[20px] mb-1">fork_right</span>
                    <span className="text-lg font-bold text-slate-200">{loadingStats ? '...' : githubStats?.forks || '-'}</span>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">Forks</span>
                </div>
                <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-white/5 border border-white/5">
                    <span className="material-symbols-outlined text-purple-500 text-[20px] mb-1">group</span>
                    <span className="text-lg font-bold text-slate-200">{loadingStats ? '...' : githubStats?.contributors || '-'}</span>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">Contributors</span>
                </div>
            </div>

            {/* Full Description */}
            <div className="flex flex-col gap-2 mb-8">
                <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Description</h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                    {plugin.fullDescription}
                </p>
            </div>

            {/* Plugin Settings */}
            {window.KoBarExtensions?.getSettingsPanel(plugin.id) && (
                <div className="flex flex-col gap-4 mb-8">
                    <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Settings</h3>
                    <div className="p-4 rounded-xl bg-black/20 border border-white/5">
                        {window.KoBarExtensions.getSettingsPanel(plugin.id)?.render()}
                    </div>
                </div>
            )}
        </div>
    );
};

export default PluginDetail;
