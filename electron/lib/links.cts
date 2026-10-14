// T-219: main-process copy of the canonical project links (src/config/links.ts is the renderer copy; the two compile in
// separate projects, so tests/links.test.ts asserts they match and that tools/builderConfig.cjs publishes to the same repo).
// Pure: no Electron imports.

export const REPO_OWNER = 'Kobar-Project';
export const REPO_NAME = 'KoBar';

export const REPO_SLUG = `${REPO_OWNER}/${REPO_NAME}`;
export const REPO_URL = `https://github.com/${REPO_SLUG}`;
export const RELEASES_URL = `${REPO_URL}/releases`;
export const ISSUES_URL = `${REPO_URL}/issues`;
export const DISCUSSIONS_URL = `${REPO_URL}/discussions`;

export const CONTACT_EMAIL = 'hello@kobar.org';
export const SECURITY_EMAIL = CONTACT_EMAIL;

/**
 * The only auto-update feed: GitHub Releases of the canonical repository. Passed to `autoUpdater.setFeedURL` so the feed never
 * depends on a user-controlled value or on whatever app-update.yml was baked into an old build.
 */
export const UPDATE_FEED = { provider: 'github', owner: REPO_OWNER, repo: REPO_NAME } as const;
