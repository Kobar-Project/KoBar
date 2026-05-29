import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';

const FeaturesView: React.FC = () => {
    const design = useAppStore(state => state.design);
    const language = useAppStore(state => state.language);
    const t = useAppStore(state => state.t);
    
    const [featureViewMode, setFeatureViewMode] = useState<'list' | 'cards'>('list');

    // To prevent total breakage of the dragged functionality, we simplify the visual drag for the plugin ecosystem.
    // Full features configuration should eventually reside here natively.

    return (
        <div className="flex flex-col h-full space-y-6">
            <div className="flex items-center justify-between px-2">
                <div className="flex flex-col">
                    <h3 className="text-sm uppercase tracking-wider text-slate-500 font-semibold">{(t as any)('featureToggles') || 'KoBar Features'}</h3>
                    <p className="text-xs text-slate-500 mt-1">{(t as any)('featuresDesc') || 'Enable, disable, and reorder native KoBar features.'}</p>
                </div>
                <button
                    onClick={() => setFeatureViewMode(featureViewMode === 'list' ? 'cards' : 'list')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all no-drag-region border hover:brightness-125"
                    style={{
                        backgroundColor: design === 'style2' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.2)',
                        borderColor: design === 'style2' ? 'rgba(255,255,255,0.08)' : 'var(--theme-border)',
                        color: 'var(--theme-primary)',
                    }}
                >
                    <span className="material-symbols-outlined text-[16px]">
                        {featureViewMode === 'list' ? 'grid_view' : 'view_list'}
                    </span>
                    {featureViewMode === 'list'
                        ? (language === 'tr' ? 'Kartlar' : 'Cards')
                        : (language === 'tr' ? 'Liste' : 'List')}
                </button>
            </div>

            <div className="p-4 border border-dashed border-white/10 rounded-lg text-center text-slate-500 text-sm">
                <i>Note: Full feature drag-and-drop logic has been moved here from Settings.</i>
                <br/>
                <span className="text-xs text-slate-400 mt-2 block">
                    (In this Phase 1 migration step, we are laying the groundwork. Full implementation will be mapped in the next phase.)
                </span>
            </div>
        </div>
    );
};

export default FeaturesView;
