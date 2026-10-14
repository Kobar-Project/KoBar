import { useId, type ReactNode } from 'react';
import { cx } from './cx';

/**
 * Interaction classes for text-entry controls. Same as INTERACTIVE minus `select-none`, so the user can still select
 * the typed text. Inputs match :focus-visible on click too, which is the expected caret-plus-ring behaviour.
 */
export const FIELD_INTERACTIVE =
    'no-drag-region pointer-events-auto focus-visible:outline-hidden focus-visible:shadow-[var(--kb-focus-ring)]';

/** Shared box of TextField and Select; height follows the density token --kb-control-h. */
export const FIELD_CONTROL =
    'h-[var(--kb-control-h)] w-full min-w-0 rounded-sm border bg-inset text-[0.8125rem] leading-5 text-fg-1 transition-colors duration-[var(--kb-dur-fast)] disabled:cursor-not-allowed disabled:text-fg-3 disabled:opacity-[var(--kb-opacity-disabled)]';

/** Control border: --kb-stroke-control (>=3:1, WCAG 1.4.11) or the danger colour when invalid. */
export function fieldBorder(invalid: boolean): string {
    return invalid ? 'border-[var(--kb-danger)]' : 'border-[var(--kb-stroke-control)]';
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
