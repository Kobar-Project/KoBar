import React, { useState, useMemo, useEffect, useRef } from 'react';
import CryptoJS from 'crypto-js';

const SnippetVaultPopup = (props) => {
    const { onClose, anchorRect } = props;

    // Use KoBar's global store for environment variables
    const store = window.useAppStore();
    const edgePosition = store.edgePosition;
    const design = store.design;
    const glassOpacity = store.glassOpacity;
    const isSmartPositioning = store.isPopupSmartPositioning;
    const isMac = store.isMac;
    const screenBounds = store.screenBounds;
    const sidebarPosition = store.sidebarPosition;
    const orientation = store.orientation;
    const language = store.language || 'en';

    // Localization mapping
    const TRANSLATIONS = {
        en: {
            snippetVaultHeader: "Snippet Vault",
            colorDefault: "Default", colorRed: "Red", colorBlue: "Blue", colorGreen: "Green", colorYellow: "Yellow", colorPurple: "Purple", colorOrange: "Orange",
            passwordLock: "Lock with Password", setPasswordPlaceholder: "Set Password...", normalView: "Normal View", compactView: "Compact View",
            searchPlaceholder: "Search snippets...", noMatchingSnippets: "No matching snippets.", noSnippetsYet: "No snippets yet.",
            sendToSlot: "Send to Slot", copyToOS: "Copy to Clipboard", edit: "Edit", deleteAction: "Delete",
            lockedContentDesc: "This content is encrypted.", enterPasswordPlaceholder: "Enter Password...",
            titleLabel: "TITLE", titlePlaceholder: "Snippet Title", contentLabel: "CONTENT", contentPlaceholder: "Snippet Content...",
            colorCategory: "COLOR CATEGORY", tagsLabel: "TAGS (comma separated)", tagsPlaceholder: "tag1, tag2",
            cancel: "Cancel", saveSnippet: "Save Snippet"
        },
        tr: {
            snippetVaultHeader: "Kod/Metin Kasası",
            colorDefault: "Varsayılan", colorRed: "Kırmızı", colorBlue: "Mavi", colorGreen: "Yeşil", colorYellow: "Sarı", colorPurple: "Mor", colorOrange: "Turuncu",
            passwordLock: "Şifre ile Kilitle", setPasswordPlaceholder: "Şifre Belirle...", normalView: "Normal Görünüm", compactView: "Kompakt Görünüm",
            searchPlaceholder: "Snippet ara...", noMatchingSnippets: "Eşleşen snippet bulunamadı.", noSnippetsYet: "Henüz snippet eklenmedi.",
            sendToSlot: "Slota Gönder", copyToOS: "Panoya Kopyala", edit: "Düzenle", deleteAction: "Sil",
            lockedContentDesc: "Bu içerik şifrelenmiştir.", enterPasswordPlaceholder: "Şifreyi Girin...",
            titleLabel: "BAŞLIK", titlePlaceholder: "Snippet Başlığı", contentLabel: "İÇERİK", contentPlaceholder: "Snippet İçeriği...",
            colorCategory: "RENK KATEGORİSİ", tagsLabel: "ETİKETLER (virgülle ayırın)", tagsPlaceholder: "etiket1, etiket2",
            cancel: "İptal", saveSnippet: "Kaydet"
        },
        de: {
            snippetVaultHeader: "Snippet-Tresor", colorDefault: "Standard", colorRed: "Rot", colorBlue: "Blau", colorGreen: "Grün", colorYellow: "Gelb", colorPurple: "Lila", colorOrange: "Orange",
            passwordLock: "Mit Passwort sperren", setPasswordPlaceholder: "Passwort festlegen...", normalView: "Normalansicht", compactView: "Kompaktansicht",
            searchPlaceholder: "Snippets suchen...", noMatchingSnippets: "Keine passenden Snippets.", noSnippetsYet: "Noch keine Snippets.",
            sendToSlot: "An Slot senden", copyToOS: "In Zwischenablage kopieren", edit: "Bearbeiten", deleteAction: "Löschen",
            lockedContentDesc: "Dieser Inhalt ist verschlüsselt.", enterPasswordPlaceholder: "Passwort eingeben...",
            titleLabel: "TITEL", titlePlaceholder: "Snippet-Titel", contentLabel: "INHALT", contentPlaceholder: "Snippet-Inhalt...",
            colorCategory: "FARBKATEGORIE", tagsLabel: "TAGS (kommagetrennt)", tagsPlaceholder: "tag1, tag2",
            cancel: "Abbrechen", saveSnippet: "Snippet speichern"
        },
        ar: {
            snippetVaultHeader: "قبو المقتطفات", colorDefault: "افتراضي", colorRed: "أحمر", colorBlue: "أزرق", colorGreen: "أخضر", colorYellow: "أصفر", colorPurple: "أرجواني", colorOrange: "برتقالي",
            passwordLock: "قفل بكلمة مرور", setPasswordPlaceholder: "تعيين كلمة مرور...", normalView: "عرض عادي", compactView: "عرض مدمج",
            searchPlaceholder: "البحث في المقتطفات...", noMatchingSnippets: "لا توجد مقتطفات مطابقة.", noSnippetsYet: "لا توجد مقتطفات بعد.",
            sendToSlot: "إرسال إلى الفتحة", copyToOS: "نسخ إلى الحافظة", edit: "تعديل", deleteAction: "حذف",
            lockedContentDesc: "هذا المحتوى مشفر.", enterPasswordPlaceholder: "أدخل كلمة المرور...",
            titleLabel: "العنوان", titlePlaceholder: "عنوان المقتطف", contentLabel: "المحتوى", contentPlaceholder: "محتوى المقتطف...",
            colorCategory: "فئة اللون", tagsLabel: "العلامات (مفصولة بفاصلة)", tagsPlaceholder: "علامة1, علامة2",
            cancel: "إلغاء", saveSnippet: "حفظ المقتطف"
        },
        zh: {
            snippetVaultHeader: "代码段库", colorDefault: "默认", colorRed: "红色", colorBlue: "蓝色", colorGreen: "绿色", colorYellow: "黄色", colorPurple: "紫色", colorOrange: "橙色",
            passwordLock: "使用密码锁定", setPasswordPlaceholder: "设置密码...", normalView: "普通视图", compactView: "紧凑视图",
            searchPlaceholder: "搜索代码段...", noMatchingSnippets: "没有匹配的代码段。", noSnippetsYet: "暂无代码段。",
            sendToSlot: "发送到插槽", copyToOS: "复制到剪贴板", edit: "编辑", deleteAction: "删除",
            lockedContentDesc: "此内容已加密。", enterPasswordPlaceholder: "输入密码...",
            titleLabel: "标题", titlePlaceholder: "代码段标题", contentLabel: "内容", contentPlaceholder: "代码段内容...",
            colorCategory: "颜色分类", tagsLabel: "标签 (逗号分隔)", tagsPlaceholder: "标签1, 标签2",
            cancel: "取消", saveSnippet: "保存代码段"
        },
        fr: {
            snippetVaultHeader: "Coffre à Snippets", colorDefault: "Défaut", colorRed: "Rouge", colorBlue: "Bleu", colorGreen: "Vert", colorYellow: "Jaune", colorPurple: "Violet", colorOrange: "Orange",
            passwordLock: "Verrouiller avec mot de passe", setPasswordPlaceholder: "Définir un mot de passe...", normalView: "Vue Normale", compactView: "Vue Compacte",
            searchPlaceholder: "Rechercher des snippets...", noMatchingSnippets: "Aucun snippet correspondant.", noSnippetsYet: "Aucun snippet pour le moment.",
            sendToSlot: "Envoyer à l'emplacement", copyToOS: "Copier dans le presse-papiers", edit: "Modifier", deleteAction: "Supprimer",
            lockedContentDesc: "Ce contenu est crypté.", enterPasswordPlaceholder: "Entrer le mot de passe...",
            titleLabel: "TITRE", titlePlaceholder: "Titre du snippet", contentLabel: "CONTENU", contentPlaceholder: "Contenu du snippet...",
            colorCategory: "CATÉGORIE DE COULEUR", tagsLabel: "TAGS (séparés par des virgules)", tagsPlaceholder: "tag1, tag2",
            cancel: "Annuler", saveSnippet: "Enregistrer le snippet"
        },
        hi: {
            snippetVaultHeader: "स्निपेट वॉल्ट", colorDefault: "डिफ़ॉल्ट", colorRed: "लाल", colorBlue: "नीला", colorGreen: "हरा", colorYellow: "पीला", colorPurple: "बैंगनी", colorOrange: "नारंगी",
            passwordLock: "पासवर्ड से लॉक करें", setPasswordPlaceholder: "पासवर्ड सेट करें...", normalView: "सामान्य दृश्य", compactView: "कॉम्पैक्ट दृश्य",
            searchPlaceholder: "स्निपेट खोजें...", noMatchingSnippets: "कोई मेल खाने वाला स्निपेट नहीं।", noSnippetsYet: "अभी तक कोई स्निपेट नहीं।",
            sendToSlot: "स्लॉट पर भेजें", copyToOS: "क्लिपबोर्ड पर कॉपी करें", edit: "संपादित करें", deleteAction: "हटाएं",
            lockedContentDesc: "यह सामग्री एन्क्रिप्टेड है।", enterPasswordPlaceholder: "पासवर्ड दर्ज करें...",
            titleLabel: "शीर्षक", titlePlaceholder: "स्निपेट शीर्षक", contentLabel: "सामग्री", contentPlaceholder: "स्निपेट सामग्री...",
            colorCategory: "रंग श्रेणी", tagsLabel: "टैग (अल्पविराम से अलग)", tagsPlaceholder: "टैग1, टैग2",
            cancel: "रद्द करें", saveSnippet: "स्निपेट सहेजें"
        },
        es: {
            snippetVaultHeader: "Bóveda de Snippets", colorDefault: "Predeterminado", colorRed: "Rojo", colorBlue: "Azul", colorGreen: "Verde", colorYellow: "Amarillo", colorPurple: "Morado", colorOrange: "Naranja",
            passwordLock: "Bloquear con contraseña", setPasswordPlaceholder: "Establecer contraseña...", normalView: "Vista Normal", compactView: "Vista Compacta",
            searchPlaceholder: "Buscar snippets...", noMatchingSnippets: "No hay snippets coincidentes.", noSnippetsYet: "Aún no hay snippets.",
            sendToSlot: "Enviar al espacio", copyToOS: "Copiar al portapapeles", edit: "Editar", deleteAction: "Eliminar",
            lockedContentDesc: "Este contenido está encriptado.", enterPasswordPlaceholder: "Introducir contraseña...",
            titleLabel: "TÍTULO", titlePlaceholder: "Título del snippet", contentLabel: "CONTENIDO", contentPlaceholder: "Contenido del snippet...",
            colorCategory: "CATEGORÍA DE COLOR", tagsLabel: "ETIQUETAS (separadas por comas)", tagsPlaceholder: "etiqueta1, etiqueta2",
            cancel: "Cancelar", saveSnippet: "Guardar Snippet"
        },
        ja: {
            snippetVaultHeader: "スニペット保管庫", colorDefault: "デフォルト", colorRed: "赤", colorBlue: "青", colorGreen: "緑", colorYellow: "黄", colorPurple: "紫", colorOrange: "オレンジ",
            passwordLock: "パスワードでロック", setPasswordPlaceholder: "パスワードを設定...", normalView: "通常ビュー", compactView: "コンパクトビュー",
            searchPlaceholder: "スニペットを検索...", noMatchingSnippets: "一致するスニペットはありません。", noSnippetsYet: "スニペットはまだありません。",
            sendToSlot: "スロットに送信", copyToOS: "クリップボードにコピー", edit: "編集", deleteAction: "削除",
            lockedContentDesc: "このコンテンツは暗号化されています。", enterPasswordPlaceholder: "パスワードを入力...",
            titleLabel: "タイトル", titlePlaceholder: "スニペットのタイトル", contentLabel: "コンテンツ", contentPlaceholder: "スニペットのコンテンツ...",
            colorCategory: "カラーカテゴリ", tagsLabel: "タグ (カンマ区切り)", tagsPlaceholder: "タグ1, タグ2",
            cancel: "キャンセル", saveSnippet: "スニペットを保存"
        },
        ru: {
            snippetVaultHeader: "Хранилище сниппетов", colorDefault: "По умолчанию", colorRed: "Красный", colorBlue: "Синий", colorGreen: "Зеленый", colorYellow: "Желтый", colorPurple: "Фиолетовый", colorOrange: "Оранжевый",
            passwordLock: "Блокировка паролем", setPasswordPlaceholder: "Установить пароль...", normalView: "Обычный вид", compactView: "Компактный вид",
            searchPlaceholder: "Поиск сниппетов...", noMatchingSnippets: "Нет подходящих сниппетов.", noSnippetsYet: "Пока нет сниппетов.",
            sendToSlot: "Отправить в слот", copyToOS: "Копировать в буфер обмена", edit: "Редактировать", deleteAction: "Удалить",
            lockedContentDesc: "Этот контент зашифрован.", enterPasswordPlaceholder: "Введите пароль...",
            titleLabel: "НАЗВАНИЕ", titlePlaceholder: "Название сниппета", contentLabel: "КОНТЕНТ", contentPlaceholder: "Контент сниппета...",
            colorCategory: "КАТЕГОРИЯ ЦВЕТА", tagsLabel: "ТЕГИ (через запятую)", tagsPlaceholder: "тег1, тег2",
            cancel: "Отмена", saveSnippet: "Сохранить сниппет"
        }
    };
    const t = (key) => (TRANSLATIONS[language] || TRANSLATIONS['en'])[key] || key;

    // State initialization from localStorage
    const [snippets, setSnippets] = useState(() => {
        try {
            const data = localStorage.getItem('kobar-plugin-snippetvault-data');
            return data ? JSON.parse(data) : [];
        } catch (e) {
            return [];
        }
    });
    
    const [isCompact, setIsCompact] = useState(() => {
        return localStorage.getItem('kobar-plugin-snippetvault-compact') === 'true';
    });

    // Sync State to localStorage
    useEffect(() => {
        localStorage.setItem('kobar-plugin-snippetvault-data', JSON.stringify(snippets));
    }, [snippets]);

    useEffect(() => {
        localStorage.setItem('kobar-plugin-snippetvault-compact', String(isCompact));
    }, [isCompact]);

    const addSnippet = (snippet) => {
        setSnippets(prev => [...prev, { ...snippet, id: window.crypto.randomUUID() }]);
    };

    const updateSnippet = (id, updatedFields) => {
        setSnippets(prev => prev.map(s => s.id === id ? { ...s, ...updatedFields } : s));
    };

    const deleteSnippet = (id) => {
        setSnippets(prev => prev.filter(s => s.id !== id));
    };

    // UI States
    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = useState('list'); // 'list' | 'form'
    const [editingSnippetId, setEditingSnippetId] = useState(null);

    // Form states
    const [formTitle, setFormTitle] = useState('');
    const [formContent, setFormContent] = useState('');
    const [formTags, setFormTags] = useState('');
    const [formPassword, setFormPassword] = useState(undefined);
    const [formColor, setFormColor] = useState(undefined);
    const [showLockInput, setShowLockInput] = useState(false);

    // Prompt state
    const [unlockingId, setUnlockingId] = useState(null);
    const [unlockPassword, setUnlockPassword] = useState('');
    const [unlockAction, setUnlockAction] = useState(null);

    const SNIPPET_COLORS = [
        { name: t('colorDefault'), value: undefined, class: 'bg-slate-500' },
        { name: t('colorRed'), value: '#ef4444', class: 'bg-red-500' },
        { name: t('colorBlue'), value: '#3b82f6', class: 'bg-blue-500' },
        { name: t('colorGreen'), value: '#22c55e', class: 'bg-green-500' },
        { name: t('colorYellow'), value: '#eab308', class: 'bg-yellow-500' },
        { name: t('colorPurple'), value: '#a855f7', class: 'bg-purple-500' },
        { name: t('colorOrange'), value: '#f97316', class: 'bg-orange-500' },
    ];

    const [copiedId, setCopiedId] = useState(null);
    const [sentId, setSentId] = useState(null);

    const getPopupStyle = () => {
        if (!anchorRect) return {};
        const popupHeight = 450;
        const popupWidth = 320;
        const screenHeight = screenBounds?.height ?? 800;
        const screenWidth = screenBounds?.width ?? 1200;
        const offsetTop = sidebarPosition ? sidebarPosition.y : 0;
        const offsetLeft = sidebarPosition ? sidebarPosition.x : 0;

        const isGlass = design === 'style2';
        const alpha = Math.round(glassOpacity * 255).toString(16).padStart(2, '0');
        const bgColor = isGlass ? `#1a1612${alpha}` : '#1a1612';

        const baseStyle = {
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
            let adjustedLeft = (anchorRect.left - offsetLeft) + (anchorRect.width / 2) - (popupWidth / 2);
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
            let adjustedTop = (anchorRect.top - offsetTop) - 20 + (anchorRect.height / 2) - (popupHeight / 2);
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

    const popupRef = useRef(null);
    const isSmartRef = useRef(isSmartPositioning);
    useEffect(() => { isSmartRef.current = isSmartPositioning; }, [isSmartPositioning]);

    useEffect(() => {
        const onDrag = (e) => {
            if (!popupRef.current || !anchorRect || !isSmartRef.current) return;
            const newX = e.detail.x;
            const newY = e.detail.y;
            const popupHeight = 450;
            const popupWidth = 320;
            
            const screenXInViewport = (screenBounds?.x ?? 0) - window.screenX;
            const screenYInViewport = (screenBounds?.y ?? 0) - window.screenY;

            if (orientation === "horizontal") {
                const screenWidth = screenBounds?.width ?? 1200;
                let adjustedLeft = (anchorRect.left - newX) + (anchorRect.width / 2) - (popupWidth / 2);
                const maxLeft = screenXInViewport + (screenWidth - newX) - popupWidth - 20;
                const minLeft = screenXInViewport - newX + 20;
                if (adjustedLeft < minLeft) adjustedLeft = minLeft;
                if (adjustedLeft > maxLeft) adjustedLeft = maxLeft;
                popupRef.current.style.left = `${adjustedLeft}px`;
            } else {
                const screenHeight = screenBounds?.height ?? 800;
                let adjustedTop = (anchorRect.top - newY) - 20 + (anchorRect.height / 2) - (popupHeight / 2);
                const maxTop = screenYInViewport + (screenHeight - newY) - popupHeight - 20;
                const minTop = screenYInViewport - newY + 20;
                if (adjustedTop < minTop) adjustedTop = minTop;
                if (adjustedTop > maxTop) adjustedTop = maxTop;
                popupRef.current.style.top = `${adjustedTop}px`;
            }
        };
        document.addEventListener('kobar-drag', onDrag);
        return () => document.removeEventListener('kobar-drag', onDrag);
    }, [anchorRect, screenBounds, orientation]);

    const handleCopy = (id, content) => {
        if (window.api?.writeToClipboard) {
            window.api.writeToClipboard({ type: 'text', content });
        } else {
            navigator.clipboard.writeText(content);
        }
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 1000);
    };

    const handleSendToSlot = (id, content) => {
        // Plugin system: use OS clipboard which KoBar will naturally pick up into a slot
        if (window.api?.writeToClipboard) {
            window.api.writeToClipboard({ type: 'text', content });
        } else {
            navigator.clipboard.writeText(content);
        }
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

    const openEdit = (snippet) => {
        if (snippet.password) {
            setUnlockingId(snippet.id);
            setUnlockPassword('');
            setUnlockAction(() => () => {
                setEditingSnippetId(snippet.id);
                setFormTitle(snippet.title);
                let decrypted = snippet.content;
                try {
                    const bytes = CryptoJS.AES.decrypt(snippet.content, snippet.password);
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

    const checkLock = (snippet, action) => {
        if (snippet.password) {
            setUnlockingId(snippet.id);
            setUnlockPassword('');
            setUnlockAction(() => () => {
                let decrypted = snippet.content;
                try {
                    const bytes = CryptoJS.AES.decrypt(snippet.content, snippet.password);
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

    const filteredSnippets = useMemo(() => {
        if (!searchQuery.trim()) return snippets;
        const q = searchQuery.toLowerCase();
        return snippets.filter(s =>
            s.title.toLowerCase().includes(q) ||
            (!s.password && s.content.toLowerCase().includes(q)) ||
            s.tags.some(t => t.toLowerCase().includes(q))
        );
    }, [snippets, searchQuery]);

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
                                                const val = e.target.value;
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
                        onClick={onClose}
                        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>
            </div>

            {/* List View */}
            {viewMode === 'list' && (
                <div className="flex flex-col flex-1 overflow-hidden">
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

                    <div className="flex-1 overflow-y-auto px-3 pb-3 custom-scrollbar flex flex-col gap-2">
                        {filteredSnippets.length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-sm gap-2">
                                <span className="material-symbols-outlined text-[32px] opacity-50">search_off</span>
                                {searchQuery ? t('noMatchingSnippets') : t('noSnippetsYet')}
                            </div>
                        ) : (
                            filteredSnippets.map(snippet => isCompact ? (
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
                                <div
                                    key={snippet.id}
                                    className={`rounded-lg p-3 flex flex-col gap-2 hover:brightness-125 transition-all group relative border ${snippet.color ? '' : 'bg-white/5 border-white/5'}`}
                                    style={{
                                        backgroundColor: snippet.color ? `${snippet.color}15` : undefined,
                                        borderColor: snippet.color ? `${snippet.color}40` : undefined
                                    }}
                                >
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

                                    <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed break-words italic">
                                        {snippet.password ? t('lockedContentDesc') : snippet.content}
                                    </p>

                                    {snippet.tags.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mt-1 pointer-events-auto">
                                            {snippet.tags.map((tag, idx) => (
                                                <span key={idx} className="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold rounded-md select-auto">
                                                    #{tag}
                                                </span>
                                            ))}
                                        </div>
                                    )}

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

// Plugin Registration
if (window.KoBarExtensions) {
    window.KoBarExtensions.registerPanel('snippetvault-plugin-panel', {
        id: 'snippetvault-plugin-panel',
        render: (props) => window.React.createElement(SnippetVaultPopup, props)
    });

    window.KoBarExtensions.registerSidebarButton({
        id: 'snippetvault-plugin-btn',
        icon: 'library_books',
        label: 'Snippet Vault',
        onClick: (e, anchorRect) => {
            if (window.useAppStore) {
                const store = window.useAppStore.getState();
                const isCurrentlyOpen = store.activeExtensionPanelId === 'snippetvault-plugin-panel';
                
                store.closeAllUtilityPopups();
                
                if (!isCurrentlyOpen) {
                    window.useAppStore.setState({ 
                        activeExtensionPanelId: 'snippetvault-plugin-panel',
                        activeExtensionAnchorRect: anchorRect
                    });
                }
            }
        }
    });
}
