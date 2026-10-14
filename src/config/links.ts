// T-219: the single place for every project link the renderer uses (repo, releases, issues, contact, website, support pages).
// Nothing else under src/ may hard-code these. The main process keeps an identical copy in electron/lib/links.cts (the two
// compile in separate projects), and tests/links.test.ts fails if they or tools/builderConfig.cjs (publish target) drift apart.

/** The canonical GitHub repository: it hosts the source, the releases and the auto-update feed. */
export const REPO_OWNER = 'Kobar-Project';
export const REPO_NAME = 'KoBar';

const GITHUB_ORIGIN = 'https://github.com';

export const REPO_SLUG = `${REPO_OWNER}/${REPO_NAME}`;
export const REPO_URL = `${GITHUB_ORIGIN}/${REPO_SLUG}`;
export const RELEASES_URL = `${REPO_URL}/releases`;
export const ISSUES_URL = `${REPO_URL}/issues`;
export const DISCUSSIONS_URL = `${REPO_URL}/discussions`;

/** The one contact address, also the private security-report address named in SECURITY.md. */
export const CONTACT_EMAIL = 'hello@kobar.org';
export const SECURITY_EMAIL = CONTACT_EMAIL;
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;

export const WEBSITE_URL = 'https://kobar.org';
export const WEBSITE_HOST = 'kobar.org';
export const PATREON_URL = 'https://patreon.com/kobarproject';
export const OPEN_COLLECTIVE_URL = 'https://opencollective.com/kobar';
/** Credited contributor shown in Settings > About. */
export const CONTRIBUTOR_ARINDAM_URL = 'https://github.com/arindam-sahoo';

/** Official plugin registry (unchanged by T-219; plugin repositories stay under their own Kobar-Project repos). */
export const PLUGIN_REGISTRY_URL = 'https://raw.githubusercontent.com/Kobar-Project/kobar-plugins-registry/main/registry.json';

/** Maker credited in Settings > About. */
export const AUTHOR_NAME = 'Ekrem EDALI';
export const AUTHOR_URL = 'https://github.com/eedali';
