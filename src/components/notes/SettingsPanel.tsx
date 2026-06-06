import React, { useState, useRef, useEffect } from 'react';
import { useAppStore, applyCustomThemeCSS } from '../../store/useAppStore';
import { getLanguageOptions } from '../../i18n/translations';
function hsvToHex(h: number, s: number, v: number): string {
    s /= 100; v /= 100;
    let i = Math.floor(h / 60);
    let f = h / 60 - i;
    let p = v * (1 - s);
    let q = v * (1 - f * s);
    let t = v * (1 - (1 - f) * s);
    let r = 0, g = 0, b = 0;
    switch (i % 6) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        case 5: r = v; g = p; b = q; break;
    }
    const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0').toUpperCase();
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToHsv(hex: string): [number, number, number] {
    let hexStr = hex;
    if (hexStr.length === 4) {
        hexStr = '#' + hexStr[1] + hexStr[1] + hexStr[2] + hexStr[2] + hexStr[3] + hexStr[3];
    } else if (hexStr.length !== 7) {
        return [0, 0, 100];
    }
    let r = parseInt(hexStr.slice(1, 3), 16) / 255;
    let g = parseInt(hexStr.slice(3, 5), 16) / 255;
    let b = parseInt(hexStr.slice(5, 7), 16) / 255;
    
    if (isNaN(r)) r = 0;
    if (isNaN(g)) g = 0;
    if (isNaN(b)) b = 0;

    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, v = max;
    let d = max - min;
    s = max === 0 ? 0 : d / max;

    if (max !== min) {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    } else {
        h = 0;
    }
    return [Math.round(h * 360), Math.round(s * 100), Math.round(v * 100)];
}
import { IS_STORE_BUILD } from '../../App';
import Accordion from './Accordion';
const isSystemTab = (note: any) => note.isSettings || note.title === 'Welcome to KoBar!';

const SettingsPanel: React.FC = () => {
    // ─── Granular Selectors (prevents re-render on unrelated store changes) ───
    const theme = useAppStore(state => state.theme);
    const setTheme = useAppStore(state => state.setTheme);
    const customThemeColor = useAppStore(state => state.customThemeColor);
    const setCustomThemeColor = useAppStore(state => state.setCustomThemeColor);
    const language = useAppStore(state => state.language);
    
    // Refs for file inputs
    const importSettingsRef = useRef<HTMLInputElement>(null);
    const importDataRef = useRef<HTMLInputElement>(null);


    const setLanguage = useAppStore(state => state.setLanguage);
    const t = useAppStore(state => state.t);
    const showTooltips = useAppStore(state => state.showTooltips);
    const setShowTooltips = useAppStore(state => state.setShowTooltips);
    const launchAtStartup = useAppStore(state => state.launchAtStartup);
    const enableEyeAnimation = useAppStore(state => state.enableEyeAnimation);
    const setEnableEyeAnimation = useAppStore(state => state.setEnableEyeAnimation);
    const setLaunchAtStartup = useAppStore(state => state.setLaunchAtStartup);
    const toggleWidth = useAppStore(state => state.toggleWidth);
    const setToggleWidth = useAppStore(state => state.setToggleWidth);
    const sidebarWidth = useAppStore(state => state.sidebarWidth);
    const setSidebarWidth = useAppStore(state => state.setSidebarWidth);
    const iconScale = useAppStore(state => state.iconScale);
    const setIconScale = useAppStore(state => state.setIconScale);
    const featureSpacing = useAppStore(state => state.featureSpacing);
    const setFeatureSpacing = useAppStore(state => state.setFeatureSpacing);
    const design = useAppStore(state => state.design);
    const setDesign = useAppStore(state => state.setDesign);
    const glassOpacity = useAppStore(state => state.glassOpacity);
    const setGlassOpacity = useAppStore(state => state.setGlassOpacity);

    const isPopupSmartPositioning = useAppStore(state => state.isPopupSmartPositioning);
    const setIsPopupSmartPositioning = useAppStore(state => state.setIsPopupSmartPositioning);
    const orientation = useAppStore(state => state.orientation);
    const setOrientation = useAppStore(state => state.setOrientation);

    // Top-level states for inline custom color picker
    const [inlineHsv, setInlineHsv] = useState<[number, number, number]>([0, 0, 100]);
    const [isDraggingSat, setIsDraggingSat] = useState(false);
    const [isDraggingHue, setIsDraggingHue] = useState(false);
    const satRectRef = useRef<HTMLDivElement>(null);
    const hueRectRef = useRef<HTMLDivElement>(null);

    // Synchronize local HSV state when theme changes externally
    useEffect(() => {
        if (customThemeColor) {
            setInlineHsv(hexToHsv(customThemeColor));
        }
    }, [customThemeColor]);

    const handleSatMove = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
        if (!satRectRef.current) return;
        const rect = satRectRef.current.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
        
        const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
        
        const newS = Math.round(x * 100);
        const newV = Math.round(y * 100);
        
        setInlineHsv(prev => [prev[0], newS, newV]);
        const newHex = hsvToHex(inlineHsv[0], newS, newV);
        setCustomThemeColor(newHex);
        applyCustomThemeCSS(newHex);
        setTheme('custom');
    };

    const handleHueMove = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
        if (!hueRectRef.current) return;
        const rect = hueRectRef.current.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
        
        const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const newH = Math.round(x * 360);
        
        setInlineHsv(prev => [newH, prev[1], prev[2]]);
        const newHex = hsvToHex(newH, inlineHsv[1], inlineHsv[2]);
        setCustomThemeColor(newHex);
        applyCustomThemeCSS(newHex);
        setTheme('custom');
    };

    useEffect(() => {
        const handleGlobalMove = (e: MouseEvent | TouchEvent) => {
            if (isDraggingSat) handleSatMove(e);
            if (isDraggingHue) handleHueMove(e);
        };
        const handleGlobalUp = () => {
            setIsDraggingSat(false);
            setIsDraggingHue(false);
        };

        if (isDraggingSat || isDraggingHue) {
            window.addEventListener('mousemove', handleGlobalMove);
            window.addEventListener('mouseup', handleGlobalUp);
            window.addEventListener('touchmove', handleGlobalMove);
            window.addEventListener('touchend', handleGlobalUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleGlobalMove);
            window.removeEventListener('mouseup', handleGlobalUp);
            window.removeEventListener('touchmove', handleGlobalMove);
            window.removeEventListener('touchend', handleGlobalUp);
        };
    }, [isDraggingSat, isDraggingHue, inlineHsv]);

    const [appVersion, setAppVersion] = useState('');
    const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'upToDate' | 'available' | 'downloading' | 'downloaded' | 'error'>('idle');
    const [latestVersion, setLatestVersion] = useState('');
    const [downloadPercent, setDownloadPercent] = useState(0);
    const [downloadSpeed, setDownloadSpeed] = useState('');
    const [downloadedSize, setDownloadedSize] = useState('');
    const [totalSize, setTotalSize] = useState('');
    const [updateErrorMessage, setUpdateErrorMessage] = useState('');

    useEffect(() => {
        if (IS_STORE_BUILD) return;

        // Subscriptions to Electron auto-updater progress/complete/error IPCs
        let unsubscribeProgress = () => {};
        let unsubscribeComplete = () => {};
        let unsubscribeError = () => {};

        if (window.api?.onUpdateDownloadProgress) {
            unsubscribeProgress = window.api.onUpdateDownloadProgress((progress) => {
                setUpdateStatus('downloading');
                setDownloadPercent(Math.round(progress.percent));
                
                // Bytes per second converted to readable MB/s
                const speedMB = (progress.bytesPerSecond / (1024 * 1024)).toFixed(1);
                setDownloadSpeed(`${speedMB} MB/s`);
                
                // Downloaded & Total sizes in MB
                const transMB = (progress.transferred / (1024 * 1024)).toFixed(1);
                const totalMB = (progress.total / (1024 * 1024)).toFixed(1);
                setDownloadedSize(`${transMB} MB`);
                setTotalSize(`${totalMB} MB`);
            });
        }

        if (window.api?.onUpdateDownloadComplete) {
            unsubscribeComplete = window.api.onUpdateDownloadComplete((version) => {
                setUpdateStatus('downloaded');
                setDownloadPercent(100);
                if (version) setLatestVersion(version);
            });
        }

        if (window.api?.onUpdateError) {
            unsubscribeError = window.api.onUpdateError((err) => {
                setUpdateStatus('error');
                setUpdateErrorMessage(err || 'Update failed to download');
            });
        }

        return () => {
            unsubscribeProgress();
            unsubscribeComplete();
            unsubscribeError();
        };
    }, []);

    const handleCheckUpdatesInline = async () => {
        if (updateStatus === 'checking' || updateStatus === 'downloading') return;
        setUpdateStatus('checking');
        setUpdateErrorMessage('');
        
        try {
            const result = await window.api.checkForUpdatesManual();
            
            if (result.status === 'disabled') {
                setUpdateStatus('idle');
                return;
            }

            if (result.status === 'error') {
                setUpdateStatus('error');
                setUpdateErrorMessage(result.message || 'Unknown update check error');
                return;
            }

            if (result.status === 'success') {
                if (result.updateAvailable && result.version) {
                    setUpdateStatus('available');
                    setLatestVersion(result.version);
                } else {
                    setUpdateStatus('upToDate');
                }
            }
        } catch (err: any) {
            setUpdateStatus('error');
            setUpdateErrorMessage(err?.message || 'Failed to check for updates');
        }
    };

    const handleStartDownloadInline = () => {
        if (window.api?.downloadAndInstallUpdate) {
            setUpdateStatus('downloading');
            setDownloadPercent(0);
            window.api.downloadAndInstallUpdate();
        }
    };

    const handleQuitAndInstallInline = () => {
        if (window.api?.quitAndInstallUpdate) {
            window.api.quitAndInstallUpdate();
        }
    };

    const scrollRef = useRef<HTMLDivElement>(null);
    const scrollDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // Restore scroll position on mount — read from store directly (no subscription)
    useEffect(() => {
        const savedPos = useAppStore.getState().scrollPositions['settings'];
        if (scrollRef.current && savedPos) {
            scrollRef.current.scrollTop = savedPos;
        }
    }, []);

    // Debounced scroll position sync — prevents re-render storm
    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const scrollTop = e.currentTarget.scrollTop;
        clearTimeout(scrollDebounceRef.current);
        scrollDebounceRef.current = setTimeout(() => {
            useAppStore.getState().setScrollPosition('settings', scrollTop);
        }, 250);
    };

    useEffect(() => {
        if (window.api?.getAppVersion) {
            window.api.getAppVersion().then(setAppVersion);
        }
    }, []);

    const handleAutoLaunchToggle = () => {
        setLaunchAtStartup(!launchAtStartup);
    };

    // maxShortcuts handler removed

    const handleToggleWidthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val)) {
            setToggleWidth(Math.min(40, Math.max(10, val)));
        }
    };

    const handleSidebarWidthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val)) {
            setSidebarWidth(Math.min(120, Math.max(40, val)));
        }
    };

    const handleIconScaleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val)) {
            setIconScale(Math.min(1.5, Math.max(0.7, val)));
        }
    };

    const handleFeatureSpacingChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val)) {
            setFeatureSpacing(Math.min(50, Math.max(0, val)));
        }
    };

    const handleExport = (type: 'settings' | 'data', method: 'download' | 'email') => {
        const state = useAppStore.getState();
        let payload: any = {};
        
        if (type === 'settings') {
            payload = {
                theme: state.theme,
                customThemeColor: state.customThemeColor,
                language: state.language,
                showTooltips: state.showTooltips,
                sidebarWidth: state.sidebarWidth,
                iconScale: state.iconScale,
                teleportShortcut: state.teleportShortcut,
                launchAtStartup: state.launchAtStartup,
                enableEyeAnimation: state.enableEyeAnimation,


                isKoCalendarEnabled: state.isKoCalendarEnabled,
                isPinInjectorEnabled: state.isPinInjectorEnabled,
                isKoBoxEnabled: state.isKoBoxEnabled,
                isAiHubEnabled: state.isAiHubEnabled,
                koBoxCleanupMode: state.koBoxCleanupMode,

                featureOrder: state.featureOrder,
                design: state.design,
                glassOpacity: state.glassOpacity,
                aiHubHeight: state.aiHubHeight,
                koCalendarColor: state.koCalendarColor,
                workspaces: state.workspaces,
                settingsFeatureViewMode: state.settingsFeatureViewMode,
                settingsWorkspaceViewMode: state.settingsWorkspaceViewMode,
                orientation: state.orientation,
                edgePosition: state.edgePosition,
            };
        } else {
            payload = {
                notes: state.notes.filter(n => !isSystemTab(n)),
                localEvents: state.localEvents,
            };
        }

        const jsonString = JSON.stringify(payload, null, 2);

        if (method === 'download') {
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `kobar-${type}-export.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            window.api?.sendNotification?.('Export Complete', `Successfully downloaded ${type} export.`);
        } else if (method === 'email') {
            const subject = encodeURIComponent(`KoBar ${type === 'settings' ? 'Settings' : 'Data'} Export`);
            const body = encodeURIComponent(jsonString);
            window.api?.openExternal(`mailto:?subject=${subject}&body=${body}`);
            window.api?.sendNotification?.('Export Ready', `Opening your email client to send ${type} export.`);
        }
    };

    const handleImport = (type: 'settings' | 'data', event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const jsonStr = e.target?.result as string;
                const parsed = JSON.parse(jsonStr);
                
                if (typeof parsed !== 'object' || parsed === null) {
                    throw new Error('Invalid JSON structure');
                }

                if (type === 'data') {
                    const state = useAppStore.getState();
                    
                    let nextId = state.nextNoteId || Math.max(...state.notes.map(n => n.id), 0) + 1;
                    const filteredImportedNotes = (parsed.notes || []).filter((n: any) => !isSystemTab(n));
                    const importedNotes = filteredImportedNotes.map((n: any) => ({ ...n, id: nextId++ }));
                    



                    const mergedLocalEvents = [...state.localEvents, ...(parsed.localEvents || []).map((ev: any) => ({ ...ev, id: Date.now().toString() + '-' + Math.floor(Math.random() * 1000) }))];

                    useAppStore.setState({
                        notes: [...state.notes, ...importedNotes],
                        nextNoteId: nextId,
                        localEvents: mergedLocalEvents
                    });
                } else {
                    // Apply parsed settings directly to the store
                    useAppStore.setState(parsed);
                    
                    // Switch to mini mode and teleport to center as if it's a fresh start
                    const state = useAppStore.getState();
                    const visibleHeight = state.screenBounds?.height ?? 800;
                    state.setMiniMode(true, { 
                        x: state.isMac ? Math.floor(window.innerWidth / 2) : 3000, 
                        y: Math.floor(visibleHeight / 2) 
                    });
                }
                
                window.api?.sendNotification?.('Import Complete', `Successfully imported ${type}.`);
            } catch (err) {
                console.error('Import failed', err);
                window.api?.sendNotification?.('Import Failed', `Could not parse the ${type} import file.`);
            }
        };
        reader.readAsText(file);
        
        // Reset the input so the same file can be selected again
        event.target.value = '';
    };

    const localizedLanguages = getLanguageOptions(language);

    return (
        <div 
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto p-8 pl-10 pb-4 custom-scrollbar relative" 
            style={{ backgroundColor: design === 'style2' ? 'transparent' : 'var(--theme-bg-base)' }}
        >
            <h2 className="text-2xl font-semibold text-slate-200 mb-8">{t('settings')}</h2>

            <div className="space-y-10">


                {/* --- MIDDLE SECTION: Application UI Configuration --- */}
                <div>
                    <h3 className="text-sm uppercase tracking-wider text-slate-500 font-semibold mb-4 px-2">{t('uiLayout')}</h3>
                    <div className="space-y-4">
                        <Accordion title={t('layoutAndSpacing')} icon="grid_view" defaultOpen={true}>
                            <div className="flex flex-col gap-6">
                                <div className="flex flex-col gap-3">
                                    <label className="text-sm text-slate-400 font-medium">{t('orientation') || 'Orientation'}</label>
                                    <div className="flex bg-black/20 p-1 rounded-xl border border-white/5 no-drag-region">
                                        <button onClick={() => setOrientation('vertical')}
                                            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${orientation === 'vertical' ? 'bg-primary text-slate-900 shadow-md' : 'text-slate-400 hover:text-slate-200'}`}>
                                            {t('vertical') || 'Vertical'}
                                        </button>
                                        <button onClick={() => setOrientation('horizontal')}
                                            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${orientation === 'horizontal' ? 'bg-primary text-slate-900 shadow-md' : 'text-slate-400 hover:text-slate-200'}`}>
                                            {t('horizontal') || 'Horizontal'}
                                        </button>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-3">
                                    <div className="flex justify-between items-center">
                                        <label className="text-sm text-slate-400 font-medium">{t('toggleWidthConfig')}</label>
                                        <span className="text-base font-bold text-primary">{toggleWidth}px</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="10"
                                        max="40"
                                        value={toggleWidth}
                                        onChange={handleToggleWidthChange}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onTouchStart={(e) => e.stopPropagation()}
                                        onDragStart={(e) => e.stopPropagation()}
                                        draggable={false}
                                        className={`w-full h-2 rounded-lg appearance-none cursor-pointer mt-1 no-drag-region ${design === 'style2' ? 'bg-white/10' : 'bg-slate-700'}`}
                                        style={{ accentColor: 'var(--theme-primary)' }}
                                    />
                                </div>

                                <div className="flex flex-col gap-3">
                                    <div className="flex justify-between items-center">
                                        <label className="text-sm text-slate-400 font-medium">{language === 'tr' ? 'KoBar Genişliği' : 'KoBar Width'}</label>
                                        <span className="text-base font-bold text-primary">{sidebarWidth}px</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="40"
                                        max="120"
                                        value={sidebarWidth}
                                        onChange={handleSidebarWidthChange}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onTouchStart={(e) => e.stopPropagation()}
                                        onDragStart={(e) => e.stopPropagation()}
                                        draggable={false}
                                        className={`w-full h-2 rounded-lg appearance-none cursor-pointer mt-1 no-drag-region ${design === 'style2' ? 'bg-white/10' : 'bg-slate-700'}`}
                                        style={{ accentColor: 'var(--theme-primary)' }}
                                    />
                                </div>

                                <div className="flex flex-col gap-3">
                                    <div className="flex justify-between items-center">
                                        <label className="text-sm text-slate-400 font-medium">{language === 'tr' ? 'İkon Boyutu' : 'Icon Size'}</label>
                                        <span className="text-base font-bold text-primary">{Math.round(iconScale * 100)}%</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0.7"
                                        max="1.5"
                                        step="0.05"
                                        value={iconScale}
                                        onChange={handleIconScaleChange}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onTouchStart={(e) => e.stopPropagation()}
                                        onDragStart={(e) => e.stopPropagation()}
                                        draggable={false}
                                        className={`w-full h-2 rounded-lg appearance-none cursor-pointer mt-1 no-drag-region ${design === 'style2' ? 'bg-white/10' : 'bg-slate-700'}`}
                                        style={{ accentColor: 'var(--theme-primary)' }}
                                    />
                                </div>

                                <div className="flex flex-col gap-3">
                                    <div className="flex justify-between items-center">
                                        <label className="text-sm text-slate-400 font-medium">{t('featureSpacingConfig')}</label>
                                        <span className="text-base font-bold text-primary">{featureSpacing}px</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="50"
                                        value={featureSpacing}
                                        onChange={handleFeatureSpacingChange}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onTouchStart={(e) => e.stopPropagation()}
                                        onDragStart={(e) => e.stopPropagation()}
                                        draggable={false}
                                        className={`w-full h-2 rounded-lg appearance-none cursor-pointer mt-1 no-drag-region ${design === 'style2' ? 'bg-white/10' : 'bg-slate-700'}`}
                                        style={{ accentColor: 'var(--theme-primary)' }}
                                    />
                                </div>

                                <div className="w-full h-px bg-white/5 my-2"></div>

                                <div className="flex items-center justify-between">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-sm text-slate-300 font-medium">{t('smartPopupPositioning')}</span>
                                        <span className="text-xs text-slate-500 leading-tight pr-4">{t('smartPopupPositioningDesc')}</span>
                                    </div>
                                    <button
                                        onClick={() => setIsPopupSmartPositioning(!isPopupSmartPositioning)}
                                        className={`relative w-11 h-6 rounded-full transition-colors duration-200 no-drag-region shrink-0 ${isPopupSmartPositioning ? 'bg-primary' : 'bg-slate-600'}`}
                                    >
                                        <span
                                            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${isPopupSmartPositioning ? 'translate-x-5' : 'translate-x-0'}`}
                                        />
                                    </button>
                                </div>
                            </div>
                        </Accordion>
                    </div>
                </div>

                <div className="w-full h-px opacity-20" style={{ backgroundColor: 'var(--theme-border)' }}></div>

                {/* --- BOTTOM SECTION: Static Settings --- */}
                <div>
                    <h3 className="text-sm uppercase tracking-wider text-slate-500 font-semibold mb-4 px-2">{t('appearance')} & {t('settings')}</h3>
                    <div className="space-y-4">
                        
                        {/* Theme & Language Settings Area */}
                        <Accordion title={t('appearance')} icon="palette" defaultOpen={true}>
                            <div className="flex flex-col gap-6">
                        {/* Language Selection */}
                        <div className="flex flex-col gap-3">
                            <label className="text-sm text-slate-400 font-medium">{t('language')}</label>
                            <div className="grid grid-cols-2 gap-2 mt-1">
                                {localizedLanguages.map((lang) => (
                                    <button
                                        key={lang.code}
                                        onClick={() => setLanguage(lang.code)}
                                        className={`px-3 py-2 text-left text-sm rounded-lg transition-colors border no-drag-region ${language === lang.code
                                            ? 'bg-primary/20 border-primary text-primary font-medium'
                                            : `border-transparent text-slate-300 hover:text-slate-200 ${design === 'style2' ? 'hover:bg-white/5' : 'hover:bg-[#2a241c]'}`
                                            }`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span>{lang.name}</span>
                                            {language === lang.code && (
                                                <span className="material-symbols-outlined text-[16px]">check</span>
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="w-full h-px" style={{ backgroundColor: 'var(--theme-border)' }}></div>

                        {/* Design Selection */}
                        <div className="flex flex-col gap-3">
                            <label className="text-sm text-slate-400 font-medium">{t('designMode')}</label>
                            <div className="flex bg-black/20 p-1 rounded-xl border border-white/5 no-drag-region">
                                <button
                                    onClick={() => setDesign('style1')}
                                    className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${design === 'style1'
                                        ? 'bg-primary text-slate-900 shadow-lg'
                                        : 'text-slate-400 hover:text-slate-200'
                                        }`}
                                >
                                    {t('designStyle1')}
                                </button>
                                <button
                                    onClick={() => setDesign('style2')}
                                    className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${design === 'style2'
                                        ? 'bg-primary text-slate-900 shadow-lg'
                                        : 'text-slate-400 hover:text-slate-200'
                                        }`}
                                >
                                    {t('designStyle2')}
                                </button>
                            </div>
                        </div>

                        {design === 'style2' && (
                            <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
                                <div className="flex justify-between items-center">
                                    <label className="text-sm text-slate-400 font-medium">{t('glassOpacity')}</label>
                                    <span className="text-base font-bold text-primary">{glassOpacity}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="10"
                                    max="90"
                                    value={glassOpacity}
                                    onChange={(e) => setGlassOpacity(parseInt(e.target.value))}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    className={`w-full h-2 rounded-lg appearance-none cursor-pointer mt-1 no-drag-region ${design === 'style2' ? 'bg-white/10' : 'bg-slate-700'}`}
                                    style={{ accentColor: 'var(--theme-primary)' }}
                                />
                            </div>
                        )}

                        <div className="w-full h-px" style={{ backgroundColor: 'var(--theme-border)' }}></div>


                        {/* Theme Selection */}
                        <div className="flex flex-col gap-3">
                            <label className="text-sm text-slate-400 font-medium">{t('themeColor')}</label>
                            <div className="grid grid-cols-5 gap-4 mt-2">
                                {[
                                    { id: 'ember', name: 'Ember', color: '#f4a125' },
                                    { id: 'ocean', name: 'Ocean', color: '#38bdf8' },
                                    { id: 'sakura', name: 'Sakura', color: '#f472b6' },
                                    { id: 'emerald', name: 'Emerald', color: '#34d399' },
                                    { id: 'midnight', name: 'Midnight', color: '#6366f1' },
                                    { id: 'amethyst', name: 'Amethyst', color: '#a855f7' },
                                    { id: 'crimson', name: 'Crimson', color: '#f43f5e' },
                                    { id: 'nord', name: 'Nord', color: '#81a1c1' },
                                    { id: 'coffee', name: 'Coffee', color: '#d97706' },
                                    { id: 'lavender', name: 'Lavender', color: '#a78bfa' }
                                ].map((themeItem) => (
                                    <button
                                        key={themeItem.id}
                                        onClick={() => setTheme(themeItem.id as any)}
                                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all no-drag-region ${theme === themeItem.id
                                            ? 'ring-2 ring-offset-2 ring-offset-[#1a1612] scale-110 shadow-lg'
                                            : 'hover:scale-105 opacity-80 hover:opacity-100'
                                            }`}
                                        style={{
                                            backgroundColor: themeItem.color
                                        }}
                                        title={themeItem.name}
                                    >
                                        {theme === themeItem.id && (
                                            <span className="material-symbols-outlined text-white text-[18px] drop-shadow-md">check</span>
                                        )}
                                    </button>
                                ))}
                            </div>
                            
                            {/* Custom Theme Color Picker */}
                            <div className="mt-4 flex flex-col gap-3">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs text-slate-500 font-medium uppercase tracking-wider">{(t as any)('customTheme') || 'Custom Theme'}</label>
                                    <div className="flex items-center gap-2">
                                        <div 
                                            className={`w-5 h-5 rounded-full ring-1 shadow-inner ${theme === 'custom' ? 'ring-primary' : 'ring-white/20'}`} 
                                            style={{ backgroundColor: customThemeColor }}
                                        ></div>
                                        <span className="text-xs font-mono text-slate-400 uppercase">{customThemeColor || '#F4A125'}</span>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-3 bg-black/20 p-3 rounded-xl border border-white/5 no-drag-region">
                                    {/* Custom Saturation/Value Square */}
                                    <div 
                                        ref={satRectRef}
                                        className="w-full h-32 relative cursor-crosshair overflow-hidden rounded-md border border-white/10 shadow-inner"
                                        style={{ backgroundColor: `hsl(${inlineHsv[0]}, 100%, 50%)` }}
                                        onMouseDown={(e) => { setIsDraggingSat(true); handleSatMove(e); setTheme('custom'); }}
                                        onTouchStart={(e) => { setIsDraggingSat(true); handleSatMove(e); setTheme('custom'); }}
                                    >
                                        <div className="absolute inset-0 bg-gradient-to-r from-white to-transparent pointer-events-none"></div>
                                        <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent pointer-events-none"></div>
                                        {/* Cursor */}
                                        <div 
                                            className="absolute w-3 h-3 border-2 border-white rounded-full shadow-lg -translate-x-1/2 translate-y-1/2 pointer-events-none"
                                            style={{ 
                                                left: `${inlineHsv[1]}%`, 
                                                bottom: `${inlineHsv[2]}%`,
                                                backgroundColor: theme === 'custom' ? customThemeColor : 'transparent'
                                            }}
                                        ></div>
                                    </div>

                                    {/* Custom Hue Slider */}
                                    <div 
                                        ref={hueRectRef}
                                        className="w-full h-3 rounded-full relative cursor-pointer border border-white/10 shadow-inner"
                                        style={{ 
                                            background: 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)' 
                                        }}
                                        onMouseDown={(e) => { setIsDraggingHue(true); handleHueMove(e); setTheme('custom'); }}
                                        onTouchStart={(e) => { setIsDraggingHue(true); handleHueMove(e); setTheme('custom'); }}
                                    >
                                        {/* Cursor */}
                                        <div 
                                            className="absolute w-4 h-4 bg-white border border-slate-400 rounded-full shadow-md -top-0.5 -translate-x-1/2 pointer-events-none"
                                            style={{ left: `${(inlineHsv[0] / 360) * 100}%` }}
                                        ></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </Accordion>
                


                {/* General Settings Area */}
                <Accordion title={t('settings')} icon="tune" defaultOpen={true}>
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <span className="material-symbols-outlined text-slate-400 text-[20px]">power_settings_new</span>
                                <span className="text-sm text-slate-300">{t('launchAtStartup')}</span>
                            </div>
                            <button
                                onClick={handleAutoLaunchToggle}
                                className={`relative w-11 h-6 rounded-full transition-colors duration-200 no-drag-region ${launchAtStartup ? 'bg-primary' : 'bg-slate-600'}`}
                            >
                                <span
                                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${launchAtStartup ? 'translate-x-5' : 'translate-x-0'}`}
                                />
                            </button>
                        </div>

                        <div className="w-full h-px opacity-50" style={{ backgroundColor: 'var(--theme-border)' }}></div>

                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <span className="material-symbols-outlined text-slate-400 text-[20px]">info</span>
                                <span className="text-sm text-slate-300">{showTooltips ? t('hideTooltips') : t('showTooltips')}</span>
                            </div>
                            <button
                                onClick={() => setShowTooltips(!showTooltips)}
                                className={`relative w-11 h-6 rounded-full transition-colors duration-200 no-drag-region ${showTooltips ? 'bg-primary' : 'bg-slate-600'}`}
                            >
                                <span
                                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${showTooltips ? 'translate-x-5' : 'translate-x-0'}`}
                                />
                            </button>
                        </div>

                        <div className="w-full h-px opacity-50" style={{ backgroundColor: 'var(--theme-border)' }}></div>

                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <span className="material-symbols-outlined text-slate-400 text-[20px]">visibility</span>
                                <span className="text-sm text-slate-300">{t('enableEyeAnimation')}</span>
                            </div>
                            <button
                                onClick={() => setEnableEyeAnimation(!enableEyeAnimation)}
                                className={`relative w-11 h-6 rounded-full transition-colors duration-200 no-drag-region ${enableEyeAnimation ? 'bg-primary' : 'bg-slate-600'}`}
                            >
                                <span
                                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${enableEyeAnimation ? 'translate-x-5' : 'translate-x-0'}`}
                                />
                            </button>
                        </div>


                        
                    </div>
                  </Accordion>

                {/* Update Center Section */}
                {!IS_STORE_BUILD && (
                    <Accordion title={(t as any)('updateCenter') || 'Update Center'} icon="update" defaultOpen={false}>
                        <div className="flex flex-col gap-4 no-drag-region">
                            <div className="flex flex-col gap-4">
                                {/* Current version label */}
                                <div className="flex items-center justify-between px-1">
                                    <span className="text-[11px] uppercase tracking-widest text-slate-500 font-bold">{t('version') || 'Version'}</span>
                                    <span className="text-xs font-mono font-semibold text-slate-300 bg-white/5 px-2 py-0.5 rounded-md border border-white/10">
                                        v{appVersion || '...'}
                                    </span>
                                </div>

                                <div className="w-full h-px opacity-30" style={{ backgroundColor: 'var(--theme-border)' }}></div>

                                {/* Custom Inline UI based on updateStatus */}
                                {updateStatus === 'idle' && (
                                    <div className="flex flex-col gap-3">
                                        <button
                                            onClick={handleCheckUpdatesInline}
                                            className="w-full py-2.5 px-4 rounded-xl border border-primary/20 bg-primary/5 hover:bg-primary/10 hover:border-primary/40 text-primary text-xs font-semibold flex items-center justify-center gap-2 transition-all duration-300 active:scale-[0.98] cursor-pointer"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">update</span>
                                            <span>{t('checkForUpdates') as string || 'Check for Updates'}</span>
                                        </button>
                                    </div>
                                )}

                                {updateStatus === 'checking' && (
                                    <div className="p-3 bg-white/5 border border-white/5 rounded-xl flex flex-col items-center justify-center gap-3">
                                        <span className="material-symbols-outlined text-primary text-[24px] animate-spin">sync</span>
                                        <span className="text-xs text-slate-300 font-medium">
                                            {t('checkingForUpdates') as string || 'Checking for updates...'}
                                        </span>
                                    </div>
                                )}

                                {updateStatus === 'upToDate' && (
                                    <div className="flex flex-col gap-4">
                                        <div className="p-3.5 bg-green-500/10 border border-green-500/20 rounded-xl flex items-start gap-3">
                                            <span className="material-symbols-outlined text-green-500 text-[20px] shrink-0 mt-0.5">check_circle</span>
                                            <div className="flex flex-col gap-0.5">
                                                <span className="text-xs text-green-400 font-bold">{t('appUpToDate') as string || 'App Up to Date'}</span>
                                                <span className="text-[11px] text-slate-400 leading-relaxed font-medium">
                                                    {t('alreadyLatest') as string || 'You are already using the latest version of KoBar.'}
                                                </span>
                                            </div>
                                        </div>
                                        <button
                                            onClick={handleCheckUpdatesInline}
                                            className="w-full py-2 px-3 rounded-lg border border-slate-700 hover:border-slate-500 bg-slate-800/40 text-slate-300 text-xs font-medium flex items-center justify-center gap-2 transition-all duration-300 active:scale-[0.98] cursor-pointer"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">sync</span>
                                            <span>{t('checkForUpdates') as string || 'Check Again'}</span>
                                        </button>
                                    </div>
                                )}

                                {updateStatus === 'available' && (
                                    <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl flex flex-col gap-3.5">
                                        <div className="flex items-start gap-3">
                                            <span className="material-symbols-outlined text-amber-500 text-[22px] shrink-0 mt-0.5">arrow_circle_down</span>
                                            <div className="flex flex-col gap-0.5">
                                                <span className="text-xs text-amber-400 font-bold">
                                                    {((t as any)('newVersionAvailable') || 'New Version Available: v{version}').replace('{version}', latestVersion)}
                                                </span>
                                                <span className="text-[11px] text-slate-400 leading-relaxed font-medium">
                                                    An update is ready for download. Click below to begin the installation process.
                                                </span>
                                            </div>
                                        </div>
                                        <button
                                            onClick={handleStartDownloadInline}
                                            className="w-full py-2.5 px-4 rounded-xl text-white text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-primary/20 transition-all duration-300 active:scale-[0.98] border border-primary/30 cursor-pointer"
                                            style={{
                                                background: 'linear-gradient(135deg, var(--theme-primary) 0%, rgba(var(--theme-primary-rgb), 0.8) 100%)'
                                            }}
                                        >
                                            <span className="material-symbols-outlined text-[18px]">download</span>
                                            <span>{(t as any)('downloadAndInstall') || 'Download & Install Update'}</span>
                                        </button>
                                    </div>
                                )}

                                {updateStatus === 'downloading' && (
                                    <div className="p-3.5 bg-white/5 border border-white/5 rounded-xl flex flex-col gap-3">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-slate-300 font-bold flex items-center gap-2">
                                                <span className="material-symbols-outlined text-[16px] text-primary animate-pulse">downloading</span>
                                                {((t as any)('downloadingUpdate') || 'Downloading Update...')}
                                            </span>
                                            <span className="text-xs font-mono font-bold text-primary">{downloadPercent}%</span>
                                        </div>

                                        {/* Premium Progress Bar */}
                                        <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-white/5 relative">
                                            <div 
                                                className="h-full rounded-full transition-all duration-300 shadow-[0_0_10px_rgba(var(--theme-primary-rgb),0.5)] relative overflow-hidden"
                                                style={{ 
                                                    width: `${downloadPercent}%`,
                                                    backgroundColor: 'var(--theme-primary)'
                                                }}
                                            >
                                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shine_2s_infinite]"></div>
                                            </div>
                                        </div>

                                        {/* Download Metadata */}
                                        <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 font-bold px-0.5">
                                            <span>{downloadedSize} of {totalSize}</span>
                                            <span>{downloadSpeed}</span>
                                        </div>
                                    </div>
                                )}

                                {updateStatus === 'downloaded' && (
                                    <div className="p-3.5 bg-green-500/10 border border-green-500/20 rounded-xl flex flex-col gap-3.5">
                                        <div className="flex items-start gap-3">
                                            <span className="material-symbols-outlined text-green-500 text-[22px] shrink-0 mt-0.5">task_alt</span>
                                            <div className="flex flex-col gap-0.5">
                                                <span className="text-xs text-green-400 font-bold">
                                                    {((t as any)('downloadComplete') || 'Download Complete!')}
                                                </span>
                                                <span className="text-[11px] text-slate-400 leading-relaxed font-medium">
                                                    {((t as any)('restartInstallDesc') || 'The update has been downloaded. Restart the application to apply the update.')}
                                                </span>
                                            </div>
                                        </div>
                                        <button
                                            onClick={handleQuitAndInstallInline}
                                            className="w-full py-2.5 px-4 rounded-xl text-white text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-green-500/20 transition-all duration-300 active:scale-[0.98] border border-green-500/30 cursor-pointer"
                                            style={{
                                                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                                            }}
                                        >
                                            <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                                            <span>{((t as any)('restartAndInstall') || 'Restart & Install Now')}</span>
                                        </button>
                                    </div>
                                )}

                                {updateStatus === 'error' && (
                                    <div className="p-3.5 bg-red-500/10 border border-red-500/20 rounded-xl flex flex-col gap-3.5">
                                        <div className="flex items-start gap-3">
                                            <span className="material-symbols-outlined text-red-500 text-[22px] shrink-0 mt-0.5">error</span>
                                            <div className="flex flex-col gap-0.5">
                                                <span className="text-xs text-red-400 font-bold">{t('updateError') as string || 'Update Failed'}</span>
                                                <span className="text-[11px] text-slate-400 leading-relaxed font-medium break-all font-mono">
                                                    {updateErrorMessage}
                                                </span>
                                            </div>
                                        </div>
                                        <button
                                            onClick={handleCheckUpdatesInline}
                                            className="w-full py-2 px-3 rounded-lg border border-red-500/20 hover:border-red-500/40 bg-red-500/5 hover:bg-red-500/10 text-red-400 text-xs font-medium flex items-center justify-center gap-2 transition-all duration-300 active:scale-[0.98] cursor-pointer"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">sync</span>
                                            <span>{t('checkForUpdates') as string || 'Try Checking Again'}</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </Accordion>
                )}

                {/* Export Data & Settings Section */}
                <Accordion title={t('exportDataSettings') as string || 'Export Data and Settings'} icon="database" defaultOpen={false}>
                    <div className="flex flex-col gap-4 px-1">
                        {/* Export Settings */}
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-sm text-slate-300 font-medium">{t('exportSettings') as string || 'Export Settings'}</span>
                                    <span className="text-xs text-slate-500">{t('exportSettingsDesc') as string || 'Backup your layout, themes, and feature toggles.'}</span>
                                </div>
                            </div>
                            <div className="flex gap-2 mt-1">
                                <button
                                    onClick={() => handleExport('settings', 'download')}
                                    className="flex-1 py-2 rounded-lg bg-black/20 border border-white/5 hover:bg-white/5 hover:border-primary/50 text-slate-300 hover:text-primary text-xs font-medium flex items-center justify-center gap-2 transition-all"
                                >
                                    <span className="material-symbols-outlined text-[16px]">download</span>
                                    {t('downloadJson') as string || 'Download JSON'}
                                </button>
                                <button
                                    onClick={() => handleExport('settings', 'email')}
                                    className="flex-1 py-2 rounded-lg bg-black/20 border border-white/5 hover:bg-white/5 hover:border-primary/50 text-slate-300 hover:text-primary text-xs font-medium flex items-center justify-center gap-2 transition-all"
                                >
                                    <span className="material-symbols-outlined text-[16px]">mail</span>
                                    {t('sendToEmail') as string || 'Send to Email'}
                                </button>
                                <input type="file" accept=".json" className="hidden" ref={importSettingsRef} onChange={(e) => handleImport('settings', e)} />
                                <button
                                    onClick={() => importSettingsRef.current?.click()}
                                    className="flex-1 py-2 rounded-lg bg-black/20 border border-white/5 hover:bg-white/5 hover:border-primary/50 text-slate-300 hover:text-primary text-xs font-medium flex items-center justify-center gap-2 transition-all"
                                >
                                    <span className="material-symbols-outlined text-[16px]">upload</span>
                                    {t('import') as string || 'Import'}
                                </button>
                            </div>
                        </div>

                        <div className="w-full h-px opacity-30" style={{ backgroundColor: 'var(--theme-border)' }}></div>

                        {/* Export Data */}
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-sm text-slate-300 font-medium">{t('exportData') as string || 'Export Data'}</span>
                                    <span className="text-xs text-slate-500">{t('exportDataDesc') as string || 'Backup your notes, calendar events, to-dos, and snippets.'}</span>
                                </div>
                            </div>
                            <div className="flex gap-2 mt-1">
                                <button
                                    onClick={() => handleExport('data', 'download')}
                                    className="flex-1 py-2 rounded-lg bg-black/20 border border-white/5 hover:bg-white/5 hover:border-primary/50 text-slate-300 hover:text-primary text-xs font-medium flex items-center justify-center gap-2 transition-all"
                                >
                                    <span className="material-symbols-outlined text-[16px]">download</span>
                                    {t('downloadJson') as string || 'Download JSON'}
                                </button>
                                <button
                                    onClick={() => handleExport('data', 'email')}
                                    className="flex-1 py-2 rounded-lg bg-black/20 border border-white/5 hover:bg-white/5 hover:border-primary/50 text-slate-300 hover:text-primary text-xs font-medium flex items-center justify-center gap-2 transition-all"
                                >
                                    <span className="material-symbols-outlined text-[16px]">mail</span>
                                    {t('sendToEmail') as string || 'Send to Email'}
                                </button>
                                <input type="file" accept=".json" className="hidden" ref={importDataRef} onChange={(e) => handleImport('data', e)} />
                                <button
                                    onClick={() => importDataRef.current?.click()}
                                    className="flex-1 py-2 rounded-lg bg-black/20 border border-white/5 hover:bg-white/5 hover:border-primary/50 text-slate-300 hover:text-primary text-xs font-medium flex items-center justify-center gap-2 transition-all"
                                >
                                    <span className="material-symbols-outlined text-[16px]">upload</span>
                                    {t('import') as string || 'Import'}
                                </button>
                            </div>
                        </div>
                    </div>
                </Accordion>

                {/* About Section */}
                <Accordion title={t('about')} icon="help_outline" defaultOpen={false}>
                    <div className="flex flex-col gap-5 px-1">
                        <div className="flex flex-col gap-2">
                            <span className="text-sm text-slate-300 font-medium">{t('aboutMaker')}</span>
                            <span className="text-xs text-slate-500 leading-relaxed font-medium">{t('aboutCredits')}</span>
                            <span className="text-xs text-slate-500 leading-relaxed font-medium">
                                {t('aboutContributors')}{' '}
                                <button
                                    onClick={() => window.api?.openExternal('https://github.com/arindam-sahoo')}
                                    className="text-primary hover:underline font-semibold transition-all cursor-pointer"
                                >
                                    Arindam Sahoo
                                </button>
                            </span>
                        </div>
                        
                        <div className="w-full h-px opacity-30" style={{ backgroundColor: 'var(--theme-border)' }}></div>

                        <div className="flex flex-col gap-2">
                             <p className="text-xs text-slate-400 leading-relaxed">
                                {t('aboutContact')}
                                <button 
                                    onClick={() => window.api?.openExternal('mailto:hello@kobar.org')}
                                    className="text-primary hover:underline ml-1 font-semibold transition-all cursor-pointer"
                                >
                                    hello@kobar.org
                                </button>
                            </p>
                             <p className="text-xs text-slate-400 leading-relaxed">
                                {t('aboutWebsite')}
                                <button 
                                    onClick={() => window.api?.openExternal('https://kobar.org')}
                                    className="text-primary hover:underline ml-1 font-semibold transition-all cursor-pointer"
                                >
                                    kobar.org
                                </button>
                            </p>
                        </div>

                        <div className="pt-2 flex items-center justify-between">
                            <span className="text-[10px] uppercase tracking-widest text-slate-600 font-bold">{t('version')}</span>
                            <span className="text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded-md border border-primary/20">{appVersion || '...'}</span>
                        </div>
                        
                        <div className="pt-1">
                            <button
                                onClick={() => window.api?.openExternal('https://patreon.com/kobarproject')}
                                className="w-full py-2.5 px-4 rounded-xl text-white text-xs font-bold flex items-center justify-center gap-2 shadow-lg transition-all duration-300 active:scale-[0.98] border border-[#FF424D]/30 cursor-pointer"
                                style={{ background: 'linear-gradient(135deg, #FF424D 0%, #D8313A 100%)' }}
                            >
                                <span className="material-symbols-outlined text-[16px]">favorite</span>
                                <span>{t('aboutPatreon')}</span>
                            </button>
                        </div>
                    </div>
                </Accordion>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsPanel;
