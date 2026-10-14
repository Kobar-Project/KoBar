import React, { StrictMode } from 'react'
import ReactDOM from 'react-dom'
import { createRoot } from 'react-dom/client'
// T-403: claims the preload's internal storage bridge (boot snapshot + write channels) before any plugin script can run.
import './storage/client'
// T-606: claims the preload's internal Settings window sync bridge, also before any plugin script can run.
import { settingsSyncBridge, startSettingsSync } from './store/sync'
import { setSettingsOpener } from './store/settingsOpener'
import { pluginSync } from './store/pluginSyncHost'
import { workspaceSync } from './store/workspaceSyncHost'
import { systemSync } from './store/systemSyncHost'
import '@fontsource-variable/space-grotesk'
import 'material-symbols/outlined.css'
import './index.css'
import App from './App.tsx'
import { useAppStore } from './store/useAppStore'
import { createAutoLaunchResync } from './store/autoLaunchResync'
import './components/extensions/extensionRegistry'
import { setupLocalStorageIsolation } from './utils/localStorageIsolation'
import { migrateLocalStorageSnapshot, scheduleLocalStorageSnapshot } from './storage/migrateFromLocalStorage'
import { releasePersistFileWrites } from './store/persistStorage'

window.React = React;
window.ReactDOM = ReactDOM;
window.useAppStore = useAppStore;

// T-606: publish the settings snapshot to the Settings window (via main) and apply its allow-listed actions.
// T-607: a `launchAtStartup` change from the Settings window re-reads the OS login-item state afterwards (main may refuse it).
const resyncAutoLaunch = createAutoLaunchResync({
  win: window,
  read: () => window.api?.getAutoLaunch?.(),
  apply: (enabled) => useAppStore.setState({ launchAtStartup: enabled }),
});
// T-615: openSettingsTab / openPluginsTab open the Settings window through the claimed bridge.
setSettingsOpener(settingsSyncBridge ? settingsSyncBridge.openSettings : null);
startSettingsSync({
  store: useAppStore,
  bridge: settingsSyncBridge,
  plugins: pluginSync,
  workspaces: workspaceSync,
  system: systemSync,
  onApplied: (key) => {
    if (key === 'launchAtStartup') resyncAutoLaunch();
  },
});

setupLocalStorageIsolation();
// T-404: one-time masked archive of localStorage into kobar-data/ (after hydration, when idle; localStorage is only read).
// T-405: the first write of `kobar-storage` into the file store waits until this archive exists.
scheduleLocalStorageSnapshot({
  store: useAppStore,
  run: async () => {
    const outcome = await migrateLocalStorageSnapshot();
    if (outcome.ok || (outcome.status === 'skipped' && outcome.reason === 'already-done')) releasePersistFileWrites();
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

