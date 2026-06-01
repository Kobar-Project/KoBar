import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import { usePluginChatStore } from './usePluginChatStore';

const ResizerHandle = ({ direction, edgePosition, startDrag }) => {
    const React = window.React;
    const directionClasses = (() => {
        switch (direction) {
            case 'side':
                return `absolute top-0 bottom-0 w-6 cursor-ew-resize ${edgePosition === 'right' ? 'left-0 -ml-3' : 'right-0 -mr-3'}`;
            case 'bottom':
                return 'absolute bottom-0 left-0 right-0 h-6 -mb-3 cursor-ns-resize';
            case 'corner':
                return `absolute bottom-0 w-6 h-6 -mb-3 cursor-nwse-resize ${edgePosition === 'right' ? 'left-0 -ml-3' : 'right-0 -mr-3'}`;
        }
    })();
    return (
        <div
            onMouseDown={(e) => startDrag(e, direction)}
            className={`${directionClasses} resizer-handle hover:bg-[#f4a125]/30 transition-colors z-50 [-webkit-app-region:no-drag] bg-black/1`}
        />
    );
};

const MODELS = [
    { id: 'anthropic:claude-sonnet-4-6', label: 'Claude 4.6 Sonnet (Anthropic - Best)' },
    { id: 'anthropic:claude-opus-4-6', label: 'Claude 4.6 Opus (Anthropic - Heavy)' },
    { id: 'anthropic:claude-haiku-4-5-20251001', label: 'Claude 4.5 Haiku (Anthropic - Fast)' },
    { id: 'local:llama3', label: 'Local Default (Ollama / LM Studio)' },
    { id: 'local:llava', label: 'Local Vision (Ollama - LLaVA)' }
];

export const AiHubPanel = ({ onClose, anchorRect }) => {
    const React = window.React;
    const { useState, useEffect, useRef } = React;
    const useAppStore = window.useAppStore;

    const edgePosition = useAppStore(state => state.edgePosition);
    const design = useAppStore(state => state.design);
    const glassOpacity = useAppStore(state => state.glassOpacity);
    const tGlobal = useAppStore(state => state.t);
    const isMac = useAppStore(state => state.isMac);
    const screenBounds = useAppStore(state => state.screenBounds);
    const sidebarPosition = useAppStore(state => state.sidebarPosition);
    const orientation = useAppStore(state => state.orientation);

    const { 
        chats, activeChatId, apiKeys, setActiveChatId, createChat, 
        deleteChat, addMessage, appendStreamToMessage, updateChatTitle, 
        aiAvatar, userAvatar, setAiAvatar, setUserAvatar 
    } = usePluginChatStore();

    const [input, setInput] = useState('');
    const [attachments, setAttachments] = useState([]);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatingMessageId, setGeneratingMessageId] = useState(null);
    const [showSettings, setShowSettings] = useState(false);

    const [aiHubWidth, setAiHubWidth] = useState(600);
    const [aiHubHeight, setAiHubHeight] = useState(600);
    const [isSmartPositioning] = useState(true);

    const inputRef = useRef(null);
    const popupRef = useRef(null);
    const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
    
    // Title Editing State
    const [editingChatId, setEditingChatId] = useState(null);
    const [editTitle, setEditTitle] = useState('');
    const editInputRef = useRef(null);

    const messagesScrollRef = useRef(null);
    const bottomRef = useRef(null);
    const activeChat = chats.find(c => c.id === activeChatId) || null;

    useEffect(() => {
        if (!activeChatId && chats.length > 0) setActiveChatId(chats[0].id);
        else if (chats.length === 0) createChat(); 
    }, []);

    useEffect(() => {
        if (isAutoScrollEnabled && messagesScrollRef.current) {
            messagesScrollRef.current.scrollTo({
                top: messagesScrollRef.current.scrollHeight,
                behavior: 'auto'
            });
        }
    }, [activeChat?.messages.length, activeChat?.messages[activeChat?.messages.length - 1]?.content, isAutoScrollEnabled]);

    const getPopupStyle = () => {
        if (!anchorRect) return { display: 'none' };
        
        const screenHeight = screenBounds?.height ?? 800;
        const screenWidth = screenBounds?.width ?? 1200;
        const offsetTop = sidebarPosition ? sidebarPosition.y : 0;
        const offsetLeft = sidebarPosition ? sidebarPosition.x : 0;

        const style = {
            position: 'absolute',
            zIndex: 99999,
            width: `${aiHubWidth}px`,
            height: `${aiHubHeight}px`,
            display: 'flex',
            flexDirection: 'row', 
            backgroundColor: design === 'style2' 
                ? `color-mix(in srgb, var(--theme-bg-dark) ${glassOpacity}%, transparent)` 
                : 'var(--theme-bg-dark)',
            borderColor: design === 'style2' ? 'rgba(255, 255, 255, 0.1)' : 'var(--theme-border)',
            borderWidth: '1px',
            borderStyle: 'solid',
            backdropFilter: design === 'style2' ? (isMac ? 'blur(8px)' : 'blur(20px)') : 'none',
            WebkitBackdropFilter: design === 'style2' ? (isMac ? 'blur(8px)' : 'blur(20px)') : 'none',
            boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
            maxHeight: `${Math.floor((screenBounds?.height ?? 800) - 60)}px`,
            willChange: 'transform, opacity' 
        };

        const screenXInViewport = (screenBounds?.x ?? 0) - window.screenX;
        const screenYInViewport = (screenBounds?.y ?? 0) - window.screenY;

        if (orientation === "horizontal") {
            let adjustedLeft = (anchorRect.left - offsetLeft) + (anchorRect.width / 2) - (aiHubWidth / 2);
            const maxLeft = screenXInViewport + (screenWidth - offsetLeft) - aiHubWidth - 20;
            const minLeft = screenXInViewport - offsetLeft + 20;
            if (adjustedLeft < minLeft) adjustedLeft = minLeft;
            if (adjustedLeft > maxLeft) adjustedLeft = maxLeft;

            if (!isSmartPositioning) {
                style.left = '50%';
                style.transform = 'translateX(-50%)';
            } else {
                style.left = adjustedLeft;
            }

            if (edgePosition === 'top') {
                style.top = '100%';
                style.marginTop = '12px';
            } else {
                style.bottom = '100%';
                style.marginBottom = '12px';
            }
        } else {
            let adjustedTop = (anchorRect.top - offsetTop) - 20 + (anchorRect.height / 2) - (aiHubHeight / 2);
            const maxTop = screenYInViewport + (screenHeight - offsetTop) - aiHubHeight - 20;
            const minTop = screenYInViewport - offsetTop + 20;
            if (adjustedTop < minTop) adjustedTop = minTop;
            if (adjustedTop > maxTop) adjustedTop = maxTop;

            if (!isSmartPositioning) {
                style.top = '50%';
                style.transform = 'translateY(-50%)';
            } else {
                style.top = adjustedTop;
            }

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

    const handleAvatarUpload = (e, type) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result;
            if (type === 'ai') setAiAvatar(base64);
            else setUserAvatar(base64);
        };
        reader.readAsDataURL(file);
    };

    const startDrag = (e, direction) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const startW = aiHubWidth;
        const startH = aiHubHeight;

        const onMouseMove = (moveEvent) => {
            let newW = startW;
            let newH = startH;
            if (direction === 'side' || direction === 'corner') {
                const deltaX = edgePosition === 'right' ? startX - moveEvent.clientX : moveEvent.clientX - startX;
                newW = Math.max(300, startW + deltaX);
            }
            if (direction === 'bottom' || direction === 'corner') {
                const deltaY = moveEvent.clientY - startY;
                newH = Math.max(400, startH + deltaY);
            }
            setAiHubWidth(newW);
            setAiHubHeight(newH);
        };
        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    const handleSend = async () => {
        if (!input.trim() && attachments.length === 0) return;
        if (isGenerating) return;

        let currentChatId = activeChatId;
        const selectedModelString = activeChat?.model || 'openai:gpt-4o';
        const [provider, model] = selectedModelString.split(':');

        if (!currentChatId || !activeChat) {
            currentChatId = createChat(selectedModelString);
            setActiveChatId(currentChatId);
        }

        const userMsgId = crypto.randomUUID();
        let attArray = undefined;

        if (attachments.length > 0) {
            attArray = attachments.map(a => a.content);
        }

        addMessage(currentChatId, {
            id: userMsgId,
            role: 'user',
            content: input.trim(),
            attachments: attArray
        });

        // Generate title if new chat AND title is still default
        const currentChatRefreshed = usePluginChatStore.getState().chats.find(c => c.id === currentChatId);
        if (currentChatRefreshed && currentChatRefreshed.title === 'New Chat' && currentChatRefreshed.messages.length === 1 && currentChatRefreshed.messages[0].role === 'user') {
            const newTitle = input.trim().substring(0, 30) + (input.trim().length > 30 ? '...' : '');
            updateChatTitle(currentChatId, newTitle);
        }

        setInput('');
        setAttachments([]);
        setIsGenerating(true);

        const aiMsgId = crypto.randomUUID();
        setGeneratingMessageId(aiMsgId);
        addMessage(currentChatId, {
            id: aiMsgId,
            role: 'assistant',
            content: ''
        });

        // Prepare messages for IPC
        const payloadMessages = (usePluginChatStore.getState().chats.find(c => c.id === currentChatId)?.messages || []).slice(0, -1).map((m, index, array) => {
            const isLastMessage = index === array.length - 1;

            if (m.attachments && m.attachments.length > 0) {
                const imageAttachments = m.attachments.filter(att => att.startsWith('data:image'));
                const textAttachments = m.attachments.filter(att => !att.startsWith('data:image'));

                let combinedText = m.content && m.content.trim() !== '' ? m.content : 'Please analyze this.';
                if (textAttachments.length > 0) {
                    combinedText += '\n\n[Attached Document Content]:\n' + textAttachments.join('\n\n---\n\n');
                }

                if (!isLastMessage && imageAttachments.length > 0) {
                    combinedText += '\n\n[Image attached previously]';
                    return { role: m.role, content: combinedText };
                }

                if (imageAttachments.length === 0) {
                    return { role: m.role, content: combinedText };
                }

                const contentArray = [];
                contentArray.push({ type: 'text', text: combinedText });

                imageAttachments.forEach(att => {
                    contentArray.push({
                        type: 'image_url',
                        image_url: { url: att }
                    });
                });

                return {
                    role: m.role,
                    content: contentArray
                };
            }

            return {
                role: m.role,
                content: m.content
            };
        });

        try {
            const cleanupChunk = window.api?.onLlmStreamChunk((data) => {
                if (data.messageId === aiMsgId) {
                    appendStreamToMessage(data.chatId, data.messageId, data.chunk);
                }
            });

            const cleanupEnd = window.api?.onLlmStreamEnd((data) => {
                if (data.messageId === aiMsgId) {
                    setIsGenerating(false);
                    setGeneratingMessageId(null);
                    if (cleanupChunk) cleanupChunk();
                    if (cleanupEnd) cleanupEnd();
                    if (cleanupErr) cleanupErr();
                }
            });

            const cleanupErr = window.api?.onLlmStreamError((data) => {
                if (data.messageId === aiMsgId) {
                    appendStreamToMessage(data.chatId, data.messageId, `\n\n**Error:** ${data.error}`);
                    setIsGenerating(false);
                    setGeneratingMessageId(null);
                    if (cleanupChunk) cleanupChunk();
                    if (cleanupEnd) cleanupEnd();
                    if (cleanupErr) cleanupErr();
                }
            });

            const currentApiKeys = usePluginChatStore.getState().apiKeys;
            const combinedSystemPrompt = [
                currentApiKeys.systemMessage || "You are a helpful AI assistant. Provide concise, accurate answers. Output markdown securely.",
                currentApiKeys.customInstructions ? `USER CONTEXT:\n${currentApiKeys.customInstructions}` : ""
            ].filter(Boolean).join("\n\n---\n\n");

            await window.api?.llmRequest({
                chatId: currentChatId,
                messageId: aiMsgId,
                provider,
                model,
                messages: payloadMessages || [],
                apiKeys: currentApiKeys,
                systemPrompt: combinedSystemPrompt
            });
        } catch (e) {
            setIsGenerating(false);
            setGeneratingMessageId(null);
        }
    };

    const handleCancel = () => {
        if (generatingMessageId) {
            window.api?.cancelLlmRequest(generatingMessageId);
            setIsGenerating(false);
            setGeneratingMessageId(null);
        }
    };

    const handleCopy = (text) => {
        window.api?.writeToClipboard?.({ type: 'text', content: text });
    };

    const handleSendToSlot = (text) => {
        // Send to clipboard directly as a workaround since forceAddClipboardItem is not exposed
        window.api?.writeToClipboard?.({ type: 'text', content: text });
        window.api?.sendNotification?.('Sent to Clipboard', 'The text has been copied successfully.');
    };

    const startEditingTitle = (id, currentTitle) => {
        setEditingChatId(id);
        setEditTitle(currentTitle);
        setTimeout(() => editInputRef.current?.focus(), 50);
    };

    const saveTitle = (id) => {
        if (editTitle.trim()) {
            updateChatTitle(id, editTitle.trim());
        }
        setEditingChatId(null);
    };

    const onInput = (e) => {
        const val = e.target.value;
        setInput(val);
        e.target.style.height = 'auto';
        e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
    };

    const onDrop = async (e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files);
        for (const file of files) {
            const filePath = window.api?.getFilePath(file) || file.path;
            if (filePath) {
                const res = await window.api?.parseFile(filePath);
                if (res && res.type !== 'error') {
                     setAttachments(prev => [...prev, { name: file.name, content: res.content, type: res.type }]);
                }
            }
        }
    };

    const preprocessMarkdown = (text) => {
        if (!text) return '';
        return text
            .replace(/\\\*/g, '*')
            .replace(/\*\*\s+(.*?)\s+\*\*/g, '**$1**')
            .replace(/(^|\s)\*\s+(.*?)\s+\*(\s|$)/g, '$1*$2*$3');
    };

    return (
        <div
            ref={popupRef}
            className="overflow-hidden font-sans no-drag-region pointer-events-auto flex flex-row"
            style={{
                ...getPopupStyle(),
                borderRadius: '8px'
            }}
            onMouseEnter={() => window.api?.setIgnoreMouseEvents?.(false)}
            onMouseLeave={() => window.api?.setIgnoreMouseEvents?.(true)}
            onDragOver={e => e.preventDefault()}
            onDrop={onDrop}
        >
            <ResizerHandle direction="side" edgePosition={edgePosition} startDrag={startDrag} />
            <ResizerHandle direction="bottom" edgePosition={edgePosition} startDrag={startDrag} />
            <ResizerHandle direction="corner" edgePosition={edgePosition} startDrag={startDrag} />

            <style>{`
                .ai-chat-selectable, .ai-chat-selectable * { 
                    -webkit-user-select: text !important; 
                    user-select: text !important; 
                    cursor: text !important;
                }
                .ai-chat-selectable *::selection {
                    background-color: rgba(59, 130, 246, 0.6) !important;
                    color: white !important;
                }
            `}</style>
            
            <div className={`flex transition-all duration-300 shrink-0 h-full ${isSidebarOpen ? 'w-48 opacity-100 border-r' : 'w-0 min-w-0 opacity-0 border-none overflow-hidden'}`} style={{ borderColor: 'var(--theme-border)', minHeight: 0 }}>
                <div className={`flex flex-col h-full shrink-0 ${isSidebarOpen ? 'w-48' : 'w-0'}`}>
                    <div className="p-3 border-b border-white/5 flex items-center justify-between">
                        <span className="font-bold text-slate-200 text-sm">Chats</span>
                        <button onClick={() => createChat()} className="w-8 h-8 rounded-lg bg-[#f4a125]/20 text-[#f4a125] hover:bg-[#f4a125]/30 flex items-center justify-center pointer-events-auto" title="New Chat">
                            <span className="material-symbols-outlined text-[18px]">add</span>
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto w-full custom-scrollbar p-2 flex flex-col gap-1">
                        {chats.map(c => (
                            <div 
                                key={c.id} 
                                onClick={() => setActiveChatId(c.id)}
                                onDoubleClick={() => startEditingTitle(c.id, c.title)}
                                className={`w-full group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors pointer-events-auto select-none
                                    ${activeChatId === c.id ? 'bg-[#f4a125]/20 text-[#f4a125]' : 'hover:bg-white/5 text-slate-400'}
                                `}
                            >
                                {editingChatId === c.id ? (
                                    <input
                                        ref={editInputRef}
                                        value={editTitle}
                                        onChange={(e) => setEditTitle(e.target.value)}
                                        onBlur={() => saveTitle(c.id)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveTitle(c.id);
                                            if (e.key === 'Escape') setEditingChatId(null);
                                        }}
                                        className="bg-black/40 border border-[#f4a125]/50 text-white text-sm rounded px-1 w-full outline-none"
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                ) : (
                                    <>
                                        <span className="truncate text-sm font-medium pr-2 block">{c.title}</span>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); deleteChat(c.id); }}
                                            className={`p-1 flex items-center rounded-md hover:bg-red-500/20 text-red-400 transition-colors ${activeChatId === c.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                                        >
                                            <span className="material-symbols-outlined text-[16px]">delete</span>
                                        </button>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Main Area */}
            <div className="flex-1 flex flex-col bg-transparent">
                <div className="p-3 border-b flex items-center justify-between bg-transparent shrink-0 pointer-events-auto" style={{ borderColor: 'var(--theme-border)' }}>
                    <div className="flex items-center gap-3">
                        <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
                            <span className="material-symbols-outlined text-[20px]">{isSidebarOpen ? 'keyboard_double_arrow_left' : 'keyboard_double_arrow_right'}</span>
                        </button>
                        <select
                            value={activeChat?.model || 'openai:gpt-4o'}
                            onChange={(e) => {
                                if (activeChat) {
                                    usePluginChatStore.setState(s => ({
                                        chats: s.chats.map(c => c.id === activeChat.id ? {...c, model: e.target.value} : c)
                                    }));
                                } else {
                                    createChat(e.target.value);
                                }
                            }}
                            className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-slate-200 min-w-[200px] outline-none hover:border-[#f4a125]/50 cursor-pointer"
                        >
                            {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                        </select>
                    </div>
                    <div className="flex items-center gap-1">
                        <button 
                            onClick={() => setShowSettings(!showSettings)} 
                            className={`p-1.5 rounded-lg transition-colors ${showSettings ? 'bg-[#f4a125] text-[#1a1612]' : 'text-slate-400 hover:text-white hover:bg-white/10'}`}
                            title="AI Hub Settings"
                        >
                            <span className="material-symbols-outlined text-[20px]">settings</span>
                        </button>
                        <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
                            <span className="material-symbols-outlined text-[20px]">close</span>
                        </button>
                    </div>
                </div>

                <div 
                    ref={messagesScrollRef}
                    onScroll={(e) => {
                        const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
                        const isNearBottom = scrollHeight - scrollTop - clientHeight < 150;
                        setIsAutoScrollEnabled(isNearBottom);
                    }}
                    className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-6 pointer-events-auto select-auto no-drag-region"
                >
                    {activeChat?.messages.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center opacity-50 select-none pointer-events-none">
                            <span className="material-symbols-outlined text-[48px] text-[#f4a125] mb-4">smart_toy</span>
                            <span className="text-slate-200 font-bold mb-1">KoBar AI Hub</span>
                            <span className="text-sm text-slate-400 text-center max-w-[300px]">Say hello to start!</span>
                        </div>
                    ) : (
                        activeChat?.messages.map((msg) => (
                            <div key={msg.id} className={`flex gap-4 w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                {msg.role !== 'user' && (
                                    <div className="w-8 h-8 rounded-full bg-[#f4a125]/20 shrink-0 flex items-center justify-center overflow-hidden border border-white/10">
                                        {aiAvatar ? (
                                            <img src={aiAvatar} alt="AI" className="w-full h-full object-cover" />
                                        ) : (
                                            <span className="material-symbols-outlined text-[#f4a125] text-[18px]">smart_toy</span>
                                        )}
                                    </div>
                                )}
                                <div className={`flex flex-col gap-1 max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                    <div className={`p-4 rounded-2xl group relative ai-chat-selectable ${msg.role === 'user' ? 'bg-[#f4a125]/10 text-slate-200 border border-[#f4a125]/20 rounded-tr-sm' : 'bg-transparent text-slate-300 border border-white/5 rounded-tl-sm'}`} style={{ WebkitUserSelect: 'text', userSelect: 'text' }}>
                                        
                                        <div className={`absolute top-2 flex gap-1 bg-[#1a1612] rounded-md border border-white/10 p-1 opacity-0 group-hover:opacity-100 transition-opacity z-10 
                                            ${msg.role === 'user' ? '-left-16' : '-right-16'}`}>
                                            <button onClick={() => handleSendToSlot(msg.content)} className="p-1 hover:text-[#f4a125] text-slate-400 transition-colors" title="Send to Slot">
                                                <span className="material-symbols-outlined text-[16px]">dynamic_feed</span>
                                            </button>
                                            <button onClick={() => handleCopy(msg.content)} className="p-1 hover:text-[#f4a125] text-slate-400 transition-colors" title="Copy Text">
                                                <span className="material-symbols-outlined text-[16px]">content_copy</span>
                                            </button>
                                        </div>

                                        {msg.attachments && msg.attachments.length > 0 && (
                                             <div className="flex flex-wrap gap-2 mb-3">
                                                 <span className="text-xs bg-[#f4a125]/20 text-[#f4a125] px-2 py-1 rounded-md">+{msg.attachments.length} files attached</span>
                                             </div>
                                        )}

                                        <div className="text-[14px] leading-relaxed break-words ai-chat-selectable text-sm max-w-none">
                                            <ReactMarkdown 
                                                remarkPlugins={[remarkGfm]}
                                                components={{
                                                    strong: ({node, ...props}) => <strong className="font-bold text-white" {...props} />,
                                                    p: ({node, ...props}) => <p className="mb-3 last:mb-0 leading-relaxed" {...props} />,
                                                    ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-3 space-y-1" {...props} />,
                                                    ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-3 space-y-1" {...props} />,
                                                    li: ({node, ...props}) => <li className="leading-relaxed" {...props} />,
                                                    h1: ({node, ...props}) => <h1 className="text-xl font-bold mb-3 text-white" {...props} />,
                                                    h2: ({node, ...props}) => <h2 className="text-lg font-bold mb-3 text-white" {...props} />,
                                                    h3: ({node, ...props}) => <h3 className="text-base font-bold mb-2 text-white" {...props} />,
                                                    em: ({node, ...props}) => <em className="italic text-slate-300" {...props} />,
                                                    pre: ({node, children, ...props}) => <pre className="select-text" style={{ WebkitUserSelect: 'text', userSelect: 'text' }} {...props}>{children}</pre>,
                                                    code: ({node, inline, className, children, ...props}) => {
                                                        const match = /language-(\w+)/.exec(className || '');
                                                        const language = match ? match[1] : 'text';

                                                        return !inline ? (
                                                            <div className="relative mt-2 mb-4 rounded-lg overflow-hidden group no-drag-region select-text" style={{ WebkitUserSelect: 'text', userSelect: 'text' }}>
                                                                <div className="absolute right-2 top-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                    <button 
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            window.api?.writeToClipboard?.({ type: 'text', content: String(children).replace(/\n$/, '') });
                                                                        }}
                                                                        className="p-1.5 bg-white/10 hover:bg-white/20 rounded-md text-slate-300 transition-colors flex items-center"
                                                                        title="Copy to OS Clipboard"
                                                                    >
                                                                        <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                                    </button>
                                                                </div>
                                                                <SyntaxHighlighter
                                                                    style={vscDarkPlus}
                                                                    language={language}
                                                                    PreTag="div"
                                                                    className="text-xs !m-0 !bg-black/40 select-text"
                                                                    customStyle={{ WebkitUserSelect: 'text', userSelect: 'text' }}
                                                                >
                                                                    {String(children).replace(/\n$/, '')}
                                                                </SyntaxHighlighter>
                                                            </div>
                                                        ) : (
                                                            <code className="bg-black/30 text-[#f4a125] px-1.5 py-0.5 rounded font-mono text-xs select-text" style={{ WebkitUserSelect: 'text', userSelect: 'text' }} {...props}>
                                                                {children}
                                                            </code>
                                                        );
                                                    }
                                                }}
                                            >
                                                {preprocessMarkdown(msg.content)}
                                            </ReactMarkdown>
                                        </div>
                                    </div>
                                </div>
                                {msg.role === 'user' && (
                                    <div className="w-8 h-8 rounded-full bg-slate-700 shrink-0 flex items-center justify-center overflow-hidden border border-white/10">
                                        {userAvatar ? (
                                            <img src={userAvatar} alt="User" className="w-full h-full object-cover" />
                                        ) : (
                                            <span className="material-symbols-outlined text-white text-[18px]">person</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                    {isGenerating && (
                         <div className="flex gap-4 w-full justify-start">
                              <div className="w-8 h-8 rounded-full bg-[#f4a125]/20 shrink-0 flex items-center justify-center">
                                  <span className="material-symbols-outlined text-[#f4a125] text-[18px] animate-spin">refresh</span>
                              </div>
                              <div className="p-4 rounded-2xl bg-transparent text-slate-300 border border-white/5 rounded-tl-sm flex items-center">
                                  <span className="animate-pulse">Thinking...</span>
                              </div>
                         </div>
                    )}
                    <div ref={bottomRef} className="h-1 shrink-0" />
                </div>

                <div className="p-3 border-t flex flex-col bg-black/10 shrink-0 pointer-events-auto" style={{ borderColor: 'var(--theme-border)' }}>
                    {attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2">
                             {attachments.map((a, i) => (
                                 <div key={i} className="flex items-center gap-1.5 px-2 py-1 bg-white/5 border border-white/10 rounded-md text-xs text-slate-300">
                                     <span className="material-symbols-outlined text-[14px] text-[#f4a125]">{a.type === 'image' ? 'image' : 'description'}</span>
                                     <span className="truncate max-w-[150px]">{a.name}</span>
                                     <button onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))} className="hover:text-red-400 p-0.5 rounded-sm ml-1">
                                         <span className="material-symbols-outlined text-[14px]">close</span>
                                     </button>
                                 </div>
                             ))}
                        </div>
                    )}

                    <div className="relative flex items-end focus-within:border-[#f4a125]/50 transition-colors">
                        <textarea
                            ref={inputRef}
                            value={input}
                            onChange={onInput}
                            placeholder="Type a message..."
                            className="w-full bg-black/20 text-slate-200 rounded-lg p-3 outline-none resize-none custom-scrollbar border border-white/5 focus:border-[#f4a125]/50 transition-colors max-h-[200px] overflow-y-auto select-auto pointer-events-auto"
                            style={{ minHeight: '44px' }}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                        />
                        <div className="flex items-center gap-1 pb-1 ml-2">
                             {isGenerating ? (
                                 <button onClick={handleCancel} className="p-2 rounded-xl bg-red-500/20 text-red-500 hover:bg-red-500/30 transition-colors">
                                     <span className="material-symbols-outlined text-[20px]">stop_circle</span>
                                 </button>
                             ) : (
                                 <button onClick={handleSend} disabled={!input.trim() && attachments.length === 0} className="p-2 rounded-xl bg-[#f4a125] text-[#1a1612] hover:brightness-110 transition-colors disabled:opacity-50">
                                     <span className="material-symbols-outlined text-[20px] -rotate-45 ml-0.5 mt-0.5">send</span>
                                 </button>
                             )}
                        </div>
                    </div>
                </div>

                {/* Settings Overlay View */}
                {showSettings && (
                    <div className="absolute top-[57px] left-0 right-0 bottom-0 bg-[#1a1612] z-50 flex flex-col no-drag-region">
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">
                            <div>
                                <h3 className="text-sm font-bold text-[#f4a125] uppercase tracking-wider mb-4">Model Defaults</h3>
                                <div className="space-y-4">
                                    <div className="flex flex-col gap-2">
                                        <label className="text-xs text-slate-400">Default Model</label>
                                        <select
                                            value={apiKeys?.defaultModel || 'anthropic:claude-sonnet-4-6'}
                                            onChange={(e) => usePluginChatStore.getState().setApiKeys({ defaultModel: e.target.value })}
                                            className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-[#f4a125]/50 cursor-pointer"
                                        >
                                            {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div className="w-full h-px bg-white/5" />

                            <div>
                                <h3 className="text-sm font-bold text-[#f4a125] uppercase tracking-wider mb-4">API Keys & Providers</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="flex flex-col gap-2 relative group opacity-50">
                                        <label className="text-xs text-slate-400">OpenAI API Key (Coming Soon)</label>
                                        <input disabled type="password" placeholder="Will be added soon" className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[10px] text-slate-500 outline-none select-none cursor-not-allowed" />
                                    </div>
                                    <div className="flex flex-col gap-2 relative group opacity-50">
                                        <label className="text-xs text-slate-400">Gemini API Key (Coming Soon)</label>
                                        <input disabled type="password" placeholder="Will be added soon" className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[10px] text-slate-500 outline-none select-none cursor-not-allowed" />
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <label className="text-xs text-slate-400">Anthropic API Key</label>
                                        <input 
                                            type="password" 
                                            value={apiKeys?.anthropic || ''}
                                            onChange={(e) => usePluginChatStore.getState().setApiKeys({ anthropic: e.target.value })}
                                            placeholder="sk-ant-..."
                                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-[#f4a125]/50 select-text"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <label className="text-xs text-slate-400">Local URL (Ollama/LM Studio)</label>
                                        <input 
                                            type="text" 
                                            value={apiKeys?.localUrl || ''}
                                            onChange={(e) => usePluginChatStore.getState().setApiKeys({ localUrl: e.target.value })}
                                            placeholder="http://localhost:11434"
                                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-[#f4a125]/50 select-text"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="w-full h-px bg-white/5" />

                            <div>
                                <h3 className="text-sm font-bold text-[#f4a125] uppercase tracking-wider mb-4">Profile Customization</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div className="flex items-center gap-4">
                                        <div className="w-16 h-16 rounded-xl bg-[#f4a125]/10 border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
                                            {aiAvatar ? (
                                                <img src={aiAvatar} alt="AI" className="w-full h-full object-cover" />
                                            ) : (
                                                <span className="material-symbols-outlined text-[#f4a125] text-[32px]">smart_toy</span>
                                            )}
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <label className="text-xs text-slate-400">AI Avatar (Recommended: 128x128px)</label>
                                            <div className="flex gap-2">
                                                <label className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs text-slate-200 cursor-pointer transition-colors">
                                                    Change
                                                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleAvatarUpload(e, 'ai')} />
                                                </label>
                                                {aiAvatar && (
                                                    <button onClick={() => setAiAvatar(null)} className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-xs text-red-500 transition-colors">
                                                        Remove
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4">
                                        <div className="w-16 h-16 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
                                            {userAvatar ? (
                                                <img src={userAvatar} alt="User" className="w-full h-full object-cover" />
                                            ) : (
                                                <span className="material-symbols-outlined text-white text-[32px]">person</span>
                                            )}
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <label className="text-xs text-slate-400">User Avatar (Recommended: 128x128px)</label>
                                            <div className="flex gap-2">
                                                <label className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs text-slate-200 cursor-pointer transition-colors">
                                                    Change
                                                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleAvatarUpload(e, 'user')} />
                                                </label>
                                                {userAvatar && (
                                                    <button onClick={() => setUserAvatar(null)} className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-xs text-red-500 transition-colors">
                                                        Remove
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="w-full h-px bg-white/5" />

                            <div>
                                <h3 className="text-sm font-bold text-[#f4a125] uppercase tracking-wider mb-4">Prompt Customization</h3>
                                <div className="space-y-4">
                                    <div className="flex flex-col gap-2">
                                        <div className="flex justify-between items-center">
                                            <label className="text-xs text-slate-400">System Message</label>
                                            <span className="text-[10px] text-slate-500 italic">Defines AI behavior</span>
                                        </div>
                                        <textarea 
                                            value={apiKeys?.systemMessage || ''}
                                            onChange={(e) => usePluginChatStore.getState().setApiKeys({ systemMessage: e.target.value })}
                                            placeholder="You are a helpful AI..."
                                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-[#f4a125]/50 min-h-[80px] resize-none select-text"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <div className="flex justify-between items-center">
                                            <label className="text-xs text-slate-400">Custom Instructions</label>
                                            <span className="text-[10px] text-slate-500 italic">Added to system prompt</span>
                                        </div>
                                        <textarea 
                                            value={apiKeys?.customInstructions || ''}
                                            onChange={(e) => usePluginChatStore.getState().setApiKeys({ customInstructions: e.target.value })}
                                            placeholder="e.g. Always respond in Spanish"
                                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-[#f4a125]/50 min-h-[80px] resize-none select-text"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="p-4 border-t border-white/5 bg-black/20 flex justify-end">
                            <button 
                                onClick={() => setShowSettings(false)}
                                className="px-6 py-2 bg-[#f4a125] text-[#1a1612] font-bold rounded-lg hover:brightness-110 transition-all shadow-lg"
                            >
                                Back to Chat
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
