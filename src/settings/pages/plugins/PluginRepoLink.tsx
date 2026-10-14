// R-16: a small "owner/name" GitHub link for a plugin row. A plain anchor with target="_blank": main's navigation guard
// (electron/main/app/security.cts) sends it through the checked external-open gate (https is allow-listed there). Renders nothing
// unless the repo is a strict "owner/name" (the URL is rebuilt from the validated slug, never taken verbatim).
import { Icon } from '../../../ui';
import { normalizePluginRepo, pluginRepoUrl } from '../../../store/pluginSummary';

export function PluginRepoLink({ repo, label }: { repo: string | null; label: string }) {
    const slug = normalizePluginRepo(repo);
    const url = pluginRepoUrl(slug);
    if (!slug || !url) return null;
    return (
        <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            title={label}
            className="flex min-w-0 max-w-full items-center gap-1.5 text-[0.6875rem] leading-4 text-fg-2 hover:text-[var(--kb-accent)] hover:underline"
        >
            <Icon name="open_in_new" size={16} className="shrink-0" />
            <span className="min-w-0 truncate">{slug}</span>
        </a>
    );
}
