// T-313: the LLM proxy (llm-request / cancel-llm-request and the AbortController map), moved unchanged out of main.cts.
// The pure request building and chunk parsing (incl. the loopback check for the local provider) stay in electron/main/lib/llmRequest.cts.
// The renderer's AI Hub passes the user's keys per request; they are only used to build the provider request and are never logged.
// NOTE: this main-process proxy is scheduled for removal in 2.0 (the plugin will call the providers itself), so it is moved as is and not reworked.
import { ipcMain, net } from 'electron';
import { buildRequest, parseChunk, pickApiKey } from '../lib/llmRequest.cjs';
import { appState } from '../state.cjs';

export function registerLlmIpc(): void {
    const cancelControllers: Record<string, AbortController> = {};

    ipcMain.handle('cancel-llm-request', (_event, messageId: string) => {
        if (cancelControllers[messageId]) {
            cancelControllers[messageId].abort();
            delete cancelControllers[messageId];
        }
    });

    ipcMain.handle(
        'llm-request',
        async (
            _event,
            data: {
                chatId: string;
                messageId: string;
                provider: string;
                model: string;
                messages: any[];
                apiKeys: any;
                systemPrompt?: string;
            }
        ) => {
            const { chatId, messageId, provider, model, messages, apiKeys, systemPrompt } = data;

            // Explicitly extract the correct key for validation
            const apiKey = pickApiKey(provider, apiKeys);

            // Validation: Prevent cloud calls without keys
            if (provider !== 'local' && (!apiKey || apiKey.trim() === '')) {
                if (appState.mainWindow) {
                    appState.mainWindow.webContents.send('llm-stream-error', {
                        chatId,
                        messageId,
                        error: `${provider.toUpperCase()} API key not found. Please check your AI Hub settings.`,
                    });
                }
                return;
            }

            cancelControllers[messageId] = new AbortController();
            const signal = cancelControllers[messageId].signal;

            try {
                const request = buildRequest({ provider, model, messages, apiKeys, apiKey, systemPrompt });
                if (!request.ok) {
                    appState.mainWindow?.webContents.send('llm-stream-error', {
                        chatId,
                        messageId,
                        error: request.error,
                    });
                    return;
                }
                const { url, headers, body } = request;

                // CNL: Chromium's network stack (system proxy and certificate store), like the rest of the app; Node's own fetch
                // ignores them and failed with a bare "fetch failed" on the owner's machine.
                const res = await net.fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
                if (!res.ok) {
                    const errorText = await res.text();
                    throw new Error(`API Error: ${res.status} - ${errorText}`);
                }

                const reader = res.body?.getReader();
                const decoder = new TextDecoder('utf-8');

                if (reader && appState.mainWindow) {
                    let buffer = '';
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || ''; // keep the incomplete line in buffer

                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed || trimmed === 'data: [DONE]') continue;

                            if (trimmed.startsWith('data: ')) {
                                try {
                                    const dataPayload = JSON.parse(trimmed.substring(6));
                                    const chunk = parseChunk(provider, dataPayload);

                                    if (chunk) {
                                        appState.mainWindow.webContents.send('llm-stream-chunk', { chatId, messageId, chunk });
                                    }
                                } catch {
                                    // ignore unparseable chunks
                                } // handle JSON parses safely for tiny chunks
                            }
                        }
                    }
                    if (buffer && appState.mainWindow) {
                        // Flush remaining
                        try {
                            if (buffer.startsWith('data: ')) {
                                const finalPayload = JSON.parse(buffer.substring(6));
                                const chunk = parseChunk(provider, finalPayload);
                                if (chunk) appState.mainWindow.webContents.send('llm-stream-chunk', { chatId, messageId, chunk });
                            }
                        } catch {
                            /* ignore an incomplete/invalid trailing chunk */
                        }
                    }
                    appState.mainWindow.webContents.send('llm-stream-end', { chatId, messageId });
                }
            } catch (e: any) {
                if (e.name === 'AbortError') {
                    // LLM Request aborted
                } else {
                    if (appState.mainWindow) {
                        const base = e instanceof Error ? e.message : typeof e === 'object' ? JSON.stringify(e) : String(e);
                        // A network failure says why (DNS, TLS, refused connection...), not just "fetch failed".
                        const cause = e instanceof Error && e.cause ? (e.cause as { code?: string; message?: string }) : null;
                        const detail = cause?.code ?? cause?.message;
                        const errorMessage = detail && !base.includes(detail) ? `${base} (${detail})` : base;
                        appState.mainWindow.webContents.send('llm-stream-error', { chatId, messageId, error: errorMessage });
                    }
                }
            } finally {
                delete cancelControllers[messageId];
            }
        }
    );
}
