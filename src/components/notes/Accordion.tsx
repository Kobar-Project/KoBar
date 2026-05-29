import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';

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

export default Accordion;
