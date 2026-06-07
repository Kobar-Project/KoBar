import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';

const CURRENT_TUTORIAL_VERSION = "1.0.0";

const TutorialManager: React.FC = () => {
    const isHydrated = useAppStore(state => state.isHydrated);
    const tutorialState = useAppStore(state => state.tutorialState);
    const setTutorialState = useAppStore(state => state.setTutorialState);
    const isManualTutorialTrigger = useAppStore(state => state.isManualTutorialTrigger);
    const setIsManualTutorialTrigger = useAppStore(state => state.setIsManualTutorialTrigger);
    const t = useAppStore(state => state.t);
    const showEyeNotification = useAppStore(state => state.showEyeNotification);
    const hideEyeNotification = useAppStore(state => state.hideEyeNotification);
    const setNotePanelOpen = useAppStore(state => state.setNotePanelOpen);
    const isNotePanelOpen = useAppStore(state => state.isNotePanelOpen);
    const setIsHighlightingToggleNotes = useAppStore(state => state.setIsHighlightingToggleNotes);
    const setIsHighlightingSettingsBtn = useAppStore(state => state.setIsHighlightingSettingsBtn);
    const setIsHighlightingPluginsBtn = useAppStore(state => state.setIsHighlightingPluginsBtn);
    const setActiveNoteId = useAppStore(state => state.setActiveNoteId);
    const notes = useAppStore(state => state.notes);
    const activeNoteId = useAppStore(state => state.activeNoteId);
    const activeNote = notes.find(n => n.id === activeNoteId);

    const [step, setStep] = useState<number>(-1);
    
    // Refs to manage timeouts and state across renders
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
    const stepRef = useRef(step);
    
    useEffect(() => {
        stepRef.current = step;
    }, [step]);

    const clearTimers = () => {
        timers.current.forEach(clearTimeout);
        timers.current = [];
    };

    const addTimer = (callback: () => void, ms: number) => {
        const timer = setTimeout(callback, ms);
        timers.current.push(timer);
        return timer;
    };

    // Clean up on unmount
    useEffect(() => {
        return () => {
            clearTimers();
            setIsHighlightingToggleNotes(false);
            setIsHighlightingSettingsBtn(false);
            setIsHighlightingPluginsBtn(false);
            hideEyeNotification();
        };
    }, []);

    // Initial Trigger Evaluation
    useEffect(() => {
        if (!isHydrated) return;
        
        const checkTutorial = () => {
            if (tutorialState.version !== CURRENT_TUTORIAL_VERSION) {
                // Future version upgrade logic
            }

            if (isManualTutorialTrigger) {
                setIsManualTutorialTrigger(false);
                setTutorialState({ status: 'pending', snoozeUntil: undefined });
                setStep(-1);
                clearTimers(); // Clear any existing wait timer
                startStep0();
                return;
            }

            if (tutorialState.status === 'completed') return;

            if (tutorialState.status === 'snoozed') {
                if (tutorialState.snoozeUntil && Date.now() < tutorialState.snoozeUntil) {
                    return; // Still snoozed
                } else {
                    // Snooze expired, set to pending to show again
                    setTutorialState({ status: 'pending', snoozeUntil: undefined });
                    // Will re-trigger due to state change
                    return;
                }
            }

            if (tutorialState.status === 'pending' && step === -1) {
                // Wait 10 seconds, then start Step 0
                addTimer(() => {
                    startStep0();
                }, 10000);
            }
        };

        checkTutorial();
    }, [isHydrated, tutorialState.status, tutorialState.snoozeUntil, isManualTutorialTrigger]);

    const showFarewell = (mode: 'complete' | 'snooze') => {
        clearTimers();
        setIsHighlightingToggleNotes(false);
        setIsHighlightingSettingsBtn(false);
        setIsHighlightingPluginsBtn(false);
        setStep(-2); // End state
        
        showEyeNotification({
            message: (t as any)('tutorialFarewellMessage'),
            buttons: [
                {
                    label: (t as any)('tutorialBtnOkExclaim'),
                    color: "green",
                    onClick: () => {
                        hideEyeNotification();
                        clearTimers();
                    }
                }
            ]
        });

        // Effect for the mode
        if (mode === 'complete') {
            setTutorialState({ status: 'completed' });
        } else {
            setTutorialState({ status: 'snoozed', snoozeUntil: Date.now() + 24 * 60 * 60 * 1000 });
        }

        // Auto close after 15s
        addTimer(() => {
            hideEyeNotification();
        }, 15000);
    };

    const startStep0 = () => {
        setStep(0);
        showEyeNotification({
            message: (t as any)('tutorialStep0Message'),
            buttons: [
                { label: (t as any)('tutorialBtnYes'), color: "green", onClick: () => startStep1() },
                { label: (t as any)('tutorialBtnTerminate'), color: "red", onClick: () => showFarewell('complete') },
                { label: (t as any)('tutorialBtnLater'), color: "primary", onClick: () => showFarewell('snooze') }
            ]
        });
    };

    const startStep1 = () => {
        setStep(1);
        clearTimers();
        
        // Deactivate plugins, close note panel
        useAppStore.setState({ activeExtensionPanelId: null });
        setNotePanelOpen(false);
        
        showEyeNotification({
            message: (t as any)('tutorialStep1Message'),
            buttons: [
                { label: (t as any)('tutorialBtnOk'), color: "green", onClick: () => handleStep1Action('tamam') },
                { label: (t as any)('tutorialBtnTerminate'), color: "red", onClick: () => showFarewell('complete') },
                { label: (t as any)('tutorialBtnSkip'), color: "primary", onClick: () => handleStep1Action('atla') }
            ]
        });

        setIsHighlightingToggleNotes(true);
    };

    const handleStep1Action = (action: 'tamam' | 'atla') => {
        hideEyeNotification();
        
        if (action === 'atla') {
            addTimer(() => {
                forceOpenNotePanel();
                startStep2();
            }, 1000);
        } else if (action === 'tamam') {
            // Wait 10 seconds
            addTimer(() => {
                // If they haven't opened it, open it for them
                if (!useAppStore.getState().isNotePanelOpen) {
                    forceOpenNotePanel();
                }
                startStep2();
            }, 10000);
        }
    };

    // Watch for manual notch click during step 1 wait
    useEffect(() => {
        if (step === 1 && isNotePanelOpen) {
            // User opened it manually!
            clearTimers(); // Cancel the 10s or 1s timer
            startStep2();
        }
    }, [isNotePanelOpen, step]);

    const forceOpenNotePanel = () => {
        setNotePanelOpen(true);
    };

    const startStep2 = () => {
        setStep(2);
        clearTimers();
        setIsHighlightingToggleNotes(false);

        // Close settings/plugins if open, ensure a regular note is active
        const state = useAppStore.getState();
        const activeNote = state.notes.find(n => n.id === state.activeNoteId);
        
        if (activeNote?.isSettings || activeNote?.isPlugins) {
            // Switch to the first normal note, or add one
            const normalNote = state.notes.find(n => !n.isSettings && !n.isPlugins);
            if (normalNote) {
                setActiveNoteId(normalNote.id);
            } else {
                state.addNote();
            }
        }

        showEyeNotification({
            message: (t as any)('tutorialStep2Message'),
            buttons: [
                { label: (t as any)('tutorialBtnOk'), color: "green", onClick: () => startStep3() },
                { label: (t as any)('tutorialBtnTerminate'), color: "red", onClick: () => showFarewell('complete') }
            ]
        });

        addTimer(() => {
            startStep3();
        }, 7000);
    };

    const startStep3 = () => {
        setStep(3);
        clearTimers();
        
        // Ensure settings/plugins are closed
        const state = useAppStore.getState();
        const aNote = state.notes.find(n => n.id === state.activeNoteId);
        if (aNote?.isSettings || aNote?.isPlugins) {
            const normalNote = state.notes.find(n => !n.isSettings && !n.isPlugins);
            if (normalNote) state.setActiveNoteId(normalNote.id);
            else state.addNote();
        }

        setIsHighlightingSettingsBtn(true);

        showEyeNotification({
            message: (t as any)('tutorialStep3Message'),
            buttons: [
                { label: (t as any)('tutorialBtnOk'), color: "green", onClick: () => {
                    useAppStore.getState().openSettingsTab();
                }},
                { label: (t as any)('tutorialBtnTerminate'), color: "red", onClick: () => showFarewell('complete') }
            ]
        });

        addTimer(() => {
            useAppStore.getState().openSettingsTab();
            startStep4();
        }, 10000);
    };

    useEffect(() => {
        if (step === 3 && activeNote?.isSettings) {
            clearTimers();
            startStep4();
        }
    }, [activeNote?.isSettings, step]);

    const startStep4 = () => {
        setStep(4);
        clearTimers();
        setIsHighlightingSettingsBtn(false);

        showEyeNotification({
            message: (t as any)('tutorialStep4Message'),
            buttons: [
                { label: (t as any)('tutorialBtnOk'), color: "green", onClick: () => startStep5() },
                { label: (t as any)('tutorialBtnTerminate'), color: "red", onClick: () => showFarewell('complete') }
            ]
        });

        addTimer(() => {
            startStep5();
        }, 7000);
    };

    const startStep5 = () => {
        setStep(5);
        clearTimers();
        
        // Close settings, switch to normal note
        const state = useAppStore.getState();
        const normalNote = state.notes.find(n => !n.isSettings && !n.isPlugins);
        if (normalNote) state.setActiveNoteId(normalNote.id);
        else state.addNote();

        setIsHighlightingPluginsBtn(true);

        showEyeNotification({
            message: (t as any)('tutorialStep5Message'),
            buttons: [
                { label: (t as any)('tutorialBtnOk'), color: "green", onClick: () => {
                    useAppStore.getState().openPluginsTab();
                    startStep6();
                }},
                { label: (t as any)('tutorialBtnTerminate'), color: "red", onClick: () => showFarewell('complete') }
            ]
        });

        addTimer(() => {
            useAppStore.getState().openPluginsTab();
            startStep6();
        }, 10000);
    };

    useEffect(() => {
        if (step === 5 && activeNote?.isPlugins) {
            clearTimers();
            startStep6();
        }
    }, [activeNote?.isPlugins, step]);

    const startStep6 = () => {
        setStep(6);
        clearTimers();
        setIsHighlightingPluginsBtn(false);

        showEyeNotification({
            message: (t as any)('tutorialStep6Message'),
            buttons: [
                { label: (t as any)('tutorialBtnOk'), color: "green", onClick: () => showFarewell('complete') },
                { label: (t as any)('tutorialBtnTerminate'), color: "red", onClick: () => showFarewell('complete') }
            ]
        });

        addTimer(() => {
            showFarewell('complete');
        }, 7000);
    };

    return null; // This component does not render any UI directly
};

export default TutorialManager;
