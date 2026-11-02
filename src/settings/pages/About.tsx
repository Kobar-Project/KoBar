// T-614: Settings > About. The app version (from the system summary) and the same credits and links the old Settings panel showed.
// Links are plain anchors with target="_blank": main's navigation guard (electron/main/app/security.cts) sends them through the
// checked external-open gate, so this window needs no bridge for them. There is no paid-licence section (licensing is gone); the
// "MIT license" chip only names the open-source licence of the app.
// CNL-08 (Canlı): a hero card (accent tile with the KoBar head, name, tagline, chips), then Contact and Credits cards.
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
import KoBarHead from '../../components/layout/KoBarHead';
import { Card } from '../../ui';
import { cx, INTERACTIVE } from '../../ui/cx';
import { useSystemSummary } from '../mirror';
import type { SettingsPageProps } from '../pages';
import { PAGE_STACK, StaticChip } from './shared';

const BODY = '[font:var(--kb-type-body)] text-fg-2';
const LINK = cx(INTERACTIVE, 'rounded-xs [font:var(--kb-type-body-strong)] text-accent hover:underline');

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
        <div className={PAGE_STACK}>
            <section aria-label={t('about')} className="flex items-center gap-5 rounded-xl bg-container p-6 text-on-container">
                <span className="flex size-22 shrink-0 items-center justify-center rounded-xl bg-accent text-on-accent">
                    <KoBarHead size={56} />
                </span>
                <div className="flex min-w-0 flex-col gap-2">
                    <p className="[font:var(--kb-type-headline)]">KoBar</p>
                    <p className="[font:var(--kb-type-body)]">{t('aboutTagline')}</p>
                    <div className="flex flex-wrap gap-1.5">
                        <StaticChip tone="inset">{t('aboutOpenSource')}</StaticChip>
                        <StaticChip tone="inset">{t('aboutLicense')}</StaticChip>
                        <StaticChip tone="inset">
                            {t('version')}: {summary?.version || '…'}
                        </StaticChip>
                    </div>
                </div>
            </section>
            <Card as="section" variant="list" aria-label={t('aboutContactTitle')} title={t('aboutContactTitle')}>
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
            </Card>
            <Card as="section" variant="list" aria-label={t('aboutCreditsTitle')} title={t('aboutCreditsTitle')}>
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
            </Card>
            <Card as="section" variant="list" aria-label={t('aboutSponsors')} title={t('aboutSponsors')}>
                <p className={BODY}>
                    {t('aboutSponsorsBody')}
                    <ExternalLink href={CONTACT_MAILTO}>{CONTACT_EMAIL}</ExternalLink>
                </p>
            </Card>
        </div>
    );
}
