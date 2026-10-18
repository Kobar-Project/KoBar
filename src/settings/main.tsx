// T-605: Settings window entry (settings.html). Like the PiP entry it renders without the app store: no persist middleware,
// no localStorage isolation, no plugin host (window.React / window.useAppStore / window.KoBarExtensions are NOT set here),
// so this window never reads or writes `kobar-storage`. T-606: the read-only settings mirror (./mirror) is started here; it gets
// snapshots from the main window (via main) and sends actions, through the narrow settings-preload only.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/space-grotesk';
import 'material-symbols/outlined.css';
import '../index.css';
import { startSettingsAppearanceSync } from './appearance';
import { settingsMirror } from './mirror';
import { parseSettingsParams, parseSettingsPlatform } from './params';
import { SettingsApp } from './SettingsApp';
import { setDocumentPlatform, type UiPlatform } from '../platform';

const { lang, page } = parseSettingsParams(window.location.search);
// MAC-022: platform from the load query, before the first render; a snapshot's platform (below) still overrides it.
setDocumentPlatform(parseSettingsPlatform(window.location.search));
const root = document.documentElement;
root.lang = lang;
// T-608: root attributes as in src/App.tsx (same helpers): the defaults until the first snapshot,
// then the main window's accent, custom colour, material and density from the mirror.
startSettingsAppearanceSync(settingsMirror.store, root);

// MAC-022: this window has no preload api object; the host's system summary carries the platform. Applied on every snapshot (null leaves it).
const applyPlatform = (system: { platform?: UiPlatform } | null) => {
    if (system?.platform) setDocumentPlatform(system.platform);
};
applyPlatform(settingsMirror.store.getState().system);
settingsMirror.store.subscribe((s) => applyPlatform(s.system));

settingsMirror.start();

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <SettingsApp lang={lang} initialPage={page} />
    </StrictMode>
);
