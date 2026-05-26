import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';

const POPULAR_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'INR', 'CAD', 'AUD', 'CHF', 'CNY'];

const FALLBACK_RATES: Record<string, number> = {
    USD: 1.0,
    EUR: 0.92,
    GBP: 0.79,
    JPY: 156.5,
    CAD: 1.36,
    AUD: 1.51,
    CHF: 0.91,
    CNY: 7.24,
    INR: 83.3,
    NZD: 1.63,
    SGD: 1.35,
    HKD: 7.81,
    SEK: 10.70,
    KRW: 1365.0,
    TRY: 32.2,
    MXN: 16.7,
    BRL: 5.15,
    RUB: 90.0,
    ZAR: 18.4,
    NOK: 10.6,
    DKK: 6.87,
    PLN: 3.93,
    AED: 3.67,
    SAR: 3.75,
    THB: 36.5,
    MYR: 4.71,
    IDR: 16000.0,
    PHP: 58.2,
    ILS: 3.70,
    TWD: 32.2,
    VND: 25400.0
};

const CURRENCY_DETAILS: Record<string, { name: string; flag: string }> = {
    USD: { name: 'US Dollar', flag: '🇺🇸' },
    EUR: { name: 'Euro', flag: '🇪🇺' },
    GBP: { name: 'British Pound', flag: '🇬🇧' },
    JPY: { name: 'Japanese Yen', flag: '🇯🇵' },
    CAD: { name: 'Canadian Dollar', flag: '🇨🇦' },
    AUD: { name: 'Australian Dollar', flag: '🇦🇺' },
    CHF: { name: 'Swiss Franc', flag: '🇨🇭' },
    CNY: { name: 'Chinese Yuan', flag: '🇨🇳' },
    INR: { name: 'Indian Rupee', flag: '🇮🇳' },
    NZD: { name: 'New Zealand Dollar', flag: '🇳🇿' },
    SGD: { name: 'Singapore Dollar', flag: '🇸🇬' },
    HKD: { name: 'Hong Kong Dollar', flag: '🇭🇰' },
    SEK: { name: 'Swedish Krona', flag: '🇸🇪' },
    KRW: { name: 'South Korean Won', flag: '🇰🇷' },
    TRY: { name: 'Turkish Lira', flag: '🇹🇷' },
    MXN: { name: 'Mexican Peso', flag: '🇲🇽' },
    BRL: { name: 'Brazilian Real', flag: '🇧🇷' },
    RUB: { name: 'Russian Ruble', flag: '🇷🇺' },
    ZAR: { name: 'South African Rand', flag: '🇿🇦' },
    NOK: { name: 'Norwegian Krone', flag: '🇳🇴' },
    DKK: { name: 'Danish Krone', flag: '🇩🇰' },
    PLN: { name: 'Polish Zloty', flag: '🇵🇱' },
    AED: { name: 'UAE Dirham', flag: '🇦🇪' },
    SAR: { name: 'Saudi Riyal', flag: '🇸🇦' },
    THB: { name: 'Thai Baht', flag: '🇹🇭' },
    MYR: { name: 'Malaysian Ringgit', flag: '🇲🇾' },
    IDR: { name: 'Indonesian Rupiah', flag: '🇮🇩' },
    PHP: { name: 'Philippine Peso', flag: '🇵🇭' },
    ILS: { name: 'Israeli New Shekel', flag: '🇮🇱' },
    ARS: { name: 'Argentine Peso', flag: '🇦🇷' },
    CLP: { name: 'Chilean Peso', flag: '🇨🇱' },
    COP: { name: 'Colombian Peso', flag: '🇨🇴' },
    EGP: { name: 'Egyptian Pound', flag: '🇪🇬' },
    VND: { name: 'Vietnamese Dong', flag: '🇻🇳' },
    KWD: { name: 'Kuwaiti Dinar', flag: '🇰🇼' },
    QAR: { name: 'Qatari Rial', flag: '🇶🇦' },
    HUF: { name: 'Hungarian Forint', flag: '🇭🇺' },
    CZK: { name: 'Czech Koruna', flag: '🇨🇿' },
    RON: { name: 'Romanian Leu', flag: '🇷🇴' },
    UAH: { name: 'Ukrainian Hryvnia', flag: '🇺🇦' },
    NGN: { name: 'Nigerian Naira', flag: '🇳🇬' },
    PKR: { name: 'Pakistani Rupee', flag: '🇵🇰' },
    BDT: { name: 'Bangladeshi Taka', flag: '🇧🇩' },
    LKR: { name: 'Sri Lankan Rupee', flag: '🇱🇰' },
    TWD: { name: 'New Taiwan Dollar', flag: '🇹🇼' }
};

const CalculatorPopup: React.FC = () => {
    const t = useAppStore(state => state.t);
    const isSmartPositioning = useAppStore(state => state.isPopupSmartPositioning);
    const edgePosition = useAppStore(state => state.edgePosition);
    const calculatorAnchorRect = useAppStore(state => state.calculatorAnchorRect);
    const setIsCalculatorOpen = useAppStore(state => state.setIsCalculatorOpen);
    const design = useAppStore(state => state.design);
    const glassOpacity = useAppStore(state => state.glassOpacity);
    const isMac = useAppStore(state => state.isMac);
    const screenBounds = useAppStore(state => state.screenBounds);
    const [display, setDisplay] = useState('0');
    const [prevValue, setPrevValue] = useState<number | null>(null);
    const [operator, setOperator] = useState<string | null>(null);
    const [waitingForOperand, setWaitingForOperand] = useState(false);
    const [parenStack, setParenStack] = useState<Array<{ prevValue: number | null, operator: string | null }>>([]);
    const operatorJustPressed = useRef(false);
    const isScientific = useAppStore(state => state.isCalculatorScientific);
    const setIsScientific = useAppStore(state => state.setIsCalculatorScientific);
    const [angleMode, setAngleMode] = useState<'DEG' | 'RAD'>('DEG');
    const [memory, setMemory] = useState<number>(0);
    const [history, setHistory] = useState<string[]>([]);

    const [mode, setMode] = useState<'basic' | 'scientific' | 'currency'>(isScientific ? 'scientific' : 'basic');
    const [rates, setRates] = useState<Record<string, number>>(FALLBACK_RATES);
    const [ratesLoading, setRatesLoading] = useState(false);
    const [ratesError, setRatesError] = useState<string | null>(null);
    const [fromCurrency, setFromCurrency] = useState('USD');
    const [toCurrency, setToCurrency] = useState(() => {
        const cachedStr = localStorage.getItem('kobar_default_to_currency');
        if (cachedStr) {
            try {
                const parsed = JSON.parse(cachedStr);
                if (parsed && typeof parsed === 'object' && parsed.currency) {
                    return parsed.currency;
                }
            } catch (e) {
                return cachedStr; // Handle raw string cache from old build
            }
        }
        return 'EUR';
    });
    const [currencyAmount, setCurrencyAmount] = useState('1');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectorMode, setSelectorMode] = useState<'from' | 'to' | null>(null);
    const [copyFeedback, setCopyFeedback] = useState(false);
    const [lastFetched, setLastFetched] = useState<Date | null>(null);

    // Fetch and caching rates
    const fetchRates = async () => {
        setRatesLoading(true);
        setRatesError(null);
        try {
            const res = await fetch('https://open.er-api.com/v6/latest/USD');
            if (!res.ok) throw new Error('Network response was not ok');
            const data = await res.json();
            if (data && data.rates) {
                setRates(data.rates);
                const now = Date.now();
                setLastFetched(new Date(now));
                localStorage.setItem('kobar_exchange_rates', JSON.stringify({
                    rates: data.rates,
                    timestamp: now
                }));
            } else {
                throw new Error('Invalid rate data');
            }
        } catch (err) {
            console.error('Failed to fetch exchange rates:', err);
            setRatesError('failed');
            const cached = localStorage.getItem('kobar_exchange_rates');
            if (cached) {
                try {
                    const { rates: cachedRates, timestamp } = JSON.parse(cached);
                    if (cachedRates) {
                        setRates(cachedRates);
                        if (timestamp) setLastFetched(new Date(timestamp));
                        return;
                    }
                } catch (e) {}
            }
            setRates(FALLBACK_RATES);
        } finally {
            setRatesLoading(false);
        }
    };

    useEffect(() => {
        if (mode === 'currency') {
            const cached = localStorage.getItem('kobar_exchange_rates');
            if (cached) {
                try {
                    const { rates: cachedRates, timestamp } = JSON.parse(cached);
                    if (cachedRates && timestamp && (Date.now() - timestamp < 43200000)) {
                        setRates(cachedRates);
                        setLastFetched(new Date(timestamp));
                        setRatesLoading(false);
                        return;
                    }
                } catch (e) {}
            }
            fetchRates();
        }
    }, [mode]);

    useEffect(() => {
        const detectLocalCurrency = async () => {
            const cachedStr = localStorage.getItem('kobar_default_to_currency');
            if (cachedStr) {
                try {
                    const parsed = JSON.parse(cachedStr);
                    if (parsed && typeof parsed === 'object') {
                        const { currency, timestamp } = parsed;
                        // Expire cache after 1 hour to detect location/VPN changes
                        if (currency && CURRENCY_DETAILS[currency] && timestamp && (Date.now() - timestamp < 3600000)) {
                            setToCurrency(currency);
                            return;
                        }
                    }
                } catch (e) {
                    // Raw string format or invalid, proceed to fetch
                }
            }

            try {
                const res = await fetch('https://ipapi.co/json/');
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.currency && CURRENCY_DETAILS[data.currency]) {
                        setToCurrency(data.currency);
                        localStorage.setItem('kobar_default_to_currency', JSON.stringify({
                            currency: data.currency,
                            timestamp: Date.now()
                        }));
                        return;
                    }
                }
            } catch (err) {
                console.warn('Failed to fetch IP-based currency:', err);
            }

            // Fallback: try to guess by locale/timezone
            try {
                const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
                const tzCurrencyMap: Record<string, string> = {
                    'Asia/Kolkata': 'INR',
                    'Asia/Calcutta': 'INR',
                    'Europe/London': 'GBP',
                    'Europe/Paris': 'EUR',
                    'Europe/Berlin': 'EUR',
                    'Europe/Rome': 'EUR',
                    'Europe/Madrid': 'EUR',
                    'Europe/Amsterdam': 'EUR',
                    'Asia/Tokyo': 'JPY',
                    'Asia/Shanghai': 'CNY',
                    'Asia/Hong_Kong': 'HKD',
                    'Asia/Singapore': 'SGD',
                    'Australia/Sydney': 'AUD',
                    'Australia/Melbourne': 'AUD',
                    'America/Toronto': 'CAD',
                    'America/Vancouver': 'CAD',
                    'America/Mexico_City': 'MXN',
                    'America/Sao_Paulo': 'BRL',
                    'Europe/Istanbul': 'TRY',
                    'Asia/Dubai': 'AED',
                    'Asia/Riyadh': 'SAR',
                    'Asia/Bangkok': 'THB',
                    'Asia/Seoul': 'KRW',
                    'Europe/Moscow': 'RUB',
                };
                
                let matchedCurrency = tzCurrencyMap[tz];
                if (!matchedCurrency) {
                    for (const [key, val] of Object.entries(tzCurrencyMap)) {
                        if (tz.startsWith(key.split('/')[0])) {
                            matchedCurrency = val;
                            break;
                        }
                    }
                }
                
                if (matchedCurrency && CURRENCY_DETAILS[matchedCurrency]) {
                    setToCurrency(matchedCurrency);
                    localStorage.setItem('kobar_default_to_currency', JSON.stringify({
                        currency: matchedCurrency,
                        timestamp: Date.now()
                    }));
                    return;
                }
            } catch (e) {}
        };

        detectLocalCurrency();
    }, []);

    const handleCurrencyDigit = (digit: string) => {
        if (currencyAmount === '0') {
            setCurrencyAmount(digit === '00' ? '0' : digit);
        } else if (currencyAmount.length < 12) {
            setCurrencyAmount(currencyAmount + digit);
        }
    };

    const handleCurrencyBackspace = () => {
        if (currencyAmount.length <= 1) {
            setCurrencyAmount('0');
        } else {
            setCurrencyAmount(currencyAmount.slice(0, -1));
        }
    };

    const handleCurrencyClear = () => {
        setCurrencyAmount('0');
    };

    const handleCurrencyDot = () => {
        if (!currencyAmount.includes('.')) {
            setCurrencyAmount(currencyAmount + '.');
        }
    };

    const handleSwapCurrencies = () => {
        const temp = fromCurrency;
        setFromCurrency(toCurrency);
        setToCurrency(temp);
    };

    const fromRate = rates[fromCurrency] || 1;
    const toRate = rates[toCurrency] || 1;
    const amountVal = parseFloat(currencyAmount) || 0;
    const convertedVal = amountVal * (toRate / fromRate);
    const convertedAmountStr = isNaN(convertedVal) ? '0.00' : convertedVal.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    const currentRateStr = `1 ${fromCurrency} = ${(toRate / fromRate).toFixed(4)} ${toCurrency}`;
    const lastFetchedStr = lastFetched 
        ? lastFetched.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) 
        : '';

    const popupRef = useRef<HTMLDivElement>(null);

    const orientation = useAppStore(state => state.orientation);

    // We need sidebarPosition because if it exists, our wrapper is absolute, which shifts the coordinate space.
    const sidebarPosition = useAppStore(state => state.sidebarPosition);

    const getPopupStyle = (): React.CSSProperties => {
        if (!calculatorAnchorRect) return { display: 'none' };
        
        const popupHeight = mode === 'scientific' ? 570 : 500;
        const popupWidth = mode === 'scientific' ? 360 : mode === 'currency' ? 320 : 280;
        const screenHeight = screenBounds?.height ?? 800;
        const screenWidth = screenBounds?.width ?? 1200;
        const offsetTop = sidebarPosition ? sidebarPosition.y : 0;
        const offsetLeft = sidebarPosition ? sidebarPosition.x : 0;

        const style: React.CSSProperties = {
            position: 'absolute',
            zIndex: 99999,
            width: `${popupWidth}px`,
            pointerEvents: 'auto',
            backgroundColor: design === 'style2' 
                ? `color-mix(in srgb, var(--theme-surface) ${glassOpacity}%, transparent)` 
                : 'var(--theme-surface)',
            borderColor: design === 'style2' ? 'rgba(255, 255, 255, 0.1)' : 'var(--theme-border)',
            backdropFilter: design === 'style2' ? (isMac ? 'blur(8px)' : 'blur(20px)') : 'none',
            WebkitBackdropFilter: design === 'style2' ? (isMac ? 'blur(8px)' : 'blur(20px)') : 'none',
            willChange: 'transform, opacity',
            transition: 'width 0.3s ease'
        };

        const screenXInViewport = (screenBounds?.x ?? 0) - window.screenX;
        const screenYInViewport = (screenBounds?.y ?? 0) - window.screenY;

        if (orientation === "horizontal") {
            let adjustedLeft = screenXInViewport + (screenWidth / 2) - (popupWidth / 2) - offsetLeft;
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
            let adjustedTop = screenYInViewport + (screenHeight / 2) - (popupHeight / 2) - offsetTop;
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
    React.useEffect(() => { isSmartRef.current = isSmartPositioning; }, [isSmartPositioning]);

    React.useEffect(() => {
        const onDrag = (e: any) => {
            if (!popupRef.current || !calculatorAnchorRect || !isSmartRef.current) return;
            const newX = e.detail.x;
            const newY = e.detail.y;
            const popupHeight = mode === 'scientific' ? 570 : 500;
            const popupWidth = mode === 'scientific' ? 360 : mode === 'currency' ? 320 : 280;
            
            const screenXInViewport = (screenBounds?.x ?? 0) - window.screenX;
            const screenYInViewport = (screenBounds?.y ?? 0) - window.screenY;

            if (orientation === "horizontal") {
                const screenWidth = screenBounds?.width ?? 1200;
                let adjustedLeft = screenXInViewport + (screenWidth / 2) - (popupWidth / 2) - newX;
                const maxLeft = screenXInViewport + (screenWidth - newX) - popupWidth - 20;
                const minLeft = screenXInViewport - newX + 20;
                if (adjustedLeft < minLeft) adjustedLeft = minLeft;
                if (adjustedLeft > maxLeft) adjustedLeft = maxLeft;
                popupRef.current.style.left = `${adjustedLeft}px`;

            } else {
                const screenHeight = screenBounds?.height ?? 800;
                let adjustedTop = screenYInViewport + (screenHeight / 2) - (popupHeight / 2) - newY;
                const maxTop = screenYInViewport + (screenHeight - newY) - popupHeight - 20;
                const minTop = screenYInViewport - newY + 20;
                if (adjustedTop < minTop) adjustedTop = minTop;
                if (adjustedTop > maxTop) adjustedTop = maxTop;
                popupRef.current.style.top = `${adjustedTop}px`;

            }
        };
        document.addEventListener('kobar-drag', onDrag);
        return () => document.removeEventListener('kobar-drag', onDrag);
    }, [calculatorAnchorRect, screenBounds, isScientific, orientation, mode]);

    const handleDigit = (digit: string) => {
        operatorJustPressed.current = false;
        if (waitingForOperand) {
            setDisplay(digit === '00' ? '0' : digit);
            setWaitingForOperand(false);
        } else {
            if (display === '0') {
                setDisplay(digit === '00' ? '0' : digit);
            } else {
                setDisplay(display + digit);
            }
        }
    };

    const handleOperator = (nextOperator: string) => {
        if (operatorJustPressed.current) {
            setOperator(nextOperator);
            return;
        }

        const inputValue = parseFloat(display);

        if (prevValue === null) {
            setPrevValue(inputValue);
        } else if (operator) {
            const result = performCalculation();
            const cleanStr = formatDisplay(result);
            setPrevValue(parseFloat(cleanStr));
            setDisplay(cleanStr);
        }

        setWaitingForOperand(true);
        setOperator(nextOperator);
        operatorJustPressed.current = true;
    };

    const performCalculation = () => {
        const inputValue = parseFloat(display);
        if (prevValue === null || operator === null) return inputValue;

        switch (operator) {
            case '+': return prevValue + inputValue;
            case '-': return prevValue - inputValue;
            case '×': return prevValue * inputValue;
            case '÷': return inputValue !== 0 ? prevValue / inputValue : NaN;
            case '^': return Math.pow(prevValue, inputValue);
            case 'mod': {
                const res = prevValue % inputValue;
                return Math.abs(res) < 1e-12 ? 0 : res;
            }
            default: return inputValue;
        }
    };

    const handleEqual = () => {
        operatorJustPressed.current = false;
        if (!operator) return;
        const expression = `${formatDisplay(prevValue!)} ${operator} ${formatDisplay(display)}`;
        const result = performCalculation();
        const resultStr = formatDisplay(result);
        setHistory(prev => [`${expression} = ${resultStr}`, ...prev].slice(0, 10));
        setDisplay(resultStr);
        setPrevValue(null);
        setOperator(null);
        setWaitingForOperand(true);
    };

    const handleClear = () => {
        operatorJustPressed.current = false;
        setDisplay('0');
        setPrevValue(null);
        setOperator(null);
        setWaitingForOperand(false);
        setParenStack([]);
    };

    const handleBackspace = () => {
        if (operatorJustPressed.current) return;
        
        setWaitingForOperand(false);
        
        if (display === '0') return;
        if (display.length === 1) {
            setDisplay('0');
        } else {
            setDisplay(display.slice(0, -1));
        }
    };

    const handleParenOpen = () => {
        operatorJustPressed.current = false;
        setParenStack([...parenStack, { prevValue, operator }]);
        setPrevValue(null);
        setOperator(null);
        setDisplay('0');
        setWaitingForOperand(true);
    };

    const handleParenClose = () => {
        operatorJustPressed.current = false;
        if (parenStack.length === 0) return;
        
        let result = parseFloat(display);
        if (prevValue !== null && operator !== null) {
            result = performCalculation();
        }
        
        const newStack = [...parenStack];
        const { prevValue: savedPrev, operator: savedOp } = newStack.pop()!;
        setParenStack(newStack);
        
        setDisplay(formatDisplay(result));
        setPrevValue(savedPrev);
        setOperator(savedOp);
        setWaitingForOperand(true);
    };

    // Scientific functions
    const toRadians = (deg: number) => (deg * Math.PI) / 180;
    const getAngleInput = (val: number) => angleMode === 'DEG' ? toRadians(val) : val;

    const handleScientific = (fn: string) => {
        operatorJustPressed.current = false;
        const val = parseFloat(display);
        let result: number;

        switch (fn) {
            case 'sin': result = Math.sin(getAngleInput(val)); break;
            case 'cos': result = Math.cos(getAngleInput(val)); break;
            case 'tan': result = Math.tan(getAngleInput(val)); break;
            case 'asin': result = angleMode === 'DEG' ? (Math.asin(val) * 180 / Math.PI) : Math.asin(val); break;
            case 'acos': result = angleMode === 'DEG' ? (Math.acos(val) * 180 / Math.PI) : Math.acos(val); break;
            case 'atan': result = angleMode === 'DEG' ? (Math.atan(val) * 180 / Math.PI) : Math.atan(val); break;
            case 'ln': result = Math.log(val); break;
            case 'log': result = Math.log10(val); break;
            case '√': result = Math.sqrt(val); break;
            case '∛': result = Math.cbrt(val); break;
            case 'x²': result = val * val; break;
            case 'x³': result = val * val * val; break;
            case '1/x': result = val !== 0 ? 1 / val : NaN; break;
            case 'n!': result = factorial(val); break;
            case '|x|': result = Math.abs(val); break;
            case 'e^x': result = Math.exp(val); break;
            case '10^x': result = Math.pow(10, val); break;
            case '±': result = -val; break;
            case '%': result = val / 100; break;
            default: result = val;
        }

        setDisplay(formatDisplay(result));
        setWaitingForOperand(true);
    };

    const factorial = (n: number): number => {
        if (n < 0 || !Number.isInteger(n)) return NaN;
        if (n <= 1) return 1;
        if (n > 170) return Infinity;
        let result = 1;
        for (let i = 2; i <= n; i++) result *= i;
        return result;
    };

    const insertConstant = (val: number) => {
        operatorJustPressed.current = false;
        setDisplay(String(val));
        setWaitingForOperand(true);
    };

    const formatDisplay = (val: number | string): string => {
        const num = typeof val === 'string' ? parseFloat(val) : val;
        if (isNaN(num)) return 'Error';
        if (!isFinite(num)) return '∞';
        
        const str = typeof val === 'string' ? val : String(num);
        if (str.length > 14) {
            const cleanNum = parseFloat(num.toPrecision(12));
            let formatted = String(cleanNum);
            if (formatted.length > 14) {
                formatted = cleanNum.toExponential(8).replace(/\.?0+e/, 'e');
            }
            return formatted;
        }
        return str;
    };

    // Memory functions
    const handleMemory = (action: string) => {
        operatorJustPressed.current = false;
        const val = parseFloat(display);
        switch (action) {
            case 'MC': setMemory(0); break;
            case 'MR': setDisplay(formatDisplay(memory)); setWaitingForOperand(true); break;
            case 'M+': setMemory(memory + val); break;
            case 'M-': setMemory(memory - val); break;
        }
    };

    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName || '')) return;

            const { key } = e;

            if (mode !== 'currency') {
                if (/[0-9]/.test(key)) {
                    handleDigit(key);
                } else if (key === '.' || key === ',') {
                    if (!display.includes('.')) handleDigit('.');
                } else if (key === '+') {
                    handleOperator('+');
                } else if (key === '-') {
                    handleOperator('-');
                } else if (key === '*' || key.toLowerCase() === 'x') {
                    handleOperator('×');
                } else if (key === '/') {
                    handleOperator('÷');
                } else if (key === 'Enter' || key === '=') {
                    e.preventDefault();
                    handleEqual();
                } else if (key === 'Backspace') {
                    handleBackspace();
                } else if (key === 'Escape' || key.toLowerCase() === 'c') {
                    handleClear();
                } else if (key === '(') {
                    handleParenOpen();
                } else if (key === ')') {
                    handleParenClose();
                }
            } else {
                if (/[0-9]/.test(key)) {
                    handleCurrencyDigit(key);
                } else if (key === '.' || key === ',') {
                    handleCurrencyDot();
                } else if (key === 'Backspace') {
                    handleCurrencyBackspace();
                } else if (key === 'Escape' || key.toLowerCase() === 'c') {
                    handleCurrencyClear();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [display, prevValue, operator, waitingForOperand, parenStack, mode, currencyAmount]);

    const CalcButton = ({ onClick, children, className = '', title }: { onClick: () => void; children: React.ReactNode; className?: string; title?: string }) => (
        <button
            onClick={onClick}
            className={`h-10 flex items-center justify-center rounded-lg text-sm font-medium transition-all active:scale-95 no-drag-region ${className}`}
            title={title}
        >
            {children}
        </button>
    );

    const SciFnButton = ({ onClick, children, title }: { onClick: () => void; children: React.ReactNode; title?: string }) => (
        <button
            onClick={onClick}
            className="h-9 flex items-center justify-center rounded-md text-[11px] font-semibold bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 border border-indigo-500/15 transition-all active:scale-95 no-drag-region"
            title={title}
        >
            {children}
        </button>
    );

    return (
        <div
            ref={popupRef}
            className="border p-4 shadow-2xl pointer-events-auto animate-in fade-in zoom-in duration-200 transition-all overflow-hidden rounded-xl"
            style={getPopupStyle()}
        >
            {/* Header */}
            <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold ml-1">
                        {mode === 'currency' ? t('currencyConverter') : t('calculator')}
                    </span>
                    {mode === 'scientific' && (
                        <button
                            onClick={() => setAngleMode(angleMode === 'DEG' ? 'RAD' : 'DEG')}
                            className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-primary/15 text-primary border border-primary/20 hover:bg-primary/25 transition-all no-drag-region"
                        >
                            {angleMode}
                        </button>
                    )}
                </div>
                <div className="flex items-center gap-1.5">
                    {/* Scientific Mode Toggle */}
                    <button 
                        onClick={() => {
                            if (mode === 'scientific') {
                                setMode('basic');
                                setIsScientific(false);
                            } else {
                                setMode('scientific');
                                setIsScientific(true);
                            }
                        }}
                        className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all no-drag-region ${mode === 'scientific' ? 'bg-primary/20 text-primary' : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'}`}
                        title={mode === 'scientific' ? 'Basic Mode' : 'Scientific Mode'}
                    >
                        <span className="material-symbols-outlined text-[16px]">function</span>
                    </button>

                    {/* Currency Mode Toggle */}
                    <button 
                        onClick={() => {
                            if (mode === 'currency') {
                                setMode(isScientific ? 'scientific' : 'basic');
                            } else {
                                setMode('currency');
                            }
                        }}
                        className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all no-drag-region ${mode === 'currency' ? 'bg-primary/20 text-primary' : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'}`}
                        title={mode === 'currency' ? 'Calculator Mode' : 'Currency Converter'}
                    >
                        <span className="material-symbols-outlined text-[16px]">payments</span>
                    </button>

                    <button 
                        onClick={() => setIsCalculatorOpen(false)}
                        className="w-6 h-6 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-red-500/20 flex items-center justify-center transition-all no-drag-region"
                    >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                </div>
            </div>

            {mode === 'currency' ? (
                <div className="flex-1 flex flex-col">
                    {/* Currency inputs display block */}
                    <div className="bg-black/20 rounded-lg p-3 mb-3 border flex flex-col gap-2 relative" style={{ borderColor: 'var(--theme-border)' }}>
                        
                        {/* Source Currency Input Row */}
                        <div className="flex items-center justify-between gap-2">
                            <button
                                onClick={() => setSelectorMode('from')}
                                className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 transition-all text-xs font-semibold no-drag-region"
                            >
                                <span>{CURRENCY_DETAILS[fromCurrency]?.flag || '🪙'}</span>
                                <span className="font-bold">{fromCurrency}</span>
                                <span className="material-symbols-outlined text-[14px] text-slate-400">arrow_drop_down</span>
                            </button>
                            <div className="text-xl font-bold text-slate-200 tracking-tight truncate flex-1 text-right max-w-[180px]">
                                {currencyAmount}
                            </div>
                        </div>

                        {/* Target Currency Output Row */}
                        <div className="flex items-center justify-between gap-2">
                            <button
                                onClick={() => setSelectorMode('to')}
                                className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 transition-all text-xs font-semibold no-drag-region"
                            >
                                <span>{CURRENCY_DETAILS[toCurrency]?.flag || '🪙'}</span>
                                <span className="font-bold">{toCurrency}</span>
                                <span className="material-symbols-outlined text-[14px] text-slate-400">arrow_drop_down</span>
                            </button>
                            <div className="flex items-center justify-end flex-1 min-w-0">
                                <div className="text-xl font-bold text-primary truncate max-w-[150px] mr-1.5">
                                    {convertedAmountStr}
                                </div>
                            </div>
                        </div>

                        {/* Middle Rate & Swap Divider (Footer) */}
                        <div className="flex items-center justify-between border-t border-white/5 pt-1.5 mt-0.5 text-[10px]">
                            <div className="text-slate-500 font-medium flex flex-col gap-0.5">
                                <div className="flex items-center gap-1">
                                    <span>{currentRateStr}</span>
                                    <button 
                                        onClick={fetchRates}
                                        disabled={ratesLoading}
                                        className={`p-0.5 rounded hover:bg-white/5 active:scale-95 transition-all text-slate-400 hover:text-white inline-flex items-center justify-center no-drag-region ${ratesLoading ? 'animate-spin' : ''}`}
                                        title="Refresh Rates"
                                    >
                                        <span className="material-symbols-outlined text-[10px]">refresh</span>
                                    </button>
                                </div>
                                {lastFetchedStr && (
                                    <div className="text-[8px] text-slate-600">
                                        {t('ratesUpdated')}: {lastFetchedStr}
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center gap-1.5 no-drag-region">
                                <button
                                    onClick={() => {
                                        const cleanVal = convertedAmountStr.replace(/[^\d.]/g, '');
                                        navigator.clipboard.writeText(cleanVal);
                                        setCopyFeedback(true);
                                        setTimeout(() => setCopyFeedback(false), 1500);
                                    }}
                                    className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center hover:bg-primary/20 hover:scale-110 active:scale-95 transition-all relative"
                                    title={t('copyToClipboard')}
                                >
                                    <span className="material-symbols-outlined text-[14px]">
                                        {copyFeedback ? 'check' : 'content_copy'}
                                    </span>
                                    {copyFeedback && (
                                        <span className="absolute bottom-full right-0 mb-1 px-1.5 py-0.5 text-[8px] bg-slate-950 text-white rounded border border-white/10 whitespace-nowrap animate-bounce">
                                            {t('copied')}
                                        </span>
                                    )}
                                </button>
                                <button
                                    onClick={handleSwapCurrencies}
                                    className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center hover:bg-primary/20 hover:scale-110 active:scale-95 transition-all"
                                    title="Swap Currencies"
                                >
                                    <span className="material-symbols-outlined text-[14px] font-bold">swap_vert</span>
                                </button>
                            </div>
                        </div>

                        {ratesError && (
                            <div className="text-[9px] text-yellow-500 font-medium text-center mt-1">
                                {t('failedToFetchRates')}
                            </div>
                        )}
                    </div>

                    {/* Currency Keypad */}
                    <div className="grid grid-cols-4 gap-2">
                        <CalcButton onClick={() => handleCurrencyDigit('7')} className="bg-slate-700/50 text-slate-200 hover:bg-slate-700">7</CalcButton>
                        <CalcButton onClick={() => handleCurrencyDigit('8')} className="bg-slate-700/50 text-slate-200 hover:bg-slate-700">8</CalcButton>
                        <CalcButton onClick={() => handleCurrencyDigit('9')} className="bg-slate-700/50 text-slate-200 hover:bg-slate-700">9</CalcButton>
                        <CalcButton onClick={handleCurrencyBackspace} className="bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20" title="Backspace">
                            <span className="material-symbols-outlined text-[16px]">backspace</span>
                        </CalcButton>

                        <CalcButton onClick={() => handleCurrencyDigit('4')} className="bg-slate-700/50 text-slate-200 hover:bg-slate-700">4</CalcButton>
                        <CalcButton onClick={() => handleCurrencyDigit('5')} className="bg-slate-700/50 text-slate-200 hover:bg-slate-700">5</CalcButton>
                        <CalcButton onClick={() => handleCurrencyDigit('6')} className="bg-slate-700/50 text-slate-200 hover:bg-slate-700">6</CalcButton>
                        <CalcButton onClick={handleCurrencyClear} className="bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20">C</CalcButton>

                        <CalcButton onClick={() => handleCurrencyDigit('1')} className="bg-slate-700/50 text-slate-200 hover:bg-slate-700">1</CalcButton>
                        <CalcButton onClick={() => handleCurrencyDigit('2')} className="bg-slate-700/50 text-slate-200 hover:bg-slate-700">2</CalcButton>
                        <CalcButton onClick={() => handleCurrencyDigit('3')} className="bg-slate-700/50 text-slate-200 hover:bg-slate-700">3</CalcButton>
                        <CalcButton 
                            onClick={() => {
                                const cleanVal = convertedAmountStr.replace(/[^\d.]/g, '');
                                navigator.clipboard.writeText(cleanVal);
                                setCopyFeedback(true);
                                setTimeout(() => setCopyFeedback(false), 1500);
                            }}
                            className="bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 text-xs font-bold"
                            title="Copy output value"
                        >
                            Copy
                        </CalcButton>

                        <CalcButton onClick={() => handleCurrencyDigit('0')} className="bg-slate-700/50 text-slate-200 hover:bg-slate-700">0</CalcButton>
                        <CalcButton onClick={() => handleCurrencyDigit('00')} className="bg-slate-700/50 text-slate-200 hover:bg-slate-700">00</CalcButton>
                        <CalcButton onClick={handleCurrencyDot} className="bg-slate-700/50 text-slate-200 hover:bg-slate-700">.</CalcButton>
                        <CalcButton onClick={handleSwapCurrencies} className="bg-primary text-slate-900 hover:opacity-90 font-bold" title="Swap currencies">Swap</CalcButton>
                    </div>
                </div>
            ) : (
                <>
                    {/* Display */}
                    <div className="bg-black/20 rounded-lg p-3 mb-3 text-right border" style={{ borderColor: 'var(--theme-border)' }}>
                        <div className="text-xs text-slate-500 h-4 overflow-hidden tabular-nums whitespace-nowrap">
                            {parenStack.map((item, index) => (
                                <span key={index}>{item.prevValue !== null ? `${formatDisplay(item.prevValue)} ${item.operator} (` : '( '}</span>
                            ))}
                            {prevValue !== null ? `${formatDisplay(prevValue)} ${operator}` : ''}
                        </div>
                        <div className="text-2xl font-bold text-slate-200 overflow-hidden truncate tabular-nums">
                            {formatDisplay(display)}
                        </div>
                    </div>

                    {/* Memory Row (Scientific only) */}
                    {isScientific && (
                        <div className="grid grid-cols-4 gap-1.5 mb-2">
                            {['MC', 'MR', 'M+', 'M-'].map(m => (
                                <button
                                    key={m}
                                    onClick={() => handleMemory(m)}
                                    className={`h-7 rounded-md text-[10px] font-bold transition-all no-drag-region ${memory !== 0 && (m === 'MR' || m === 'MC') ? 'bg-primary/15 text-primary' : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'}`}
                                >
                                    {m}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Scientific Functions Grid */}
                    {isScientific && (
                        <div className="grid grid-cols-5 gap-1.5 mb-2">
                            <SciFnButton onClick={() => handleScientific('sin')} title="Sine">sin</SciFnButton>
                            <SciFnButton onClick={() => handleScientific('cos')} title="Cosine">cos</SciFnButton>
                            <SciFnButton onClick={() => handleScientific('tan')} title="Tangent">tan</SciFnButton>
                            <SciFnButton onClick={() => handleScientific('ln')} title="Natural Log">ln</SciFnButton>
                            <SciFnButton onClick={() => handleScientific('log')} title="Log base 10">log</SciFnButton>

                            <SciFnButton onClick={() => handleScientific('asin')} title="Arc Sine">sin⁻¹</SciFnButton>
                            <SciFnButton onClick={() => handleScientific('acos')} title="Arc Cosine">cos⁻¹</SciFnButton>
                            <SciFnButton onClick={() => handleScientific('atan')} title="Arc Tangent">tan⁻¹</SciFnButton>
                            <SciFnButton onClick={() => handleScientific('e^x')} title="e to the power x">eˣ</SciFnButton>
                            <SciFnButton onClick={() => handleScientific('10^x')} title="10 to the power x">10ˣ</SciFnButton>

                            <SciFnButton onClick={() => handleScientific('√')} title="Square Root">√</SciFnButton>
                            <SciFnButton onClick={() => handleScientific('∛')} title="Cube Root">∛</SciFnButton>
                            <SciFnButton onClick={() => handleScientific('x²')} title="Square">x²</SciFnButton>
                            <SciFnButton onClick={() => handleScientific('x³')} title="Cube">x³</SciFnButton>
                            <SciFnButton onClick={() => handleOperator('^')} title="Power">xʸ</SciFnButton>

                            <SciFnButton onClick={() => handleScientific('n!')} title="Factorial">n!</SciFnButton>
                            <SciFnButton onClick={() => handleScientific('1/x')} title="Reciprocal">1/x</SciFnButton>
                            <SciFnButton onClick={() => handleScientific('|x|')} title="Absolute">|x|</SciFnButton>
                            <SciFnButton onClick={() => insertConstant(Math.PI)} title="Pi">π</SciFnButton>
                            <SciFnButton onClick={() => insertConstant(Math.E)} title="Euler's Number">e</SciFnButton>
                        </div>
                    )}

                    {/* Parentheses */}
                    <div className="grid grid-cols-4 gap-2 mb-2">
                        <CalcButton onClick={handleParenOpen} className="bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20">(</CalcButton>
                        <CalcButton onClick={handleParenClose} className="bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20">)</CalcButton>
                        <CalcButton onClick={() => handleScientific('±')} className="bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20" title="Plus/Minus">±</CalcButton>
                        <CalcButton onClick={() => handleOperator('÷')} className="bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20">÷</CalcButton>
                    </div>

                    {/* Keypad */}
                    <div className="grid grid-cols-4 gap-2">
                        <CalcButton onClick={handleClear} className="bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20">C</CalcButton>
                        <CalcButton onClick={() => handleOperator('mod')} className="bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20" title="Modulo">mod</CalcButton>
                        <CalcButton onClick={() => handleScientific('%')} className="bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20" title="Percentage">%</CalcButton>
                        <CalcButton onClick={() => handleOperator('×')} className="bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20">×</CalcButton>

                        {[7, 8, 9].map(n => (
                            <CalcButton key={n} onClick={() => handleDigit(String(n))} className="bg-slate-700/50 text-slate-200 hover:bg-slate-700"> {n} </CalcButton>
                        ))}
                        <CalcButton onClick={() => handleOperator('-')} className="bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20">−</CalcButton>

                        {[4, 5, 6].map(n => (
                            <CalcButton key={n} onClick={() => handleDigit(String(n))} className="bg-slate-700/50 text-slate-200 hover:bg-slate-700"> {n} </CalcButton>
                        ))}
                        <CalcButton onClick={() => handleOperator('+')} className="bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20">+</CalcButton>

                        {[1, 2, 3].map(n => (
                            <CalcButton key={n} onClick={() => handleDigit(String(n))} className="bg-slate-700/50 text-slate-200 hover:bg-slate-700"> {n} </CalcButton>
                        ))}
                        <CalcButton onClick={handleEqual} className="row-span-2 h-full bg-primary text-slate-900 hover:opacity-90 font-bold">=</CalcButton>

                        <CalcButton onClick={() => !display.includes('.') && handleDigit('.')} className="bg-slate-700/50 text-slate-200 hover:bg-slate-700">.</CalcButton>
                        <CalcButton onClick={() => handleDigit('0')} className="bg-slate-700/50 text-slate-200 hover:bg-slate-700">0</CalcButton>
                        <CalcButton onClick={handleBackspace} className="bg-slate-700/50 text-slate-200 hover:bg-slate-700" title="Backspace">
                            <span className="material-symbols-outlined text-[16px]">backspace</span>
                        </CalcButton>
                    </div>

                    {/* History (Scientific only) */}
                    {isScientific && history.length > 0 && (
                        <div className="mt-2 border-t border-white/5 pt-2 max-h-20 overflow-y-auto custom-scrollbar">
                            {history.map((h, i) => (
                                <div key={i} className="text-[10px] text-slate-500 truncate py-0.5 tabular-nums">{h}</div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* Currency Selector Modal */}
            {selectorMode && (
                <div className="absolute inset-0 z-[100] flex flex-col p-4 bg-slate-950/95 backdrop-blur-md animate-in fade-in duration-200">
                    <div className="flex justify-between items-center mb-3">
                        <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                            Select Currency
                        </span>
                        <button
                            onClick={() => {
                                setSelectorMode(null);
                                setSearchQuery('');
                            }}
                            className="w-6 h-6 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition-all no-drag-region"
                        >
                            <span className="material-symbols-outlined text-[16px]">close</span>
                        </button>
                    </div>

                    {/* Search Input */}
                    <div className="relative mb-3 no-drag-region">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-[16px] text-slate-500">search</span>
                        <input
                            type="text"
                            autoFocus
                            placeholder={t('searchCurrency')}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-primary/50 focus:bg-white/10 transition-colors"
                        />
                    </div>

                    {/* Scrollable Currency List */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 no-drag-region">
                        {(() => {
                            const availableCurrencies = Object.keys(rates);
                            const q = searchQuery.toLowerCase().trim();
                            
                            // Filter list
                            const filtered = availableCurrencies.filter(code => {
                                const details = CURRENCY_DETAILS[code];
                                const name = details?.name.toLowerCase() || '';
                                return code.toLowerCase().includes(q) || name.includes(q);
                            });

                            // Sort: popular currencies first, then alphabetical
                            const sorted = [...filtered].sort((a, b) => {
                                const idxA = POPULAR_CURRENCIES.indexOf(a);
                                const idxB = POPULAR_CURRENCIES.indexOf(b);
                                if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                                if (idxA !== -1) return -1;
                                if (idxB !== -1) return 1;
                                return a.localeCompare(b);
                            });

                            if (sorted.length === 0) {
                                return (
                                    <div className="text-center py-6 text-xs text-slate-500">
                                        No currencies found
                                    </div>
                                );
                            }

                            return sorted.map(code => {
                                const details = CURRENCY_DETAILS[code] || { name: code, flag: '🪙' };
                                const isSelected = selectorMode === 'from' ? fromCurrency === code : toCurrency === code;
                                return (
                                    <button
                                        key={code}
                                        onClick={() => {
                                            if (selectorMode === 'from') {
                                                setFromCurrency(code);
                                            } else {
                                                setToCurrency(code);
                                            }
                                            setSelectorMode(null);
                                            setSearchQuery('');
                                        }}
                                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg mb-1 transition-all text-left ${isSelected ? 'bg-primary/20 border border-primary/30 text-primary font-bold' : 'bg-white/5 border border-transparent text-slate-300 hover:bg-white/10 hover:text-white'}`}
                                    >
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <span className="text-base select-none">{details.flag}</span>
                                            <div className="min-w-0">
                                                <div className="text-xs font-bold leading-none">{code}</div>
                                                <div className="text-[10px] text-slate-500 truncate mt-0.5">{details.name}</div>
                                            </div>
                                        </div>
                                        {isSelected && (
                                            <span className="material-symbols-outlined text-[14px] text-primary">check</span>
                                        )}
                                    </button>
                                );
                            });
                        })()}
                    </div>
                </div>
            )}
        </div>
    );
};

export default CalculatorPopup;
