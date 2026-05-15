import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import TooltipButton from './TooltipButton';

const FocusButton: React.FC = () => {
    const { 
        t, isFocusActive, focusRemainingTime, isFocusPopupOpen, setIsFocusPopupOpen, setFocusAnchorRect 
    } = useAppStore();
    
    // Alarm logic
    const [isAlarmRinging, setIsAlarmRinging] = useState(false);
    const alarmAudioRef = useRef<HTMLAudioElement | null>(null);

    const formatTime = (totalSeconds: number) => {
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const stopAlarm = () => {
        if (alarmAudioRef.current) {
            alarmAudioRef.current.pause();
            alarmAudioRef.current.currentTime = 0;
        }
        setIsAlarmRinging(false);
    };

    const triggerAlarm = async () => {
        try {
            const base64 = await window.api?.getMelodyAudio('Alarm');
            if (base64) {
                if (!alarmAudioRef.current) {
                    alarmAudioRef.current = new Audio();
                }
                alarmAudioRef.current.src = `${base64}`;
                alarmAudioRef.current.loop = true;
                alarmAudioRef.current.load();
                alarmAudioRef.current.play();
                setIsAlarmRinging(true);
            }
        } catch(e) {
            console.error('Alarm play error', e);
        }
    };

    // Watch focus completion
    useEffect(() => {
        // if active and remaining reaches 0
        if (isFocusActive && focusRemainingTime === 0 && !isAlarmRinging) {
            triggerAlarm();
        }
    }, [isFocusActive, focusRemainingTime, isAlarmRinging]);

    useEffect(() => {
        return () => {
            if (alarmAudioRef.current) {
                alarmAudioRef.current.pause();
                alarmAudioRef.current = null;
            }
        };
    }, []);

    const buttonRef = useRef<HTMLButtonElement>(null);

    const handleMainButtonClick = (e: React.MouseEvent) => {
        if (isAlarmRinging) {
            stopAlarm();
            return;
        }
        const rect = buttonRef.current?.getBoundingClientRect() || e.currentTarget.getBoundingClientRect();
        setFocusAnchorRect(rect);
        setIsFocusPopupOpen(!isFocusPopupOpen);
    };

    return (
        <div className="relative group flex items-center justify-center w-full no-drag-region">
            <TooltipButton
                buttonRef={buttonRef}
                onClick={handleMainButtonClick}
                className={`p-1.5 transition-colors relative flex items-center justify-center w-12 h-12 rounded-full transition-all active:scale-95 shadow-lg focus-trigger-btn
                    ${isAlarmRinging ? 'animate-[pulse_1s_ease-in-out_infinite] bg-red-500/30 text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.6)]' : 
                      isFocusPopupOpen ? 'bg-primary/20 text-primary border border-primary/50 scale-110' : 'bg-white/5 text-slate-400 hover:text-primary hover:bg-white/10 hover:scale-110'}
                `}
                label={t('focusMode')}
            >
                {isFocusActive ? (
                    <span className="text-xs font-bold text-primary tracking-wider">{formatTime(focusRemainingTime)}</span>
                ) : (
                    <span className="material-symbols-outlined text-[20px]">hourglass_empty</span>
                )}
            </TooltipButton>
        </div>
    );
};

export default FocusButton;
