// CNL-08: the "who published this" line of a plugin row. `verified` + "Kobar-Project" for the official organisation, `warning` + the
// owner and "unverified" for any other repo. Nothing is shown without a strict "owner/name" repo (a dev plugin has none).
import { normalizePluginRepo } from '../../../store/pluginSummary';
import { Icon } from '../../../ui';
import type { SettingsPageProps } from '../../pages';

const OFFICIAL_OWNER = 'kobar-project';

export function PluginOrigin({ t, repo }: { t: SettingsPageProps['t']; repo: string | null }) {
    const slug = normalizePluginRepo(repo);
    if (!slug) return null;
    const owner = slug.split('/')[0];
    const verified = owner.toLowerCase() === OFFICIAL_OWNER;
    return (
        <span className="inline-flex min-w-0 items-center gap-1 [font:var(--kb-type-caption)] text-fg-2">
            <Icon
                name={verified ? 'verified' : 'warning'}
                size={16}
                className={verified ? 'shrink-0 text-accent' : 'shrink-0 text-warning'}
            />
            <span className="truncate">{verified ? t('pluginVerifiedSource') : t('pluginUnverifiedMeta').replace('{owner}', owner)}</span>
        </span>
    );
}
