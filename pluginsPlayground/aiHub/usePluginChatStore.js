import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const usePluginChatStore = create(
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
                const newChat = {
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
            name: 'kobar-aihub-plugin-storage',
            version: 1,
        }
    )
);
