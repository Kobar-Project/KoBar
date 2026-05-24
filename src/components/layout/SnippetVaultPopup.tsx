import React, { useState, useMemo, useEffect, useRef } from 'react';
import CryptoJS from 'crypto-js';
import { useAppStore } from '../../store/useAppStore';
import type { Snippet } from '../../store/useAppStore';
import { useClipboardStore } from '../../store/useClipboardStore';

export const SnippetVaultPopup: React.FC = () => {
    const isSnippetVaultOpen = useAppStore(state => state.isSnippetVaultOpen);
    const setIsSnippetVaultOpen = useAppStore(state => state.setIsSnippetVaultOpen);
    const snippetVaultAnchorRect = useAppStore(state => state.snippetVaultAnchorRect);
    const edgePosition = useAppStore(state => state.edgePosition);
    const design = useAppStore(state => state.design);
    const glassOpacity = useAppStore(state => state.glassOpacity);
    const t = useAppStore(state => state.t);
    const isSmartPositioning = useAppStore(state => state.isPopupSmartPositioning);
    const isMac = useAppStore(state => state.isMac);

    const snippets = useAppStore(state => state.snippets);
    const addSnippet = useAppStore(state => state.addSnippet);
    const updateSnippet = useAppStore(state => state.updateSnippet);
    const deleteSnippet = useAppStore(state => state.deleteSnippet);
    const isCompact = useAppStore(state => state.isSnippetVaultCompact);
    const setIsCompact = useAppStore(state => state.setIsSnippetVaultCompact);

    const forceAddClipboardItem = useClipboardStore(state => state.forceAddClipboardItem);

    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = useState<'list' | 'form'>('list');
    const [editingSnippetId, setEditingSnippetId] = useState<string | null>(null);

    // Form states
    const [formTitle, setFormTitle] = useState('');
    const [formContent, setFormContent] = useState('');
    const [formTags, setFormTags] = useState('');
    const [formPassword, setFormPassword] = useState<string | undefined>(undefined);
    const [formColor, setFormColor] = useState<string | undefined>(undefined);
    const [showLockInput, setShowLockInput] = useState(false);

    // Prompt state
    const [unlockingId, setUnlockingId] = useState<string | null>(null);
    const [unlockPassword, setUnlockPassword] = useState('');
    const [unlockAction, setUnlockAction] = useState<(() => void) | null>(null);

    const SNIPPET_COLORS = [
        { name: t('colorDefault'), value: undefined, class: 'bg-slate-500' },
        { name: t('colorRed'), value: '#ef4444', class: 'bg-red-500' },
        { name: t('colorBlue'), value: '#3b82f6', class: 'bg-blue-500' },
        { name: t('colorGreen'), value: '#22c55e', class: 'bg-green-500' },
        { name: t('colorYellow'), value: '#eab308', class: 'bg-yellow-500' },
        { name: t('colorPurple'), value: '#a855f7', class: 'bg-purple-500' },
        { name: t('colorOrange'), value: '#f97316', class: 'bg-orange-500' },
    ];

    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [sentId, setSentId] = useState<string | null>(null);

    // Reset Search / state on close
    useEffect(() => {
        if (!isSnippetVaultOpen) {
            setViewMode('list');
            setSearchQuery('');
            setEditingSnippetId(null);
        }
    }, [isSnippetVaultOpen]);

    const screenBounds = useAppStore(state => state.screenBounds);
    const sidebarPosition = useAppStore(state => state.sidebarPosition);

    const orientation = useAppStore(state => state.orientation);

    const getPopupStyle = () => {
        if (!snippetVaultAnchorRect) return {};
        const popupHeight = 450;
        const popupWidth = 320;
        const screenHeight = screenBounds?.height ?? 800;
        const screenWidth = screenBounds?.width ?? 1200;
        const offsetTop = sidebarPosition ? sidebarPosition.y : 0;
        const offsetLeft = sidebarPosition ? sidebarPosition.x : 0;

        const isGlass = design === 'style2';
        const alpha = Math.round(glassOpacity * 255).toString(16).padStart(2, '0');
        const bgColor = isGlass ? `#1a1612${alpha}` : '#1a1612';

        const baseStyle: React.CSSProperties = {
            position: 'absolute',
            backgroundColor: bgColor,
            backdropFilter: isGlass ? (isMac ? 'blur(8px)' : 'blur(20px)') : 'none',
            WebkitBackdropFilter: isGlass ? (isMac ? 'blur(8px)' : 'blur(20px)') : 'none',
            border: isGlass ? '1px solid rgba(255, 255, 255, 0.05)' : 'none',
            boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
            zIndex: 99999,
            width: '320px',
            height: '450px',
            display: 'flex',
            flexDirection: 'column',
            willChange: 'transform, opacity'
        };

        const screenXInViewport = (screenBounds?.x ?? 0) - window.screenX;
        const screenYInViewport = (screenBounds?.y ?? 0) - window.screenY;

        if (orientation === "horizontal") {
            let adjustedLeft = (snippetVaultAnchorRect.left - offsetLeft) + (snippetVaultAnchorRect.width / 2) - (popupWidth / 2);
            const maxLeft = screenXInViewport + (screenWidth - offsetLeft) - popupWidth - 20;
            const minLeft = screenXInViewport - offsetLeft + 20;
            if (adjustedLeft < minLeft) adjustedLeft = minLeft;
            if (adjustedLeft > maxLeft) adjustedLeft = maxLeft;

            if (!isSmartPositioning) {
                baseStyle.left = '50%';
                baseStyle.transform = 'translateX(-50%)';
            } else {
                baseStyle.left = adjustedLeft;
            }

            if (edgePosition === 'top') {
                baseStyle.top = '100%';
                baseStyle.marginTop = '12px';
            } else {
                baseStyle.bottom = '100%';
                baseStyle.marginBottom = '12px';
            }
        } else {
            let adjustedTop = (snippetVaultAnchorRect.top - offsetTop) - 20 + (snippetVaultAnchorRect.height / 2) - (popupHeight / 2);
            const maxTop = screenYInViewport + (screenHeight - offsetTop) - popupHeight - 20;
            const minTop = screenYInViewport - offsetTop + 20;
            if (adjustedTop < minTop) adjustedTop = minTop;
            if (adjustedTop > maxTop) adjustedTop = maxTop;

            if (!isSmartPositioning) {
                baseStyle.top = '50%';
                baseStyle.transform = 'translateY(-50%)';
            } else {
                baseStyle.top = adjustedTop;
            }

            if (edgePosition === 'left') {
                baseStyle.left = '100%';
                baseStyle.marginLeft = '12px';
            } else {
                baseStyle.right = '100%';
                baseStyle.marginRight = '12px';
            }
        }

        return baseStyle;
    };

    const popupRef = React.useRef<HTMLDivElement>(null);
    const isSmartRef = useRef(isSmartPositioning);
    React.useEffect(() => { isSmartRef.current = isSmartPositioning; }, [isSmartPositioning]);

    React.useEffect(() => {
        const onDrag = (e: any) => {
            if (!popupRef.current || !snippetVaultAnchorRect || !isSmartRef.current) return;
            const newX = e.detail.x;
            const newY = e.detail.y;
            const popupHeight = 450;
            const popupWidth = 320;
            
            const screenXInViewport = (screenBounds?.x ?? 0) - window.screenX;
        const screenYInViewport = (screenBounds?.y ?? 0) - window.screenY;

        if (orientation === "horizontal") {
                const screenWidth = screenBounds?.width ?? 1200;
                let adjustedLeft = (snippetVaultAnchorRect.left - newX) + (snippetVaultAnchorRect.width / 2) - (popupWidth / 2);
                const maxLeft = screenXInViewport + (screenWidth - newX) - popupWidth - 20;
                const minLeft = screenXInViewport - newX + 20;
                if (adjustedLeft < minLeft) adjustedLeft = minLeft;
                if (adjustedLeft > maxLeft) adjustedLeft = maxLeft;
                popupRef.current.style.left = `${adjustedLeft}px`;

            } else {
                const screenHeight = screenBounds?.height ?? 800;
                let adjustedTop = (snippetVaultAnchorRect.top - newY) - 20 + (snippetVaultAnchorRect.height / 2) - (popupHeight / 2);
                const maxTop = screenYInViewport + (screenHeight - newY) - popupHeight - 20;
                const minTop = screenYInViewport - newY + 20;
                if (adjustedTop < minTop) adjustedTop = minTop;
                if (adjustedTop > maxTop) adjustedTop = maxTop;
                popupRef.current.style.top = `${adjustedTop}px`;

            }
        };
        document.addEventListener('kobar-drag', onDrag);
        return () => document.removeEventListener('kobar-drag', onDrag);
    }, [snippetVaultAnchorRect, screenBounds, orientation]);

    const handleCopy = (id: string, content: string) => {
        navigator.clipboard.writeText(content);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 1000);
    };

    const handleSendToSlot = (id: string, content: string) => {
        forceAddClipboardItem('text', content);
        setSentId(id);
        setTimeout(() => setSentId(null), 1000);
    };

    const openAddNew = () => {
        setEditingSnippetId(null);
        setFormTitle('');
        setFormContent('');
        setFormTags('');
        setFormPassword(undefined);
        setFormColor(undefined);
        setShowLockInput(false);
        setViewMode('form');
    };

    const openEdit = (snippet: Snippet) => {
        if (snippet.password) {
            setUnlockingId(snippet.id);
            setUnlockPassword('');
            setUnlockAction(() => () => {
                setEditingSnippetId(snippet.id);
                setFormTitle(snippet.title);
                let decrypted = snippet.content;
                try {
                    const bytes = CryptoJS.AES.decrypt(snippet.content, snippet.password!);
                    const decoded = bytes.toString(CryptoJS.enc.Utf8);
                    if (decoded) decrypted = decoded;
                } catch (e) { }
                setFormContent(decrypted);
                setFormTags(snippet.tags.join(', '));
                setFormPassword(snippet.password);
                setFormColor(snippet.color);
                setViewMode('form');
                setUnlockingId(null);
            });
            return;
        }
        setEditingSnippetId(snippet.id);
        setFormTitle(snippet.title);
        setFormContent(snippet.content);
        setFormTags(snippet.tags.join(', '));
        setFormPassword(snippet.password);
        setFormColor(snippet.color);
        setViewMode('form');
    };

    const checkLock = (snippet: Snippet, action: (content: string) => void) => {
        if (snippet.password) {
            setUnlockingId(snippet.id);
            setUnlockPassword('');
            setUnlockAction(() => () => {
                let decrypted = snippet.content;
                try {
                    const bytes = CryptoJS.AES.decrypt(snippet.content, snippet.password!);
                    const decoded = bytes.toString(CryptoJS.enc.Utf8);
                    if (decoded) decrypted = decoded;
                } catch (e) { }
                action(decrypted);
            });
            return;
        }
        action(snippet.content);
    };

    const handleSave = () => {
        if (!formTitle.trim() || !formContent.trim()) return;

        const tagsArray = formTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);

        let finalContent = formContent.trim();
        if (formPassword) {
            finalContent = CryptoJS.AES.encrypt(finalContent, formPassword).toString();
        }

        if (editingSnippetId) {
            updateSnippet(editingSnippetId, {
                title: formTitle.trim(),
                content: finalContent,
                tags: tagsArray,
                password: formPassword,
                color: formColor
            });
        } else {
            addSnippet({
                title: formTitle.trim(),
                content: finalContent,
                tags: tagsArray,
                password: formPassword,
                color: formColor
            });
        }
        setViewMode('list');
    };

    // Filter
    const filteredSnippets = useMemo(() => {
        if (!searchQuery.trim()) return snippets;
        const q = searchQuery.toLowerCase();
        return snippets.filter(s =>
            s.title.toLowerCase().includes(q) ||
            (!s.password && s.content.toLowerCase().includes(q)) ||
            s.tags.some(t => t.toLowerCase().includes(q))
        );
    }, [snippets, searchQuery]);

    if (!isSnippetVaultOpen) return null;

    return (
        <div
            ref={popupRef}
            className="rounded-xl overflow-hidden font-sans no-drag-region pointer-events-auto"
            style={getPopupStyle()}
            onMouseEnter={() => window.api?.setIgnoreMouseEvents?.(false)}
            onMouseLeave={() => window.api?.setIgnoreMouseEvents?.(true)}
        >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/20 shrink-0">
                <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">data_object</span>
                    <span className="text-slate-200 font-semibold">{t('snippetVaultHeader')}</span>
                    {viewMode === 'form' && (
                        <div className="relative flex items-center ml-2">
                            <button
                                onClick={() => {
                                    if (formPassword) {
                                        setFormPassword(undefined);
                                        setShowLockInput(false);
                                    } else {
                                        setShowLockInput(!showLockInput);
                                    }
                                }}
                                className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all ${formPassword ? 'bg-primary text-slate-900' : 'hover:bg-white/10 text-slate-400'}`}
                                title={t('passwordLock')}
                            >
                                <span className="material-symbols-outlined text-[18px]">
                                    {formPassword ? 'lock' : 'lock_open'}
                                </span>
                            </button>
                            {showLockInput && !formPassword && (
                                <div className="absolute left-8 top-0 w-32 animate-in fade-in slide-in-from-left-2 duration-200">
                                    <input
                                        autoFocus
                                        type="password"
                                        placeholder={t('setPasswordPlaceholder')}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                const val = (e.target as HTMLInputElement).value;
                                                if (val) setFormPassword(val);
                                                setShowLockInput(false);
                                            }
                                            if (e.key === 'Escape') setShowLockInput(false);
                                        }}
                                        onBlur={(e) => {
                                            const val = e.target.value;
                                            if (val) setFormPassword(val);
                                            setShowLockInput(false);
                                        }}
                                        className="w-full bg-[#2a241c] border border-primary/30 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-primary shadow-xl"
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <div className="flex gap-2">
                    {viewMode === 'list' && (
                        <>
                            <button
                                onClick={() => setIsCompact(!isCompact)}
                                className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${isCompact ? 'bg-primary/20 text-primary' : 'hover:bg-white/10 text-slate-400 hover:text-white'}`}
                                title={isCompact ? t('normalView') : t('compactView')}
                            >
                                <span className="material-symbols-outlined text-[18px]">
                                    {isCompact ? 'view_agenda' : 'segment'}
                                </span>
                            </button>
                            <button
                                onClick={openAddNew}
                                className="w-7 h-7 flex items-center justify-center rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
                            >
                                <span className="material-symbols-outlined text-[18px]">add</span>
                            </button>
                        </>
                    )}
                    <button
                        onClick={() => setIsSnippetVaultOpen(false)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>
            </div>

            {/* List View */}
            {viewMode === 'list' && (
                <div className="flex flex-col flex-1 overflow-hidden">
                    {/* Search Bar */}
                    <div className="p-3 shrink-0">
                        <div className="relative flex items-center">
                            <span className="material-symbols-outlined absolute left-3 text-slate-400 text-[18px]">search</span>
                            <input
                                type="text"
                                placeholder={t('searchPlaceholder')}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-black/30 border border-white/5 rounded-xl py-2 pl-9 pr-10 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-primary/50 pointer-events-auto select-auto"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-3 w-5 h-5 flex items-center justify-center rounded-full hover:bg-white/10 text-slate-400 hover:text-white transition-all animate-in fade-in zoom-in duration-200"
                                >
                                    <span className="material-symbols-outlined text-[16px]">close</span>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Scrollable Container */}
                    <div className="flex-1 overflow-y-auto px-3 pb-3 custom-scrollbar flex flex-col gap-2">
                        {filteredSnippets.length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-sm gap-2">
                                <span className="material-symbols-outlined text-[32px] opacity-50">search_off</span>
                                {searchQuery ? t('noMatchingSnippets') : t('noSnippetsYet')}
                            </div>
                        ) : (
                            filteredSnippets.map(snippet => isCompact ? (
                                // Compact Item
                                <div
                                    key={snippet.id}
                                    className={`rounded-lg p-2 px-3 flex items-center justify-between hover:brightness-125 transition-all group relative border ${snippet.color ? '' : 'bg-white/5 border-white/5'}`}
                                    style={{
                                        backgroundColor: snippet.color ? `${snippet.color}15` : undefined,
                                        borderColor: snippet.color ? `${snippet.color}40` : undefined
                                    }}
                                >
                                    <div className="flex-1 flex items-center gap-2 mr-2 truncate">
                                        {snippet.password && <span className="material-symbols-outlined text-[16px] text-primary shrink-0">lock</span>}
                                        <span className="text-slate-200 font-medium text-sm truncate">{snippet.title}</span>
                                    </div>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                        <button onClick={() => checkLock(snippet, (decrypted) => handleSendToSlot(snippet.id, decrypted))} className="p-1 rounded-md hover:bg-primary/20 text-slate-400 hover:text-primary transition-colors">
                                            <span className="material-symbols-outlined text-[16px]">
                                                {sentId === snippet.id ? 'check' : 'dynamic_feed'}
                                            </span>
                                        </button>
                                        <button onClick={() => checkLock(snippet, (decrypted) => handleCopy(snippet.id, decrypted))} className="p-1 rounded-md hover:bg-primary/20 text-slate-400 hover:text-primary transition-colors">
                                            <span className="material-symbols-outlined text-[16px]">
                                                {copiedId === snippet.id ? 'check' : 'content_copy'}
                                            </span>
                                        </button>
                                        <button onClick={() => openEdit(snippet)} className="p-1 rounded-md hover:bg-white/20 text-slate-400 hover:text-slate-200 transition-colors" title={t('edit')}>
                                            <span className="material-symbols-outlined text-[16px]">edit</span>
                                        </button>
                                        <button onClick={() => checkLock(snippet, () => deleteSnippet(snippet.id))} className="p-1 rounded-md hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors" title={t('deleteAction')}>
                                            <span className="material-symbols-outlined text-[16px]">delete</span>
                                        </button>
                                    </div>

                                    {/* Password Prompt Overlay */}
                                    {unlockingId === snippet.id && (
                                        <div className="absolute inset-0 bg-black/80 rounded-lg flex items-center px-2 py-1 z-10 gap-2">
                                            <input
                                                autoFocus
                                                type="password"
                                                placeholder={t('enterPasswordPlaceholder')}
                                                value={unlockPassword}
                                                onChange={(e) => setUnlockPassword(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        if (unlockPassword === snippet.password) {
                                                            unlockAction?.();
                                                            setUnlockingId(null);
                                                        } else {
                                                            setUnlockPassword('');
                                                        }
                                                    }
                                                    if (e.key === 'Escape') setUnlockingId(null);
                                                }}
                                                className="flex-1 bg-transparent border-none text-xs text-white focus:outline-none placeholder:text-slate-500 h-full"
                                            />
                                            <button onClick={() => setUnlockingId(null)} className="text-slate-400 hover:text-white shrink-0">
                                                <span className="material-symbols-outlined text-[16px]">close</span>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                // Normal Item
                                <div
                                    key={snippet.id}
                                    className={`rounded-lg p-3 flex flex-col gap-2 hover:brightness-125 transition-all group relative border ${snippet.color ? '' : 'bg-white/5 border-white/5'}`}
                                    style={{
                                        backgroundColor: snippet.color ? `${snippet.color}15` : undefined,
                                        borderColor: snippet.color ? `${snippet.color}40` : undefined
                                    }}
                                >
                                    {/* Top Row */}
                                    <div className="flex justify-between items-start gap-2 border-b border-white/10 pb-2 mb-1">
                                        <div className="flex items-center gap-2 truncate">
                                            {snippet.password && <span className="material-symbols-outlined text-[18px] text-primary shrink-0">lock</span>}
                                            <span className="text-slate-200 font-bold text-sm truncate">{snippet.title}</span>
                                        </div>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => checkLock(snippet, (decrypted) => handleSendToSlot(snippet.id, decrypted))} className="p-1 rounded-md hover:bg-primary/20 text-slate-400 hover:text-primary transition-colors" title={t('sendToSlot')}>
                                                <span className="material-symbols-outlined text-[16px]">
                                                    {sentId === snippet.id ? 'check' : 'dynamic_feed'}
                                                </span>
                                            </button>
                                            <button onClick={() => checkLock(snippet, (decrypted) => handleCopy(snippet.id, decrypted))} className="p-1 rounded-md hover:bg-primary/20 text-slate-400 hover:text-primary transition-colors" title={t('copyToOS')}>
                                                <span className="material-symbols-outlined text-[16px]">
                                                    {copiedId === snippet.id ? 'check' : 'content_copy'}
                                                </span>
                                            </button>
                                            <button onClick={() => openEdit(snippet)} className="p-1 rounded-md hover:bg-white/20 text-slate-400 hover:text-slate-200 transition-colors" title={t('edit')}>
                                                <span className="material-symbols-outlined text-[16px]">edit</span>
                                            </button>
                                            <button onClick={() => checkLock(snippet, () => deleteSnippet(snippet.id))} className="p-1 rounded-md hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors" title={t('deleteAction')}>
                                                <span className="material-symbols-outlined text-[16px]">delete</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Content Row */}
                                    <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed break-words italic">
                                        {snippet.password ? t('lockedContentDesc') : snippet.content}
                                    </p>

                                    {/* Tags Row */}
                                    {snippet.tags.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mt-1 pointer-events-auto">
                                            {snippet.tags.map((tag, idx) => (
                                                <span key={idx} className="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold rounded-md select-auto">
                                                    #{tag}
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    {/* Password Prompt Overlay */}
                                    {unlockingId === snippet.id && (
                                        <div className="absolute inset-0 bg-black/80 rounded-lg flex items-center justify-center p-4 z-10">
                                            <div className="flex-1 flex gap-2 items-center bg-[#1a1612] border border-primary/30 p-2 rounded-lg shadow-2xl animate-in zoom-in-95 duration-200">
                                                <span className="material-symbols-outlined text-[20px] text-primary">lock</span>
                                                <input
                                                    autoFocus
                                                    type="password"
                                                    placeholder={t('enterPasswordPlaceholder')}
                                                    value={unlockPassword}
                                                    onChange={(e) => setUnlockPassword(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            if (unlockPassword === snippet.password) {
                                                                unlockAction?.();
                                                                setUnlockingId(null);
                                                            } else {
                                                                setUnlockPassword('');
                                                            }
                                                        }
                                                        if (e.key === 'Escape') setUnlockingId(null);
                                                    }}
                                                    className="flex-1 bg-transparent border-none text-sm text-white focus:outline-none"
                                                />
                                                <button onClick={() => setUnlockingId(null)} className="text-slate-400 hover:text-white">
                                                    <span className="material-symbols-outlined text-[18px]">close</span>
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* Form View */}
            {viewMode === 'form' && (
                <div className="flex flex-col flex-1 overflow-hidden p-4 gap-4">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('titleLabel')}</label>
                        <input
                            type="text"
                            placeholder={t('titlePlaceholder')}
                            value={formTitle}
                            onChange={(e) => setFormTitle(e.target.value)}
                            className="bg-black/30 border border-white/5 rounded-lg p-2 text-sm text-slate-200 focus:outline-none focus:border-primary/50 pointer-events-auto select-auto"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5 flex-1">
                        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('contentLabel')}</label>
                        <textarea
                            placeholder={t('contentPlaceholder')}
                            value={formContent}
                            onChange={(e) => setFormContent(e.target.value)}
                            className="bg-black/30 border border-white/5 rounded-lg p-2 text-sm text-slate-200 focus:outline-none focus:border-primary/50 resize-none flex-1 pointer-events-auto select-auto"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('colorCategory')}</label>
                        <div className="flex gap-2 p-1">
                            {SNIPPET_COLORS.map(color => (
                                <button
                                    key={color.name}
                                    onClick={() => setFormColor(color.value)}
                                    className={`w-6 h-6 rounded-full transition-all border-2 ${color.class} ${formColor === color.value ? 'border-white scale-125 border-opacity-100' : 'border-transparent border-opacity-0 hover:scale-110'}`}
                                    title={color.name}
                                />
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('tagsLabel')}</label>
                        <input
                            type="text"
                            placeholder={t('tagsPlaceholder')}
                            value={formTags}
                            onChange={(e) => setFormTags(e.target.value)}
                            className="bg-black/30 border border-white/5 rounded-lg p-2 text-sm text-slate-200 focus:outline-none focus:border-primary/50 pointer-events-auto select-auto"
                        />
                    </div>

                    <div className="flex gap-2 pt-2">
                        <button
                            onClick={() => setViewMode('list')}
                            className="flex-1 py-2 rounded-lg bg-white/5 text-slate-300 hover:bg-white/10 transition-colors text-sm font-semibold pointer-events-auto"
                        >
                            {t('cancel')}
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={!formTitle.trim() || !formContent.trim()}
                            className="flex-1 py-2 rounded-lg bg-primary text-slate-900 hover:brightness-110 transition-all font-semibold text-sm disabled:opacity-50 pointer-events-auto"
                        >
                            {t('saveSnippet')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
