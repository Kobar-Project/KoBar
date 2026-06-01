const React = window.React;
const { useState, useRef, useEffect } = React;

function hexToHSL(hex) {
    let r = parseInt(hex.slice(1, 3), 16) / 255;
    let g = parseInt(hex.slice(3, 5), 16) / 255;
    let b = parseInt(hex.slice(5, 7), 16) / 255;

    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h, s, l) {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = (n) => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

function getContrastColor(hex) {
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);
    let yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? '#000000' : '#FFFFFF';
}

function hsvToHex(h, s, v) {
    s /= 100;
    v /= 100;
    let i = Math.floor(h / 60);
    let f = h / 60 - i;
    let p = v * (1 - s);
    let q = v * (1 - f * s);
    let t = v * (1 - (1 - f) * s);
    let r = 0, g = 0, b = 0;
    switch (i % 6) {
        case 0: r = v, g = t, b = p; break;
        case 1: r = q, g = v, b = p; break;
        case 2: r = p, g = v, b = t; break;
        case 3: r = p, g = q, b = v; break;
        case 4: r = t, g = p, b = v; break;
        case 5: r = v, g = p, b = q; break;
    }
    const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, '0').toUpperCase();
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToHsv(hex) {
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

const pluginTranslations = {
    en: {
        colorPicker: "Color Picker",
        pickColor: "Pick Color from Screen",
        copyAll: "Copy All",
        analogous: "Analogous",
        complementary: "Complementary",
        splitComplementary: "Split Complementary",
        triadic: "Triadic",
        tetradic: "Tetradic",
        createNewPalette: "Create New Palette",
        noPalettes: "No palettes created yet.",
        clickToEdit: "Click to edit with custom wheel",
        clickToCopy: "Click to copy",
        noEyeDropper: "Your browser does not support the EyeDropper API",
        newPalette: "New Palette"
    },
    tr: {
        colorPicker: "Renk Seçici",
        pickColor: "Ekrandan Renk Seç",
        copyAll: "Tümünü Kopyala",
        analogous: "Benzer",
        complementary: "Tamamlayıcı",
        splitComplementary: "Bölünmüş Tamamlayıcı",
        triadic: "Üçlü",
        tetradic: "Dörtlü",
        createNewPalette: "Yeni Palet Oluştur",
        noPalettes: "Henüz palet oluşturulmadı.",
        clickToEdit: "Özel tekerlek ile düzenlemek için tıklayın",
        clickToCopy: "Kopyalamak için tıklayın",
        noEyeDropper: "Tarayıcınız EyeDropper API'yi desteklemiyor",
        newPalette: "Yeni Palet"
    },
    de: {
        colorPicker: "Farbauswahl",
        pickColor: "Farbe vom Bildschirm wählen",
        copyAll: "Alles kopieren",
        analogous: "Analog",
        complementary: "Komplementär",
        splitComplementary: "Teilkomplementär",
        triadic: "Triadisch",
        tetradic: "Tetradisch",
        createNewPalette: "Neue Palette erstellen",
        noPalettes: "Noch keine Paletten erstellt.",
        clickToEdit: "Klicken, um mit benutzerdefiniertem Rad zu bearbeiten",
        clickToCopy: "Klicken zum Kopieren",
        noEyeDropper: "Ihr Browser unterstützt die EyeDropper-API nicht",
        newPalette: "Neue Palette"
    },
    ar: {
        colorPicker: "منتقي الألوان",
        pickColor: "اختر لوناً من الشاشة",
        copyAll: "نسخ الكل",
        analogous: "مماثل",
        complementary: "مكمل",
        splitComplementary: "مكمل منقسم",
        triadic: "ثلاثي",
        tetradic: "رباعي",
        createNewPalette: "إنشاء لوحة ألوان جديدة",
        noPalettes: "لم يتم إنشاء لوحات ألوان بعد.",
        clickToEdit: "انقر للتحرير بعجلة مخصصة",
        clickToCopy: "انقر للنسخ",
        noEyeDropper: "متصفحك لا يدعم واجهة برمجة تطبيقات EyeDropper",
        newPalette: "لوحة ألوان جديدة"
    },
    zh: {
        colorPicker: "拾色器",
        pickColor: "从屏幕上选择颜色",
        copyAll: "全部复制",
        analogous: "相似色",
        complementary: "互补色",
        splitComplementary: "分裂互补色",
        triadic: "三角色",
        tetradic: "四角色",
        createNewPalette: "创建新调色板",
        noPalettes: "尚未创建调色板。",
        clickToEdit: "点击使用自定义色轮编辑",
        clickToCopy: "点击复制",
        noEyeDropper: "您的浏览器不支持 EyeDropper API",
        newPalette: "新调色板"
    },
    fr: {
        colorPicker: "Sélecteur de couleurs",
        pickColor: "Choisir une couleur sur l'écran",
        copyAll: "Tout copier",
        analogous: "Analogue",
        complementary: "Complémentaire",
        splitComplementary: "Complémentaire partagé",
        triadic: "Triadique",
        tetradic: "Tétradique",
        createNewPalette: "Créer une nouvelle palette",
        noPalettes: "Aucune palette créée pour le moment.",
        clickToEdit: "Cliquez pour éditer avec la roue personnalisée",
        clickToCopy: "Cliquez pour copier",
        noEyeDropper: "Votre navigateur ne prend pas en charge l'API EyeDropper",
        newPalette: "Nouvelle palette"
    },
    hi: {
        colorPicker: "कलर पिकर",
        pickColor: "स्क्रीन से रंग चुनें",
        copyAll: "सभी कॉपी करें",
        analogous: "अनुरूप",
        complementary: "पूरक",
        splitComplementary: "विभाजित पूरक",
        triadic: "त्रिकोणीय",
        tetradic: "चतुष्कोणीय",
        createNewPalette: "नया पैलेट बनाएं",
        noPalettes: "अभी तक कोई पैलेट नहीं बनाया गया।",
        clickToEdit: "कस्टम व्हील के साथ संपादित करने के लिए क्लिक करें",
        clickToCopy: "कॉपी करने के लिए क्लिक करें",
        noEyeDropper: "आपका ब्राउज़र EyeDropper API का समर्थन नहीं करता है",
        newPalette: "नया पैलेट"
    },
    es: {
        colorPicker: "Selector de colores",
        pickColor: "Elegir color de la pantalla",
        copyAll: "Copiar todo",
        analogous: "Análogo",
        complementary: "Complementario",
        splitComplementary: "Complementario dividido",
        triadic: "Triádico",
        tetradic: "Tetrádico",
        createNewPalette: "Crear nueva paleta",
        noPalettes: "Aún no se han creado paletas.",
        clickToEdit: "Haz clic para editar con rueda personalizada",
        clickToCopy: "Haz clic para copiar",
        noEyeDropper: "Tu navegador no soporta la API EyeDropper",
        newPalette: "Nueva paleta"
    },
    ja: {
        colorPicker: "カラーピッカー",
        pickColor: "画面から色を選択",
        copyAll: "すべてコピー",
        analogous: "類似色",
        complementary: "補色",
        splitComplementary: "分裂補色",
        triadic: "トライアド",
        tetradic: "テトラード",
        createNewPalette: "新しいパレットを作成",
        noPalettes: "パレットはまだ作成されていません。",
        clickToEdit: "カスタムホイールで編集するにはクリック",
        clickToCopy: "クリックしてコピー",
        noEyeDropper: "お使いのブラウザはEyeDropper APIをサポートしていません",
        newPalette: "新しいパレット"
    },
    ru: {
        colorPicker: "Выбор цвета",
        pickColor: "Выбрать цвет с экрана",
        copyAll: "Копировать всё",
        analogous: "Аналогичный",
        complementary: "Комплементарный",
        splitComplementary: "Раздельно-комплементарный",
        triadic: "Триадный",
        tetradic: "Тетрадный",
        createNewPalette: "Создать новую палитру",
        noPalettes: "Палитры еще не созданы.",
        clickToEdit: "Нажмите, чтобы изменить с помощью колеса",
        clickToCopy: "Нажмите, чтобы скопировать",
        noEyeDropper: "Ваш браузер не поддерживает API EyeDropper",
        newPalette: "Новая палитра"
    }
};

const ColorPickerPanel = ({ onClose, anchorRect }) => {
    // Use KoBar's global store directly, or fallback to sensible defaults
    const store = window.useAppStore();
    const edgePosition = store.edgePosition || 'right';
    const design = store.design || 'style2';
    const glassOpacity = store.glassOpacity || 50;
    
    const currentColor = store.currentColor || '#FF0000';
    const setCurrentColor = store.setCurrentColor || (() => {});
    const colorPalettes = store.colorPalettes || [];
    const addPalette = store.addPalette || (() => {});
    const updatePalette = store.updatePalette || (() => {});
    const deletePalette = store.deletePalette || (() => {});
    const duplicatePalette = store.duplicatePalette || (() => {});
    const autoCopyColor = store.autoCopyColor;
    const isCopyPasteEnabled = store.isCopyPasteEnabled;
    const screenBounds = store.screenBounds;
    const isSmartPositioning = store.isPopupSmartPositioning ?? true;
    const isMac = store.isMac;
    const setEyeDropperOffset = store.setEyeDropperOffset || (() => {});
    const eyeDropperOffset = store.eyeDropperOffset || { x: 0, y: 0 };
    const orientation = store.orientation || 'vertical';
    const sidebarPosition = store.sidebarPosition;
    const language = store.language || 'en';

    const t = (key) => {
        const langDict = pluginTranslations[language] || pluginTranslations['en'];
        return langDict[key] || pluginTranslations['en'][key] || key;
    };

    const [activeTab, setActiveTab] = useState('wheel');
    const popupRef = useRef(null);
    const [editingPalette, setEditingPalette] = useState(null);
    const [hsv, setHsv] = useState(hexToHsv(currentColor));
    const [isDraggingSat, setIsDraggingSat] = useState(false);
    const [isDraggingHue, setIsDraggingHue] = useState(false);
    const satRectRef = useRef(null);
    const hueRectRef = useRef(null);

    useEffect(() => {
        setHsv(hexToHsv(currentColor));
    }, [currentColor]);

    const handleSatMove = (e) => {
        if (!satRectRef.current) return;
        const rect = satRectRef.current.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        
        const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
        
        const newS = Math.round(x * 100);
        const newV = Math.round(y * 100);
        
        setHsv(prev => [prev[0], newS, newV]);
        const newHex = hsvToHex(hsv[0], newS, newV);
        setCurrentColor(newHex);

        if (editingPalette) {
            const palette = colorPalettes.find(p => p.id === editingPalette.id);
            if (palette) {
                const newColors = [...palette.colors];
                newColors[editingPalette.index] = newHex;
                updatePalette(palette.id, { colors: newColors });
            }
        }
    };

    const handleHueMove = (e) => {
        if (!hueRectRef.current) return;
        const rect = hueRectRef.current.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        
        const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const newH = Math.round(x * 360);
        
        setHsv(prev => [newH, prev[1], prev[2]]);
        const newHex = hsvToHex(newH, hsv[1], hsv[2]);
        setCurrentColor(newHex);

        if (editingPalette) {
            const palette = colorPalettes.find(p => p.id === editingPalette.id);
            if (palette) {
                const newColors = [...palette.colors];
                newColors[editingPalette.index] = newHex;
                updatePalette(palette.id, { colors: newColors });
            }
        }
    };

    useEffect(() => {
        const handleGlobalMove = (e) => {
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
    }, [isDraggingSat, isDraggingHue, hsv]);

    const getPopupStyle = () => {
        if (!anchorRect) return { display: 'none' };
        
        const popupHeight = 450;
        const popupWidth = 320;
        const screenHeight = screenBounds?.height ?? 800;
        const screenWidth = screenBounds?.width ?? 1200;
        const offsetTop = sidebarPosition ? sidebarPosition.y : 0;
        const offsetLeft = sidebarPosition ? sidebarPosition.x : 0;

        const style = {
            position: 'absolute',
            zIndex: 99999,
            backgroundColor: design === 'style2' 
                ? `color-mix(in srgb, var(--theme-surface) ${glassOpacity}%, transparent)` 
                : 'var(--theme-surface)',
            borderColor: design === 'style2' ? 'rgba(255, 255, 255, 0.1)' : 'var(--theme-border)',
            backdropFilter: design === 'style2' ? (isMac ? 'blur(8px)' : 'blur(20px)') : 'none',
            WebkitBackdropFilter: design === 'style2' ? (isMac ? 'blur(8px)' : 'blur(20px)') : 'none',
            willChange: 'transform, opacity',
            transitionProperty: 'opacity, transform, filter'
        };

        const screenXInViewport = (screenBounds?.x ?? 0) - (window.screenX + eyeDropperOffset.x);
        const screenYInViewport = (screenBounds?.y ?? 0) - (window.screenY + eyeDropperOffset.y);

        if (orientation === "horizontal") {
            let adjustedLeft = (anchorRect.left - offsetLeft) + (anchorRect.width / 2) - (popupWidth / 2);
            const maxLeft = screenXInViewport + (screenWidth - offsetLeft) - popupWidth - 20;
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
            let adjustedTop = (anchorRect.top - offsetTop) - 20 + (anchorRect.height / 2) - (popupHeight / 2);
            const maxTop = screenYInViewport + (screenHeight - offsetTop) - popupHeight - 20;
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

    const isSmartRef = useRef(isSmartPositioning);
    useEffect(() => { isSmartRef.current = isSmartPositioning; }, [isSmartPositioning]);

    useEffect(() => {
        const onDrag = (e) => {
            if (!popupRef.current || !anchorRect || !isSmartRef.current) return;
            const newX = e.detail.x;
            const newY = e.detail.y;
            const popupHeight = 450;
            const popupWidth = 320;
            
            const screenXInViewport = (screenBounds?.x ?? 0) - (window.screenX + eyeDropperOffset.x);
            const screenYInViewport = (screenBounds?.y ?? 0) - (window.screenY + eyeDropperOffset.y);

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
    }, [anchorRect, screenBounds, orientation, eyeDropperOffset]);

    const handleEyeDropper = async () => {
        try {
            if ('EyeDropper' in window) {
                if (window.api?.startEyeDropper) {
                    const offset = await window.api.startEyeDropper();
                    setEyeDropperOffset(offset);
                }
                const eyeDropper = new window.EyeDropper();
                const result = await eyeDropper.open();
                const hex = result.sRGBHex.toUpperCase();
                setCurrentColor(hex);
                copyColor(hex);
            } else {
                alert(t('noEyeDropper'));
            }
        } catch (e) {
            console.log('EyeDropper cancelled or failed', e);
        } finally {
            if (window.api?.stopEyeDropper) {
                await window.api.stopEyeDropper();
            }
            setEyeDropperOffset({ x: 0, y: 0 });
        }
    };

    const copyColor = (hex) => {
        navigator.clipboard.writeText(hex);
        if (autoCopyColor && isCopyPasteEnabled && window.api?.writeToClipboard) {
            window.api.writeToClipboard({ type: 'text', content: hex });
        }
    };

    const copyColors = (hexes) => {
        hexes.forEach(hex => {
            if (window.api?.writeToClipboard) {
                window.api.writeToClipboard({ type: 'text', content: hex });
            }
        });
    };

    const generateHarmonies = (hex) => {
        const [h, s, l] = hexToHSL(hex);
        return [
            { name: t('analogous'), colors: [hslToHex((h + 330) % 360, s, l), hex, hslToHex((h + 30) % 360, s, l)] },
            { name: t('complementary'), colors: [hex, hslToHex((h + 180) % 360, s, l)] },
            { name: t('splitComplementary'), colors: [hex, hslToHex((h + 150) % 360, s, l), hslToHex((h + 210) % 360, s, l)] },
            { name: t('triadic'), colors: [hex, hslToHex((h + 120) % 360, s, l), hslToHex((h + 240) % 360, s, l)] },
            { name: t('tetradic'), colors: [hex, hslToHex((h + 90) % 360, s, l), hslToHex((h + 180) % 360, s, l), hslToHex((h + 270) % 360, s, l)] }
        ];
    };

    const renderColorBox = (hex, index) => (
        <button 
            key={`${hex}-${index}`} 
            onClick={() => copyColor(hex)}
            className="h-10 flex-1 rounded-md flex items-center justify-center font-bold text-xs shadow-inner cursor-pointer transition-transform hover:scale-105 active:scale-95 border border-black/10 text-shadow-sm"
            style={{ backgroundColor: hex, color: getContrastColor(hex) }}
            title={t('clickToCopy')}
        >
            {hex}
        </button>
    );

    const harmonies = generateHarmonies(currentColor);

    return (
        <div
            ref={popupRef}
            className="w-80 border p-4 shadow-2xl pointer-events-auto animate-in fade-in zoom-in duration-200 overflow-hidden rounded-xl"
            style={getPopupStyle()}
        >
            <div className="flex justify-between items-center mb-4">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold ml-1 drag-region w-full">{t('colorPicker')}</span>
                <div className="flex gap-1">
                    <button 
                        onClick={handleEyeDropper}
                        className="w-6 h-6 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 flex items-center justify-center transition-all no-drag-region"
                        title={t('pickColor')}
                    >
                        <span className="material-symbols-outlined text-[16px]">colorize</span>
                    </button>
                    <button 
                        onClick={onClose}
                        className="w-6 h-6 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-red-500/20 flex items-center justify-center transition-all no-drag-region"
                    >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                </div>
            </div>

            <div className="flex bg-black/20 p-1 rounded-lg mb-4">
                <button 
                    onClick={() => {
                        setActiveTab('wheel');
                        setEditingPalette(null);
                    }}
                    className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${activeTab === 'wheel' ? 'bg-white/10 shadow-sm text-white' : 'text-slate-400 hover:text-white'}`}
                >
                    Wheel & Harmonies
                </button>
                <button 
                    onClick={() => setActiveTab('palettes')}
                    className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${activeTab === 'palettes' ? 'bg-white/10 shadow-sm text-white' : 'text-slate-400 hover:text-white'}`}
                >
                    Palettes
                </button>
            </div>

            {activeTab === 'wheel' ? (
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col items-center">
                        <div 
                            ref={satRectRef}
                            className="w-full h-32 relative cursor-crosshair overflow-hidden border border-white/10 shadow-inner"
                            style={{ backgroundColor: `hsl(${hsv[0]}, 100%, 50%)` }}
                            onMouseDown={(e) => { setIsDraggingSat(true); handleSatMove(e); }}
                            onTouchStart={(e) => { setIsDraggingSat(true); handleSatMove(e); }}
                        >
                            <div className="absolute inset-0 bg-gradient-to-r from-white to-transparent"></div>
                            <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent"></div>
                            <div 
                                className="absolute w-3 h-3 border-2 border-white rounded-full shadow-lg -translate-x-1/2 translate-y-1/2 pointer-events-none"
                                style={{ 
                                    left: `${hsv[1]}%`, 
                                    bottom: `${hsv[2]}%`,
                                    backgroundColor: currentColor
                                }}
                            ></div>
                        </div>

                        <div 
                            ref={hueRectRef}
                            className="w-full h-3 mt-4 rounded-full relative cursor-pointer border border-white/10"
                            style={{ 
                                background: 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)' 
                            }}
                            onMouseDown={(e) => { setIsDraggingHue(true); handleHueMove(e); }}
                            onTouchStart={(e) => { setIsDraggingHue(true); handleHueMove(e); }}
                        >
                            <div 
                                className="absolute w-4 h-4 bg-white border border-slate-400 rounded-full shadow-md -top-0.5 -translate-x-1/2 pointer-events-none"
                                style={{ left: `${(hsv[0] / 360) * 100}%` }}
                            ></div>
                        </div>

                        <div className="flex items-center gap-3 w-full mt-4">
                            <div 
                                className="w-10 h-10 rounded-full border-2 shadow-sm"
                                style={{ backgroundColor: currentColor, borderColor: 'var(--theme-border)' }}
                            ></div>
                            <div className="flex-1 flex flex-col gap-1">
                                <div className="flex bg-black/30 rounded-lg p-0.5">
                                    <div className="flex-1 py-1 text-[10px] text-center font-bold text-primary bg-primary/10 rounded-md">HEX</div>
                                    <div className="flex-1 py-1 text-[10px] text-center font-bold text-slate-500 rounded-md">RGB</div>
                                </div>
                                <input 
                                    type="text" 
                                    className="bg-black/20 text-center uppercase font-bold text-sm tracking-widest text-slate-200 border rounded-lg py-1 w-full outline-none"
                                    style={{ borderColor: 'var(--theme-border)' }}
                                    value={currentColor}
                                    onChange={(e) => setCurrentColor(e.target.value.toUpperCase())}
                                />
                            </div>
                        </div>
                    </div>
                    
                    <div className="h-[1px] w-full bg-slate-700/50 my-1"></div>

                    <div className="h-64 overflow-y-auto pr-2 custom-scrollbar flex flex-col gap-4">
                        {harmonies.map((harmony, i) => (
                            <div key={i}>
                                <div className="flex justify-between items-end mb-1">
                                    <span className="text-xs text-slate-400">{harmony.name}</span>
                                    <button 
                                        onClick={() => copyColors(harmony.colors)}
                                        className="text-[10px] bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded text-slate-300 transition-colors"
                                    >
                                        {t('copyAll')}
                                    </button>
                                </div>
                                <div className="flex gap-1">
                                    {harmony.colors.map((hex, idx) => renderColorBox(hex, idx))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="flex flex-col gap-3 h-80 overflow-y-auto pr-2 custom-scrollbar">
                    <button 
                        onClick={() => addPalette({ id: Date.now().toString(), name: t('newPalette'), colors: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF'] })}
                        className="w-full py-2 bg-primary/10 text-primary border border-primary/20 rounded-lg text-sm hover:bg-primary/20 transition-colors flex items-center justify-center gap-2"
                    >
                        <span className="material-symbols-outlined text-sm">add</span>
                        {t('createNewPalette')}
                    </button>

                    {colorPalettes.length === 0 ? (
                        <div className="text-center text-slate-500 text-sm mt-8">{t('noPalettes')}</div>
                    ) : (
                        colorPalettes.map(palette => (
                            <div key={palette.id} className="bg-black/20 rounded-lg p-2 border" style={{ borderColor: 'var(--theme-border)' }}>
                                <div className="flex justify-between items-center mb-2">
                                    <input 
                                        type="text"
                                        className="bg-transparent text-sm font-medium text-slate-200 outline-none w-full"
                                        value={palette.name}
                                        onChange={(e) => updatePalette(palette.id, { name: e.target.value })}
                                    />
                                    <div className="flex gap-1">
                                        <button onClick={() => duplicatePalette(palette.id)} className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-white bg-white/5 rounded">
                                            <span className="material-symbols-outlined text-[13px]">content_copy</span>
                                        </button>
                                        <button onClick={() => deletePalette(palette.id)} className="w-5 h-5 flex items-center justify-center text-red-500 hover:text-red-400 bg-red-500/10 rounded">
                                            <span className="material-symbols-outlined text-[13px]">delete</span>
                                        </button>
                                    </div>
                                </div>
                                <div className="flex gap-1">
                                    {palette.colors.map((hex, index) => (
                                        <div key={index} className="flex flex-col gap-1 flex-1">
                                            <div 
                                                className={`h-8 rounded-sm shadow-inner cursor-pointer relative group flex items-center justify-center overflow-hidden border-2 transition-all
                                                    ${editingPalette?.id === palette.id && editingPalette?.index === index ? 'border-primary ring-2 ring-primary/20 scale-105' : 'border-black/20'}`}
                                                style={{ backgroundColor: hex }}
                                                onClick={() => {
                                                    setCurrentColor(hex);
                                                    setEditingPalette({ id: palette.id, index });
                                                    setActiveTab('wheel');
                                                }}
                                                title={t('clickToEdit')}
                                            >
                                                <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors flex items-center justify-center">
                                                    <span className="material-symbols-outlined text-white opacity-0 group-hover:opacity-100 text-sm transition-opacity">edit</span>
                                                </div>
                                            </div>
                                            <input 
                                                type="text" 
                                                value={hex}
                                                onChange={(e) => {
                                                    const newColors = [...palette.colors];
                                                    newColors[index] = e.target.value.toUpperCase();
                                                    updatePalette(palette.id, { colors: newColors });
                                                }}
                                                maxLength={7}
                                                className="bg-transparent text-[10px] text-center text-slate-400 hover:text-slate-200 focus:text-white outline-none w-full uppercase"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

window.KoBarExtensions.registerSidebarButton({
    id: 'kobar-colorpicker-plugin-btn',
    icon: 'palette',
    label: window.useAppStore.getState().t?.('colorPicker') || 'Color Picker',
    onClick: (e, anchorRect) => {
        const store = window.useAppStore.getState();
        const isOpen = store.activeExtensionPanelId === 'kobar-colorpicker-plugin-panel';
        
        store.closeAllUtilityPopups();
        
        if (!isOpen) {
            window.useAppStore.setState({ 
                activeExtensionPanelId: 'kobar-colorpicker-plugin-panel',
                activeExtensionAnchorRect: anchorRect
            });
        } else {
            window.useAppStore.setState({ 
                activeExtensionPanelId: null,
                activeExtensionAnchorRect: null
            });
        }
    }
});

window.KoBarExtensions.registerPanel('kobar-colorpicker-plugin-panel', {
    id: 'kobar-colorpicker-plugin-panel',
    render: (props) => React.createElement(ColorPickerPanel, {
        onClose: () => window.useAppStore.setState({ activeExtensionPanelId: null }),
        anchorRect: props.anchorRect
    })
});
