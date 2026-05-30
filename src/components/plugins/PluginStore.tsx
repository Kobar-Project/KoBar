import React from 'react';
import { useAppStore } from '../../store/useAppStore';

export const MOCK_PLUGINS = [
    {
        id: 'deep-translate',
        name: 'DeepTranslate',
        author: 'KoBar Team',
        description: 'Advanced translation features powered by AI. Translate text instantly anywhere.',
        fullDescription: 'DeepTranslate integrates powerful AI models directly into your workflow. Whether you are translating code comments, messages, or entire documents, you can do it with a single click. Features auto-language detection and offline mode for selected languages.',
        version: 'v1.2.0',
        icon: 'translate',
        color: 'primary',
        downloads: '12.4k',
        rating: '4.8',
        tags: ["KoBar's plugins", 'Approved', 'Installed'],
        installed: true,
        active: true,
        repo: 'facebook/react' 
    },
    {
        id: 'term-quick',
        name: 'TermQuick',
        author: 'DevGuru',
        description: 'Integrated quick terminal for executing shell commands right from the sidebar.',
        fullDescription: 'TermQuick gives you instant access to a command line interface without leaving KoBar. Execute scripts, manage files, and run npm commands seamlessly. It supports both PowerShell and Bash depending on your OS.',
        version: 'v0.9.1',
        icon: 'terminal',
        color: 'emerald-500',
        downloads: '5.1k',
        rating: '4.2',
        tags: ['Beta', 'Not Installed'],
        installed: false,
        active: false,
        repo: 'electron/electron'
    },
    {
        id: 'snippet-vault',
        name: 'SnippetVault',
        author: 'CodeMaster',
        description: 'Store and quickly retrieve your most used code snippets.',
        fullDescription: 'SnippetVault is a lifesaver for developers. Save code blocks and insert them anywhere with a quick shortcut.',
        version: 'v2.0.1',
        icon: 'code',
        color: 'blue-500',
        downloads: '8.2k',
        rating: '4.5',
        tags: ['Approved', 'Installed'],
        installed: true,
        active: false,
        repo: 'microsoft/vscode'
    }
];

const PluginStore: React.FC = () => {
    const t = useAppStore(state => state.t);
    const pluginsViewMode = useAppStore(state => state.pluginsViewMode);
    const setPluginsViewMode = useAppStore(state => state.setPluginsViewMode);
    const pluginsSearchQuery = useAppStore(state => state.pluginsSearchQuery);
    const setPluginsSearchQuery = useAppStore(state => state.setPluginsSearchQuery);
    const pluginsSelectedTags = useAppStore(state => state.pluginsSelectedTags);
    const setPluginsSelectedTags = useAppStore(state => state.setPluginsSelectedTags);
    const setSelectedPluginId = useAppStore(state => state.setSelectedPluginId);

    const tags = ['All', "KoBar's plugins", 'Approved', 'Unapproved', 'Installed', 'Not Installed', 'Beta'];

    const handleTagClick = (clickedTag: string) => {
        if (clickedTag === 'All') {
            // If all tags are currently selected, clear them. Otherwise, select all.
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

    // Filter plugins
    const filteredPlugins = MOCK_PLUGINS.filter(plugin => {
        if (pluginsSearchQuery) {
            const q = pluginsSearchQuery.toLowerCase();
            if (!plugin.name.toLowerCase().includes(q) && 
                !plugin.description.toLowerCase().includes(q) &&
                !plugin.author.toLowerCase().includes(q)) {
                return false;
            }
        }

        if (pluginsSelectedTags.length > 0) {
            const hasMatchingTag = pluginsSelectedTags.some(tag => plugin.tags.includes(tag));
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

    return (
        <div className="flex flex-col h-full space-y-6">
            <div className="flex items-center justify-between px-2">
                <div className="flex flex-col">
                    <h3 className="text-sm uppercase tracking-wider text-slate-500 font-semibold">{(t as any)('plugins') || 'Plugins'}</h3>
                    <p className="text-xs text-slate-500 mt-1">{(t as any)('pluginStoreDesc') || 'Browse, manage, and install extensions.'}</p>
                </div>
            </div>

            {/* Search and Filter */}
            <div className="px-2">
                <div className="relative w-full no-drag-region">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-[18px]">search</span>
                    <input 
                        type="text" 
                        value={pluginsSearchQuery}
                        onChange={(e) => setPluginsSearchQuery(e.target.value)}
                        placeholder="Search plugins by name, tag, or author..." 
                        className="w-full bg-black/30 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm text-slate-200 focus:outline-none focus:border-primary transition-colors placeholder:text-slate-600"
                    />
                </div>
                
                {/* Filter Tags */}
                <div className="flex flex-wrap gap-2 mt-3 no-drag-region">
                    {tags.map(tag => {
                        const isSelected = (tag === 'All' && (pluginsSelectedTags.length === 0 || pluginsSelectedTags.length === tags.length - 1)) || 
                                           (tag !== 'All' && pluginsSelectedTags.includes(tag));
                        return (
                            <span 
                                key={tag}
                                onClick={() => handleTagClick(tag)}
                                className={`px-3 py-1 border rounded-full text-[11px] font-medium cursor-pointer transition-colors ${
                                    isSelected
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
                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                            pluginsViewMode === 'grid' ? 'bg-primary text-slate-900 shadow-md' : 'bg-black/20 text-slate-400 border border-white/5 hover:text-slate-200'
                        }`}
                        title="Grid View"
                    >
                        <span className="material-symbols-outlined text-[18px]">grid_view</span>
                    </button>
                    <button
                        onClick={() => setPluginsViewMode('list')}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                            pluginsViewMode === 'list' ? 'bg-primary text-slate-900 shadow-md' : 'bg-black/20 text-slate-400 border border-white/5 hover:text-slate-200'
                        }`}
                        title="List View"
                    >
                        <span className="material-symbols-outlined text-[18px]">view_list</span>
                    </button>
                </div>
            </div>

            {/* Grid view */}
            {pluginsViewMode === 'grid' && (
                <div className="grid grid-cols-2 gap-4 px-2">
                    {filteredPlugins.map(plugin => {
                        const colors = getColorClasses(plugin.color);
                        const glowClass = getGlowClass(plugin.installed, plugin.active);
                        return (
                            <div 
                                key={plugin.id}
                                onClick={() => setSelectedPluginId(plugin.id)}
                                className={`aspect-[2/3] bg-black/20 border border-white/5 rounded-2xl relative group overflow-hidden transition-all ${colors.border} hover:bg-black/40 cursor-pointer no-drag-region flex flex-col`}
                            >
                                <div className={`absolute inset-0 ${glowClass} blur-[50px] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none`} />
                                
                                {/* Top Half: Banner Image */}
                                <div className={`h-1/2 w-full bg-gradient-to-br ${colors.gradient} relative`}>
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <span className="material-symbols-outlined text-white/20 text-5xl">image</span>
                                    </div>
                                </div>

                                {/* Bottom Half: Info */}
                                <div className="h-1/2 w-full p-4 flex flex-col items-center justify-center relative z-10 text-center gap-2">
                                    <div className={`w-12 h-12 rounded-xl ${colors.bg} flex items-center justify-center shrink-0 -mt-10 mb-1 border-4 border-[#1a1612]`}>
                                        <span className={`material-symbols-outlined ${colors.text} text-[24px]`}>{plugin.icon}</span>
                                    </div>
                                    <span className="text-base font-bold text-slate-200 leading-tight">{plugin.name}</span>
                                    <span className="text-[11px] text-slate-400 italic">by {plugin.author}</span>
                                    <div className="flex items-center gap-2 mt-auto">
                                        <span className="text-[10px] text-slate-500 flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">download</span> {plugin.downloads}</span>
                                        <span className="text-[10px] text-slate-500 flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">star</span> {plugin.rating}</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* List view */}
            {pluginsViewMode === 'list' && (
                <div className="flex flex-col gap-3 px-2">
                    {filteredPlugins.map(plugin => {
                        const colors = getColorClasses(plugin.color);
                        const glowClass = getGlowClass(plugin.installed, plugin.active);
                        return (
                            <div 
                                key={plugin.id}
                                onClick={() => setSelectedPluginId(plugin.id)}
                                className={`flex items-center gap-4 p-4 rounded-xl border border-white/5 bg-black/20 hover:bg-black/40 transition-all cursor-pointer no-drag-region relative group overflow-hidden ${colors.border}`}
                            >
                                <div className={`absolute inset-0 ${glowClass} blur-[40px] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none`} />
                                
                                <div className={`w-10 h-10 rounded-lg ${colors.bg} flex items-center justify-center shrink-0 relative z-10`}>
                                    <span className={`material-symbols-outlined ${colors.text} text-[20px]`}>{plugin.icon}</span>
                                </div>
                                
                                <div className="flex flex-col flex-1 min-w-0 relative z-10">
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-sm font-bold text-slate-200">{plugin.name}</span>
                                        <span className="text-xs text-slate-400 italic">by {plugin.author}</span>
                                    </div>
                                    <span className="text-xs text-slate-500 truncate mt-0.5">{plugin.description}</span>
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
