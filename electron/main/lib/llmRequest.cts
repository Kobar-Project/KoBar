// T-305: builds the HTTP request for each LLM provider and extracts the text from a streamed chunk. Moved unchanged out of the
// `llm-request` handler in main.cts. Pure: no Electron imports, no network (the handler does the fetch), so it is unit-tested with fake inputs.
import { isLoopbackUrl } from '../../lib/uiGuards.cjs';

/** One part of a multimodal message. A malformed part (e.g. an image part without image_url) throws like the inline code did. */
export type LlmContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface LlmMessage {
    role: string;
    content: string | LlmContentPart[];
}

export interface LlmApiKeys {
    openai?: string;
    gemini?: string;
    anthropic?: string;
    localUrl?: string;
}

export interface LlmRequestInput {
    provider: string;
    model: string;
    messages: LlmMessage[];
    apiKeys: LlmApiKeys | null | undefined;
    /** The key already extracted for `provider` (see `pickApiKey`). */
    apiKey: string;
    systemPrompt?: string;
}

export interface LlmBody {
    model: string;
    messages: unknown[];
    stream: boolean;
    max_tokens?: number;
    temperature?: number;
    system?: string;
}

export type LlmRequest =
    { ok: true; url: string; headers: Record<string, string>; body: LlmBody | Record<string, never> } | { ok: false; error: string };

/** One parsed `data: {...}` stream payload; `delta` is only present on content_block_delta events (a missing one throws, the caller ignores the chunk). */
export interface LlmStreamPayload {
    type?: string;
    delta?: { text?: string };
    choices?: Array<{ delta?: { content?: string } }>;
}

/** The API key of a cloud provider: '' for local, unknown providers or a missing key object. Typed `string`, but it is undefined at runtime when that provider's key is absent from `apiKeys` (the handler treats undefined and '' alike as "missing"). */
export function pickApiKey(provider: string, apiKeys: LlmApiKeys | null | undefined): string {
    let apiKey = '';
    if (apiKeys) {
        if (provider === 'openai') apiKey = apiKeys.openai as string;
        if (provider === 'gemini') apiKey = apiKeys.gemini as string;
        if (provider === 'anthropic') apiKey = apiKeys.anthropic as string;
    }
    return apiKey;
}

/** URL, headers and JSON body of the streaming chat request; `ok: false` when the local URL is refused (SEC-18). May throw on a malformed input (e.g. no model string), like the inline code did. */
export function buildRequest({ provider, model, messages, apiKeys, apiKey, systemPrompt }: LlmRequestInput): LlmRequest {
    let url = '';
    let headers: Record<string, string> = {};
    let body: LlmBody | Record<string, never> = {};

    const finalMessages = [...messages];

    if (provider === 'openai' || provider === 'gemini') {
        headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        };
    } else if (provider === 'anthropic') {
        headers = {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        };
    }

    if (provider === 'openai') {
        if (systemPrompt) {
            finalMessages.unshift({ role: 'system', content: systemPrompt });
        }
        url = 'https://api.openai.com/v1/chat/completions';
        body = {
            model: model || 'gpt-4o',
            messages: finalMessages,
            stream: true,
        };
    } else if (provider === 'anthropic') {
        url = 'https://api.anthropic.com/v1/messages';

        // Translate multimodal (image) payloads to Anthropic's schema
        const anthropicMessages = finalMessages.map((m) => {
            if (Array.isArray(m.content)) {
                const translatedContent = m.content.map((part) => {
                    if (part.type === 'image_url') {
                        const dataUrl = part.image_url.url;
                        const matches = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
                        if (matches) {
                            return {
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: matches[1], // e.g., image/jpeg, image/png
                                    data: matches[2], // pure base64
                                },
                            };
                        }
                    }
                    return part; // Keep text parts unchanged
                });
                return { role: m.role, content: translatedContent };
            }
            return m;
        });

        body = {
            model: model || 'claude-sonnet-4-6',
            max_tokens: 4096,
            messages: anthropicMessages,
            stream: true,
        };
        if (systemPrompt) {
            body.system = systemPrompt;
        }
    } else if (provider === 'gemini') {
        const geminiModel = model.replace('gemini:', '').replace('-latest', '');

        // Use the official OpenAI compatibility endpoint
        url = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

        if (systemPrompt) {
            finalMessages.unshift({ role: 'system', content: systemPrompt });
        }

        body = {
            model: geminiModel || 'gemini-3.1-flash',
            messages: finalMessages,
            stream: true,
        };
    } else if (provider === 'local') {
        // Only loopback servers (Ollama, LM Studio...) may be reached; anything else is refused (SEC-18).
        if (apiKeys?.localUrl && !isLoopbackUrl(apiKeys.localUrl)) {
            return { ok: false, error: 'The local model URL must point to this computer (localhost, 127.0.0.1 or [::1]).' };
        }
        // 1. Detect if it's Ollama or LM Studio
        const endpoint = (apiKeys?.localUrl || 'http://localhost:11434')
            .replace(/\/v1\/?$/, '')
            .replace(/\/api\/?$/, '')
            .replace(/\/+$/, '');
        const isOllama = endpoint.includes('11434') || (apiKeys?.localUrl || '').toLowerCase().includes('ollama');

        // 2. Check for vision/multimodal payload
        const hasVision = finalMessages.some((m) => Array.isArray(m.content));

        // 3. SAFE System Prompt Injection (Disable for local vision to prevent looping)
        if (systemPrompt && !hasVision) {
            finalMessages.unshift({ role: 'system', content: systemPrompt });
        }

        headers = { 'Content-Type': 'application/json' };

        if (isOllama) {
            // OLLAMA NATIVE API
            url = endpoint + '/api/chat';
            const ollamaMessages = finalMessages.map((m) => {
                if (Array.isArray(m.content)) {
                    let textContent = '';
                    const images: string[] = [];
                    m.content.forEach((part) => {
                        if (part.type === 'text') textContent += part.text + '\n';
                        if (part.type === 'image_url') {
                            // Ollama expects raw base64 without data:image prefix
                            images.push(part.image_url.url.replace(/^data:image\/\w+;base64,/, ''));
                        }
                    });
                    return { role: m.role, content: textContent.trim(), images: images.length > 0 ? images : undefined };
                }
                return m;
            });
            body = {
                model: model.replace('local:', '') || 'llava',
                messages: ollamaMessages,
                stream: true,
            };
        } else {
            // LM STUDIO (OpenAI API Compatibility)
            url = endpoint + '/v1/chat/completions';
            body = {
                model: model.replace('local:', '') || 'local-model',
                messages: finalMessages,
                stream: true,
                max_tokens: 2048,
                temperature: 0.7,
            };
        }
    }

    return { ok: true, url, headers, body };
}

/** The text of one parsed `data: {...}` stream payload ('' when it carries none). May throw on a malformed payload (callers catch). */
export function parseChunk(provider: string, dataPayload: LlmStreamPayload): string {
    let chunk = '';
    if (provider === 'anthropic') {
        if (dataPayload.type === 'content_block_delta') {
            chunk = dataPayload.delta!.text || '';
        }
    } else {
        chunk = dataPayload.choices?.[0]?.delta?.content || '';
    }
    return chunk;
}
