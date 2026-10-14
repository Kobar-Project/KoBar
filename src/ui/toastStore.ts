import { useSyncExternalStore, type ReactNode } from 'react';

// In-memory toast queue (info = Toast, 4 s, auto-dismiss, optional "Undo"). Pure module state: never
// persisted, no window.api, no clipboard. Rendered by <ToastRegion />.

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
    label: string;
    onClick: () => void;
}

export interface ToastOptions {
    message: ReactNode;
    title?: ReactNode;
    /** "error" is announced assertively (role="alert"); the others politely (role="status"). */
    tone?: ToastTone;
    /** Auto-dismiss delay in ms (default 4000). 0 keeps the toast until it is dismissed. */
    duration?: number;
    /** One action button (e.g. "Undo"); clicking it also dismisses the toast. */
    action?: ToastAction;
    /** Reusing an id replaces that toast instead of stacking a duplicate. */
    id?: string;
}

export interface ToastRecord {
    id: string;
    message: ReactNode;
    title?: ReactNode;
    tone: ToastTone;
    duration: number;
    action?: ToastAction;
}

export const DEFAULT_TOAST_DURATION_MS = 4 * 1000;
/** Older toasts are dropped beyond this many. */
export const MAX_TOASTS = 3;

type Listener = () => void;

let toasts: readonly ToastRecord[] = [];
let counter = 0;
const listeners = new Set<Listener>();

function emit(next: readonly ToastRecord[]): void {
    toasts = next;
    for (const listener of listeners) listener();
}

function show(options: ToastOptions | string): string {
    const opts: ToastOptions = typeof options === 'string' ? { message: options } : options;
    const id = opts.id ?? `kb-toast-${++counter}`;
    const record: ToastRecord = {
        id,
        message: opts.message,
        title: opts.title,
        tone: opts.tone ?? 'info',
        duration: Math.max(0, opts.duration ?? DEFAULT_TOAST_DURATION_MS),
        action: opts.action,
    };
    const rest = toasts.filter((item) => item.id !== id);
    emit([...rest, record].slice(-MAX_TOASTS));
    return id;
}

const withTone =
    (tone: ToastTone) =>
    (message: ReactNode, options: Omit<ToastOptions, 'message' | 'tone'> = {}): string =>
        show({ ...options, message, tone });

export const toast = {
    show,
    info: withTone('info'),
    success: withTone('success'),
    warning: withTone('warning'),
    error: withTone('error'),
    dismiss(id: string): void {
        if (toasts.some((item) => item.id === id)) emit(toasts.filter((item) => item.id !== id));
    },
    clear(): void {
        if (toasts.length > 0) emit([]);
    },
    getAll(): readonly ToastRecord[] {
        return toasts;
    },
    subscribe(listener: Listener): () => void {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },
};

/** Current toasts (oldest first). */
export function useToasts(): readonly ToastRecord[] {
    return useSyncExternalStore(toast.subscribe, toast.getAll, toast.getAll);
}
