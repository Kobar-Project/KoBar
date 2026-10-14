// T-303: typed IPC registry for the main process. `registry.handle` / `registry.on` register a channel on ipcMain with
//   1. types from shared/ipc-contract.ts: the handler's arguments and result are checked against the contract at compile time;
//   2. optional runtime argument validation (any zod schema of the whole argument tuple). Validation only GATES the call:
//      the handler always receives the original, untouched arguments (zod never strips or transforms what it gets);
//   3. optional sender policy (a named predicate supplied by main, e.g. "main window, top frame"), checked first;
//   4. error handling: an exception is logged with the channel name. For `handle` it is re-thrown unchanged, so Electron
//      rejects the renderer's invoke exactly as it did without the registry; for `on` (fire and forget, nobody can
//      observe the error) it is logged and dropped instead of becoming an uncaught exception in the main process.
// The IpcMainInvokeEvent / IpcMainEvent is passed to the handler unchanged, so every check a handler does itself
// (path grants, confirmations, sender/frame checks) still runs exactly as before.
// Pure module: no Electron runtime import (ipcMain and the logger are injected), so it is unit-tested with a fake ipcMain.
// Argument values are never logged by the validation/policy paths (they can be file paths); only the channel and the zod issue paths/codes are. Handler exceptions are logged as thrown.
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import type { ZodType } from 'zod';
import type { InvokeArgs, InvokeChannel, InvokeResult, SendArgs, SendChannel } from '../../../shared/ipc-contract.js' with {
    'resolution-mode': 'import',
};

/** The part of Electron's ipcMain the registry uses (the real ipcMain satisfies it). */
export interface IpcMainLike {
    handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void;
    on(channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void): unknown;
}

export interface IpcRegistryLogger {
    warn(...data: unknown[]): void;
    error(...data: unknown[]): void;
}

/**
 * Named sender checks main may attach to a channel. Only use one where the handler already did that check.
 * `settings-window-top-frame` (T-606): the Settings window's top frame (its narrow settings-preload), never the main window.
 */
export type SenderPolicyName = 'main-window-top-frame' | 'settings-window-top-frame';

/** A sender predicate; IpcMainEvent is structurally an IpcMainInvokeEvent, so one predicate serves both kinds. */
export type SenderPolicy = (event: IpcMainInvokeEvent) => boolean;

/** A schema of the whole argument tuple (the values after the channel name). Use `.rest(z.unknown())` to tolerate extra args. */
export type ArgsSchema = ZodType;

export type InvokeHandler<C extends InvokeChannel> = (
    event: IpcMainInvokeEvent,
    ...args: InvokeArgs<C>
) => InvokeResult<C> | Promise<InvokeResult<C>>;

export type SendHandler<C extends SendChannel> = (event: IpcMainEvent, ...args: SendArgs<C>) => unknown;

export interface HandleOptions<C extends InvokeChannel> {
    args?: ArgsSchema;
    /**
     * Result for arguments that fail `args`. Return exactly what the handler itself returns for bad input today (for
     * example `{ success: false, reason }`). Without it the invoke is rejected with a neutral error.
     */
    onInvalid?: (event: IpcMainInvokeEvent) => InvokeResult<C>;
    senderPolicy?: SenderPolicyName;
    /** Result for a sender the policy refuses. Without it the invoke is rejected with a neutral error. */
    onDenied?: (event: IpcMainInvokeEvent) => InvokeResult<C>;
}

export interface OnOptions {
    /** Arguments that fail the schema are ignored (logged, the handler is not called). */
    args?: ArgsSchema;
    /** A refused sender is ignored (logged, the handler is not called). */
    senderPolicy?: SenderPolicyName;
}

export interface IpcRegistry {
    handle<C extends InvokeChannel>(channel: C, handler: InvokeHandler<C>): void;
    handle<C extends InvokeChannel>(channel: C, options: HandleOptions<C>, handler: InvokeHandler<C>): void;
    on<C extends SendChannel>(channel: C, handler: SendHandler<C>): void;
    on<C extends SendChannel>(channel: C, options: OnOptions, handler: SendHandler<C>): void;
}

export interface IpcRegistryDeps {
    ipcMain: IpcMainLike;
    senderPolicies?: Partial<Record<SenderPolicyName, SenderPolicy>>;
    logger?: IpcRegistryLogger;
}

/** Neutral rejection messages (no argument values). */
export const INVALID_ARGS_MESSAGE = 'Invalid IPC arguments';
export const SENDER_DENIED_MESSAGE = 'IPC sender not allowed';

/** "path: code" for each zod issue, never the offending value. */
export function describeIssues(error: unknown): string {
    const issues = (error as { issues?: ReadonlyArray<{ path?: ReadonlyArray<PropertyKey>; code?: unknown }> } | null)?.issues;
    if (!Array.isArray(issues) || issues.length === 0) return 'invalid';
    return issues
        .slice(0, 5)
        .map((issue) => `${(issue.path ?? []).map(String).join('.') || '(args)'}: ${String(issue.code ?? 'invalid')}`)
        .join(', ');
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return (
        !!value && (typeof value === 'object' || typeof value === 'function') && typeof (value as { then?: unknown }).then === 'function'
    );
}

export function createIpcRegistry({ ipcMain, senderPolicies = {}, logger = console }: IpcRegistryDeps): IpcRegistry {
    const registered = new Set<string>();

    function claim(channel: string): void {
        if (registered.has(channel)) throw new Error(`[ipc] ${channel} is already registered`);
        registered.add(channel);
    }

    function policyFor(channel: string, name: SenderPolicyName | undefined): SenderPolicy | null {
        if (name === undefined) return null;
        const policy = senderPolicies[name];
        // A misconfigured channel fails at startup instead of silently skipping its sender check.
        if (!policy) throw new Error(`[ipc] ${channel}: unknown sender policy "${name}"`);
        return policy;
    }

    function handle<C extends InvokeChannel>(
        channel: C,
        optionsOrHandler: HandleOptions<C> | InvokeHandler<C>,
        maybeHandler?: InvokeHandler<C>
    ): void {
        const options: HandleOptions<C> = typeof optionsOrHandler === 'function' ? {} : optionsOrHandler;
        const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler;
        if (typeof handler !== 'function') throw new Error(`[ipc] ${channel}: missing handler`);
        const policy = policyFor(channel, options.senderPolicy);
        claim(channel);

        ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
            if (policy && !policy(event)) {
                logger.warn(`[ipc] ${channel}: refused a call from a sender outside its policy`);
                if (options.onDenied) return options.onDenied(event);
                throw new Error(SENDER_DENIED_MESSAGE);
            }
            if (options.args) {
                const parsed = options.args.safeParse(args);
                if (!parsed.success) {
                    logger.warn(`[ipc] ${channel}: invalid arguments (${describeIssues(parsed.error)})`);
                    if (options.onInvalid) return options.onInvalid(event);
                    throw new Error(INVALID_ARGS_MESSAGE);
                }
            }
            try {
                return await handler(event, ...(args as InvokeArgs<C>));
            } catch (e) {
                // Re-thrown unchanged: Electron turns it into the same rejected invoke the renderer saw before.
                logger.error(`[ipc] ${channel} handler failed:`, e);
                throw e;
            }
        });
    }

    function on<C extends SendChannel>(channel: C, optionsOrHandler: OnOptions | SendHandler<C>, maybeHandler?: SendHandler<C>): void {
        const options: OnOptions = typeof optionsOrHandler === 'function' ? {} : optionsOrHandler;
        const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler;
        if (typeof handler !== 'function') throw new Error(`[ipc] ${channel}: missing handler`);
        const policy = policyFor(channel, options.senderPolicy);
        claim(channel);

        ipcMain.on(channel, (event: IpcMainEvent, ...args: unknown[]) => {
            if (policy && !policy(event)) {
                logger.warn(`[ipc] ${channel}: ignored a message from a sender outside its policy`);
                return;
            }
            if (options.args) {
                const parsed = options.args.safeParse(args);
                if (!parsed.success) {
                    logger.warn(`[ipc] ${channel}: ignored invalid arguments (${describeIssues(parsed.error)})`);
                    return;
                }
            }
            try {
                const result = handler(event, ...(args as SendArgs<C>));
                if (isPromiseLike(result)) {
                    result.then(undefined, (e: unknown) => logger.error(`[ipc] ${channel} handler failed:`, e));
                }
            } catch (e) {
                logger.error(`[ipc] ${channel} handler failed:`, e);
            }
        });
    }

    return { handle, on } as IpcRegistry;
}
