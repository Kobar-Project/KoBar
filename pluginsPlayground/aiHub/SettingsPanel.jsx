import { usePluginChatStore } from './usePluginChatStore';

const MODELS = [
    { id: 'anthropic:claude-sonnet-4-6', label: 'Claude 4.6 Sonnet (Anthropic - Best)' },
    { id: 'anthropic:claude-opus-4-6', label: 'Claude 4.6 Opus (Anthropic - Heavy)' },
    { id: 'anthropic:claude-haiku-4-5-20251001', label: 'Claude 4.5 Haiku (Anthropic - Fast)' },
    { id: 'local:llama3', label: 'Local Default (Ollama / LM Studio)' },
    { id: 'local:llava', label: 'Local Vision (Ollama - LLaVA)' }
];

export const SettingsPanel = () => {
    const React = window.React;
    const { useState, useEffect } = React;
    const useAppStore = window.useAppStore;
    const currentLang = useAppStore(state => state.language);
    
    // We bind to the plugin's local store
    const apiKeys = usePluginChatStore(state => state.apiKeys);
    const setApiKeys = usePluginChatStore(state => state.setApiKeys);

    const TRANSLATIONS = {
        en: {
            modelDefaults: "Model Defaults",
            defaultModelLabel: "Default Chat Model",
            apiKeysProviders: "API Keys & Providers",
            anthropicKeyLabel: "Anthropic API Key",
            openaiKeyLabel: "OpenAI API Key (Coming Soon)",
            geminiKeyLabel: "Gemini API Key (Coming Soon)",
            localUrlLabel: "Local Inference URL",
            systemMessageLabel: "System Message",
            customInstructionsLabel: "Custom Instructions",
            comingSoon: "Coming Soon"
        },
        tr: {
            modelDefaults: "Varsayılan Modeller",
            defaultModelLabel: "Varsayılan Sohbet Modeli",
            apiKeysProviders: "API Anahtarları ve Sağlayıcılar",
            anthropicKeyLabel: "Anthropic API Anahtarı",
            openaiKeyLabel: "OpenAI API Anahtarı (Yakında)",
            geminiKeyLabel: "Gemini API Anahtarı (Yakında)",
            localUrlLabel: "Yerel Çıkarım URL'si",
            systemMessageLabel: "Sistem Mesajı",
            customInstructionsLabel: "Özel Talimatlar",
            comingSoon: "Yakında"
        }
    };

    const t = (key) => {
        const langDict = TRANSLATIONS[currentLang] || TRANSLATIONS['en'];
        return langDict[key] || key;
    };

    return (
        <div className="flex flex-col text-slate-200 p-2 space-y-6">
            <div>
                <h3 className="text-sm font-bold text-[#f4a125] uppercase tracking-wider mb-4">{t('modelDefaults')}</h3>
                <div className="space-y-4">
                    <div className="flex flex-col gap-2">
                        <label className="text-xs text-slate-400">{t('defaultModelLabel')}</label>
                        <select
                            value={apiKeys.defaultModel}
                            onChange={(e) => setApiKeys({ defaultModel: e.target.value })}
                            className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-[#f4a125]/50 cursor-pointer"
                        >
                            {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                        </select>
                    </div>
                </div>
            </div>

            <div className="w-full h-px bg-white/5" />

            <div>
                <h3 className="text-sm font-bold text-[#f4a125] uppercase tracking-wider mb-4">{t('apiKeysProviders')}</h3>
                <div className="grid grid-cols-1 gap-4">
                    <div className="flex flex-col gap-2">
                        <label className="text-xs text-slate-400">{t('anthropicKeyLabel')}</label>
                        <input 
                            type="password" 
                            value={apiKeys.anthropic || ''}
                            onChange={(e) => setApiKeys({ anthropic: e.target.value })}
                            placeholder="sk-ant-..."
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-[#f4a125]/50 transition-colors"
                        />
                    </div>
                    
                    <div className="flex flex-col gap-2 opacity-50">
                        <label className="text-xs text-slate-400">{t('openaiKeyLabel')}</label>
                        <input 
                            disabled
                            type="password" 
                            placeholder={t('comingSoon')}
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[10px] text-slate-500 outline-none select-none cursor-not-allowed"
                        />
                    </div>
                    <div className="flex flex-col gap-2 opacity-50">
                        <label className="text-xs text-slate-400">{t('geminiKeyLabel')}</label>
                        <input 
                            disabled
                            type="password" 
                            placeholder={t('comingSoon')}
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[10px] text-slate-500 outline-none select-none cursor-not-allowed"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-xs text-slate-400">{t('localUrlLabel')} (Ollama / LM Studio)</label>
                        <input 
                            type="text" 
                            value={apiKeys.localUrl || ''}
                            onChange={(e) => setApiKeys({ localUrl: e.target.value })}
                            placeholder="http://localhost:11434"
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-[#f4a125]/50 transition-colors"
                        />
                    </div>
                </div>
            </div>

            <div className="w-full h-px bg-white/5" />

            <div>
                <h3 className="text-sm font-bold text-[#f4a125] uppercase tracking-wider mb-4">Context</h3>
                <div className="space-y-4">
                    <div className="flex flex-col gap-2">
                        <label className="text-xs text-slate-400">{t('systemMessageLabel')}</label>
                        <textarea 
                            value={apiKeys.systemMessage || ''}
                            onChange={(e) => setApiKeys({ systemMessage: e.target.value })}
                            placeholder="You are a helpful AI assistant..."
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-[#f4a125]/50 transition-colors min-h-[80px] custom-scrollbar resize-y"
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="text-xs text-slate-400">{t('customInstructionsLabel')}</label>
                        <textarea 
                            value={apiKeys.customInstructions || ''}
                            onChange={(e) => setApiKeys({ customInstructions: e.target.value })}
                            placeholder="User preferences..."
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-[#f4a125]/50 transition-colors min-h-[80px] custom-scrollbar resize-y"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
