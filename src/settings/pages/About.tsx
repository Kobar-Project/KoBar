// T-614: Settings > About. The app version (from the system summary) and the same credits and links the old Settings panel showed.
// Links are plain anchors with target="_blank": main's navigation guard (electron/main/app/security.cts) sends them through the
// checked external-open gate, so this window needs no bridge for them. There is no licence section (licensing is gone).
import {
    AUTHOR_NAME,
    AUTHOR_URL,
    CONTACT_EMAIL,
    CONTACT_MAILTO,
    CONTRIBUTOR_ARINDAM_URL,
    OPEN_COLLECTIVE_URL,
    PATREON_URL,
    WEBSITE_HOST,
    WEBSITE_URL,
} from '../../config/links';
import { Surface } from '../../ui';
import { useSystemSummary } from '../mirror';
import type { SettingsPageProps } from '../pages';

const BODY = 'text-[0.8125rem] leading-5 text-fg-2';
const LINK = 'font-semibold text-[var(--kb-accent)] hover:underline';

function ExternalLink({ href, children }: { href: string; children: string }) {
    return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
            {children}
        </a>
    );
}

export function AboutPage({ t }: SettingsPageProps) {
    const summary = useSystemSummary();
    return (
        <div className="flex max-w-xl flex-col gap-4">
            <Surface as="section" level="surface" elevation="e1" radius="lg" aria-label={t('about')} className="flex flex-col gap-3 p-4">
                <p className="text-[0.8125rem] leading-5 font-semibold text-fg-1">KoBar</p>
                <p className={BODY}>
                    {t('version')}: <span className="font-mono text-fg-1">{summary?.version || '…'}</span>
                </p>
                <p className={BODY}>
                    {t('aboutMaker')
                        .split('{author}')
                        .flatMap((part, i) =>
                            i === 0
                                ? [part]
                                : [
                                      <ExternalLink key="author" href={AUTHOR_URL}>
                                          {AUTHOR_NAME}
                                      </ExternalLink>,
                                      part,
                                  ]
                        )}
                </p>
                <p className={BODY}>{t('aboutCredits')}</p>
                <p className={BODY}>
                    {t('aboutContributors')} <ExternalLink href={CONTRIBUTOR_ARINDAM_URL}>Arindam Sahoo</ExternalLink>
                </p>
                <p className={BODY}>
                    {t('aboutContact')}
                    <ExternalLink href={CONTACT_MAILTO}>{CONTACT_EMAIL}</ExternalLink>
                </p>
                <p className={BODY}>
                    {t('aboutWebsite')}
                    <ExternalLink href={WEBSITE_URL}>{WEBSITE_HOST}</ExternalLink>
                </p>
                <p className={BODY}>
                    <ExternalLink href={PATREON_URL}>Patreon</ExternalLink>
                    {' · '}
                    <ExternalLink href={OPEN_COLLECTIVE_URL}>Open Collective</ExternalLink>
                </p>
            </Surface>
            <Surface
                as="section"
                level="surface"
                elevation="e1"
                radius="lg"
                aria-label={t('aboutSponsors')}
                className="flex flex-col gap-3 p-4"
            >
                <p className="text-[0.8125rem] leading-5 font-semibold text-fg-1">{t('aboutSponsors')}</p>
                <p className={BODY}>
                    {t('aboutSponsorsBody')}
                    <ExternalLink href={CONTACT_MAILTO}>{CONTACT_EMAIL}</ExternalLink>
                </p>
            </Surface>
        </div>
    );
}
