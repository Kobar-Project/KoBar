import React, { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';

const PLUGIN_REGISTRY_URL = 'https://raw.githubusercontent.com/Kobar-Project/kobar-plugins-registry/main/registry.json';

const PluginStore: React.FC = () => {
    const externalPluginsList = useAppStore(state => state.externalPluginsList);
    const setExternalPluginsList = useAppStore(state => state.setExternalPluginsList);
    const [, setIsFetchingRegistry] = useState(false);

    const pluginsViewMode = useAppStore(state => state.pluginsViewMode);
    const setPluginsViewMode = useAppStore(state => state.setPluginsViewMode);
    const pluginsSearchQuery = useAppStore(state => state.pluginsSearchQuery);
    const setPluginsSearchQuery = useAppStore(state => state.setPluginsSearchQuery);
    const pluginsSelectedTags = useAppStore(state => state.pluginsSelectedTags);
    const setPluginsSelectedTags = useAppStore(state => state.setPluginsSelectedTags);
    const setSelectedPluginId = useAppStore(state => state.setSelectedPluginId);
    const triggerExtensionReload = useAppStore(state => state.triggerExtensionReload);

    const [githubRepoUrl, setGithubRepoUrl] = useState<string | null>(null);
    const [isCheckingRepo, setIsCheckingRepo] = useState(false);
    const [installPrompt, setInstallPrompt] = useState<{ repoName: string, repoUrl: string } | null>(null);
    const [installError, setInstallError] = useState<string | null>(null);
    const [installing, setInstalling] = useState(false);

    const [isDragOver, setIsDragOver] = useState(false);
    const [installMessage, setInstallMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [installedExtensions, setInstalledExtensions] = useState<any[]>([]);



    const loadExtensionsData = async () => {
        try {
            if (window.api?.getInstalledExtensions) {
                const installed = await window.api.getInstalledExtensions();
                setInstalledExtensions(installed);
            }
        } catch (e) {
            console.error('Failed to load extensions data:', e);
        }
    };

    useEffect(() => {
        const fetchRegistry = async () => {
            setIsFetchingRegistry(true);
            try {
                // Fetch from the centralized registry
                // Appending a timestamp query parameter to prevent aggressive caching
                const res = await fetch(`${PLUGIN_REGISTRY_URL}?t=${new Date().getTime()}`);
                if (res.ok) {
                    const data = await res.json();
                    setExternalPluginsList(data);
                } else {
                    console.error('Failed to fetch plugin registry. Status:', res.status);
                }
            } catch (error) {
                console.error('Error fetching plugin registry:', error);
            } finally {
                setIsFetchingRegistry(false);
            }
        };

        loadExtensionsData();
        fetchRegistry();
    }, []);

    // Listen for extension reload triggers
    useEffect(() => {
        const unsubscribe = useAppStore.subscribe((state, prevState) => {
            if (state.extensionReloadTrigger !== prevState.extensionReloadTrigger) {
                loadExtensionsData();
            }
        });
        return () => unsubscribe();
    }, []);


    useEffect(() => {
        const githubRegex = /^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)/i;
        const match = pluginsSearchQuery.trim().match(githubRegex);
        if (match) {
            setGithubRepoUrl(`${match[1]}/${match[2]}`);
        } else {
            setGithubRepoUrl(null);
            setInstallPrompt(null);
            setInstallError(null);
        }
    }, [pluginsSearchQuery]);

    const checkGithubRepo = async () => {
        if (!githubRepoUrl) return;
        setIsCheckingRepo(true);
        setInstallError(null);
        setInstallPrompt(null);

        try {
            const releaseRes = await fetch(`https://api.github.com/repos/${githubRepoUrl}/releases/latest`);
            if (releaseRes.ok) {
                const releaseData = await releaseRes.json();
                const hasZip = (releaseData.assets && releaseData.assets.some((a: any) => a.name.endsWith('.zip'))) || releaseData.zipball_url;
                if (hasZip) {
                    setInstallPrompt({ repoName: githubRepoUrl.split('/')[1], repoUrl: githubRepoUrl });
                } else {
                    setInstallError("No .zip asset or source code found in the latest release.");
                }
            } else {
                setInstallError("Plugin not found at the provided link.");
            }
        } catch (e) {
            setInstallError("Failed to check GitHub repository.");
        } finally {
            setIsCheckingRepo(false);
        }
    };

    const confirmInstallGithub = async () => {
        if (!installPrompt) return;
        setInstalling(true);
        try {
            const result = await window.api.installExtensionFromGithub(installPrompt.repoName, installPrompt.repoUrl);
            if (result.success) {
                setPluginsSearchQuery('');
                triggerExtensionReload();
            } else {
                setInstallError(result.reason || "Installation failed.");
            }
        } catch (e) {
            setInstallError("An unexpected error occurred during installation.");
        } finally {
            setInstalling(false);
        }
    };

    const handleInstallExtensionFromFile = async () => {
        if (window.api?.installExtensionFromFile) {
            setInstallMessage(null);
            try {
                const res = await window.api.installExtensionFromFile();
                if (res.success) {
                    setInstallMessage({ type: 'success', text: 'Extension installed successfully!' });
                    triggerExtensionReload();
                } else if (res.reason !== 'Canceled by user') {
                    setInstallMessage({ type: 'error', text: `Failed to install: ${res.reason || 'Unknown error'}` });
                }
            } catch (e: any) {
                setInstallMessage({ type: 'error', text: `Error during installation: ${e.message || e}` });
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

        const filePath = window.api?.getFilePath?.(file);
        if (!filePath || !window.api?.installExtensionFromPath) {
            setInstallMessage({ type: 'error', text: 'Drag & drop is not supported in this environment.' });
            return;
        }

        setInstallMessage(null);
        try {
            const res = await window.api.installExtensionFromPath(filePath);
            if (res.success) {
                setInstallMessage({ type: 'success', text: 'Extension installed successfully!' });
                triggerExtensionReload();
            } else {
                setInstallMessage({ type: 'error', text: `Failed to install: ${res.reason || 'Unknown error'}` });
            }
        } catch (e: any) {
            setInstallMessage({ type: 'error', text: `Error during installation: ${e.message || e}` });
        }
    };

    const handleToggleExtension = async (plugin: any) => {
        if (plugin.isInternal) {
            plugin.onToggle();
        } else {
            if (plugin.installed && window.api?.toggleExtensionEnabled) {
                await window.api.toggleExtensionEnabled(plugin.id, !plugin.active);
                triggerExtensionReload();
            }
        }
    };

    const handleUninstallExtension = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (window.api?.uninstallExtension) {
            await window.api.uninstallExtension(id);
            triggerExtensionReload();
        }
    };



    const allPlugins = useMemo(() => {


        const externals = (Array.isArray(externalPluginsList) ? externalPluginsList : []).map((ext: any) => {
            const installedPlugin = (installedExtensions || []).find(i => i.id === ext.id);
            return {
                ...ext,
                icon: ext.icon || 'extension',
                color: 'blue-500',
                tags: (installedPlugin ? ['Installed'] : ['Not Installed']).concat(ext.isBeta ? ['Beta'] : []),
                installed: !!installedPlugin,
                active: installedPlugin ? installedPlugin.enabled : false,
                isInternal: false,
                isBeta: ext.isBeta === true,
                version: installedPlugin ? installedPlugin.version : undefined
            };
        });

        // Add dynamically loaded local extensions that aren't in the externalPluginsList (like dev/local zip installs)
        const localOnlyExtensions = (installedExtensions || []).filter(inst => !(Array.isArray(externalPluginsList) ? externalPluginsList : []).find(ext => ext.id === inst.id)).map(inst => ({
            ...inst,
            author: inst.author || 'Local Extension',
            color: 'emerald-500',
            tags: ['Installed'].concat(inst.isBeta ? ['Beta'] : []),
            installed: true,
            active: inst.enabled,
            isInternal: false,
            isBeta: inst.isBeta === true
        }));

        return [...externals, ...localOnlyExtensions];
    }, [installedExtensions, externalPluginsList]);

    const tags = ['All', "KoBar's plugins", 'Installed', 'Not Installed', 'Beta'];

    const handleTagClick = (clickedTag: string) => {
        if (clickedTag === 'All') {
            if (pluginsSelectedTags.length === tags.length - 1) {
                setPluginsSelectedTags([]);
            } else {
                setPluginsSelectedTags(tags.filter(t => t !== 'All'));
            }
            return;
        }

        let newTags = [...pluginsSelectedTags];
        if (newTags.includes(clickedTag)) {
            newTags = newTags.filter(t => t !== clickedTag);
        } else {
            newTags.push(clickedTag);
        }
        setPluginsSelectedTags(newTags);
    };

    const filteredPlugins = (allPlugins || []).filter((plugin: any) => {
        if (pluginsSearchQuery) {
            const q = pluginsSearchQuery.toLowerCase();
            if (!plugin.name.toLowerCase().includes(q) &&
                !plugin.description.toLowerCase().includes(q) &&
                !(plugin.author && plugin.author.toLowerCase().includes(q))) {
                return false;
            }
        }

        if (pluginsSelectedTags.length > 0) {
            const hasMatchingTag = pluginsSelectedTags.some(tag => plugin.tags && plugin.tags.includes(tag));
            if (!hasMatchingTag) return false;
        }

        return true;
    });

    const getColorClasses = (color: string) => {
        if (color === 'primary') {
            return {
                bg: 'bg-primary/10',
                border: 'hover:border-primary/50',
                text: 'text-primary',
                gradient: 'from-primary/30 to-blue-500/20'
            };
        }
        return {
            bg: `bg-${color}/10`,
            border: `hover:border-${color}/50`,
            text: `text-${color}`,
            gradient: `from-${color}/30 to-teal-500/20`
        };
    };

    const getGlowClass = (installed: boolean, active: boolean) => {
        if (!installed) return 'bg-black/0 shadow-none';
        if (installed && active) return 'bg-green-500/30';
        return 'bg-red-500/30';
    };

    const handleGithubClick = (e: React.MouseEvent, url: string) => {
        e.stopPropagation();
        if (window.api?.openExternal) {
            window.api.openExternal(url);
        } else {
            window.open(url, '_blank');
        }
    };

    return (
        <div className="flex flex-col h-full space-y-6">
            <div className="flex items-center justify-between px-2">
                {/* Main buttons are now managed via PluginsPanel at the top level and appear here above the search implicitly */}
            </div>

            {/* Install Extension Zip Drag/Drop */}
            <div className="px-2 no-drag-region">
                <div
                    onClick={handleInstallExtensionFromFile}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
                    onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }}
                    onDrop={handleDropExtension}
                    className={`p-4 border border-dashed rounded-xl text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 group ${isDragOver
                            ? 'border-primary bg-primary/10 scale-[1.02]'
                            : 'border-[#2a241c] hover:border-primary/50 bg-black/20 hover:bg-black/30'
                        }`}
                >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isDragOver ? 'bg-primary/20 scale-110' : 'bg-primary/10 group-hover:scale-110'
                        }`}>
                        <span className="material-symbols-outlined text-primary text-[24px]">
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

                {installMessage && (
                    <div className={`mt-3 p-3 rounded-xl border flex items-center justify-between ${installMessage.type === 'success'
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
                            onClick={(e) => { e.stopPropagation(); setInstallMessage(null); }}
                            className="text-slate-400 hover:text-slate-200 p-0.5 rounded transition-all hover:bg-white/5"
                        >
                            <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                    </div>
                )}
            </div>

            {/* Search and Filter */}
            <div className="px-2">
                <div className="relative w-full no-drag-region">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-[18px]">search</span>
                    <input
                        type="text"
                        value={pluginsSearchQuery}
                        onChange={(e) => setPluginsSearchQuery(e.target.value)}
                        placeholder="Search plugins by name, tag, or author... (or paste GitHub link)"
                        className="w-full bg-black/30 border border-white/10 rounded-xl py-2.5 pl-10 pr-24 text-sm text-slate-200 focus:outline-none focus:border-primary transition-colors placeholder:text-slate-600"
                    />
                    {githubRepoUrl && (
                        <button
                            onClick={checkGithubRepo}
                            disabled={isCheckingRepo}
                            className="absolute right-2 top-1/2 -translate-y-1/2 bg-primary text-black px-3 py-1 rounded-lg text-xs font-semibold hover:bg-primary/90 disabled:opacity-50"
                        >
                            {isCheckingRepo ? 'Checking...' : 'Load Link'}
                        </button>
                    )}
                </div>

                {installPrompt && (
                    <div className="mt-4 p-4 rounded-xl bg-primary/10 border border-primary/30 flex flex-col gap-3">
                        <div className="flex items-start gap-3">
                            <span className="material-symbols-outlined text-primary mt-0.5">info</span>
                            <div>
                                <h4 className="text-sm font-semibold text-slate-200">GitHub Plugin Found</h4>
                                <p className="text-xs text-slate-400 mt-1">Would you like to install the <strong>{installPrompt.repoName}</strong> plugin?</p>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 mt-2">
                            <button
                                onClick={() => setInstallPrompt(null)}
                                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-black/30 text-slate-300 hover:bg-black/50"
                            >
                                No
                            </button>
                            <button
                                onClick={confirmInstallGithub}
                                disabled={installing}
                                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-primary text-black hover:bg-primary/90 flex items-center gap-2"
                            >
                                {installing && <span className="material-symbols-outlined text-[14px] animate-spin">sync</span>}
                                {installing ? 'Installing...' : 'Yes, Install'}
                            </button>
                        </div>
                    </div>
                )}

                {installError && (
                    <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start gap-3 text-red-400">
                        <span className="material-symbols-outlined mt-0.5">error</span>
                        <div>
                            <h4 className="text-sm font-semibold">Install Error</h4>
                            <p className="text-xs mt-1">{installError}</p>
                        </div>
                    </div>
                )}

                {/* Filter Tags */}
                <div className="flex flex-wrap gap-2 mt-3 no-drag-region">
                    {tags.map(tag => {
                        const isSelected = (tag === 'All' && (pluginsSelectedTags.length === 0 || pluginsSelectedTags.length === tags.length - 1)) ||
                            (tag !== 'All' && pluginsSelectedTags.includes(tag));
                        return (
                            <span
                                key={tag}
                                onClick={() => handleTagClick(tag)}
                                className={`px-3 py-1 border rounded-full text-[11px] font-medium cursor-pointer transition-colors ${isSelected
                                        ? 'bg-primary text-slate-900 border-primary'
                                        : 'bg-white/5 text-slate-400 border-white/10 hover:bg-primary/20 hover:text-primary'
                                    }`}
                            >
                                {tag}
                            </span>
                        );
                    })}
                </div>

                {/* View Toggles Underneath Tags */}
                <div className="flex items-center gap-2 mt-4 no-drag-region">
                    <button
                        onClick={() => setPluginsViewMode('grid')}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${pluginsViewMode === 'grid' ? 'bg-primary text-slate-900 shadow-md' : 'bg-black/20 text-slate-400 border border-white/5 hover:text-slate-200'
                            }`}
                        title="Grid View"
                    >
                        <span className="material-symbols-outlined text-[18px]">grid_view</span>
                    </button>
                    <button
                        onClick={() => setPluginsViewMode('list')}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${pluginsViewMode === 'list' ? 'bg-primary text-slate-900 shadow-md' : 'bg-black/20 text-slate-400 border border-white/5 hover:text-slate-200'
                            }`}
                        title="List View"
                    >
                        <span className="material-symbols-outlined text-[18px]">view_list</span>
                    </button>
                </div>
            </div>

            {/* Grid view */}
            {pluginsViewMode === 'grid' && (
                <div className="flex flex-wrap gap-4 px-2">
                    {filteredPlugins.map((plugin: any) => {
                        const colors = getColorClasses(plugin.color);
                        const glowClass = getGlowClass(plugin.installed, plugin.active);
                        return (
                            <div
                                key={plugin.id}
                                onClick={() => !plugin.isInternal && setSelectedPluginId(plugin.id)}
                                className={`w-[260px] h-[350px] shrink-0 bg-black/20 border border-white/5 rounded-2xl relative group overflow-hidden transition-all ${colors.border} hover:bg-black/40 cursor-pointer no-drag-region flex flex-col`}
                            >
                                <div className={`absolute inset-0 ${glowClass} blur-[50px] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none`} />

                                {/* Top Half: Banner Image */}
                                <div className={`h-2/3 w-full bg-gradient-to-br ${colors.gradient} relative`}>
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        {plugin.image ? (
                                            <img key={plugin.image} src={plugin.image} alt={plugin.name} className="w-full h-full object-cover" onLoad={(e) => (e.currentTarget.style.display = '')} onError={(e) => (e.currentTarget.style.display = 'none')} />
                                        ) : (
                                            <span className="material-symbols-outlined text-white/20 text-5xl">extension</span>
                                        )}
                                    </div>

                                    {/* Beta Badge Overlay */}
                                    {plugin.isBeta && (
                                        <div className="absolute top-3 left-3 z-20">
                                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/80 text-white shadow-sm border border-purple-400/30 backdrop-blur-md">BETA</span>
                                        </div>
                                    )}

                                    {/* Action button overlay */}
                                    {plugin.installed && (
                                        <div className="absolute top-3 right-3 z-20">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleToggleExtension(plugin); }}
                                                className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${plugin.active ? 'bg-green-500' : 'bg-slate-600'}`}
                                            >
                                                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${plugin.active ? 'translate-x-5' : 'translate-x-0'}`} />
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Bottom Half: Info */}
                                <div className="h-1/3 w-full px-4 pb-3 pt-0 flex flex-col items-center justify-center relative z-10 text-center gap-1">
                                    <div className={`w-14 h-14 rounded-full bg-[#111111] flex items-center justify-center shrink-0 -mt-10 mb-1 border-[4px] border-[#222] shadow-lg`}>
                                        <span className={`material-symbols-outlined ${colors.text} text-[26px]`}>{plugin.icon}</span>
                                    </div>
                                    <span className="text-base font-bold text-slate-200 leading-tight">{plugin.name}</span>
                                    <span className="text-[11px] text-slate-400 italic">by {plugin.author}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* List view (Detailed) */}
            {pluginsViewMode === 'list' && (
                <div className="flex flex-col gap-4 px-2">
                    {filteredPlugins.map((plugin: any) => {
                        const colors = getColorClasses(plugin.color);
                        const glowClass = getGlowClass(plugin.installed, plugin.active);
                        return (
                            <div
                                key={plugin.id}
                                onClick={() => !plugin.isInternal && setSelectedPluginId(plugin.id)}
                                className={`flex flex-col p-4 rounded-xl border border-[#2a241c] bg-black/20 hover:border-primary/30 transition-all cursor-pointer no-drag-region relative group overflow-hidden`}
                            >
                                <div className={`absolute inset-0 ${glowClass} blur-[40px] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none`} />

                                <div className="flex items-center justify-between relative z-10">
                                    <div className="flex items-center gap-4 flex-1 min-w-0">
                                        {plugin.image ? (
                                            <img key={plugin.image} src={plugin.image} alt={plugin.name} className="w-12 h-12 rounded-xl object-cover shrink-0" onLoad={(e) => (e.currentTarget.style.display = '')} onError={(e) => (e.currentTarget.style.display = 'none')} />
                                        ) : (
                                            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                                                <span className={`material-symbols-outlined ${colors.text} text-[24px]`}>{plugin.icon}</span>
                                            </div>
                                        )}

                                        <div className="flex flex-col min-w-0 gap-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-semibold text-slate-200 truncate">{plugin.name}</span>
                                                {plugin.version && <span className="text-[10px] font-mono text-slate-500 shrink-0">v{plugin.version}</span>}
                                                {plugin.isBeta && (
                                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30 shrink-0">BETA</span>
                                                )}
                                                {plugin.githubRepo && (
                                                    <button onClick={(e) => handleGithubClick(e, `https://github.com/${plugin.githubRepo}`)} className="text-slate-400 hover:text-primary transition-colors flex items-center" title="View on GitHub">
                                                        <span className="material-symbols-outlined text-[14px]">link</span>
                                                    </button>
                                                )}
                                                <span className="text-xs text-slate-400 italic">by {plugin.author}</span>
                                            </div>
                                            <span className="text-xs text-slate-400 leading-normal truncate">{plugin.description}</span>

                                            {plugin.categories && plugin.categories.length > 0 && (
                                                <div className="flex flex-wrap gap-1 mt-1">
                                                    {plugin.categories.slice(0, 3).map((cat: string) => (
                                                        <span key={cat} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/5 text-slate-400 border border-white/5">
                                                            {cat}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            {plugin.versionNote && (
                                                <div className="text-[10px] text-primary/80 mt-1 italic line-clamp-1 border-l-2 border-primary/30 pl-2">
                                                    {plugin.versionNote}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3 shrink-0 ml-4">
                                        {plugin.installed && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleToggleExtension(plugin); }}
                                                className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${plugin.active ? 'bg-green-500' : 'bg-slate-600'}`}
                                            >
                                                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${plugin.active ? 'translate-x-5' : 'translate-x-0'}`} />
                                            </button>
                                        )}

                                        {!plugin.isInternal && plugin.installed && (
                                            <button
                                                onClick={(e) => handleUninstallExtension(e, plugin.id)}
                                                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                                                title="Uninstall"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {filteredPlugins.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-slate-500">
                    <span className="material-symbols-outlined text-[48px] mb-2 opacity-50">extension_off</span>
                    <span className="text-sm">No plugins found.</span>
                </div>
            )}
        </div>
    );
};

export default PluginStore;
