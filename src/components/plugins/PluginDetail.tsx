import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { MOCK_PLUGINS } from './PluginStore';

const PluginDetail: React.FC = () => {
    const selectedPluginId = useAppStore(state => state.selectedPluginId);
    const setSelectedPluginId = useAppStore(state => state.setSelectedPluginId);
    
    const plugin = MOCK_PLUGINS.find(p => p.id === selectedPluginId);
    
    const [githubStats, setGithubStats] = useState<{ stars: number | string; forks: number | string; contributors: number | string } | null>(null);
    const [loadingStats, setLoadingStats] = useState(false);
    const [installProgress, setInstallProgress] = useState<number | null>(null);
    const [isLocalInstalled, setIsLocalInstalled] = useState(false);

    useEffect(() => {
        if (plugin) {
            setIsLocalInstalled(plugin.tags.includes('Installed'));
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
            // Fetch repo stats
            fetch(`https://api.github.com/repos/${plugin.repo}`)
                .then(res => res.json())
                .then(data => {
                    setGithubStats(prev => ({
                        ...prev,
                        stars: data.stargazers_count,
                        forks: data.forks_count,
                        contributors: prev?.contributors || '10+' // Mocked contributors
                    }));
                    setLoadingStats(false);
                })
                .catch(() => {
                    setGithubStats({ stars: '-', forks: '-', contributors: '-' });
                    setLoadingStats(false);
                });
        }
    }, [plugin]);

    if (!plugin) return null;

    const handleInstall = async () => {
        if (!plugin) return;
        setInstallProgress(0);
        
        try {
            const result = await window.api.installExtensionFromGithub(plugin.id, plugin.repo);
            if (result.success) {
                setIsLocalInstalled(true);
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
                <div className="absolute inset-0 flex items-center justify-center flex-col gap-2">
                    <span className="material-symbols-outlined text-white/20 text-7xl">image</span>
                    <span className="text-white/30 text-sm">Media Gallery (Coming Soon)</span>
                </div>
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
                        <button className="flex-1 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-colors text-sm font-semibold flex items-center justify-center gap-2">
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                            Uninstall
                        </button>
                        <button className="flex-1 py-2 rounded-lg bg-primary text-slate-900 transition-colors text-sm font-semibold flex items-center justify-center gap-2 shadow-lg shadow-primary/20">
                            <span className="material-symbols-outlined text-[18px]">toggle_on</span>
                            Disable
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
            <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Description</h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                    {plugin.fullDescription}
                </p>
            </div>
        </div>
    );
};

export default PluginDetail;
