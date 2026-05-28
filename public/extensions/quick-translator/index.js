(function() {
    const React = window.React;
    const useAppStore = window.useAppStore;

    // The React Translator panel component
    function TranslatorPanel(props) {
        const [sourceText, setSourceText] = React.useState('');
        const [translatedText, setTranslatedText] = React.useState('');
        const [srcLang, setSrcLang] = React.useState('en');
        const [trgLang, setTrgLang] = React.useState('tr');
        const [loading, setLoading] = React.useState(false);
        const [copied, setCopied] = React.useState(false);
        const [error, setError] = React.useState(null);

        const design = useAppStore(state => state.design);
        const glassOpacity = useAppStore(state => state.glassOpacity);
        const isMac = useAppStore(state => state.isMac);
        const orientation = useAppStore(state => state.orientation);
        const edgePosition = useAppStore(state => state.edgePosition);
        const sidebarPosition = useAppStore(state => state.sidebarPosition);
        const screenBounds = useAppStore(state => state.screenBounds);

        const languages = [
            { code: 'en', name: 'English', flag: '🇺🇸' },
            { code: 'tr', name: 'Türkçe', flag: '🇹🇷' },
            { code: 'es', name: 'Español', flag: '🇪🇸' },
            { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
            { code: 'fr', name: 'Français', flag: '🇫🇷' },
            { code: 'it', name: 'Italiano', flag: '🇮🇹' },
            { code: 'ru', name: 'Русский', flag: '🇷🇺' },
            { code: 'zh', name: '中文', flag: '🇨🇳' },
            { code: 'ja', name: '日本語', flag: '🇯🇵' },
            { code: 'ar', name: 'العربية', flag: '🇸🇦' }
        ];

        const handleTranslate = async () => {
            if (!sourceText.trim()) return;
            setLoading(true);
            setError(null);
            try {
                const res = await fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(sourceText) + '&langpair=' + srcLang + '|' + trgLang);
                if (!res.ok) throw new Error('API error');
                const data = await res.json();
                if (data && data.responseData) {
                    setTranslatedText(data.responseData.translatedText);
                } else {
                    throw new Error('Invalid response');
                }
            } catch (err) {
                console.error(err);
                setError('Offline or API error. Mock translation used.');
                // Simple mock fallback
                setTranslatedText('[Translated to ' + trgLang.toUpperCase() + ']: ' + sourceText);
            } finally {
                setLoading(false);
            }
        };

        const handleSwap = () => {
            const temp = srcLang;
            setSrcLang(trgLang);
            setTrgLang(temp);
            const tempText = sourceText;
            setSourceText(translatedText);
            setTranslatedText(tempText);
        };

        const handleCopy = () => {
            if (!translatedText) return;
            navigator.clipboard.writeText(translatedText);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        };

        const getPopupStyle = () => {
            const popupWidth = 320;
            const popupHeight = 380;
            const offsetTop = sidebarPosition ? sidebarPosition.y : 0;
            const offsetLeft = sidebarPosition ? sidebarPosition.x : 0;

            const style = {
                position: 'absolute',
                zIndex: 99999,
                width: popupWidth + 'px',
                pointerEvents: 'auto',
                backgroundColor: design === 'style2' 
                    ? 'color-mix(in srgb, var(--theme-surface) ' + glassOpacity + '%, transparent)' 
                    : 'var(--theme-surface)',
                borderColor: design === 'style2' ? 'rgba(255, 255, 255, 0.1)' : 'var(--theme-border)',
                borderWidth: '1px',
                borderStyle: 'solid',
                borderRadius: '12px',
                padding: '16px',
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
                backdropFilter: design === 'style2' ? (isMac ? 'blur(8px)' : 'blur(20px)') : 'none',
                WebkitBackdropFilter: design === 'style2' ? (isMac ? 'blur(8px)' : 'blur(20px)') : 'none',
                color: '#e2e8f0'
            };

            if (orientation === "horizontal") {
                style.left = '50%';
                style.transform = 'translateX(-50%)';
                if (edgePosition === 'top') {
                    style.top = '100%';
                    style.marginTop = '12px';
                } else {
                    style.bottom = '100%';
                    style.marginBottom = '12px';
                }
            } else {
                style.top = '50%';
                style.transform = 'translateY(-50%)';
                if (edgePosition === 'left') {
                    style.left = '100%';
                    style.marginLeft = '12px';
                } else {
                    style.right = '100%';
                    style.marginRight = '12px';
                }
            }
            return style;
        };

        return React.createElement('div', { style: getPopupStyle(), className: 'animate-in fade-in zoom-in duration-200' },
            // Header
            React.createElement('div', { className: 'flex justify-between items-center mb-3' },
                React.createElement('div', { className: 'flex items-center gap-2' },
                    React.createElement('span', { className: 'material-symbols-outlined text-[18px] text-primary' }, 'translate'),
                    React.createElement('span', { className: 'text-xs uppercase tracking-wider text-slate-400 font-bold' }, 'Quick Translator')
                ),
                React.createElement('button', {
                    onClick: props.onClose,
                    className: 'w-6 h-6 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-red-500/20 flex items-center justify-center transition-all'
                }, React.createElement('span', { className: 'material-symbols-outlined text-[16px]' }, 'close'))
            ),

            // Content
            React.createElement('div', { className: 'flex flex-col gap-3' },
                // Selectors
                React.createElement('div', { className: 'flex items-center justify-between gap-2' },
                    React.createElement('select', {
                        value: srcLang,
                        onChange: (e) => setSrcLang(e.target.value),
                        className: 'bg-black/20 border border-white/10 rounded-md p-1.5 text-xs text-slate-200 outline-none flex-1'
                    }, languages.map(l => React.createElement('option', { key: l.code, value: l.code }, l.flag + ' ' + l.name))),
                    
                    React.createElement('button', {
                        onClick: handleSwap,
                        className: 'p-1.5 rounded-lg bg-white/5 text-slate-400 hover:text-white transition-all'
                    }, React.createElement('span', { className: 'material-symbols-outlined text-[16px]' }, 'swap_horiz')),

                    React.createElement('select', {
                        value: trgLang,
                        onChange: (e) => setTrgLang(e.target.value),
                        className: 'bg-black/20 border border-white/10 rounded-md p-1.5 text-xs text-slate-200 outline-none flex-1'
                    }, languages.map(l => React.createElement('option', { key: l.code, value: l.code }, l.flag + ' ' + l.name)))
                ),

                // Source text
                React.createElement('textarea', {
                    value: sourceText,
                    onChange: (e) => setSourceText(e.target.value),
                    placeholder: 'Type text to translate...',
                    className: 'bg-black/20 border border-white/10 rounded-md p-2 text-xs text-white outline-none resize-none h-20'
                }),

                // Translate button
                React.createElement('button', {
                    onClick: handleTranslate,
                    disabled: loading || !sourceText.trim(),
                    className: 'py-2 px-4 rounded-lg bg-primary/20 hover:bg-primary/30 border border-primary/50 text-primary text-xs font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2'
                }, 
                    loading ? React.createElement('span', { className: 'material-symbols-outlined text-[16px] animate-spin' }, 'sync') : null,
                    React.createElement('span', null, loading ? 'Translating...' : 'Translate')
                ),

                // Translated text
                React.createElement('div', { className: 'relative' },
                    React.createElement('textarea', {
                        value: translatedText,
                        readOnly: true,
                        placeholder: 'Translation...',
                        className: 'bg-black/40 border border-white/10 rounded-md p-2 text-xs text-slate-200 outline-none resize-none h-20 w-full'
                    }),
                    translatedText ? React.createElement('button', {
                        onClick: handleCopy,
                        className: 'absolute right-2 bottom-2 p-1.5 rounded bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all'
                    }, React.createElement('span', { className: 'material-symbols-outlined text-[14px]' }, copied ? 'check' : 'content_copy')) : null
                ),

                error ? React.createElement('span', { className: 'text-[10px] text-amber-400 mt-1' }, error) : null
            )
        );
    }

    // Register to global KoBar extensions registry
    window.KoBarExtensions.registerSidebarButton({
        id: 'quick-translator',
        icon: 'translate',
        label: 'Quick Translator',
        onClick: function(e, anchorRect) {
            const isCurrentlyOpen = useAppStore.getState().activeExtensionPanelId === 'quick-translator';
            useAppStore.setState({ 
                activeExtensionPanelId: isCurrentlyOpen ? null : 'quick-translator',
                activeExtensionAnchorRect: anchorRect
            });
        }
    });

    window.KoBarExtensions.registerPanel('quick-translator', {
        id: 'quick-translator',
        render: function(props) {
            return React.createElement(TranslatorPanel, {
                onClose: function() {
                    useAppStore.setState({ activeExtensionPanelId: null });
                },
                anchorRect: props.anchorRect
            });
        }
    });
})();
