// T-314: extensions-config.json (which installed plugins are enabled) and the userData/extensions folder, moved unchanged out of main.cts.
// The paths depend on userData, which the dev build redirects (setPath) near the top of main.cts, so they are computed when main.cts calls
// createExtensionsConfig() at the position where the module-level constants used to be, never at import time.
import * as fs from 'fs';
import * as path from 'path';

export function createExtensionsConfig(userData: string) {
    const extensionsDir = path.join(userData, 'extensions');
    const extensionsConfigPath = path.join(userData, 'extensions-config.json');

    // Ensure extensions directory exists
    if (!fs.existsSync(extensionsDir)) {
        fs.mkdirSync(extensionsDir, { recursive: true });
    }

    function getExtensionsConfig(): Record<string, boolean> {
        if (fs.existsSync(extensionsConfigPath)) {
            try {
                return JSON.parse(fs.readFileSync(extensionsConfigPath, 'utf8'));
            } catch (e) {
                console.error('Failed to parse extensions config:', e);
            }
        }
        return {};
    }

    function saveExtensionsConfig(config: Record<string, boolean>) {
        try {
            fs.writeFileSync(extensionsConfigPath, JSON.stringify(config, null, 2), 'utf8');
        } catch (e) {
            console.error('Failed to save extensions config:', e);
        }
    }

    return { extensionsDir, extensionsConfigPath, getExtensionsConfig, saveExtensionsConfig };
}

export type ExtensionsConfigStore = ReturnType<typeof createExtensionsConfig>;
