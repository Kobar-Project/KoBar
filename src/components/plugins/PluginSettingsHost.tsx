// T-615: the only part of the old Plugins tab that stays in the main window. Two things cannot move to the Settings window, because
// that window has no plugin host (no window.React / window.KoBarExtensions / app store):
//   - the v1 settings panel a plugin registered with KoBarExtensions.registerSettingsPanel (`selectedPluginId` set), and
//   - installing a plugin from a GitHub repository link (nothing selected).
// Both are opened from the Settings window through the `plugin.openSettings` / `plugin.installFromGithub` actions (pluginSync.ts).
import React, { useEffect, useState } from 'react';
import { useT } from '../../i18n/useT';
import type { TranslationKeys } from '../../i18n';
import { useAppStore } from '../../store/useAppStore';
import { Button, IconButton, IconTile, Surface, TextField } from '../../ui';
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
            <div className="flex items-center gap-3">
                <IconTile icon="extension" size="md" />
                <h3 className="font-heading [font:var(--kb-type-title)] text-fg-1">GitHub</h3>
            </div>
            <div className="no-drag-region relative w-full">
                <TextField
                    label={t('pluginHostGithubLink')}
                    hideLabel
                    icon="link"
                    value={link}
                    onChange={(e) => onLinkChange(e.target.value)}
                    placeholder="https://github.com/owner/repo"
                    className={repo ? 'pe-32' : undefined}
                />
                {repo && (
                    <Button
                        variant="tonal"
                        size="sm"
                        onClick={checkRepo}
                        disabled={isChecking}
                        className="absolute end-2 top-1/2 -translate-y-1/2"
                    >
                        {isChecking ? t('pluginHostChecking') : t('pluginHostLoadLink')}
                    </Button>
                )}
            </div>
            {prompt && (
                <Surface level="inset" radius="md" className="flex flex-col gap-3 p-4">
                    <p className="[font:var(--kb-type-caption)] text-fg-2">
                        {t('pluginHostInstallPrompt')
                            .split('{name}')
                            .flatMap((part, i) => (i === 0 ? [part] : [<strong key={i}>{prompt.repoName}</strong>, part]))}
                    </p>
                    <div className="flex justify-end gap-2">
                        <Button variant="text" size="sm" onClick={() => setPrompt(null)}>
                            {t('pluginHostNo')}
                        </Button>
                        <Button variant="filled" size="sm" onClick={confirmInstall} disabled={installing}>
                            {installing ? t('pluginHostInstalling') : t('pluginHostYesInstall')}
                        </Button>
                    </div>
                </Surface>
            )}
            {error && (
                <div
                    role="alert"
                    className="rounded-md bg-[color-mix(in_oklab,var(--kb-danger)_14%,transparent)] p-4 [font:var(--kb-type-caption)] text-danger"
                >
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
    // A plugin's panel registers once its script ran, so re-render when the registry changes.
    const [, setTick] = useState(0);
    useEffect(() => {
        const registry = window.KoBarExtensions as unknown as { subscribe?: (listener: () => void) => () => void } | undefined;
        return registry?.subscribe?.(() => setTick((n) => n + 1));
    }, []);

    const panel = selectedPluginId ? window.KoBarExtensions?.getSettingsPanel(selectedPluginId) : undefined;

    return (
        <div className="custom-scrollbar relative flex flex-1 flex-col gap-6 overflow-y-auto p-8 pb-4">
            {selectedPluginId ? (
                <div className="flex flex-col gap-4">
                    <IconButton
                        icon="arrow_back"
                        variant="tonal"
                        size={36}
                        label={t('pluginHostBack')}
                        tooltip={false}
                        className="self-start"
                        onClick={() => setSelectedPluginId(null)}
                    />
                    {panel && (
                        <>
                            <div className="flex items-center gap-3">
                                <IconTile icon="settings" size="md" />
                                <h3 className="font-heading [font:var(--kb-type-title)] text-fg-1">{t('pluginHostSettings')}</h3>
                            </div>
                            {/* T-503: v1 settings panels always resolve the dark scheme tokens */}
                            <div data-scheme="dark" className="rounded-xl border border-stroke bg-surface p-4">
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
