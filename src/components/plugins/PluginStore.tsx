import React from 'react';
import { useAppStore } from '../../store/useAppStore';

const PluginStore: React.FC = () => {
    const t = useAppStore(state => state.t);
    const pluginsViewMode = useAppStore(state => state.pluginsViewMode);
    const setPluginsViewMode = useAppStore(state => state.setPluginsViewMode);
    const pluginsSearchQuery = useAppStore(state => state.pluginsSearchQuery);
    const setPluginsSearchQuery = useAppStore(state => state.setPluginsSearchQuery);

    return (
        <div className="flex flex-col h-full space-y-6">
            <div className="flex items-center justify-between px-2">
                <div className="flex flex-col">
                    <h3 className="text-sm uppercase tracking-wider text-slate-500 font-semibold">{(t as any)('pluginStore') || 'Plugin Store'}</h3>
                    <p className="text-xs text-slate-500 mt-1">{(t as any)('pluginStoreDesc') || 'Browse and install official community plugins.'}</p>
                </div>
                <button
                    onClick={() => setPluginsViewMode(pluginsViewMode === 'grid' ? 'list' : 'grid')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all no-drag-region border hover:brightness-125 bg-black/20 text-primary border-white/5"
                >
                    <span className="material-symbols-outlined text-[16px]">
                        {pluginsViewMode === 'grid' ? 'view_list' : 'grid_view'}
                    </span>
                    {pluginsViewMode === 'grid' ? 'List' : 'Grid'}
                </button>
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
                <div className="flex flex-wrap gap-2 mt-3">
                    <span className="px-3 py-1 bg-white/5 text-slate-400 border border-white/10 rounded-full text-[11px] font-medium cursor-pointer hover:bg-primary hover:text-slate-900 transition-colors">#productivity</span>
                    <span className="px-3 py-1 bg-white/5 text-slate-400 border border-white/10 rounded-full text-[11px] font-medium cursor-pointer hover:bg-primary hover:text-slate-900 transition-colors">#developer</span>
                    <span className="px-3 py-1 bg-white/5 text-slate-400 border border-white/10 rounded-full text-[11px] font-medium cursor-pointer hover:bg-primary hover:text-slate-900 transition-colors">#utility</span>
                </div>
            </div>

            {/* Mocked Grid view */}
            <div className="grid grid-cols-2 gap-4 px-2">
                {/* Mock Plugin Card */}
                <div className="bg-black/20 border border-white/5 rounded-2xl p-5 relative group overflow-hidden transition-all hover:border-primary/50 hover:bg-black/40 cursor-pointer no-drag-region">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-primary/20 blur-[50px] opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="flex items-start justify-between relative z-10">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                                <span className="material-symbols-outlined text-primary text-[20px]">translate</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-sm font-semibold text-slate-200">DeepTranslate</span>
                                <span className="text-[10px] text-slate-500 font-mono">v1.2.0</span>
                            </div>
                        </div>
                    </div>
                    <p className="text-xs text-slate-400 mt-4 leading-relaxed line-clamp-2 relative z-10">
                        Instantly translate selected text anywhere using DeepL API integration.
                    </p>
                    <div className="flex items-center gap-2 mt-4 relative z-10">
                        <span className="text-[10px] text-slate-500 flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">download</span> 12.4k</span>
                        <span className="text-[10px] text-slate-500 flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">star</span> 4.8</span>
                    </div>
                </div>

                 {/* Mock Plugin Card 2 */}
                 <div className="bg-black/20 border border-white/5 rounded-2xl p-5 relative group overflow-hidden transition-all hover:border-emerald-500/50 hover:bg-black/40 cursor-pointer no-drag-region">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/20 blur-[50px] opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="flex items-start justify-between relative z-10">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                                <span className="material-symbols-outlined text-emerald-500 text-[20px]">terminal</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-sm font-semibold text-slate-200">TermQuick</span>
                                <span className="text-[10px] text-slate-500 font-mono">v0.9.1</span>
                            </div>
                        </div>
                    </div>
                    <p className="text-xs text-slate-400 mt-4 leading-relaxed line-clamp-2 relative z-10">
                        A drop-down floating terminal attached to your KoBar workspace.
                    </p>
                    <div className="flex items-center gap-2 mt-4 relative z-10">
                        <span className="text-[10px] text-slate-500 flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">download</span> 5.1k</span>
                        <span className="text-[10px] text-slate-500 flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">star</span> 4.2</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PluginStore;
