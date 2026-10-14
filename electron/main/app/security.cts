// T-315: the app-wide security guards, moved unchanged out of main.cts: the navigation / window-open / webview guard for EVERY webContents,
// the default-deny permission handlers and the T-131 CSP diagnostic mode. main.cts registers the navigation guard at the same point
// as before (registerNavigationGuards) and the lifecycle's whenReady callback installs the permission handlers and CSP diagnostics.
import { app, session, WebContents } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';
import {
    CSP_REPORT_FILE_NAME,
    appendCapped,
    buildCspPolicy,
    buildMetaInjectionScript,
    buildPageListenerScript,
    parseChromiumCspConsole,
    parseConsoleViolation,
} from '../../lib/cspReport.cjs';
import { isAllowedNavigation } from '../../lib/navigation.cjs';
import { decidePermission } from '../../lib/permissions.cjs';
import { appState } from '../state.cjs';
import { openExternalChecked } from './helpers.cjs';
import type { RuntimeEnv } from './runtime.cjs';

const NAV_DEV_ORIGIN = 'http://localhost:5173';

// SEC-07: central navigation guard for EVERY webContents (main, pip, border/pin windows, ...).
// - window.open / target=_blank never creates a window; the URL goes through the external-open gate.
// - top-level navigation is limited to the app's own pages; anything else is blocked (http(s) goes to the gate).
// - <webview> is never allowed. Programmatic loadURL/loadFile and sub-frames (iframes) are not affected.
export function registerNavigationGuards(env: RuntimeEnv): void {
    const { isDev, appPaths, loadsFromDist } = env;
    const NAV_APP_FILE_URLS = [appPaths.indexHtml, appPaths.pipHtml, appPaths.settingsHtml].map((file) => pathToFileURL(file).href);
    function isAppNavigationAllowed(url: string): boolean {
        return isAllowedNavigation(url, { isDev: isDev && !loadsFromDist, devOrigin: NAV_DEV_ORIGIN, appFileUrls: NAV_APP_FILE_URLS });
    }
    app.on('web-contents-created', (_event, contents) => {
        contents.setWindowOpenHandler(({ url }) => {
            void openExternalChecked(url);
            return { action: 'deny' };
        });
        contents.on('will-navigate', (event) => {
            if (isAppNavigationAllowed(event.url)) return;
            event.preventDefault();
            if (/^https?:/i.test(event.url)) void openExternalChecked(event.url);
        });
        // Redirects also fire for sub-frames (PiP iframe) and are never opened externally.
        contents.on('will-redirect', (event) => {
            if (event.isMainFrame && !isAppNavigationAllowed(event.url)) event.preventDefault();
        });
        contents.on('will-attach-webview', (event) => {
            event.preventDefault();
        });
    });
}

// Default-deny permission model (see electron/lib/permissions.cts). Only the main app window may write the clipboard.
export function installPermissionHandlers(env: RuntimeEnv): void {
    const { isDev, loadsFromDist } = env;
    const warnedPermissions = new Set<string>();
    const decide = (wc: WebContents | null, permission: string, origin: string): boolean => {
        const granted = decidePermission(
            permission,
            origin,
            { isDev: isDev && !loadsFromDist, devOrigin: NAV_DEV_ORIGIN },
            !!wc && !!appState.mainWindow && !appState.mainWindow.isDestroyed() && wc === appState.mainWindow.webContents
        );
        if (!granted && !warnedPermissions.has(permission)) {
            warnedPermissions.add(permission);
            console.warn(`[KoBar] Permission denied: ${permission}`);
        }
        return granted;
    };
    session.defaultSession.setPermissionCheckHandler((wc: WebContents | null, permission: string, requestingOrigin: string) =>
        decide(wc, permission, requestingOrigin)
    );
    session.defaultSession.setPermissionRequestHandler(
        (wc: WebContents, permission: string, callback: (granted: boolean) => void, details: { requestingUrl?: string }) =>
            callback(decide(wc, permission, details?.requestingUrl ?? ''))
    );
    // Screen capture goes through main-process desktopCapturer IPC, never getDisplayMedia: refuse all requests.
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
        if (!warnedPermissions.has('display-capture')) {
            warnedPermissions.add('display-capture');
            console.warn('[KoBar] Permission denied: display-capture');
        }
        callback(null);
    });
}

// T-131: CSP diagnostic mode. OFF by default and honoured ONLY in dev runs (!app.isPackaged), so packaged builds and normal
// users never see any change. Nothing here is enforced in normal mode.
// KOBAR_CSP_REPORT=1    : windows load http://localhost:5173 (Vite); a Content-Security-Policy-Report-Only header is added.
// KOBAR_CSP_REPORT=file : windows load the built dist/index.html / dist/pip.html / dist/settings.html via file:// (needs `npm run build` first). The
//   Report-Only header is attempted via onHeadersReceived too, so the report shows whether it fires for file://. If no header was
//   applied to a document by dom-ready, an ENFORCED meta CSP is injected as the fallback (that session then enforces the policy).
// Violations come from a page-side `securitypolicyviolation` listener and Chromium's console lines; records are redacted, size-capped
// and appended to userData/csp-report.jsonl with a `via` field (header | meta).
export function setupCspDiagnostics(env: RuntimeEnv): void {
    const { isDev } = env;
    const mode = isDev ? process.env.KOBAR_CSP_REPORT : undefined;
    if (mode !== '1' && mode !== 'file') return;
    const policy = buildCspPolicy();
    const reportFile = path.join(app.getPath('userData'), CSP_REPORT_FILE_NAME);
    console.warn('[csp-diag] diagnostic mode ON (' + mode + '), writing to', reportFile);

    const headerApplied = new Set<number>();
    const isAppFileUrl = (url: string) => {
        const base = url.split(/[?#]/)[0].toLowerCase();
        return (
            base.startsWith('file:') &&
            (base.endsWith('/dist/index.html') || base.endsWith('/dist/pip.html') || base.endsWith('/dist/settings.html'))
        );
    };
    // Electron allows only ONE onHeadersReceived listener per session; T-131 owns it while the diagnostic mode is on.
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        const isAppDocument =
            (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') &&
            (details.url.startsWith(NAV_DEV_ORIGIN) || (mode === 'file' && isAppFileUrl(details.url)));
        if (!isAppDocument) {
            callback({});
            return;
        }
        if (typeof details.webContentsId === 'number') headerApplied.add(details.webContentsId);
        callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy-Report-Only': [policy] } });
    });

    app.on('web-contents-created', (_event, contents) => {
        const id = contents.id;
        contents.once('destroyed', () => headerApplied.delete(id));
        contents.on('did-start-navigation', (nav) => {
            if (nav.isMainFrame && !nav.isSameDocument) headerApplied.delete(id);
        });
        contents.on('dom-ready', () => {
            // Meta fallback only for file:// documents where no header was applied (so `via` is unambiguous).
            if (contents.getURL().startsWith('file:') && !headerApplied.has(id)) {
                void contents.executeJavaScript(buildMetaInjectionScript(policy)).catch(() => {});
            }
            void contents.executeJavaScript(buildPageListenerScript()).catch(() => {});
        });
        contents.on('console-message', (details) => {
            const record =
                parseConsoleViolation(details.message) ?? parseChromiumCspConsole(details.message, details.sourceId, details.lineNumber);
            if (record)
                appendCapped(reportFile, {
                    ...record,
                    via: headerApplied.has(id) ? 'header' : contents.getURL().startsWith('file:') ? 'meta' : 'none',
                });
        });
    });
}
