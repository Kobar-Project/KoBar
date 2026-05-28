import React, { useState, useRef, useEffect } from 'react';
import { useAppStore, applyCustomThemeCSS } from '../../store/useAppStore';
import { getLanguageOptions } from '../../i18n/translations';
import { hexToHsv, hsvToHex } from '../layout/ColorPickerPopup';
import { IS_STORE_BUILD } from '../../App';

const Accordion: React.FC<{
    title: string;
    icon: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
    masterToggle?: { isOn: boolean; onToggle: () => void };
}> = ({ title, icon, defaultOpen = true, children, masterToggle }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    const design = useAppStore(state => state.design);
    return (
        <div className="rounded-xl shadow-inner border overflow-hidden" 
            style={{ 
                backgroundColor: design === 'style2' ? 'rgba(255,255,255,0.03)' : 'var(--theme-bg-dark)', 
                borderColor: design === 'style2' ? 'rgba(255,255,255,0.05)' : 'var(--theme-border)' 
            }}
        >
            <div className="w-full flex items-center justify-between p-6">
                <button
                    className="flex-1 flex items-center gap-2 cursor-pointer hover:bg-black/10 transition-colors text-left"
                    onClick={() => setIsOpen(!isOpen)}
                >
                    <span className="material-symbols-outlined text-primary">{icon}</span>
                    <h3 className="text-lg font-medium text-slate-300">{title}</h3>
                </button>
                
                <div className="flex items-center gap-4">
                    {masterToggle && (
                        <button
                            onClick={masterToggle.onToggle}
                            className={`relative w-11 h-6 rounded-full transition-colors duration-200 no-drag-region shrink-0 ${masterToggle.isOn ? 'bg-primary' : 'bg-slate-600'}`}
                        >
                            <span
                                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${masterToggle.isOn ? 'translate-x-5' : 'translate-x-0'}`}
                            />
                        </button>
                    )}
                    <button onClick={() => setIsOpen(!isOpen)} className="cursor-pointer">
                        <span className={`material-symbols-outlined text-slate-400 text-[20px] transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                            expand_more
                        </span>
                    </button>
                </div>
            </div>
            {isOpen && (
                <div className="p-0 px-6 pb-6 mt-2 border-t pt-4" style={{ borderColor: 'var(--theme-border)' }}>
                    {children}
                </div>
            )}
        </div>
    );
};

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

    // --- Custom Theme Color Picker Link ---
    const currentColor = useAppStore(state => state.currentColor);
    const isColorPickerOpen = useAppStore(state => state.isColorPickerOpen);
    const [isThemePickerActive, setIsThemePickerActive] = useState(false);
    
    useEffect(() => {
        if (!isColorPickerOpen) setIsThemePickerActive(false);
    }, [isColorPickerOpen]);
    
    useEffect(() => {
        if (isThemePickerActive) {
            setCustomThemeColor(currentColor);
            applyCustomThemeCSS(currentColor);
        }
    }, [currentColor, isThemePickerActive]);
    const setLanguage = useAppStore(state => state.setLanguage);
    const t = useAppStore(state => state.t);
    const showTooltips = useAppStore(state => state.showTooltips);
    const setShowTooltips = useAppStore(state => state.setShowTooltips);
    const launchAtStartup = useAppStore(state => state.launchAtStartup);
    const enableEyeAnimation = useAppStore(state => state.enableEyeAnimation);
    const setEnableEyeAnimation = useAppStore(state => state.setEnableEyeAnimation);
    const setLaunchAtStartup = useAppStore(state => state.setLaunchAtStartup);
    const isShortcutsEnabled = useAppStore(state => state.isShortcutsEnabled);
    const setIsShortcutsEnabled = useAppStore(state => state.setIsShortcutsEnabled);
    const isCopyPasteEnabled = useAppStore(state => state.isCopyPasteEnabled);
    const setIsCopyPasteEnabled = useAppStore(state => state.setIsCopyPasteEnabled);
    const isScreenshotEnabled = useAppStore(state => state.isScreenshotEnabled);
    const setIsScreenshotEnabled = useAppStore(state => state.setIsScreenshotEnabled);
    const isFocusModeEnabled = useAppStore(state => state.isFocusModeEnabled);
    const setIsFocusModeEnabled = useAppStore(state => state.setIsFocusModeEnabled);
    const isCalculatorEnabled = useAppStore(state => state.isCalculatorEnabled);
    const setIsCalculatorEnabled = useAppStore(state => state.setIsCalculatorEnabled);
    const isColorPickerEnabled = useAppStore(state => state.isColorPickerEnabled);
    const setIsColorPickerEnabled = useAppStore(state => state.setIsColorPickerEnabled);
    const featureOrder = useAppStore(state => state.featureOrder);
    const setFeatureOrder = useAppStore(state => state.setFeatureOrder);
    const toggleWidth = useAppStore(state => state.toggleWidth);
    const setToggleWidth = useAppStore(state => state.setToggleWidth);
    const sidebarWidth = useAppStore(state => state.sidebarWidth);
    const setSidebarWidth = useAppStore(state => state.setSidebarWidth);
    const iconScale = useAppStore(state => state.iconScale);
    const setIconScale = useAppStore(state => state.setIconScale);
    const featureSpacing = useAppStore(state => state.featureSpacing);
    const setFeatureSpacing = useAppStore(state => state.setFeatureSpacing);
    const hideOnScreenshot = useAppStore(state => state.hideOnScreenshot);
    const setHideOnScreenshot = useAppStore(state => state.setHideOnScreenshot);
    const design = useAppStore(state => state.design);
    const setDesign = useAppStore(state => state.setDesign);
    const glassOpacity = useAppStore(state => state.glassOpacity);
    const setGlassOpacity = useAppStore(state => state.setGlassOpacity);
    const slotCount = useAppStore(state => state.slotCount);
    const setSlotCount = useAppStore(state => state.setSlotCount);
    const autoCopyColor = useAppStore(state => state.autoCopyColor);
    const setAutoCopyColor = useAppStore(state => state.setAutoCopyColor);
    const isTodoListEnabled = useAppStore(state => state.isTodoListEnabled);
    const setIsTodoListEnabled = useAppStore(state => state.setIsTodoListEnabled);
    const isPinInjectorEnabled = useAppStore(state => state.isPinInjectorEnabled);
    const setIsPinInjectorEnabled = useAppStore(state => state.setIsPinInjectorEnabled);
    const isKoBoxEnabled = useAppStore(state => state.isKoBoxEnabled);
    const setIsKoBoxEnabled = useAppStore(state => state.setIsKoBoxEnabled);
    const koBoxCleanupMode = useAppStore(state => state.koBoxCleanupMode);
    const setKoBoxCleanupMode = useAppStore(state => state.setKoBoxCleanupMode);
    const isSnippetVaultEnabled = useAppStore(state => state.isSnippetVaultEnabled);
    const setIsSnippetVaultEnabled = useAppStore(state => state.setIsSnippetVaultEnabled);
    const isAiHubEnabled = useAppStore(state => state.isAiHubEnabled);
    const setIsAiHubEnabled = useAppStore(state => state.setIsAiHubEnabled);
    const isKoPlayerEnabled = useAppStore(state => state.isKoPlayerEnabled);
    const setIsKoPlayerEnabled = useAppStore(state => state.setIsKoPlayerEnabled);
    const isKoCalendarEnabled = useAppStore(state => state.isKoCalendarEnabled);
    const setIsKoCalendarEnabled = useAppStore(state => state.setIsKoCalendarEnabled);

    const isPopupSmartPositioning = useAppStore(state => state.isPopupSmartPositioning);
    const setIsPopupSmartPositioning = useAppStore(state => state.setIsPopupSmartPositioning);
    const orientation = useAppStore(state => state.orientation);
    const setOrientation = useAppStore(state => state.setOrientation);

    // Workspaces
    const workspaces = useAppStore(state => state.workspaces);
    const saveCurrentAsWorkspace = useAppStore(state => state.saveCurrentAsWorkspace);
    const loadWorkspace = useAppStore(state => state.loadWorkspace);
    const deleteWorkspace = useAppStore(state => state.deleteWorkspace);
    const updateWorkspaceName = useAppStore(state => state.updateWorkspaceName);
    const updateWorkspaceSettings = useAppStore(state => state.updateWorkspaceSettings);

    const [isRenamingIdx, setIsRenamingIdx] = useState<number | null>(null);

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
    const [renameValue, setRenameValue] = useState('');
    const [newPresetName, setNewPresetName] = useState('');

    // Dynamic Extensions State & Handlers
    const [installedExtensions, setInstalledExtensions] = useState<any[]>([]);
    const [availableExtensions, setAvailableExtensions] = useState<any[]>([]);
    const [extensionsSubTab, setExtensionsSubTab] = useState<'installed' | 'marketplace'>('installed');
    const [extsLoading, setExtsLoading] = useState(false);
    const triggerExtensionReload = useAppStore(state => state.triggerExtensionReload);

    const loadExtensionsData = async () => {
        setExtsLoading(true);
        try {
            if (window.api?.getInstalledExtensions) {
                const installed = await window.api.getInstalledExtensions();
                setInstalledExtensions(installed);
            }
            if (window.api?.getAvailableExtensions) {
                const available = await window.api.getAvailableExtensions();
                setAvailableExtensions(available);
            }
        } catch (e) {
            console.error('Failed to load extensions data:', e);
        } finally {
            setExtsLoading(false);
        }
    };

    useEffect(() => {
        loadExtensionsData();
    }, []);

    const handleToggleExtension = async (id: string, enabled: boolean) => {
        if (window.api?.toggleExtensionEnabled) {
            await window.api.toggleExtensionEnabled(id, enabled);
            triggerExtensionReload();
            loadExtensionsData();
        }
    };

    const handleInstallExtension = async (id: string) => {
        if (window.api?.installExtension) {
            setExtsLoading(true);
            await window.api.installExtension(id);
            triggerExtensionReload();
            await loadExtensionsData();
        }
    };

    const handleUninstallExtension = async (id: string) => {
        if (window.api?.uninstallExtension) {
            setExtsLoading(true);
            await window.api.uninstallExtension(id);
            triggerExtensionReload();
            await loadExtensionsData();
        }
    };
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

    const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);
    const featureViewMode = useAppStore(state => state.settingsFeatureViewMode);
    const setFeatureViewMode = useAppStore(state => state.setSettingsFeatureViewMode);
    const workspaceViewMode = useAppStore(state => state.settingsWorkspaceViewMode);
    const setWorkspaceViewMode = useAppStore(state => state.setSettingsWorkspaceViewMode);
    const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

    const handleAutoLaunchToggle = () => {
        setLaunchAtStartup(!launchAtStartup);
    };

    const handleSlotCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val)) {
            setSlotCount(Math.min(20, Math.max(4, val)));
        }
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

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        setDraggedItemIndex(index);
        
        // Use the entire row as the drag image
        const row = (e.currentTarget as HTMLElement).closest('.feature-row');
        if (row && e.dataTransfer.setDragImage) {
            e.dataTransfer.setDragImage(row, 20, row.clientHeight / 2);
        }

        // Required for Firefox
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index.toString());
        
        // Slight delay to apply opacity to the row
        setTimeout(() => {
            if (row instanceof HTMLElement) {
                row.style.opacity = '0.4';
            }
        }, 0);
    };

    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        e.preventDefault();
        if (draggedItemIndex === null || draggedItemIndex === index) return;

        const newOrder = [...featureOrder];
        const draggedItem = newOrder[draggedItemIndex];
        newOrder.splice(draggedItemIndex, 1);
        newOrder.splice(index, 0, draggedItem);

        setFeatureOrder(newOrder);
        setDraggedItemIndex(index); // Update dragged index to the new position
    };

    const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
        setDraggedItemIndex(null);
        const row = (e.currentTarget as HTMLElement).closest('.feature-row');
        if (row instanceof HTMLElement) {
            row.style.opacity = '1';
        }
    };
    
    // ─── Feature Card View Helpers ───
    const toggleCardExpanded = (id: string) => {
        setExpandedCards(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const getFeatureMeta = (id: string): { icon: string; title: string; isEnabled: boolean; onToggle: () => void } | null => {
        switch (id) {
            case 'shortcuts': return { icon: 'bolt', title: t('shortcuts'), isEnabled: isShortcutsEnabled, onToggle: () => setIsShortcutsEnabled(!isShortcutsEnabled) };
            case 'copypaste': return { icon: 'content_paste', title: t('copyAndPaste'), isEnabled: isCopyPasteEnabled, onToggle: () => setIsCopyPasteEnabled(!isCopyPasteEnabled) };
            case 'screenshot': return { icon: 'photo_camera', title: t('screenshot'), isEnabled: isScreenshotEnabled, onToggle: () => setIsScreenshotEnabled(!isScreenshotEnabled) };
            case 'focusmode': return { icon: 'hourglass_empty', title: t('focusMode'), isEnabled: isFocusModeEnabled, onToggle: () => setIsFocusModeEnabled(!isFocusModeEnabled) };
            case 'calculator': return { icon: 'calculate', title: t('calculator'), isEnabled: isCalculatorEnabled, onToggle: () => setIsCalculatorEnabled(!isCalculatorEnabled) };
            case 'colorpicker': return { icon: 'palette', title: t('colorPicker'), isEnabled: isColorPickerEnabled, onToggle: () => setIsColorPickerEnabled(!isColorPickerEnabled) };
            case 'todolist': return { icon: 'checklist', title: t('todoList'), isEnabled: isTodoListEnabled, onToggle: () => setIsTodoListEnabled(!isTodoListEnabled) };
            case 'kocalendar': return { icon: 'calendar_month', title: (t as any)('koCalendar') || 'Calendar', isEnabled: isKoCalendarEnabled, onToggle: () => setIsKoCalendarEnabled(!isKoCalendarEnabled) };
            case 'pininjector': return { icon: 'push_pin', title: t('pinToTop'), isEnabled: isPinInjectorEnabled, onToggle: () => setIsPinInjectorEnabled(!isPinInjectorEnabled) };
            case 'kobox': return { icon: 'inventory_2', title: t('kobox'), isEnabled: isKoBoxEnabled, onToggle: () => setIsKoBoxEnabled(!isKoBoxEnabled) };
            case 'snippetvault': return { icon: 'library_books', title: t('snippetVault'), isEnabled: isSnippetVaultEnabled, onToggle: () => setIsSnippetVaultEnabled(!isSnippetVaultEnabled) };
            case 'aihub': return { icon: 'smart_toy', title: t('aiHub'), isEnabled: isAiHubEnabled, onToggle: () => setIsAiHubEnabled(!isAiHubEnabled) };
            case 'koplayer': return { icon: 'music_note', title: 'KoPlayer', isEnabled: isKoPlayerEnabled, onToggle: () => setIsKoPlayerEnabled(!isKoPlayerEnabled) };
            default: return null;
        }
    };

    const renderCardExpandedContent = (id: string): React.ReactNode => {
        switch (id) {
            case 'shortcuts':
                return (
                    <div className="text-sm text-slate-400">
                        {language === 'tr' 
                            ? 'Kısayollar menüsüne sürükleyip bırakarak favori uygulamalarınızı, klasörlerinizi veya web bağlantılarınızı ekleyebilirsiniz. Kısayol ekleme sınırı yoktur.' 
                            : 'Drag and drop files, folders, apps, or links into the shortcut menu for instant access. There is no limit to how many shortcuts you can pin.'}
                    </div>
                );
            case 'copypaste':
                return (
                    <div className="flex flex-col gap-3">
                        <div className="flex justify-between items-center">
                            <label className="text-sm text-slate-400 font-medium">{t('numberOfSlots')}</label>
                            <span className="text-lg font-bold text-primary">{slotCount}</span>
                        </div>
                        <input type="range" min="4" max="20" value={slotCount} onChange={handleSlotCountChange}
                            onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}
                            onDragStart={(e) => e.stopPropagation()} draggable={false}
                            className={`w-full h-2 rounded-lg appearance-none cursor-pointer mt-1 no-drag-region ${design === 'style2' ? 'bg-white/10' : 'bg-slate-700'}`}
                            style={{ accentColor: 'var(--theme-primary)' }}
                        />
                        <p className="text-xs text-slate-500 mt-2">{t('slotsMinMaxInfo')}</p>
                    </div>
                );
            case 'screenshot':
                return (
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col gap-1">
                                <span className="text-sm text-slate-300 font-medium">{t('hideOnScreenshot')}</span>
                                <span className="text-xs text-slate-500 leading-tight pr-4">{t('hideOnScreenshotDesc')}</span>
                            </div>
                            <button onClick={() => setHideOnScreenshot(!hideOnScreenshot)}
                                className={`relative w-11 h-6 rounded-full transition-colors duration-200 no-drag-region shrink-0 ${hideOnScreenshot ? 'bg-primary' : 'bg-slate-600'}`}>
                                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${hideOnScreenshot ? 'translate-x-5' : 'translate-x-0'}`} />
                            </button>
                        </div>
                    </div>
                );
            case 'focusmode':
                return <p className="text-sm text-slate-400">{(t as any)('focusModeDesc') || 'Pomodoro-style focus timer to boost your productivity.'}</p>;
            case 'calculator':
                return <p className="text-sm text-slate-400">{(t as any)('calculatorDesc') || 'Quick-access calculator for everyday math.'}</p>;
            case 'colorpicker':
                return (
                    <div className={`flex flex-col gap-4 ${!isCopyPasteEnabled ? 'opacity-50' : ''}`}>
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col gap-1">
                                <span className="text-sm text-slate-300 font-medium">{t('autoAddClipboard')}</span>
                                <span className="text-xs text-slate-500 leading-tight">{t('autoAddClipboardDesc')}</span>
                                {!isCopyPasteEnabled && <span className="text-[10px] text-red-400 mt-1">{t('requiresCopyPaste')}</span>}
                            </div>
                            <button onClick={() => setAutoCopyColor(!autoCopyColor)} disabled={!isCopyPasteEnabled}
                                className={`relative w-11 h-6 rounded-full transition-colors duration-200 no-drag-region shrink-0 ${autoCopyColor && isCopyPasteEnabled ? 'bg-primary' : 'bg-slate-600'}`}>
                                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${autoCopyColor && isCopyPasteEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                            </button>
                        </div>
                    </div>
                );
            case 'todolist':
                return <div className="text-sm text-slate-400">{t('todoListDesc')}</div>;
            case 'kocalendar':
                return <p className="text-sm text-slate-400">Manage your local events and schedule. Add due dates to your Todos to see them on the calendar.</p>;
            case 'pininjector':
                return <div className="text-sm text-slate-400">{t('pinToTopDesc')}</div>;
            case 'kobox':
                return (
                    <div className="flex flex-col gap-3">
                        <label className="text-sm text-slate-400 font-medium">{t('cleanupMode')}</label>
                        <div className="flex bg-black/20 p-1 rounded-xl border border-white/5 no-drag-region">
                            <button onClick={() => setKoBoxCleanupMode('24h')}
                                className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${koBoxCleanupMode === '24h' ? 'bg-primary text-slate-900 shadow-md' : 'text-slate-400 hover:text-slate-200'}`}>
                                {t('clearEvery24h')}
                            </button>
                            <button onClick={() => setKoBoxCleanupMode('quit')}
                                className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${koBoxCleanupMode === 'quit' ? 'bg-primary text-slate-900 shadow-md' : 'text-slate-400 hover:text-slate-200'}`}>
                                {t('clearOnQuit')}
                            </button>
                        </div>
                    </div>
                );
            case 'snippetvault':
                return <div className="text-sm text-slate-400">{t('snippetVaultDesc')}</div>;
            case 'aihub':
                return <div className="text-sm text-slate-400">{t('aiHubDesc')}</div>;
            case 'koplayer':
                return <p className="text-sm text-slate-400">Global media controller. See what's playing and control playback (Play, Pause, Next, Previous) from any media source on your system.</p>;
            default: return null;
        }
    };

    const renderFeatureCard = (id: string, index: number) => {
        const meta = getFeatureMeta(id);
        if (!meta) return null;

        const isExpanded = expandedCards.has(id);
        const expandedContent = renderCardExpandedContent(id);
        const hasExpandedContent = expandedContent !== null;

        return (
            <div
                key={id}
                onDragEnter={(e) => handleDragEnter(e, index)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => e.preventDefault()}
                className="feature-row relative rounded-xl border overflow-hidden transition-all duration-300"
                style={{
                    backgroundColor: design === 'style2' ? 'rgba(255,255,255,0.03)' : 'var(--theme-bg-dark)',
                    borderColor: meta.isEnabled
                        ? 'rgba(34, 197, 94, 0.25)'
                        : design === 'style2' ? 'rgba(255,255,255,0.05)' : 'var(--theme-border)',
                    boxShadow: meta.isEnabled
                        ? '0 0 24px -6px rgba(34, 197, 94, 0.35), inset 0 1px 0 rgba(34, 197, 94, 0.08)'
                        : '0 0 24px -6px rgba(239, 68, 68, 0.22), inset 0 1px 0 rgba(239, 68, 68, 0.05)',
                    gridColumn: isExpanded ? '1 / -1' : undefined,
                    transform: draggedItemIndex === index ? 'scale(1.05)' : 'none',
                    zIndex: draggedItemIndex === index ? 50 : 'auto',
                    position: 'relative',
                }}
            >
                {/* Drag handle */}
                <div
                    draggable
                    onDragStart={(e: any) => handleDragStart(e, index)}
                    className="absolute top-1.5 left-1/2 -translate-x-1/2 opacity-0 hover:opacity-50 cursor-move no-drag-region z-10 transition-opacity"
                >
                    <span className="material-symbols-outlined text-[14px] text-slate-400">drag_indicator</span>
                </div>

                {/* Card body */}
                <div className={`flex ${isExpanded ? 'flex-row items-center gap-4 p-4' : 'flex-col items-center gap-3 p-5 pt-7'}`}>
                    {/* Icon */}
                    <div
                        className={`${isExpanded ? 'w-10 h-10' : 'w-12 h-12'} rounded-xl flex items-center justify-center shrink-0 transition-all duration-300`}
                        style={{ backgroundColor: meta.isEnabled ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.08)' }}
                    >
                        <span
                            className={`material-symbols-outlined ${isExpanded ? 'text-[20px]' : 'text-[24px]'} transition-colors duration-300`}
                            style={{ color: meta.isEnabled ? '#22c55e' : '#6b7280' }}
                        >
                            {meta.icon}
                        </span>
                    </div>

                    {/* Title */}
                    <span className={`text-sm font-medium text-slate-300 ${isExpanded ? '' : 'text-center leading-tight min-h-[2.5rem] flex items-center'}`}>
                        {meta.title}
                    </span>

                    {isExpanded && <div className="flex-1" />}

                    {/* Toggle */}
                    <button
                        onClick={meta.onToggle}
                        className={`relative w-11 h-6 rounded-full transition-colors duration-200 no-drag-region shrink-0 ${meta.isEnabled ? 'bg-green-500' : 'bg-slate-600'}`}
                    >
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${meta.isEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>

                    {/* More/Less button */}
                    {hasExpandedContent && (
                        <button
                            onClick={() => toggleCardExpanded(id)}
                            className={`flex items-center gap-1 text-xs transition-colors no-drag-region ${isExpanded ? 'text-primary ml-2' : 'text-slate-500 hover:text-primary mt-1'}`}
                        >
                            <span>{isExpanded ? (language === 'tr' ? 'Gizle' : 'Less') : (language === 'tr' ? 'Detaylar' : 'More')}</span>
                            <span className={`material-symbols-outlined text-[14px] transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
                                expand_more
                            </span>
                        </button>
                    )}
                </div>

                {/* Expanded settings area */}
                {isExpanded && hasExpandedContent && (
                    <div
                        className="px-5 pb-5 pt-3 border-t"
                        style={{ borderColor: design === 'style2' ? 'rgba(255,255,255,0.05)' : 'var(--theme-border)' }}
                    >
                        {expandedContent}
                    </div>
                )}
            </div>
        );
    };

    // Helper to render accordion based on ID
    const renderFeatureAccordion = (id: string, index: number) => {
        let content = null;
        
        switch (id) {
            case 'shortcuts':
                content = (
                    <Accordion 
                        title={t('shortcuts')}
                        icon="bolt" 
                        defaultOpen={false}
                        masterToggle={{ isOn: isShortcutsEnabled, onToggle: () => setIsShortcutsEnabled(!isShortcutsEnabled) }}
                    >
                        <div className="text-sm text-slate-400 px-1">
                            {language === 'tr' 
                                ? 'Kısayollar menüsüne sürükleyip bırakarak favori uygulamalarınızı, klasörlerinizi veya web bağlantılarınızı ekleyebilirsiniz. Kısayol ekleme sınırı yoktur.' 
                                : 'Drag and drop files, folders, apps, or links into the shortcut menu for instant access. There is no limit to how many shortcuts you can pin.'}
                        </div>
                    </Accordion>
                );
                break;
            case 'copypaste':
                content = (
                    <Accordion 
                        title={t('copyAndPaste')} 
                        icon="content_paste" 
                        defaultOpen={false}
                        masterToggle={{ isOn: isCopyPasteEnabled, onToggle: () => setIsCopyPasteEnabled(!isCopyPasteEnabled) }}
                    >
                        <div className="flex flex-col gap-3">
                            <div className="flex justify-between items-center">
                                <label className="text-sm text-slate-400 font-medium">{t('numberOfSlots')}</label>
                                <span className="text-lg font-bold text-primary">{slotCount}</span>
                            </div>
                            <input
                                type="range"
                                min="4"
                                max="20"
                                value={slotCount}
                                onChange={handleSlotCountChange}
                                onMouseDown={(e) => e.stopPropagation()}
                                onTouchStart={(e) => e.stopPropagation()}
                                onDragStart={(e) => e.stopPropagation()}
                                draggable={false}
                                className={`w-full h-2 rounded-lg appearance-none cursor-pointer mt-1 no-drag-region ${design === 'style2' ? 'bg-white/10' : 'bg-slate-700'}`}
                                style={{ accentColor: 'var(--theme-primary)' }}
                            />
                            <p className="text-xs text-slate-500 mt-2">{t('slotsMinMaxInfo')}</p>
                        </div>
                    </Accordion>
                );
                break;
            case 'screenshot':
                content = (
                    <Accordion 
                        title={t('screenshot')} 
                        icon="photo_camera" 
                        defaultOpen={false}
                        masterToggle={{ isOn: isScreenshotEnabled, onToggle: () => setIsScreenshotEnabled(!isScreenshotEnabled) }}
                    >
                        <div className="flex flex-col gap-4 px-1">
                            <div className="flex items-center justify-between">
                                <div className="flex flex-col gap-1">
                                    <span className="text-sm text-slate-300 font-medium">{t('hideOnScreenshot')}</span>
                                    <span className="text-xs text-slate-500 leading-tight pr-4">{t('hideOnScreenshotDesc')}</span>
                                </div>
                                <button
                                    onClick={() => setHideOnScreenshot(!hideOnScreenshot)}
                                    className={`relative w-11 h-6 rounded-full transition-colors duration-200 no-drag-region shrink-0 ${hideOnScreenshot ? 'bg-primary' : 'bg-slate-600'}`}
                                >
                                    <span
                                        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${hideOnScreenshot ? 'translate-x-5' : 'translate-x-0'}`}
                                    />
                                </button>
                            </div>
                        </div>
                    </Accordion>
                );
                break;
            case 'focusmode':
                content = (
                    <Accordion 
                        title={t('focusMode')} 
                        icon="hourglass_empty" 
                        defaultOpen={false}
                        masterToggle={{ isOn: isFocusModeEnabled, onToggle: () => setIsFocusModeEnabled(!isFocusModeEnabled) }}
                    >
                        <div className="text-sm text-slate-400">
                             {/* Focus Mode specific settings */}
                        </div>
                    </Accordion>
                );
                break;
            case 'calculator':
                content = (
                    <Accordion 
                        title={t('calculator')} 
                        icon="calculate" 
                        defaultOpen={false}
                        masterToggle={{ isOn: isCalculatorEnabled, onToggle: () => setIsCalculatorEnabled(!isCalculatorEnabled) }}
                    >
                        <div className="text-sm text-slate-400">
                             {/* Calculator specific settings */}
                        </div>
                    </Accordion>
                );
                break;
            case 'colorpicker':
                content = (
                    <Accordion 
                        title={t('colorPicker')} 
                        icon="palette" 
                        defaultOpen={false}
                        masterToggle={{ isOn: isColorPickerEnabled, onToggle: () => setIsColorPickerEnabled(!isColorPickerEnabled) }}
                    >
                        <div className={`flex flex-col gap-4 px-1 ${!isCopyPasteEnabled ? 'opacity-50' : ''}`}>
                            <div className="flex items-center justify-between">
                                <div className="flex flex-col gap-1">
                                    <span className="text-sm text-slate-300 font-medium">{t('autoAddClipboard')}</span>
                                    <span className="text-xs text-slate-500 leading-tight">{t('autoAddClipboardDesc')}</span>
                                    {!isCopyPasteEnabled && <span className="text-[10px] text-red-400 mt-1">{t('requiresCopyPaste')}</span>}
                                </div>
                                <button
                                    onClick={() => setAutoCopyColor(!autoCopyColor)}
                                    disabled={!isCopyPasteEnabled}
                                    className={`relative w-11 h-6 rounded-full transition-colors duration-200 no-drag-region shrink-0 ${autoCopyColor && isCopyPasteEnabled ? 'bg-primary' : 'bg-slate-600'}`}
                                >
                                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${autoCopyColor && isCopyPasteEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                                </button>
                            </div>
                        </div>
                    </Accordion>
                );
                break;
            case 'todolist':
                content = (
                    <Accordion 
                        title={t('todoList')} 
                        icon="checklist" 
                        defaultOpen={false}
                        masterToggle={{ isOn: isTodoListEnabled, onToggle: () => setIsTodoListEnabled(!isTodoListEnabled) }}
                    >
                        <div className="flex flex-col gap-4 px-1 text-sm text-slate-400">
                            {t('todoListDesc')}
                        </div>
                    </Accordion>
                );
                break;
            case 'kocalendar':
                content = (
                    <Accordion 
                        title={(t as any)('koCalendar') || 'Calendar'} 
                        icon="calendar_month" 
                        defaultOpen={false}
                        masterToggle={{ isOn: isKoCalendarEnabled, onToggle: () => setIsKoCalendarEnabled(!isKoCalendarEnabled) }}
                    >
                        <div className="flex flex-col gap-4 px-1 text-sm text-slate-400">
                            <p>Manage your local events and schedule. Add due dates to your Todos to see them on the calendar.</p>
                        </div>
                    </Accordion>
                );
                break;
            case 'pininjector':
                content = (
                    <Accordion 
                        title={t('pinToTop')} 
                        icon="push_pin" 
                        defaultOpen={false}
                        masterToggle={{ isOn: isPinInjectorEnabled, onToggle: () => setIsPinInjectorEnabled(!isPinInjectorEnabled) }}
                    >
                        <div className="flex flex-col gap-4 px-1 text-sm text-slate-400">
                            {t('pinToTopDesc')}
                        </div>
                    </Accordion>
                );
                break;
            case 'kobox':
                content = (
                    <Accordion 
                        title={t('kobox')} 
                        icon="inventory_2" 
                        defaultOpen={false}
                        masterToggle={{ isOn: isKoBoxEnabled, onToggle: () => setIsKoBoxEnabled(!isKoBoxEnabled) }}
                    >
                        <div className="flex flex-col gap-3 px-1">
                            <label className="text-sm text-slate-400 font-medium pt-2">{t('cleanupMode')}</label>
                            <div className="flex bg-black/20 p-1 rounded-xl border border-white/5 no-drag-region">
                                <button
                                    onClick={() => setKoBoxCleanupMode('24h')}
                                    className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${koBoxCleanupMode === '24h'
                                        ? 'bg-primary text-slate-900 shadow-md'
                                        : 'text-slate-400 hover:text-slate-200'
                                    }`}
                                >
                                    {t('clearEvery24h')}
                                </button>
                                <button
                                    onClick={() => setKoBoxCleanupMode('quit')}
                                    className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${koBoxCleanupMode === 'quit'
                                        ? 'bg-primary text-slate-900 shadow-md'
                                        : 'text-slate-400 hover:text-slate-200'
                                    }`}
                                >
                                    {t('clearOnQuit')}
                                </button>
                            </div>
                        </div>
                    </Accordion>
                );
                break;
            case 'snippetvault':
                content = (
                    <Accordion 
                        title={t('snippetVault')} 
                        icon="library_books" 
                        defaultOpen={false}
                        masterToggle={{ isOn: isSnippetVaultEnabled, onToggle: () => setIsSnippetVaultEnabled(!isSnippetVaultEnabled) }}
                    >
                        <div className="flex flex-col gap-4 px-1 text-sm text-slate-400 pt-2">
                            {t('snippetVaultDesc')}
                        </div>
                    </Accordion>
                );
                break;
            case 'aihub':
                content = (
                    <Accordion 
                        title={t('aiHub')} 
                        icon="smart_toy" 
                        defaultOpen={false}
                        masterToggle={{ isOn: isAiHubEnabled, onToggle: () => setIsAiHubEnabled(!isAiHubEnabled) }}
                    >
                        <div className="flex flex-col gap-4 px-1 text-sm text-slate-400 pt-2">
                            {t('aiHubDesc')}
                        </div>
                    </Accordion>
                );
                break;
            case 'koplayer':
                content = (
                    <Accordion 
                        title="KoPlayer" 
                        icon="music_note" 
                        defaultOpen={false}
                        masterToggle={{ isOn: isKoPlayerEnabled, onToggle: () => setIsKoPlayerEnabled(!isKoPlayerEnabled) }}
                    >
                        <div className="flex flex-col gap-4 px-1 text-sm text-slate-400 pt-2">
                            Global media controller. See what's playing and control playback (Play, Pause, Next, Previous) from any media source on your system.
                        </div>
                    </Accordion>
                );
                break;
            default: return null;
        }

        return (
            <div 
                key={id}
                onDragEnter={(e) => handleDragEnter(e, index)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => e.preventDefault()}
                className="transition-transform feature-row"
                style={{ 
                    transform: draggedItemIndex === index ? 'scale(1.02)' : 'none',
                    zIndex: draggedItemIndex === index ? 50 : 'auto',
                    position: 'relative'
                }}
            >
                {/* Visual drag handle indicator - NOW THE EXCLUSIVE DRAG TRIGGER */}
                <div 
                    draggable
                    onDragStart={(e: any) => handleDragStart(e, index)}
                    className="absolute left-[-32px] top-1/2 -translate-y-1/2 opacity-30 hover:opacity-100 flex items-center justify-center p-2 cursor-move no-drag-region"
                >
                    <span className="material-symbols-outlined text-[20px]">drag_indicator</span>
                </div>
                {content}
            </div>
        );
    };

    const handleExport = (type: 'settings' | 'data', method: 'download' | 'email') => {
        const state = useAppStore.getState();
        let payload: any = {};
        
        if (type === 'settings') {
            payload = {
                theme: state.theme,
                customThemeColor: state.customThemeColor,
                language: state.language,
                focusSettings: state.focusSettings,
                showTooltips: state.showTooltips,
                sidebarWidth: state.sidebarWidth,
                iconScale: state.iconScale,
                teleportShortcut: state.teleportShortcut,
                launchAtStartup: state.launchAtStartup,
                enableEyeAnimation: state.enableEyeAnimation,
                isShortcutsEnabled: state.isShortcutsEnabled,
                maxShortcuts: state.maxShortcuts,
                isCopyPasteEnabled: state.isCopyPasteEnabled,
                isScreenshotEnabled: state.isScreenshotEnabled,
                hideOnScreenshot: state.hideOnScreenshot,
                isFocusModeEnabled: state.isFocusModeEnabled,
                isCalculatorEnabled: state.isCalculatorEnabled,
                isColorPickerEnabled: state.isColorPickerEnabled,
                isKoCalendarEnabled: state.isKoCalendarEnabled,
                isTodoListEnabled: state.isTodoListEnabled,
                isPinInjectorEnabled: state.isPinInjectorEnabled,
                isKoBoxEnabled: state.isKoBoxEnabled,
                isSnippetVaultEnabled: state.isSnippetVaultEnabled,
                isAiHubEnabled: state.isAiHubEnabled,
                isKoPlayerEnabled: state.isKoPlayerEnabled,
                koBoxCleanupMode: state.koBoxCleanupMode,
                autoCopyColor: state.autoCopyColor,
                colorPalettes: state.colorPalettes,
                featureOrder: state.featureOrder,
                design: state.design,
                glassOpacity: state.glassOpacity,
                slotCount: state.slotCount,
                aiHubHeight: state.aiHubHeight,
                koCalendarColor: state.koCalendarColor,
                workspaces: state.workspaces,
                isSnippetVaultCompact: state.isSnippetVaultCompact,
                isCalculatorScientific: state.isCalculatorScientific,
                settingsFeatureViewMode: state.settingsFeatureViewMode,
                settingsWorkspaceViewMode: state.settingsWorkspaceViewMode,
                orientation: state.orientation,
                edgePosition: state.edgePosition,
            };
        } else {
            payload = {
                notes: state.notes.filter(n => !isSystemTab(n)),
                pinnedApps: state.pinnedApps,
                todos: state.todos,
                snippets: state.snippets,
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
                    
                    const mergedPinnedApps = [...state.pinnedApps];
                    (parsed.pinnedApps || []).forEach((app: any) => {
                        if (!mergedPinnedApps.find(a => a.path === app.path)) {
                            mergedPinnedApps.push(app);
                        }
                    });

                    const mergedTodos = [...state.todos, ...(parsed.todos || []).map((t: any) => ({ ...t, id: Date.now().toString() + Math.random() }))];
                    const mergedSnippets = [...state.snippets, ...(parsed.snippets || []).map((s: any) => ({ ...s, id: crypto.randomUUID() }))];
                    const mergedLocalEvents = [...state.localEvents, ...(parsed.localEvents || []).map((ev: any) => ({ ...ev, id: Date.now().toString() + '-' + Math.floor(Math.random() * 1000) }))];

                    useAppStore.setState({
                        notes: [...state.notes, ...importedNotes],
                        nextNoteId: nextId,
                        pinnedApps: mergedPinnedApps,
                        todos: mergedTodos,
                        snippets: mergedSnippets,
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
                {/* --- WORKSPACES SECTION --- */}
                <div>
                    <div className="flex items-center justify-between mb-4 px-2">
                        <h3 className="text-sm uppercase tracking-wider text-slate-500 font-semibold">{(t as any)('workspaces') || 'Workspaces'}</h3>
                        <button
                            onClick={() => setWorkspaceViewMode(workspaceViewMode === 'list' ? 'cards' : 'list')}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all no-drag-region border hover:brightness-125"
                            style={{
                                backgroundColor: design === 'style2' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.2)',
                                borderColor: design === 'style2' ? 'rgba(255,255,255,0.08)' : 'var(--theme-border)',
                                color: 'var(--theme-primary)',
                            }}
                        >
                            <span className="material-symbols-outlined text-[16px]">
                                {workspaceViewMode === 'list' ? 'grid_view' : 'view_list'}
                            </span>
                            {workspaceViewMode === 'list'
                                ? (language === 'tr' ? 'Kartlar' : 'Cards')
                                : (language === 'tr' ? 'Liste' : 'List')}
                        </button>
                    </div>

                    {workspaceViewMode === 'list' ? (
                        /* ─── LIST (Accordion) VIEW ─── */
                        <div className="space-y-4 mb-10">
                            <Accordion title={(t as any)('workspaces') || 'Workspaces'} icon="switch_access_shortcut" defaultOpen={true}>
                                <div className="flex flex-col gap-6">
                                    <p className="text-sm text-slate-400">{(t as any)('workspacesDesc') || 'Save and load your favorite KoBar configurations.'}</p>
                                    
                                    <div className="flex flex-col gap-3">
                                        {workspaces.map((preset, idx) => (
                                            <div key={preset.id} className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${design === 'style2' ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-black/20 border-[#2a241c] hover:border-primary/30'}`}>
                                                
                                                {isRenamingIdx === idx ? (
                                                    <input 
                                                        autoFocus
                                                        type="text" 
                                                        value={renameValue}
                                                        onChange={e => setRenameValue(e.target.value)}
                                                        onBlur={() => {
                                                            if (renameValue.trim()) {
                                                                updateWorkspaceName(preset.id, renameValue.trim());
                                                            }
                                                            setIsRenamingIdx(null);
                                                        }}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                if (renameValue.trim()) {
                                                                    updateWorkspaceName(preset.id, renameValue.trim());
                                                                }
                                                                setIsRenamingIdx(null);
                                                            }
                                                            if (e.key === 'Escape') {
                                                                setIsRenamingIdx(null);
                                                            }
                                                        }}
                                                        className="flex-1 bg-transparent border-b border-primary text-sm text-white focus:outline-none px-1 py-0.5 no-drag-region mr-4"
                                                    />
                                                ) : (
                                                    <div 
                                                        className="flex-1 flex items-center gap-2 cursor-pointer group no-drag-region"
                                                        onClick={() => loadWorkspace(preset.id)}
                                                        title={(t as any)('loadWorkspace') || 'Load'}
                                                    >
                                                        <span className="material-symbols-outlined text-[18px] text-primary">play_circle</span>
                                                        <span className="text-sm font-medium text-slate-200 group-hover:text-primary transition-colors">{preset.name}</span>
                                                    </div>
                                                )}

                                                <div className="flex items-center gap-1 no-drag-region">
                                                    <button 
                                                        onClick={() => updateWorkspaceSettings(preset.id)}
                                                        className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-green-400 hover:bg-green-400/10 transition-colors"
                                                        title={(t as any)('updateWorkspaceSettings') || 'Update Settings'}
                                                    >
                                                        <span className="material-symbols-outlined text-[16px]">save</span>
                                                    </button>
                                                    <button 
                                                        onClick={() => {
                                                            setIsRenamingIdx(idx);
                                                            setRenameValue(preset.name);
                                                        }}
                                                        className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                                                        title={(t as any)('renameWorkspace') || 'Rename'}
                                                    >
                                                        <span className="material-symbols-outlined text-[16px]">edit</span>
                                                    </button>
                                                    <button 
                                                        onClick={() => deleteWorkspace(preset.id)}
                                                        className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                                                        title={(t as any)('deleteWorkspace') || 'Delete'}
                                                    >
                                                        <span className="material-symbols-outlined text-[16px]">delete</span>
                                                    </button>
                                                </div>
                                            </div>
                                        ))}

                                        {workspaces.length === 0 && (
                                            <div className="p-4 border border-dashed border-white/10 rounded-lg text-center text-slate-500 text-sm">
                                                {language === 'tr' ? 'Henüz kayıtlı preset yok.' : 'No presets saved yet.'}
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex gap-2 items-center mt-2 no-drag-region">
                                        <input 
                                            type="text" 
                                            value={newPresetName}
                                            onChange={e => setNewPresetName(e.target.value)}
                                            placeholder={(t as any)('workspaceNamePlaceholder') || 'Preset name...'}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && newPresetName.trim()) {
                                                    saveCurrentAsWorkspace(newPresetName.trim());
                                                    setNewPresetName('');
                                                }
                                            }}
                                            className="flex-1 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition-colors"
                                        />
                                        <button
                                            onClick={() => {
                                                if (newPresetName.trim()) {
                                                    saveCurrentAsWorkspace(newPresetName.trim());
                                                    setNewPresetName('');
                                                }
                                            }}
                                            disabled={!newPresetName.trim()}
                                            className="px-4 py-2 bg-primary/20 text-primary border border-primary/50 hover:bg-primary/30 rounded-lg text-sm font-medium transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {(t as any)('saveCurrentSettings') || 'Save Current Settings'}
                                        </button>
                                    </div>
                                </div>
                            </Accordion>
                        </div>
                    ) : (
                        /* ─── CARD VIEW ─── */
                        <div className="mb-10 space-y-4">
                            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                                {workspaces.map((preset, idx) => (
                                    <div
                                        key={preset.id}
                                        className="relative rounded-xl border overflow-hidden transition-all duration-300"
                                        style={{
                                            backgroundColor: design === 'style2' ? 'rgba(255,255,255,0.03)' : 'var(--theme-bg-dark)',
                                            borderColor: 'rgba(96, 165, 250, 0.2)',
                                            boxShadow: '0 0 24px -6px rgba(96, 165, 250, 0.25), inset 0 1px 0 rgba(96, 165, 250, 0.08)',
                                        }}
                                    >
                                        <div className="flex flex-col items-center gap-3 p-5 pt-6">
                                            {/* Icon */}
                                            <div
                                                className="w-12 h-12 rounded-xl flex items-center justify-center"
                                                style={{ backgroundColor: 'rgba(96, 165, 250, 0.12)' }}
                                            >
                                                <span className="material-symbols-outlined text-[24px]" style={{ color: '#60a5fa' }}>
                                                    tune
                                                </span>
                                            </div>

                                            {/* Name */}
                                            {isRenamingIdx === idx ? (
                                                <input
                                                    autoFocus
                                                    type="text"
                                                    value={renameValue}
                                                    onChange={e => setRenameValue(e.target.value)}
                                                    onBlur={() => {
                                                        if (renameValue.trim()) updateWorkspaceName(preset.id, renameValue.trim());
                                                        setIsRenamingIdx(null);
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            if (renameValue.trim()) updateWorkspaceName(preset.id, renameValue.trim());
                                                            setIsRenamingIdx(null);
                                                        }
                                                        if (e.key === 'Escape') setIsRenamingIdx(null);
                                                    }}
                                                    className="w-full bg-transparent border-b border-primary text-sm text-white text-center focus:outline-none px-1 py-0.5 no-drag-region"
                                                />
                                            ) : (
                                                <span className="text-sm font-medium text-slate-300 text-center leading-tight min-h-[1.25rem]">
                                                    {preset.name}
                                                </span>
                                            )}

                                            {/* Action buttons */}
                                            <div className="flex items-center gap-1 no-drag-region mt-1">
                                                <button
                                                    onClick={() => loadWorkspace(preset.id)}
                                                    className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-green-400 hover:bg-green-400/10 transition-colors"
                                                    title={(t as any)('loadWorkspace') || 'Load'}
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">play_circle</span>
                                                </button>
                                                <button
                                                    onClick={() => updateWorkspaceSettings(preset.id)}
                                                    className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-blue-400 hover:bg-blue-400/10 transition-colors"
                                                    title={(t as any)('updateWorkspaceSettings') || 'Update'}
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">save</span>
                                                </button>
                                                <button
                                                    onClick={() => { setIsRenamingIdx(idx); setRenameValue(preset.name); }}
                                                    className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                                                    title={(t as any)('renameWorkspace') || 'Rename'}
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">edit</span>
                                                </button>
                                                <button
                                                    onClick={() => deleteWorkspace(preset.id)}
                                                    className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                                                    title={(t as any)('deleteWorkspace') || 'Delete'}
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">delete</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}

                                {/* Add new workspace card */}
                                <div
                                    className="relative rounded-xl border-2 border-dashed overflow-hidden transition-all duration-300 cursor-pointer group no-drag-region"
                                    style={{
                                        borderColor: design === 'style2' ? 'rgba(255,255,255,0.08)' : 'var(--theme-border)',
                                    }}
                                    onClick={() => {
                                        if (newPresetName.trim()) {
                                            saveCurrentAsWorkspace(newPresetName.trim());
                                            setNewPresetName('');
                                        }
                                    }}
                                >
                                    <div className="flex flex-col items-center justify-center gap-3 p-5 pt-6 min-h-[160px]">
                                        <div
                                            className="w-12 h-12 rounded-xl flex items-center justify-center transition-colors group-hover:bg-primary/20"
                                            style={{ backgroundColor: design === 'style2' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.2)' }}
                                        >
                                            <span className="material-symbols-outlined text-[24px] text-slate-500 group-hover:text-primary transition-colors">add</span>
                                        </div>
                                        <input
                                            type="text"
                                            value={newPresetName}
                                            onChange={e => setNewPresetName(e.target.value)}
                                            onClick={e => e.stopPropagation()}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && newPresetName.trim()) {
                                                    saveCurrentAsWorkspace(newPresetName.trim());
                                                    setNewPresetName('');
                                                }
                                            }}
                                            placeholder={language === 'tr' ? 'Preset adı...' : 'Preset name...'}
                                            className="w-full bg-transparent border-b border-white/10 focus:border-primary text-sm text-white text-center focus:outline-none px-1 py-1 no-drag-region transition-colors"
                                        />
                                        <span className="text-[11px] text-slate-500 group-hover:text-primary transition-colors">
                                            {language === 'tr' ? 'Yeni Kaydet' : 'Save New'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {workspaces.length === 0 && (
                                <p className="text-sm text-slate-500 text-center px-2">
                                    {(t as any)('workspacesDesc') || 'Save and load your favorite KoBar configurations.'}
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* --- TOP SECTION: Dynamic Features --- */}
                <div>
                    <div className="flex items-center justify-between mb-4 px-2">
                        <h3 className="text-sm uppercase tracking-wider text-slate-500 font-semibold">{t('featureToggles')}</h3>
                        <button
                            onClick={() => setFeatureViewMode(featureViewMode === 'list' ? 'cards' : 'list')}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all no-drag-region border hover:brightness-125"
                            style={{
                                backgroundColor: design === 'style2' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.2)',
                                borderColor: design === 'style2' ? 'rgba(255,255,255,0.08)' : 'var(--theme-border)',
                                color: 'var(--theme-primary)',
                            }}
                        >
                            <span className="material-symbols-outlined text-[16px]">
                                {featureViewMode === 'list' ? 'grid_view' : 'view_list'}
                            </span>
                            {featureViewMode === 'list'
                                ? (language === 'tr' ? 'Kartlar' : 'Cards')
                                : (language === 'tr' ? 'Liste' : 'List')}
                        </button>
                    </div>
                    {featureViewMode === 'list' ? (
                        <div className="space-y-4">
                            {featureOrder.map((id, index) => renderFeatureAccordion(id, index))}
                        </div>
                    ) : (
                        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                            {featureOrder.map((id, index) => renderFeatureCard(id, index))}
                        </div>
                    )}
                </div>

                <div className="w-full h-px opacity-20" style={{ backgroundColor: 'var(--theme-border)' }}></div>

                {/* --- EXTENSIONS SECTION --- */}
                <div>
                    <h3 className="text-sm uppercase tracking-wider text-slate-500 font-semibold mb-4 px-2">Extensions</h3>
                    <Accordion title="Extensions Manager" icon="extension" defaultOpen={true}>
                        <div className="flex flex-col gap-6 no-drag-region">
                            {/* Sub-tabs */}
                            <div className="flex bg-black/20 p-1 rounded-xl border border-white/5">
                                <button
                                    onClick={() => setExtensionsSubTab('installed')}
                                    className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${extensionsSubTab === 'installed' ? 'bg-primary text-slate-900 shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
                                >
                                    Installed
                                </button>
                                <button
                                    onClick={() => setExtensionsSubTab('marketplace')}
                                    className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${extensionsSubTab === 'marketplace' ? 'bg-primary text-slate-900 shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
                                >
                                    Marketplace
                                </button>
                            </div>

                            {/* Extensions Loading Indicator */}
                            {extsLoading && (
                                <div className="flex items-center justify-center p-8">
                                    <span className="material-symbols-outlined text-primary text-[24px] animate-spin">sync</span>
                                </div>
                            )}

                            {/* Installed Extensions Sub-tab */}
                            {!extsLoading && extensionsSubTab === 'installed' && (
                                <div className="space-y-4">
                                    {installedExtensions.length === 0 ? (
                                        <div className="p-6 border border-dashed border-white/10 rounded-xl text-center text-slate-500 text-sm">
                                            No extensions installed yet. Visit the Marketplace to explore!
                                        </div>
                                    ) : (
                                        installedExtensions.map((ext) => (
                                            <div key={ext.id} className="flex items-center justify-between p-4 rounded-xl border border-[#2a241c] bg-black/20 hover:border-primary/30 transition-all">
                                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                                                        <span className="material-symbols-outlined text-primary text-[20px]">{ext.icon || 'extension'}</span>
                                                    </div>
                                                    <div className="flex flex-col min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-sm font-semibold text-slate-200 truncate">{ext.name}</span>
                                                            <span className="text-[10px] font-mono text-slate-500 shrink-0">v{ext.version}</span>
                                                        </div>
                                                        <span className="text-xs text-slate-400 leading-normal truncate max-w-xs">{ext.description}</span>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-3 shrink-0">
                                                    {/* Enable/Disable Toggle */}
                                                    <button
                                                        onClick={() => handleToggleExtension(ext.id, !ext.enabled)}
                                                        className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${ext.enabled ? 'bg-green-500' : 'bg-slate-600'}`}
                                                    >
                                                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${ext.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                                                    </button>

                                                    {/* Uninstall Button */}
                                                    <button
                                                        onClick={() => handleUninstallExtension(ext.id)}
                                                        className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                                                        title="Uninstall"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">delete</span>
                                                    </button>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}

                            {/* Marketplace Sub-tab */}
                            {!extsLoading && extensionsSubTab === 'marketplace' && (
                                <div className="space-y-4">
                                    {availableExtensions.map((ext) => {
                                        const isInstalled = installedExtensions.some(i => i.id === ext.id);
                                        return (
                                            <div key={ext.id} className="flex items-center justify-between p-4 rounded-xl border border-[#2a241c] bg-black/20 hover:border-primary/30 transition-all">
                                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                                                        <span className="material-symbols-outlined text-primary text-[20px]">{ext.icon || 'extension'}</span>
                                                    </div>
                                                    <div className="flex flex-col min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-sm font-semibold text-slate-200 truncate">{ext.name}</span>
                                                            <span className="text-[10px] font-mono text-slate-500 shrink-0">v{ext.version}</span>
                                                        </div>
                                                        <span className="text-xs text-slate-400 leading-normal truncate max-w-xs">{ext.description}</span>
                                                    </div>
                                                </div>

                                                <div className="shrink-0">
                                                    {isInstalled ? (
                                                        <span className="text-xs font-medium text-green-400 bg-green-500/10 border border-green-500/20 px-2.5 py-1 rounded-lg">
                                                            Installed
                                                        </span>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleInstallExtension(ext.id)}
                                                            className="px-3 py-1.5 bg-primary/20 text-primary border border-primary/50 hover:bg-primary/30 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all"
                                                        >
                                                            <span className="material-symbols-outlined text-[14px]">download</span>
                                                            Download
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </Accordion>
                </div>

                <div className="w-full h-px opacity-20" style={{ backgroundColor: 'var(--theme-border)' }}></div>

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
