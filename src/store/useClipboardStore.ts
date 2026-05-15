import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SlotState = 'empty' | 'listening' | 'filled' | 'selected';

export interface ClipboardSlot {
    state: SlotState;
    type: 'text' | 'image' | null;
    content: string | null;
}

function createEmptySlot(): ClipboardSlot {
    return { state: 'empty', type: null, content: null };
}

function createEmptySlots(count: number): ClipboardSlot[] {
    return Array.from({ length: count }, () => createEmptySlot());
}

interface ClipboardState {
    slots: ClipboardSlot[];
    slotCount: number;
    isCopyModeActive: boolean;
    isPasteModeActive: boolean;

    // Settings
    setSlotCount: (count: number) => void;

    // Copy Mode actions
    toggleCopyMode: () => void;
    addClipboardItem: (type: 'text' | 'image', content: string) => void;
    forceAddClipboardItem: (type: 'text' | 'image', content: string) => void;

    // Paste Mode actions
    togglePasteMode: () => void;
    pasteNextItem: () => ClipboardSlot | null;

    // Reset
    resetAll: () => void;
    clearSlot: (index: number) => void;

    // Manual Targeting
    setListeningSlot: (index: number) => void;
    setSelectedSlot: (index: number) => void;
}

export const useClipboardStore = create<ClipboardState>()(
    persist(
        (set, get) => ({
            slots: createEmptySlots(8),
            slotCount: 8,
            isCopyModeActive: false,
            isPasteModeActive: false,

            setSlotCount: (count: number) => {
                const currentSlots = get().slots;
                if (count > currentSlots.length) {
                    const addedSlots = Array.from({ length: count - currentSlots.length }, () => createEmptySlot());
                    set({ slotCount: count, slots: [...currentSlots, ...addedSlots] });
                } else if (count < currentSlots.length) {
                    set({ slotCount: count, slots: currentSlots.slice(0, count) });
                } else {
                    set({ slotCount: count });
                }
            },


            toggleCopyMode: () => {
                const { isCopyModeActive, slots } = get();

                if (isCopyModeActive) {
                    // Deactivate: revert the current Listening slot back to Empty
                    const updated = slots.map(slot =>
                        slot.state === 'listening' ? { ...slot, state: 'empty' as SlotState } : slot
                    );
                    set({ isCopyModeActive: false, slots: updated });

                    if (window.api?.stopClipboardListener) {
                        window.api.stopClipboardListener();
                    }
                } else {
                    // Activate Copy → forcefully deactivate Paste (mutual exclusivity)
                    let updated = slots.map(slot =>
                        slot.state === 'selected' ? { ...slot, state: 'filled' as SlotState } : slot
                    );

                    const firstEmptyIndex = updated.findIndex(s => s.state === 'empty');
                    if (firstEmptyIndex === -1) return; // All slots filled

                    updated = [...updated];
                    updated[firstEmptyIndex] = { ...updated[firstEmptyIndex], state: 'listening' };

                    set({
                        isCopyModeActive: true,
                        isPasteModeActive: false,
                        slots: updated,
                    });
                }
            },

            addClipboardItem: (type, content) => {
                const { slots, isCopyModeActive } = get();
                if (!isCopyModeActive) return;

                const updated = [...slots];

                // Find the current Listening slot
                const listeningIndex = updated.findIndex(s => s.state === 'listening');
                if (listeningIndex === -1) return;

                // Fill the Listening slot
                updated[listeningIndex] = { state: 'filled', type, content };

                // Find the next empty slot to make Listening
                const nextEmptyIndex = updated.findIndex((s, i) => i > listeningIndex && s.state === 'empty');

                if (nextEmptyIndex !== -1) {
                    updated[nextEmptyIndex] = { ...updated[nextEmptyIndex], state: 'listening' };
                    set({ slots: updated });
                } else {
                    // No more empty slots — auto-deactivate copy mode
                    set({ slots: updated, isCopyModeActive: false });
                    if (window.api?.stopClipboardListener) {
                        window.api.stopClipboardListener();
                    }
                }
            },

            forceAddClipboardItem: (type, content) => {
                const state = get();
                if (!state.isCopyModeActive) {
                    state.toggleCopyMode();
                }
                const newState = get();
                if (newState.isCopyModeActive) {
                    newState.addClipboardItem(type, content);
                }
            },

            togglePasteMode: () => {
                const { isPasteModeActive, slots, isCopyModeActive } = get();

                if (isPasteModeActive) {
                    // Deactivate: remove the Red Stroke from the selected slot
                    const updated = slots.map(slot =>
                        slot.state === 'selected' ? { ...slot, state: 'filled' as SlotState } : slot
                    );
                    set({ isPasteModeActive: false, slots: updated });
                } else {
                    // Activate Paste → forcefully deactivate Copy (mutual exclusivity)
                    let updated = slots.map(slot =>
                        slot.state === 'listening' ? { ...slot, state: 'empty' as SlotState } : slot
                    );

                    const firstFilledIndex = updated.findIndex(s => s.state === 'filled');
                    if (firstFilledIndex === -1) return; // No filled slots

                    updated = [...updated];
                    updated[firstFilledIndex] = { ...updated[firstFilledIndex], state: 'selected' };

                    set({ isPasteModeActive: true, isCopyModeActive: false, slots: updated });

                    // Stop clipboard polling if it was running
                    if (isCopyModeActive && window.api?.stopClipboardListener) {
                        window.api.stopClipboardListener();
                    }
                }
            },

            pasteNextItem: () => {
                const { slots, isPasteModeActive } = get();
                if (!isPasteModeActive) return null;

                const updated = [...slots];
                const selectedIndex = updated.findIndex(s => s.state === 'selected');
                if (selectedIndex === -1) return null;

                const item = { ...updated[selectedIndex] };

                // NOTE: We do NOT write to OS clipboard here!
                // The caller (ClipboardSlots.tsx) already handles clipboard writing
                // via executeGlobalPaste. Writing here too causes a race condition
                // where the second clipboard.clear() wipes data before Ctrl+V fires.

                // Clear the pasted slot → back to empty
                updated[selectedIndex] = createEmptySlot();

                // Find the next filled slot
                const nextFilledIndex = updated.findIndex((s, i) => i > selectedIndex && s.state === 'filled');

                if (nextFilledIndex !== -1) {
                    updated[nextFilledIndex] = { ...updated[nextFilledIndex], state: 'selected' };
                    set({ slots: updated });
                } else {
                    // No more items — auto-deactivate paste mode
                    set({ slots: updated, isPasteModeActive: false });
                }

                return item;
            },

            resetAll: () => {
                set((state) => ({
                    slots: createEmptySlots(state.slotCount),
                    isCopyModeActive: false,
                    isPasteModeActive: false,
                }));
                if (window.api?.stopClipboardListener) {
                    window.api.stopClipboardListener();
                }
            },

            clearSlot: (index: number) => {
                const { slots } = get();
                if (slots[index].state === 'filled') {
                    const updated = [...slots];
                    updated[index] = createEmptySlot();
                    set({ slots: updated });
                }
            },

            setListeningSlot: (index: number) => {
                const { slots, isCopyModeActive } = get();
                if (!isCopyModeActive || slots[index].state !== 'empty') return;

                let updated = slots.map(slot =>
                    slot.state === 'listening' ? { ...slot, state: 'empty' as SlotState } : slot
                );
                updated = [...updated];
                updated[index] = { ...updated[index], state: 'listening' };
                set({ slots: updated });
            },

            setSelectedSlot: (index: number) => {
                const { slots, isPasteModeActive } = get();
                if (!isPasteModeActive || slots[index].state !== 'filled') return;

                let updated = slots.map(slot =>
                    slot.state === 'selected' ? { ...slot, state: 'filled' as SlotState } : slot
                );
                updated = [...updated];
                updated[index] = { ...updated[index], state: 'selected' };
                set({ slots: updated });
            },
        }),
        {
            name: 'kobar-clipboard-storage',
            partialize: (state) => ({
                slotCount: state.slotCount,
            }),
            merge: (persisted, current) => {
                const merged = { ...current, ...(persisted as Partial<ClipboardState>) };
                merged.slots = createEmptySlots(merged.slotCount);
                return merged;
            },
        }
    )
);
