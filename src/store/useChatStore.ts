import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ChatMessage {
    id: string;
    role: 'system' | 'user' | 'assistant';
    content: string;
    // Optional array of file context to denote attachments
    attachments?: string[];
}

export interface Chat {
    id: string;
    title: string;
    messages: ChatMessage[];
    model: string;
    updatedAt: number;
}

export interface ChatApiKeys {
    openai: string;
    gemini: string;
    anthropic: string;
    localUrl: string; // e.g. http://localhost:11434 for Ollama
    systemMessage: string;
    customInstructions: string;
    defaultModel: string;
}

interface ChatState {
    chats: Chat[];
    activeChatId: string | null;
    apiKeys: ChatApiKeys;
    aiAvatar: string | null;
    userAvatar: string | null;

    setApiKeys: (keys: Partial<ChatApiKeys>) => void;
    setAiAvatar: (avatar: string | null) => void;
    setUserAvatar: (avatar: string | null) => void;
    
    // Chat CRUD
    setActiveChatId: (id: string | null) => void;
    createChat: (model?: string, initialMessage?: ChatMessage) => string;
    deleteChat: (id: string) => void;
    
    // Message mutations
    addMessage: (chatId: string, message: ChatMessage) => void;
    updateMessageContent: (chatId: string, messageId: string, newContent: string) => void;
    appendStreamToMessage: (chatId: string, messageId: string, chunk: string) => void;
    updateChatTitle: (chatId: string, title: string) => void;
}

export const useChatStore = create<ChatState>()(
    persist(
        (set, get) => ({
            chats: [],
            activeChatId: null,
            apiKeys: {
                openai: '',
                gemini: '',
                anthropic: '',
                localUrl: 'http://localhost:11434',
                systemMessage: '',
                customInstructions: '',
                defaultModel: 'anthropic:claude-sonnet-4-6'
            },
            aiAvatar: null,
            userAvatar: null,

            setApiKeys: (keys) => set((state) => ({ apiKeys: { ...state.apiKeys, ...keys } })),
            setAiAvatar: (avatar) => set({ aiAvatar: avatar }),
            setUserAvatar: (avatar) => set({ userAvatar: avatar }),

            setActiveChatId: (id) => set({ activeChatId: id }),

            createChat: (model, initialMessage) => {
                const id = crypto.randomUUID();
                const selectedModel = model || get().apiKeys.defaultModel;
                const newChat: Chat = {
                    id,
                    title: 'New Chat',
                    messages: initialMessage ? [initialMessage] : [],
                    model: selectedModel,
                    updatedAt: Date.now()
                };
                set((state) => ({
                    chats: [newChat, ...state.chats],
                    activeChatId: id
                }));
                return id;
            },

            deleteChat: (id) => set((state) => ({
                chats: state.chats.filter(c => c.id !== id),
                activeChatId: state.activeChatId === id ? null : state.activeChatId
            })),

            addMessage: (chatId, message) => set((state) => ({
                chats: state.chats.map(c => c.id === chatId ? { ...c, messages: [...c.messages, message], updatedAt: Date.now() } : c)
            })),

            updateMessageContent: (chatId, messageId, newContent) => set((state) => ({
                chats: state.chats.map(c => {
                    if (c.id !== chatId) return c;
                    return {
                        ...c,
                        updatedAt: Date.now(),
                        messages: c.messages.map(m => m.id === messageId ? { ...m, content: newContent } : m)
                    };
                })
            })),

            appendStreamToMessage: (chatId, messageId, chunk) => set((state) => ({
                chats: state.chats.map(c => {
                    if (c.id !== chatId) return c;
                    return {
                        ...c,
                        updatedAt: Date.now(),
                        messages: c.messages.map(m => m.id === messageId ? { ...m, content: m.content + chunk } : m)
                    };
                })
            })),

            updateChatTitle: (chatId, title) => set((state) => ({
                chats: state.chats.map(c => c.id === chatId ? { ...c, title } : c)
            }))
        }),
        {
            name: 'kobar-chat-storage',
            version: 1,
        }
    )
);
