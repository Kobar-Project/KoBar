import { describe, expect, it } from 'vitest';
import { createInstallGrants } from '../electron/lib/installGrants.cjs';
import { readMainModule } from './helpers/mainSource';

// CNL: installs / updates clicked in the Settings window skip the native confirmation through a short-lived grant; everything
// else (a plugin calling window.api, a late call) still confirms.
describe('install grants', () => {
    it('a Settings install click grants exactly one install for a short time', () => {
        let t = 1000;
        const grants = createInstallGrants(() => t);
        expect(grants.consume('install', 'todo')).toBe(false);
        grants.grantFromSettingsAction('plugin.install', { id: 'todo' });
        expect(grants.consume('update', 'todo')).toBe(false);
        expect(grants.consume('install', 'todo')).toBe(true);
        expect(grants.consume('install', 'todo')).toBe(false);
        grants.grantFromSettingsAction('plugin.install', { id: 'todo' });
        t += 15_001;
        expect(grants.consume('install', 'todo')).toBe(false);
    });

    it('a single install / update grant is bound to the clicked plugin id', () => {
        const grants = createInstallGrants(() => 0);
        grants.grantFromSettingsAction('plugin.install', { id: 'todo' });
        // A plugin in the main window cannot spend it on another plugin.
        expect(grants.consume('install', 'evil')).toBe(false);
        expect(grants.consume('install', 'todo')).toBe(true);
        grants.grantFromSettingsAction('plugin.update', { id: 'calc' });
        expect(grants.consume('update', 'todo')).toBe(false);
        expect(grants.consume('update', 'calc')).toBe(true);
        // No usable id in the payload: no grant at all.
        for (const payload of [undefined, null, {}, { id: '' }, { id: 7 }, { id: 'x'.repeat(201) }, 'todo']) {
            grants.grantFromSettingsAction('plugin.install', payload);
        }
        expect(grants.consume('install', 'todo')).toBe(false);
        expect(grants.consume('install', '')).toBe(false);
    });

    it('update all grants several updates, other actions grant nothing', () => {
        let t = 0;
        const grants = createInstallGrants(() => t);
        for (const type of ['plugin.uninstall', 'plugin.setEnabled', 'setTonalSurfaces', '__proto__', 'constructor']) {
            grants.grantFromSettingsAction(type);
        }
        expect(grants.consume('install', 'a')).toBe(false);
        expect(grants.consume('update', 'a')).toBe(false);
        grants.grantFromSettingsAction('plugin.updateAll', {});
        expect(grants.consume('update', 'a')).toBe(true);
        expect(grants.consume('update', 'b')).toBe(true);
        // Update all never grants an install.
        expect(grants.consume('install', 'a')).toBe(false);
        t += 120_001;
        expect(grants.consume('update', 'a')).toBe(false);
    });

    it('main wires it: the Settings relay grants, the GitHub install consumes before confirming', () => {
        const relay = readMainModule('windows/settingsSync.cts');
        expect(relay).toContain('installGrants.grantFromSettingsAction(action.type, action.payload)');
        const install = readMainModule('services/extensions/install.cts');
        const from = install.indexOf("registry.handle('install-extension-from-github'");
        const handler = install.slice(from, install.indexOf('\n    });', from));
        expect(handler.indexOf("installGrants.consume(update ? 'update' : 'install', id)")).toBeGreaterThan(0);
        expect(handler).toContain('confirmPluginAction(');
        // The drag-and-drop path keeps its confirmation.
        const pathFrom = install.indexOf("registry.handle('install-extension-from-path'");
        expect(install.slice(pathFrom, install.indexOf('\n    });', pathFrom))).toContain('confirmPluginAction(');
    });
});
