import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import PluginStore from './PluginStore';
import InstalledPlugins from './InstalledPlugins';
import WorkspacesView from './WorkspacesView';
import FeaturesView from './FeaturesView';

const PluginsPanel: React.FC = () => {
    const pluginsTabSubMenu = useAppStore(state => state.pluginsTabSubMenu);
    const setPluginsTabSubMenu = useAppStore(state => state.setPluginsTabSubMenu);
    const design = useAppStore(state => state.design);
    const t = useAppStore(state => state.t);

    const menuItems = [
        { id: 'store', icon: 'storefront', label: (t as any)('pluginStore') || 'Plugin Store' },
        { id: 'installed', icon: 'extension', label: (t as any)('installedPlugins') || 'Installed' },
        { id: 'workspaces', icon: 'dashboard_customize', label: (t as any)('workspaces') || 'Workspaces' },
        { id: 'features', icon: 'toggle_on', label: (t as any)('kobarFeatures') || 'KoBar Features' },
    ];

    return (
        <div 
            className="flex-1 overflow-y-auto p-8 pl-10 pb-4 custom-scrollbar relative flex flex-col" 
            style={{ backgroundColor: design === 'style2' ? 'transparent' : 'var(--theme-bg-base)' }}
        >
            <h2 className="text-2xl font-semibold text-slate-200 mb-6">{(t as any)('plugins') || 'Plugins Ecosystem'}</h2>

            {/* Sub-navigation Pills */}
            <div className="flex flex-wrap gap-2 mb-8 no-drag-region">
                {menuItems.map(item => (
                    <button
                        key={item.id}
                        onClick={() => setPluginsTabSubMenu(item.id as any)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                            pluginsTabSubMenu === item.id 
                                ? 'bg-primary text-slate-900 shadow-md' 
                                : 'bg-black/20 text-slate-400 hover:text-slate-200 hover:bg-black/40 border border-white/5'
                        }`}
                    >
                        <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                        {item.label}
                    </button>
                ))}
            </div>

            {/* Render sub-views here based on pluginsTabSubMenu */}
            <div className="flex-1 relative">
                {pluginsTabSubMenu === 'store' && <PluginStore />}
                {pluginsTabSubMenu === 'installed' && <InstalledPlugins />}
                {pluginsTabSubMenu === 'workspaces' && <WorkspacesView />}
                {pluginsTabSubMenu === 'features' && <FeaturesView />}
            </div>
        </div>
    );
};

export default PluginsPanel;
