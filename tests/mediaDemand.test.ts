import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    createMediaDemandController,
    isMediaPluginEnabled,
    isMediaPluginId,
    shouldPollMedia,
    type MediaDemandControllerDeps,
} from '../electron/main/services/mediaDemand.cjs';
import { createMediaPluginProbe, listInstalledExtensionIds } from '../electron/main/services/extensions/mediaPlugin.cjs';
import { OFFICIAL_PLUGIN_IDS } from '../electron/lib/officialPlugins.cjs';
import { readMainModule } from './helpers/mainSource';

// T-316 (ARC-13, ARC-04): media polling (SMTC worker / osascript) and the video-URL scan run only while the media plugin (KoPlayer)
// is enabled or a PiP window is open.

describe('media demand policy (T-316)', () => {
    it('polls only for an enabled media plugin or an open PiP window', () => {
        expect(shouldPollMedia({ mediaPluginEnabled: false, pipOpen: false })).toBe(false);
        expect(shouldPollMedia({ mediaPluginEnabled: true, pipOpen: false })).toBe(true);
        expect(shouldPollMedia({ mediaPluginEnabled: false, pipOpen: true })).toBe(true);
        expect(shouldPollMedia({ mediaPluginEnabled: true, pipOpen: true })).toBe(true);
    });

    it('recognises the official KoPlayer id, its dev playground copy and other koplayer ids (case-insensitive)', () => {
        expect(OFFICIAL_PLUGIN_IDS).toContain('koplayer-plugin');
        expect(isMediaPluginId('koplayer-plugin')).toBe(true);
        expect(isMediaPluginId('dev-koplayer-plugin')).toBe(true);
        expect(isMediaPluginId('KoPlayer')).toBe(true);
        for (const id of OFFICIAL_PLUGIN_IDS.filter((officialId) => officialId !== 'koplayer-plugin')) {
            expect(isMediaPluginId(id), id).toBe(false);
        }
        expect(isMediaPluginId(undefined)).toBe(false);
        expect(isMediaPluginId('')).toBe(false);
    });

    it('treats an installed media plugin as enabled unless the config says false (same rule as the renderer)', () => {
        expect(isMediaPluginEnabled([], {})).toBe(false);
        expect(isMediaPluginEnabled(['todolist-plugin'], { 'todolist-plugin': true })).toBe(false);
        expect(isMediaPluginEnabled(['koplayer-plugin'], {})).toBe(true);
        expect(isMediaPluginEnabled(['koplayer-plugin'], { 'koplayer-plugin': true })).toBe(true);
        expect(isMediaPluginEnabled(['koplayer-plugin'], { 'koplayer-plugin': false })).toBe(false);
        // A config entry alone (plugin not installed) does not count.
        expect(isMediaPluginEnabled(['todolist-plugin'], { 'koplayer-plugin': true })).toBe(false);
        // Either copy enabled is enough.
        expect(isMediaPluginEnabled(['koplayer-plugin', 'dev-koplayer-plugin'], { 'koplayer-plugin': false })).toBe(true);
    });
});

describe('media demand controller with fakes (T-316)', () => {
    function setup(initial: { plugin?: boolean; pip?: boolean } = {}) {
        const state = { plugin: initial.plugin ?? false, pip: initial.pip ?? false, running: false };
        const calls: string[] = [];
        const deps: MediaDemandControllerDeps = {
            isMediaPluginEnabled: () => state.plugin,
            isPipOpen: () => state.pip,
            isRunning: () => state.running,
            start: () => {
                calls.push('start');
                state.running = true;
            },
            stop: () => {
                calls.push('stop');
                state.running = false;
            },
            clearMedia: () => calls.push('clear'),
        };
        return { state, calls, controller: createMediaDemandController(deps), deps };
    }

    it('does nothing at startup when no plugin needs media', () => {
        const { calls, controller } = setup();
        expect(controller.update()).toBe(false);
        expect(calls).toEqual([]);
    });

    it('starts once for an enabled media plugin; repeated updates never start a second worker', () => {
        const { calls, controller } = setup({ plugin: true });
        expect(controller.update()).toBe(true);
        expect(controller.update()).toBe(true);
        expect(controller.update()).toBe(true);
        expect(calls).toEqual(['start']);
    });

    it('stops once and clears the media when the plugin is disabled; repeated updates do nothing more', () => {
        const { state, calls, controller } = setup({ plugin: true });
        controller.update();
        state.plugin = false;
        expect(controller.update()).toBe(false);
        expect(controller.update()).toBe(false);
        expect(calls).toEqual(['start', 'stop', 'clear']);
    });

    it('a PiP window keeps polling alive without the plugin and stops it when it closes', () => {
        const { state, calls, controller } = setup();
        state.pip = true;
        controller.update();
        state.pip = false;
        controller.update();
        expect(calls).toEqual(['start', 'stop', 'clear']);
    });

    it('closing the PiP while the plugin is enabled keeps polling running', () => {
        const { state, calls, controller } = setup({ plugin: true, pip: true });
        controller.update();
        state.pip = false;
        controller.update();
        expect(calls).toEqual(['start']);
    });

    it('restarts a session that stopped on its own (worker error) when the demand is still there', () => {
        const { state, calls, controller } = setup({ plugin: true });
        controller.update();
        state.running = false; // the worker error handler stopped polling
        controller.update();
        expect(calls).toEqual(['start', 'start']);
    });

    it('a throwing plugin probe counts as "not enabled" and never throws out of update()', () => {
        const { calls, deps } = setup();
        const controller = createMediaDemandController({
            ...deps,
            isMediaPluginEnabled: () => {
                throw new Error('disk error');
            },
        });
        expect(controller.update()).toBe(false);
        expect(calls).toEqual([]);
    });

    it('enable -> disable -> enable starts a fresh session each time', () => {
        const { state, calls, controller } = setup();
        for (const plugin of [true, false, true]) {
            state.plugin = plugin;
            controller.update();
        }
        expect(calls).toEqual(['start', 'stop', 'clear', 'start']);
        expect(controller.isWanted()).toBe(true);
    });
});

describe('media plugin probe on disk (T-316)', () => {
    let root: string;
    let extensionsDir: string;
    let playgroundDir: string;
    let config: Record<string, boolean>;

    function addPlugin(baseDir: string, folder: string, manifest: unknown) {
        fs.mkdirSync(path.join(baseDir, folder), { recursive: true });
        fs.writeFileSync(path.join(baseDir, folder, 'manifest.json'), JSON.stringify(manifest), 'utf8');
    }

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-mediademand-'));
        extensionsDir = path.join(root, 'extensions');
        playgroundDir = path.join(root, 'pluginsPlayground');
        fs.mkdirSync(extensionsDir);
        config = {};
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    const probe = () => createMediaPluginProbe({ extensionsDir, playgroundDir, getExtensionsConfig: () => config })();

    it('lists ids like get-installed-extensions (manifest id or folder name, dev- prefix for the playground)', () => {
        addPlugin(extensionsDir, 'koplayer-plugin', { id: 'koplayer-plugin', name: 'KoPlayer' });
        addPlugin(extensionsDir, 'folder-only', { name: 'No id' });
        fs.mkdirSync(path.join(extensionsDir, 'no-manifest'));
        addPlugin(playgroundDir, 'koplayer-dev', { id: 'koplayer-plugin' });
        expect(listInstalledExtensionIds(extensionsDir, playgroundDir).sort()).toEqual(
            ['dev-koplayer-plugin', 'folder-only', 'koplayer-plugin'].sort()
        );
    });

    it('is false without KoPlayer, true once installed, false when disabled in the config', () => {
        addPlugin(extensionsDir, 'todolist-plugin', { id: 'todolist-plugin' });
        expect(probe()).toBe(false);
        addPlugin(extensionsDir, 'koplayer-plugin', { id: 'koplayer-plugin' });
        expect(probe()).toBe(true);
        config['koplayer-plugin'] = false;
        expect(probe()).toBe(false);
        config['koplayer-plugin'] = true;
        expect(probe()).toBe(true);
    });

    it('never throws (missing folders, broken config)', () => {
        fs.rmSync(extensionsDir, { recursive: true, force: true });
        expect(probe()).toBe(false);
        addPlugin(extensionsDir, 'koplayer-plugin', { id: 'koplayer-plugin' });
        const broken = createMediaPluginProbe({
            extensionsDir,
            playgroundDir,
            getExtensionsConfig: () => null as unknown as Record<string, boolean>,
        });
        const originalError = console.error;
        console.error = () => {};
        try {
            expect(broken()).toBe(false);
        } finally {
            console.error = originalError;
        }
    });
});

describe('media demand wiring (T-316, source level)', () => {
    const media = readMainModule('services/media.cts');
    const manage = readMainModule('services/extensions/manage.cts');
    const install = readMainModule('services/extensions/install.cts');
    const bootstrap = readMainModule('bootstrap.cts');
    const pipWindow = readMainModule('windows/pipWindow.cts');
    const context = readMainModule('app/context.cts');
    const lifecycle = readMainModule('app/lifecycle.cts');

    function handler(source: string, channel: string): string {
        const start = source.indexOf(`registry.handle('${channel}'`);
        expect(start, channel).toBeGreaterThanOrEqual(0);
        const next = source.indexOf('registry.handle(', start + 1);
        return source.slice(start, next === -1 ? undefined : next);
    }

    it('startup runs the demand check (with the paths) instead of an unconditional start; will-quit still stops polling', () => {
        expect(lifecycle).toContain('updateMediaDemand({ appPaths })');
        expect(lifecycle).not.toContain('startMediaPolling(');
        expect(lifecycle).toMatch(/globalShortcut\.unregisterAll\(\);\s+stopPsBridge\(\);\s+stopMediaPolling\(\);/);
    });

    it('media.cts drives start/stop through the controller and clears stale media on stop', () => {
        expect(media).toContain('createMediaDemandController({');
        expect(media).toMatch(/isRunning: \(\) => mediaPollingInterval !== null/);
        expect(media).toMatch(/start: \(\) => \{\s*if \(mediaDeps\) startMediaPolling\(mediaDeps\);/);
        expect(media).toContain('stop: () => stopMediaPolling()');
        expect(media).toContain("if (lastMedia && lastMedia.payload !== null) sendMediaChannel('media-update', null);");
        // A stopped session's late results are dropped, and a fresh session pushes its first poll (filter reset).
        expect(media).toMatch(/export function stopMediaPolling\(\) \{\s*mediaPollGeneration\+\+;/);
        expect(media).toMatch(/if \(mediaPollingInterval\) return;[\s\S]*?mediaChangeFilter\.reset\(\);/);
        expect(media).toMatch(/runVideoUrlScan\(\)\s*\.then\(\(urls\) => \{\s*send\('video-urls-update', urls\);/);
    });

    it('toggle-extension-enabled, set-extensions-config and uninstall re-evaluate the demand after saving the config', () => {
        for (const channel of ['toggle-extension-enabled', 'set-extensions-config', 'uninstall-extension']) {
            const body = handler(manage, channel);
            const saveAt = body.indexOf('saveExtensionsConfig(');
            const notifyAt = body.indexOf('onExtensionsConfigChanged();');
            expect(saveAt, channel).toBeGreaterThanOrEqual(0);
            expect(notifyAt, channel).toBeGreaterThan(saveAt);
            expect(body.indexOf('return true;', notifyAt), channel).toBeGreaterThan(notifyAt);
        }
    });

    it('an install that enables a plugin re-evaluates the demand, also when it failed after touching the old folder', () => {
        expect(install).toMatch(/config\[extensionId\] = true;\s*saveExtensionsConfig\(config\);\s*onExtensionsConfigChanged\(\);/);
        // T-318: the old folder is removed asynchronously (under the install lock).
        expect(install).toMatch(/targetTouched = true;\s*await fs\.promises\.rm\(targetDir/);
        expect(install).toMatch(/targetTouched = true;\s*fs\.renameSync\(searchDir, targetDir\);\s*targetMoved = true;/);
        expect(install).toMatch(/\} finally \{[\s\S]*?if \(targetTouched && !targetMoved\) onExtensionsConfigChanged\(\);\s*\}/);
    });

    it('uninstall re-evaluates the demand right after saving the config (before the origin clean-up)', () => {
        expect(manage).toMatch(/saveExtensionsConfig\(config\);\s*onExtensionsConfigChanged\(\);\s*forgetExtensionOrigin\(id\);/);
    });

    it('a macOS check callback of a stopped session does not spawn the second osascript', () => {
        expect(media).toMatch(
            /exec\('osascript -', \(err, stdout\) => \{\s*(?:\/\/.*\n\s*)*if \(!isCurrent\(\)\) \{\s*macMediaPollingBusy = false;\s*return;\s*\}/
        );
    });

    it('bootstrap installs the probe and passes the hook to the management and install channels', () => {
        const start = bootstrap.indexOf('export function registerExtensionChannels');
        expect(start).toBeGreaterThanOrEqual(0);
        const body = bootstrap.slice(start);
        expect(body).toContain('setMediaPluginProbe(createMediaPluginProbe({ extensionsDir, playgroundDir, getExtensionsConfig }))');
        expect(body).toMatch(/const onExtensionsConfigChanged = \(\) => \{\s*updateMediaDemand\(\);/);
        const manageCall = body.slice(body.indexOf('registerExtensionManagementIpc({'));
        expect(manageCall.slice(0, manageCall.indexOf('});'))).toContain('onExtensionsConfigChanged,');
        const installCall = body.slice(body.indexOf('registerExtensionInstallIpc({'));
        expect(installCall.slice(0, installCall.indexOf('});'))).toContain('onExtensionsConfigChanged,');
    });

    it('opening and closing the current PiP window re-evaluates the demand (a stale close does not)', () => {
        expect(pipWindow).toMatch(/appState\.pipWindow = win;\s*(?:\/\/.*\n\s*)*onPipWindowChanged\(\);/);
        expect(pipWindow).toMatch(
            /win\.on\('closed', \(\) => \{\s*if \(appState\.pipWindow !== win\) return;\s*appState\.pipWindow = null;[\s\S]*?onPipWindowChanged\(\);\s*\}\);/
        );
        expect(context).toMatch(/const onPipWindowChanged = \(\) => \{\s*updateMediaDemand\(\);/);
        expect(context).toMatch(/function windowDeps\(\) \{[\s\S]*?onPipWindowChanged,/);
    });
});
