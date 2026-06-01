import fs from 'fs';

let content = fs.readFileSync('../../src/components/layout/CalculatorPopup.tsx', 'utf-8');

// 1. Remove all imports robustly (handles multi-line and single-line imports)
content = content.replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?[\r\n]+/gm, '');
// Also remove any remaining single line imports just in case
content = content.replace(/^import\b.*$/gm, '');

// 2. Add Prefix
const prefix = `// @ts-nocheck
const React = (window as any).React;
const { useState, useRef, useEffect } = React;

(window as any).CALC_TRANSLATIONS = {
    en: {
        calculator: "Calculator",
        currencyConverter: "Currency Converter",
        searchCurrency: "Search currency...",
        ratesUpdated: "Rates updated",
        failedToFetchRates: "Failed to fetch rates.",
        copyToClipboard: "Copy to clipboard",
        copied: "Copied!",
        basicMode: "Basic Mode",
        scientificMode: "Scientific Mode",
        refreshRates: "Refresh Rates",
        copyOutputValue: "Copy output value",
        swapCurrencies: "Swap currencies",
        selectCurrency: "Select Currency",
        noCurrenciesFound: "No currencies found",
        copy: "Copy",
        swap: "Swap"
    },
    tr: {
        calculator: "Hesap Makinesi",
        currencyConverter: "Döviz Çevirici",
        searchCurrency: "Para birimi ara...",
        ratesUpdated: "Kurlar güncellendi",
        failedToFetchRates: "Kurlar alınamadı.",
        copyToClipboard: "Panoya kopyala",
        copied: "Kopyalandı!",
        basicMode: "Temel Mod",
        scientificMode: "Bilimsel Mod",
        refreshRates: "Kurları Yenile",
        copyOutputValue: "Çıktı değerini kopyala",
        swapCurrencies: "Para birimlerini değiştir",
        selectCurrency: "Para Birimi Seç",
        noCurrenciesFound: "Para birimi bulunamadı",
        copy: "Kopyala",
        swap: "Değiştir"
    },
    de: {
        calculator: "Rechner",
        currencyConverter: "Währungsrechner",
        searchCurrency: "Währung suchen...",
        ratesUpdated: "Kurse aktualisiert",
        failedToFetchRates: "Kurse konnten nicht abgerufen werden.",
        copyToClipboard: "In Zwischenablage kopieren",
        copied: "Kopiert!",
        basicMode: "Standardmodus",
        scientificMode: "Wissenschaftlicher Modus",
        refreshRates: "Kurse aktualisieren",
        copyOutputValue: "Ausgabewert kopieren",
        swapCurrencies: "Währungen tauschen",
        selectCurrency: "Währung auswählen",
        noCurrenciesFound: "Keine Währungen gefunden",
        copy: "Kopieren",
        swap: "Tauschen"
    },
    fr: {
        calculator: "Calculatrice",
        currencyConverter: "Convertisseur de devises",
        searchCurrency: "Rechercher une devise...",
        ratesUpdated: "Taux mis à jour",
        failedToFetchRates: "Échec de la récupération des taux.",
        copyToClipboard: "Copier dans le presse-papiers",
        copied: "Copié !",
        basicMode: "Mode de base",
        scientificMode: "Mode scientifique",
        refreshRates: "Actualiser les taux",
        copyOutputValue: "Copier la valeur de sortie",
        swapCurrencies: "Échanger les devises",
        selectCurrency: "Sélectionner une devise",
        noCurrenciesFound: "Aucune devise trouvée",
        copy: "Copier",
        swap: "Échanger"
    },
    es: {
        calculator: "Calculadora",
        currencyConverter: "Conversor de divisas",
        searchCurrency: "Buscar divisa...",
        ratesUpdated: "Tasas actualizadas",
        failedToFetchRates: "Error al obtener tasas.",
        copyToClipboard: "Copiar al portapapeles",
        copied: "¡Copiado!",
        basicMode: "Modo Básico",
        scientificMode: "Modo Científico",
        refreshRates: "Actualizar tasas",
        copyOutputValue: "Copiar valor de salida",
        swapCurrencies: "Intercambiar divisas",
        selectCurrency: "Seleccionar divisa",
        noCurrenciesFound: "No se encontraron divisas",
        copy: "Copiar",
        swap: "Intercambiar"
    },
    ru: {
        calculator: "Калькулятор",
        currencyConverter: "Конвертер валют",
        searchCurrency: "Поиск валюты...",
        ratesUpdated: "Курсы обновлены",
        failedToFetchRates: "Не удалось получить курсы.",
        copyToClipboard: "Скопировать в буфер обмена",
        copied: "Скопировано!",
        basicMode: "Базовый режим",
        scientificMode: "Научный режим",
        refreshRates: "Обновить курсы",
        copyOutputValue: "Скопировать результат",
        swapCurrencies: "Поменять валюты",
        selectCurrency: "Выберите валюту",
        noCurrenciesFound: "Валюты не найдены",
        copy: "Копировать",
        swap: "Обмен"
    },
    ja: {
        calculator: "電卓",
        currencyConverter: "通貨換算",
        searchCurrency: "通貨を検索...",
        ratesUpdated: "レート更新済み",
        failedToFetchRates: "レートの取得に失敗しました。",
        copyToClipboard: "クリップボードにコピー",
        copied: "コピーしました！",
        basicMode: "基本モード",
        scientificMode: "関数電卓モード",
        refreshRates: "レートを更新",
        copyOutputValue: "出力値をコピー",
        swapCurrencies: "通貨を入れ替える",
        selectCurrency: "通貨を選択",
        noCurrenciesFound: "通貨が見つかりません",
        copy: "コピー",
        swap: "入替"
    },
    zh: {
        calculator: "计算器",
        currencyConverter: "货币转换器",
        searchCurrency: "搜索货币...",
        ratesUpdated: "汇率已更新",
        failedToFetchRates: "获取汇率失败。",
        copyToClipboard: "复制到剪贴板",
        copied: "已复制！",
        basicMode: "基本模式",
        scientificMode: "科学模式",
        refreshRates: "刷新汇率",
        copyOutputValue: "复制输出值",
        swapCurrencies: "交换货币",
        selectCurrency: "选择货币",
        noCurrenciesFound: "未找到货币",
        copy: "复制",
        swap: "交换"
    },
    ar: {
        calculator: "آلة حاسبة",
        currencyConverter: "محول العملات",
        searchCurrency: "ابحث عن العملة...",
        ratesUpdated: "تم تحديث الأسعار",
        failedToFetchRates: "فشل في جلب الأسعار.",
        copyToClipboard: "انسخ إلى الحافظة",
        copied: "تم النسخ!",
        basicMode: "الوضع الأساسي",
        scientificMode: "الوضع العلمي",
        refreshRates: "تحديث الأسعار",
        copyOutputValue: "نسخ القيمة الناتجة",
        swapCurrencies: "تبديل العملات",
        selectCurrency: "اختر العملة",
        noCurrenciesFound: "لم يتم العثور على عملات",
        copy: "نسخ",
        swap: "تبديل"
    },
    hi: {
        calculator: "कैलकुलेटर",
        currencyConverter: "मुद्रा परिवर्तक",
        searchCurrency: "मुद्रा खोजें...",
        ratesUpdated: "दरें अपडेट की गईं",
        failedToFetchRates: "दरें प्राप्त करने में विफल।",
        copyToClipboard: "क्लिपबोर्ड पर कॉपी करें",
        copied: "कॉपी किया गया!",
        basicMode: "मूल मोड",
        scientificMode: "वैज्ञानिक मोड",
        refreshRates: "दरें ताज़ा करें",
        copyOutputValue: "आउटपुट मान कॉपी करें",
        swapCurrencies: "मुद्राएं स्वैप करें",
        selectCurrency: "मुद्रा चुनें",
        noCurrenciesFound: "कोई मुद्रा नहीं मिली",
        copy: "कॉपी",
        swap: "स्वैप"
    }
};

function useStore(selector: any) {
    const selectorRef = useRef(selector);
    selectorRef.current = selector;
    const [state, setState] = useState(() => selectorRef.current((window as any).useAppStore.getState()));
    
    useEffect(() => {
        const checkUpdate = (newState: any) => {
            const newMappedState = selectorRef.current(newState);
            setState((prev: any) => {
                if (prev === newMappedState) return prev;
                return newMappedState;
            });
        };
        return (window as any).useAppStore.subscribe(checkUpdate);
    }, []);
    return state;
}
`;

// 3. Rename component and args
content = content.replace(/const CalculatorPopup: React.FC = \(\) => {/, 'const CalculatorPluginPanel = ({ onClose, anchorRect }: any) => {');

// 4. Replace useAppStore with useStore
content = content.replace(/useAppStore\(/g, 'useStore(');

// 5. Remove setIsCalculatorOpen
content = content.replace(/const\s+setIsCalculatorOpen\s*=\s*useStore\(state\s*=>\s*state\.setIsCalculatorOpen\);[\r\n]*/g, '');

// 6. Replace setIsCalculatorOpen(false) with onClose()
content = content.replace(/setIsCalculatorOpen\(false\)/g, 'onClose()');

// 7. Clipboard logic
content = content.replace(/const\s+forceAddClipboardItem\s*=\s*.*?;[\r\n]*/, '');
content = content.replace(/forceAddClipboardItem\?\.\(.*?\);[\r\n]*/g, '');

// 8. isScientific logic
content = content.replace(/const isScientific = useStore\(state => state\.isCalculatorScientific\);/g, "const [isScientific, setIsScientific] = useState(() => localStorage.getItem('kobar_calc_scientific') === 'true');");
content = content.replace(/const setIsScientific = useStore\(state => state\.setIsCalculatorScientific\);/g, "");
content = content.replace(/setIsScientific\(true\);/g, "setIsScientific(true); localStorage.setItem('kobar_calc_scientific', 'true');");
content = content.replace(/setIsScientific\(false\);/g, "setIsScientific(false); localStorage.setItem('kobar_calc_scientific', 'false');");

// 9. Remove calculatorAnchorRect from store
content = content.replace(/const\s+calculatorAnchorRect\s*=\s*useStore\(state\s*=>\s*state\.calculatorAnchorRect\);[\r\n]*/g, '');
content = content.replace(/calculatorAnchorRect/g, 'anchorRect');

// 10. export default CalculatorPopup; -> remove
content = content.replace(/export default CalculatorPopup;/g, '');

// Fix window.api TS error by casting
content = content.replace(/window\.api/g, '(window as any).api');

// 12. Bug Fixes (Keyboard, Mode Persistence)
content = content.replace(
    /if \(\/\[0-9\]\/\.test\(key\)\) \{[\s\S]*?handleParenClose\(\);\s*\}/,
    `if (/[0-9]/.test(key)) {
                if (mode === 'currency') handleCurrencyDigit(key);
                else handleDigit(key);
            } else if (key === '.' || key === ',') {
                if (mode === 'currency') handleCurrencyDot();
                else if (!display.includes('.')) handleDigit('.');
            } else if (key === 'Backspace') {
                if (mode === 'currency') handleCurrencyBackspace();
                else handleBackspace();
            } else if (key === 'Escape' || key.toLowerCase() === 'c') {
                if (mode === 'currency') handleCurrencyClear();
                else handleClear();
            } else if (mode !== 'currency') {
                if (key === '+') handleOperator('+');
                else if (key === '-') handleOperator('-');
                else if (key === '*' || key.toLowerCase() === 'x') handleOperator('×');
                else if (key === '/') handleOperator('÷');
                else if (key === 'Enter' || key === '=') { e.preventDefault(); handleEqual(); }
                else if (key === '(') handleParenOpen();
                else if (key === ')') handleParenClose();
            }`
);

content = content.replace(
    `const [mode, setMode] = useState<'basic' | 'scientific' | 'currency'>(isScientific ? 'scientific' : 'basic');`,
    `const [mode, setMode] = useState<'basic' | 'scientific' | 'currency'>(() => {
        return (localStorage.getItem('kobar_calc_plugin_mode') as any) || 'basic';
    });
    useEffect(() => {
        localStorage.setItem('kobar_calc_plugin_mode', mode);
    }, [mode]);`
);

content = content.replace(
    `if (mode === 'scientific') {
                                setMode('basic');
                                setIsScientific(false); localStorage.setItem('kobar_calc_scientific', 'false');
                            } else {
                                setMode('scientific');
                                setIsScientific(true); localStorage.setItem('kobar_calc_scientific', 'true');
                            }`,
    `if (mode === 'scientific') {
                                setMode('basic');
                                localStorage.setItem('kobar_calc_scientific', 'false');
                            } else {
                                setMode('scientific');
                                localStorage.setItem('kobar_calc_scientific', 'true');
                            }`
);

content = content.replace(
    `if (mode === 'currency') {
                                setMode(isScientific ? 'scientific' : 'basic');
                            } else {
                                setMode('currency');
                            }`,
    `if (mode === 'currency') {
                                const wasSci = localStorage.getItem('kobar_calc_scientific') === 'true';
                                setMode(wasSci ? 'scientific' : 'basic');
                            } else {
                                localStorage.setItem('kobar_calc_scientific', mode === 'scientific' ? 'true' : 'false');
                                setMode('currency');
                            }`
);

content = content.replace(
    `[anchorRect, screenBounds, isScientific, orientation, mode]`,
    `[anchorRect, screenBounds, orientation, mode]`
);

// 11. Add Registration
// 13. I18N replacements
content = content.replace(/const t = useStore\(state => state\.t\);/g, `const currentLang = useStore(state => state.language) || 'en';
    const t = (key: any) => ((window as any).CALC_TRANSLATIONS[currentLang] || (window as any).CALC_TRANSLATIONS['en'])[key] || key;`);

content = content.replace(/'Basic Mode' : 'Scientific Mode'/g, `t('basicMode') : t('scientificMode')`);
content = content.replace(/'Calculator Mode' : 'Currency Converter'/g, `t('calculator') : t('currencyConverter')`);
content = content.replace(/title="Refresh Rates"/g, `title={t('refreshRates')}`);
content = content.replace(/title="Copy output value"/g, `title={t('copyOutputValue')}`);
content = content.replace(/title="Swap currencies"/g, `title={t('swapCurrencies')}`);
content = content.replace(/>Copy</g, `>{t('copy')}<`);
content = content.replace(/>Swap</g, `>{t('swap')}<`);
content = content.replace(/Select Currency/g, `{t('selectCurrency')}`);
content = content.replace(/No currencies found/g, `{t('noCurrenciesFound')}`);

const registration = `
(window as any).KoBarExtensions.registerSidebarButton({
    id: 'com.kobar.calculator.plugin.btn',
    icon: 'calculate',
    label: 'Calculator',
    onClick: (e: any, btnAnchorRect: any) => {
        const store = (window as any).useAppStore.getState();
        const isOpen = store.activeExtensionPanelId === 'com.kobar.calculator.plugin.panel';
        store.closeAllUtilityPopups();
        if (!isOpen) {
            (window as any).useAppStore.setState({ 
                activeExtensionPanelId: 'com.kobar.calculator.plugin.panel',
                activeExtensionAnchorRect: btnAnchorRect
            });
        }
    }
});

(window as any).KoBarExtensions.registerPanel('com.kobar.calculator.plugin.panel', {
    id: 'com.kobar.calculator.plugin.panel',
    render: (props: any) => (window as any).React.createElement(CalculatorPluginPanel, props)
});
`;

fs.writeFileSync('index.tsx', prefix + content + registration);
console.log("Converted index.tsx");
