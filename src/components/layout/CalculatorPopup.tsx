import React, { useState, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';

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

    const popupRef = useRef<HTMLDivElement>(null);

    const orientation = useAppStore(state => state.orientation);

    // We need sidebarPosition because if it exists, our wrapper is absolute, which shifts the coordinate space.
    const sidebarPosition = useAppStore(state => state.sidebarPosition);

    const getPopupStyle = (): React.CSSProperties => {
        if (!calculatorAnchorRect) return { display: 'none' };
        
        const popupHeight = isScientific ? 570 : 500;
        const popupWidth = isScientific ? 360 : 280;
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
            const popupHeight = isScientific ? 570 : 500;
            const popupWidth = isScientific ? 360 : 280;
            
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
    }, [calculatorAnchorRect, screenBounds, isScientific, orientation]);

    const handleDigit = (digit: string) => {
        operatorJustPressed.current = false;
        if (waitingForOperand) {
            if (digit === '.') {
                setDisplay('0.');
            } else {
                setDisplay(digit === '00' ? '0' : digit);
            }
            setWaitingForOperand(false);
        } else {
            if (digit === '.') {
                if (!display.includes('.')) {
                    setDisplay(display + '.');
                }
            } else if (display === '0') {
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

            if (/[0-9]/.test(key)) {
                handleDigit(key);
            } else if (key === '.' || key === ',') {
                handleDigit('.');
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
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [display, prevValue, operator, waitingForOperand, parenStack]);

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
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold ml-1">{t('calculator')}</span>
                    {isScientific && (
                        <button
                            onClick={() => setAngleMode(angleMode === 'DEG' ? 'RAD' : 'DEG')}
                            className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-primary/15 text-primary border border-primary/20 hover:bg-primary/25 transition-all no-drag-region"
                        >
                            {angleMode}
                        </button>
                    )}
                </div>
                <div className="flex items-center gap-1.5">
                    <button 
                        onClick={() => setIsScientific(!isScientific)}
                        className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all no-drag-region ${isScientific ? 'bg-primary/20 text-primary' : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'}`}
                        title={isScientific ? 'Basic Mode' : 'Scientific Mode'}
                    >
                        <span className="material-symbols-outlined text-[16px]">function</span>
                    </button>
                    <button 
                        onClick={() => setIsCalculatorOpen(false)}
                        className="w-6 h-6 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-red-500/20 flex items-center justify-center transition-all no-drag-region"
                    >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                </div>
            </div>

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

                <CalcButton onClick={() => handleDigit('.')} className="bg-slate-700/50 text-slate-200 hover:bg-slate-700">.</CalcButton>
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
        </div>
    );
};

export default CalculatorPopup;
