import React from 'react';
import { useAppStore } from '../../store/useAppStore';

const EyeNotification: React.FC = () => {
    const notification = useAppStore(state => state.eyeNotification);
    const hideEyeNotification = useAppStore(state => state.hideEyeNotification);
    const orientation = useAppStore(state => state.orientation);
    const edgePosition = useAppStore(state => state.edgePosition);
    const design = useAppStore(state => state.design);
    const glassOpacity = useAppStore(state => state.glassOpacity);
    const isMac = useAppStore(state => state.isMac);

    if (!notification || !notification.isVisible) return null;

    let positionClasses = '';
    if (orientation === 'horizontal') {
        positionClasses = edgePosition === 'top' ? 'top-full mt-4 right-0' : 'bottom-full mb-4 right-0';
    } else {
        positionClasses = edgePosition === 'left' ? 'left-full ml-4 bottom-0' : 'right-full mr-4 bottom-0';
    }

    return (
        <div 
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className={`absolute ${positionClasses} z-[100] w-64 p-4 rounded-2xl shadow-2xl animate-pop-in pointer-events-auto
                ${design === 'style2' ? ((isMac ? 'backdrop-blur-md' : 'backdrop-blur-2xl') + ' border border-white/10') : 'bg-[var(--theme-bg-dark)] border border-[var(--theme-border)]'}`}
            style={{
                backgroundColor: design === 'style2' 
                    ? `color-mix(in srgb, var(--theme-bg-dark) ${glassOpacity}%, transparent)` 
                    : 'var(--theme-bg-dark)'
            }}
        >
            <p className="text-sm text-slate-300 mb-4">
                {notification.message.split(/\\n|\n/).map((line, i) => (
                    <React.Fragment key={i}>
                        {line}
                        {i < notification.message.split(/\\n|\n/).length - 1 && <br />}
                    </React.Fragment>
                ))}
            </p>
            
            {notification.buttons && notification.buttons.length > 0 && (
                <div className="flex gap-2 justify-end">
                    {notification.buttons.map((btn, idx) => {
                        let btnColorClass = 'bg-slate-700 hover:bg-slate-600 text-white';
                        if (btn.color === 'green') btnColorClass = 'bg-green-600 hover:bg-green-500 text-white';
                        if (btn.color === 'red') btnColorClass = 'bg-red-600 hover:bg-red-500 text-white';
                        if (btn.color === 'blue') btnColorClass = 'bg-blue-600 hover:bg-blue-500 text-white';
                        if (btn.color === 'primary') btnColorClass = 'bg-primary/80 hover:bg-primary text-white';
                        
                        return (
                            <button 
                                key={idx}
                                onClick={() => {
                                    btn.onClick();
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${btnColorClass}`}
                            >
                                {btn.label}
                            </button>
                        );
                    })}
                </div>
            )}
            
            <button 
                onClick={hideEyeNotification} 
                className="absolute -top-2 -right-2 w-6 h-6 bg-slate-800 text-slate-400 rounded-full hover:text-white border border-[var(--theme-border)] flex items-center justify-center transition-colors"
            >
                <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
        </div>
    );
};

export default EyeNotification;
