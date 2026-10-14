import { createContext, useContext } from 'react';

/** Why a popover closed. Focus returns to the trigger for escape, select, force (dialog opened) and programmatic closes. */
export type PopoverCloseReason = 'trigger' | 'escape' | 'outside' | 'blur' | 'select' | 'force' | 'programmatic';

export type PopoverClose = (reason?: PopoverCloseReason) => void;

export const PopoverCloseContext = createContext<PopoverClose>(() => {});

/** `close` of the nearest Popover (no-op outside one), e.g. for a "Done" button or a menu item inside the content. */
export function usePopoverClose(): PopoverClose {
    return useContext(PopoverCloseContext);
}
