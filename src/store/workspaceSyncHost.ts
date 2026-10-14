// T-612: the main window's one workspace-sync instance, wired to the real app store. main.tsx hands it to startSettingsSync.
// Host-internal, not part of the plugin contract.
import { useAppStore } from './useAppStore';
import { createWorkspaceSync } from './workspaceSync';

export const workspaceSync = createWorkspaceSync({ store: useAppStore });
