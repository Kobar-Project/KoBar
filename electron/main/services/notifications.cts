// T-307: native notifications, moved unchanged out of main.cts: the send-notification IPC handler (sanitized + rate-limited, SEC-15),
// the notice rate limiters and the fixed-text notices other handlers raise (blocked file access, KoBox copy failed).
// `getUiLanguage` still lives in main.cts and is injected once through configureNotifications().
import { ipcMain } from 'electron';
import { createCaptureLimiter } from '../../lib/captureLimiter.cjs';
import { sanitizeNotification } from '../../lib/uiGuards.cjs';
import { type MainLang, type MainStringKey, t } from '../../lib/mainStrings.cjs';

export interface NotificationDeps {
    getUiLanguage(): Promise<MainLang>;
    /** R-05: KoBar logo (PNG) passed to every native notification so the toast never falls back to the Electron icon. */
    iconPath?: string;
}

let notificationIcon: string | undefined;
let getUiLanguage: NotificationDeps['getUiLanguage'] = async () => {
    throw new Error('notifications are not configured');
};

/** Injects the main.cts helpers; called once, before any handler can run. */
export function configureNotifications(deps: NotificationDeps) {
    getUiLanguage = deps.getUiLanguage;
    notificationIcon = deps.iconPath;
}

const notificationLimiter = createCaptureLimiter(undefined, 500, 5, 10_000);
// T-042: at most one "blocked file access" and one "KoBox copy failed" notice per 10 s each (both also count against notificationLimiter).
const blockedFileNoticeLimiter = createCaptureLimiter(undefined, 10_000, 1, 10_000);
const koBoxFailNoticeLimiter = createCaptureLimiter(undefined, 10_000, 1, 10_000);
const koBoxLeftoverNoticeLimiter = createCaptureLimiter(undefined, 10_000, 1, 10_000);

export function registerNotificationIpc() {
    ipcMain.on('send-notification', (_event, payload) => {
        // Rate-limited and sanitized: a plugin must not be able to spam or spoof native notifications (SEC-15).
        if (!notificationLimiter.tryAcquire().allowed) return;
        const { title, body } = sanitizeNotification(payload?.title, payload?.body);
        if (!title && !body) return;
        const { Notification } = require('electron');
        new Notification({ title: title || 'KoBar', body, icon: notificationIcon }).show();
    });
}

/** Non-blocking notice with fixed text (never a path), rate-limited by its own limiter and notificationLimiter. */
function showRateLimitedNotice(limiter: { tryAcquire(): { allowed: boolean } }, key: MainStringKey) {
    if (!limiter.tryAcquire().allowed) return;
    if (!notificationLimiter.tryAcquire().allowed) return;
    void (async () => {
        try {
            const { Notification } = require('electron');
            if (!Notification.isSupported()) return;
            const body = t(await getUiLanguage(), key);
            new Notification({ title: 'KoBar', body, icon: notificationIcon }).show();
        } catch (e) {
            console.error('Notice failed:', e);
        }
    })();
}

/** Notice when a handler refuses a path the user did not choose. */
export function notifyBlockedFileAccess(channel: string) {
    console.warn(`${channel}: refused a path that was not selected by the user`);
    showRateLimitedNotice(blockedFileNoticeLimiter, 'blockedFileAccess');
}

/** Fixed notice text key (never a path) for a KoBox drop item that could not be copied, by refusal reason. */
function koBoxCopyFailedKey(reason: string | undefined): MainStringKey {
    if (reason === 'destination-exists') return 'koBoxItemExists';
    if (reason === 'too-large') return 'koBoxTooLarge';
    if (reason === 'source-in-use') return 'koBoxItemInUse';
    if (reason === 'unsupported-entries') return 'koBoxCrossDriveUnsupported';
    return 'koBoxCopyFailed';
}

/** Notice when a granted KoBox drop item could not be moved in (exists, too large, in use, refused by T-109 checks, I/O error). */
export function notifyKoBoxCopyFailed(reason?: string) {
    showRateLimitedNotice(koBoxFailNoticeLimiter, koBoxCopyFailedKey(reason));
}

/** R2-11: the item is safely in KoBox but a leftover of the original could not be removed. Own limiter, fixed text. */
export function notifyKoBoxLeftover() {
    showRateLimitedNotice(koBoxLeftoverNoticeLimiter, 'koBoxLeftover');
}
