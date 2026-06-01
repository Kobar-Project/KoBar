const { useState, useEffect } = window.React;

const TooltipButton = ({ children, className, style, onClick, onDoubleClick, title }) => {
    return (
        <button
            className={`group relative flex items-center justify-center outline-none ${className || ''}`}
            style={style}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            title={title}
        >
            {children}
        </button>
    );
};

const PinWindowWidget = () => {
    const [isTargetingMode, setIsTargetingMode] = useState(false);
    const [pinnedWindowHwnd, setPinnedWindowHwnd] = useState(null);

    useEffect(() => {
        let cleanupChanged = () => {};
        if (window.api && window.api.onPinnedWindowChanged) {
            cleanupChanged = window.api.onPinnedWindowChanged((hwnd) => {
                setPinnedWindowHwnd(hwnd);
            });
        }
        
        let cleanupTargeting = () => {};
        if (window.api && window.api.onPinTargetingComplete) {
            cleanupTargeting = window.api.onPinTargetingComplete(() => {
                setIsTargetingMode(false);
            });
        }

        return () => {
            cleanupChanged();
            cleanupTargeting();
        };
    }, []);

    const handleClick = (e) => {
        if (e.currentTarget._skipClick) return;

        if (pinnedWindowHwnd) {
            if (window.api && window.api.unpinCurrentWindow) {
                window.api.unpinCurrentWindow();
            }
            return;
        }

        if (!isTargetingMode) {
            setIsTargetingMode(true);
            if (window.api && window.api.enterPinTargetingMode) {
                window.api.enterPinTargetingMode();
            }
        } else {
            setIsTargetingMode(false);
        }
    };

    const handleDoubleClick = (e) => {
        e.stopPropagation();
        const target = e.currentTarget;
        target._skipClick = true;
        setTimeout(() => target._skipClick = false, 300);

        setIsTargetingMode(false);
        if (window.api && window.api.unpinAll) {
            window.api.unpinAll();
        }
    };

    let btnClass = 'w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95 shadow-lg ';
    let btnStyle = {};
    let iconName = 'push_pin';
    let tooltip = pinnedWindowHwnd ? 'Unpin Window' : 'Pin to Top';

    if (pinnedWindowHwnd) {
        btnClass += 'text-white';
        btnStyle = { backgroundColor: '#10b981', boxShadow: '0 0 20px rgba(16,185,129,0.7)' };
        iconName = 'bookmark_remove';
    } else if (isTargetingMode) {
        btnClass += 'animate-pulse text-red-400 bg-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.5)]';
    } else {
        btnClass += 'bg-white/5 text-slate-400 hover:text-primary hover:bg-white/10 hover:scale-110';
    }

    return (
        <TooltipButton
            title={tooltip}
            className={btnClass}
            style={btnStyle}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
        >
            <span className="material-symbols-outlined text-[24px]">{iconName}</span>
        </TooltipButton>
    );
};

if (window.KoBarExtensions && window.KoBarExtensions.registerInlineWidget) {
    window.KoBarExtensions.registerInlineWidget('pin-window-to-top', {
        id: 'pin-window-to-top',
        render: () => window.React.createElement(PinWindowWidget)
    });
}
