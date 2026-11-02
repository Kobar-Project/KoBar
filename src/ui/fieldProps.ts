import { useId, type ReactNode } from 'react';
import { cx } from './cx';

/**
 * Interaction classes for text-entry controls. Same as INTERACTIVE minus `select-none`, so the user can still select
 * the typed text. Inputs match :focus-visible on click too, which is the expected caret-plus-ring behaviour.
 */
export const FIELD_INTERACTIVE =
    'no-drag-region pointer-events-auto focus-visible:outline-hidden focus-visible:shadow-[var(--kb-focus-ring)]';

/** Shared box of TextField and Select: inset fill; size and radius come from FIELD_SHAPE (the search form is a 44 px pill). */
export const FIELD_CONTROL =
    'w-full min-w-0 border bg-inset [font:var(--kb-type-body)] text-fg-1 transition-colors duration-[var(--kb-dur-fast)] disabled:cursor-not-allowed disabled:text-fg-3 disabled:opacity-[var(--kb-opacity-disabled)]';

/** Form field shape: 46 px high, radius 16. */
export const FIELD_SHAPE = 'h-[46px] rounded-[16px]';

/** Control border: none at rest (the inset fill carries the shape), the danger colour when invalid. */
export function fieldBorder(invalid: boolean): string {
    return invalid ? 'border-[var(--kb-danger)]' : 'border-transparent';
}

/** True when a node renders something (not undefined/null/boolean/''); 0 counts as content. */
export function hasContent(node: ReactNode): boolean {
    return node !== undefined && node !== null && typeof node !== 'boolean' && node !== '';
}

/** True when `error` carries a visible message (`error={true}` only marks the field invalid). */
export function hasErrorMessage(error: ReactNode): boolean {
    return hasContent(error);
}

export interface FieldIds {
    controlId: string;
    hintId: string | undefined;
    errorId: string | undefined;
    describedBy: string | undefined;
}

/** Stable ids for label / hint / error and the control's aria-describedby (hint first, then error, then caller ids). */
export function useFieldIds(id: string | undefined, hasHint: boolean, hasError: boolean, extraDescribedBy?: string): FieldIds {
    const auto = useId();
    const hintId = hasHint ? `${auto}-hint` : undefined;
    const errorId = hasError ? `${auto}-error` : undefined;
    return {
        controlId: id ?? `${auto}-control`,
        hintId,
        errorId,
        describedBy: cx(hintId, errorId, extraDescribedBy) || undefined,
    };
}
