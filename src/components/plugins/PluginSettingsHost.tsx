// T-615: the only part of the old Plugins tab that stays in the main window. Two things cannot move to the Settings window, because
// that window has no plugin host (no window.React / window.KoBarExtensions / app store):
//   - the v1 settings panel a plugin registered with KoBarExtensions.registerSettingsPanel (`selectedPluginId` set), and
//   - installing a plugin from a GitHub repository link (nothing selected).
// Both are opened from the Settings window through the `plugin.openSettings` / `plugin.installFromGithub` actions (pluginSync.ts).
import React, { useEffect, useState } from 'react';
import { useT } from '../../i18n/useT';
import type { TranslationKeys } from '../../i18n';
import { useAppStore } from '../../store/useAppStore';
import { PLUGIN_CANCELED_REASON, needsAppUpdateMessage } from './pluginResults';

const GITHUB_URL_PATTERN = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)/i;

const GithubInstall: React.FC = () => {
    const t = useT();
    const triggerExtensionReload = useAppStore((state) => state.triggerExtensionReload);
    const [link, setLink] = useState('');
    const [isChecking, setIsChecking] = useState(false);
    const [prompt, setPrompt] = useState<{ repoName: string; repoUrl: string } | null>(null);
    // An i18n key (resolved at render, so a language switch updates it) or a ready message from the main process.
    const [error, setError] = useState<{ key: TranslationKeys } | { text: string } | null>(null);
    const [installing, setInstalling] = useState(false);

    const match = link.trim().match(GITHUB_URL_PATTERN);
    const repo = match ? `${match[1]}/${match[2]}` : null;

    const onLinkChange = (value: string) => {
        setLink(value);
        setPrompt(null);
        setError(null);
    };

    const checkRepo = async () => {
        if (!repo) return;
        setIsChecking(true);
        setError(null);
        setPrompt(null);
        try {
            const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`);
            if (res.ok) {
                const data = await res.json();
                const hasZip = (data.assets && data.assets.some((a: { name: string }) => a.name.endsWith('.zip'))) || data.zipball_url;
                if (hasZip) setPrompt({ repoName: repo.split('/')[1], repoUrl: repo });
                else setError({ key: 'pluginHostErrNoAsset' });
            } else {
                setError({ key: 'pluginHostErrNotFound' });
            }
        } catch {
            setError({ key: 'pluginHostErrCheck' });
        } finally {
            setIsChecking(false);
        }
    };

    const confirmInstall = async () => {
        if (!prompt) return;
        setInstalling(true);
        try {
            const result = await window.api.installExtensionFromGithub(prompt.repoName, prompt.repoUrl);
            if (result.success) {
                setLink('');
                setPrompt(null);
                triggerExtensionReload();
            } else if (result.reason !== PLUGIN_CANCELED_REASON) {
                const updateMessage = needsAppUpdateMessage(result.reason, t);
                setError(
                    updateMessage ? { text: updateMessage } : result.reason ? { text: result.reason } : { key: 'pluginHostErrInstall' }
                );
            }
        } catch {
            setError({ key: 'pluginHostErrUnexpected' });
        } finally {
            setInstalling(false);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <h3 className="text-sm font-semibold text-fg-1 uppercase tracking-wider">GitHub</h3>
            <div className="relative w-full no-drag-region">
                <input
                    type="text"
                    value={link}
                    onChange={(e) => onLinkChange(e.target.value)}
                    placeholder="https://github.com/owner/repo"
                    aria-label={t('pluginHostGithubLink')}
                    className="w-full bg-inset border border-stroke rounded-xl py-2.5 pl-3 pr-28 text-sm text-fg-1 focus:outline-none focus:border-primary transition-colors placeholder:text-fg-3"
                />
                {repo && (
                    <button
                        onClick={checkRepo}
                        disabled={isChecking}
                        className="absolute right-2 top-1/2 -translate-y-1/2 bg-primary text-[var(--kb-on-accent)] px-3 py-1 rounded-lg text-xs font-semibold hover:bg-primary/90 disabled:opacity-50"
                    >
                        {isChecking ? t('pluginHostChecking') : t('pluginHostLoadLink')}
                    </button>
                )}
            </div>
            {prompt && (
                <div className="p-4 rounded-xl bg-primary/10 border border-primary/30 flex flex-col gap-3">
                    <p className="text-xs text-fg-2">
                        {t('pluginHostInstallPrompt')
                            .split('{name}')
                            .flatMap((part, i) => (i === 0 ? [part] : [<strong key={i}>{prompt.repoName}</strong>, part]))}
                    </p>
                    <div className="flex justify-end gap-2">
                        <button
                            onClick={() => setPrompt(null)}
                            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-inset text-fg-1 hover:bg-fill-selected"
                        >
                            {t('pluginHostNo')}
                        </button>
                        <button
                            onClick={confirmInstall}
                            disabled={installing}
                            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-primary text-black hover:bg-primary/90"
                        >
                            {installing ? t('pluginHostInstalling') : t('pluginHostYesInstall')}
                        </button>
                    </div>
                </div>
            )}
            {error && (
                <div role="alert" className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                    {'key' in error ? t(error.key) : error.text}
                </div>
            )}
        </div>
    );
};

const PluginSettingsHost: React.FC = () => {
    const t = useT();
    const selectedPluginId = useAppStore((state) => state.selectedPluginId);
    const setSelectedPluginId = useAppStore((state) => state.setSelectedPluginId);
    const design = useAppStore((state) => state.design);
    // A plugin's panel registers once its script ran, so re-render when the registry changes.
    const [, setTick] = useState(0);
    useEffect(() => {
        const registry = window.KoBarExtensions as unknown as { subscribe?: (listener: () => void) => () => void } | undefined;
        return registry?.subscribe?.(() => setTick((n) => n + 1));
    }, []);

    const panel = selectedPluginId ? window.KoBarExtensions?.getSettingsPanel(selectedPluginId) : undefined;

    return (
        <div
            className="flex-1 overflow-y-auto p-8 pl-10 pb-4 custom-scrollbar relative flex flex-col gap-6"
            style={{ backgroundColor: design === 'style2' ? 'transparent' : 'var(--theme-bg-base)' }}
        >
            {selectedPluginId ? (
                <div className="flex flex-col gap-4">
                    <button
                        onClick={() => setSelectedPluginId(null)}
                        aria-label={t('pluginHostBack')}
                        className="self-start flex items-center gap-1 text-sm text-fg-2 hover:text-fg-1 no-drag-region"
                    >
                        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                    </button>
                    {panel && (
                        <>
                            <h3 className="text-sm font-semibold text-fg-1 uppercase tracking-wider">{t('pluginHostSettings')}</h3>
                            {/* T-503: v1 settings panels always resolve the dark scheme tokens */}
                            <div data-scheme="dark" className="p-4 rounded-xl bg-black/20 border border-stroke">
                                {panel.render()}
                            </div>
                        </>
                    )}
                </div>
            ) : (
                <GithubInstall />
            )}
        </div>
    );
};

export default PluginSettingsHost;
