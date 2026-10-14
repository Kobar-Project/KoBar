import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from './cx';
import { FIELD_CONTROL, FIELD_INTERACTIVE, fieldBorder, hasErrorMessage, useFieldIds } from './fieldProps';
import { FieldShell } from './FieldShell';
import { Icon } from './Icon';

export interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
}

export interface SelectProps extends Omit<ComponentPropsWithRef<'select'>, 'size' | 'multiple'> {
    /** Visible label, associated with the select via htmlFor/id (id is generated unless given). */
    label: ReactNode;
    /** Keeps the label for assistive technology only. */
    hideLabel?: boolean;
    /** Helper text below the select, linked with aria-describedby. */
    hint?: ReactNode;
    /** Marks the select aria-invalid; a message is shown below it and linked with aria-describedby (`true` = no message). */
    error?: ReactNode;
    /** Options to render; alternatively pass <option>/<optgroup> children. */
    options?: readonly SelectOption[];
}

/**
 * Styled native <select> (keyboard, type-ahead and the popup list come from the platform). `className` styles the
 * wrapper; `ref` and other props (value, onChange, name...) go to the <select>.
 */
export function Select({ label, hideLabel = false, hint, error, options, id, disabled, className, children, ...rest }: SelectProps) {
    const ariaInvalid = rest['aria-invalid'];
    const invalid = Boolean(error) || ariaInvalid === true || ariaInvalid === 'true';
    const ids = useFieldIds(id, Boolean(hint), hasErrorMessage(error), rest['aria-describedby']);

    return (
        <FieldShell ids={ids} label={label} hideLabel={hideLabel} hint={hint} error={error} disabled={disabled} className={className}>
            <div className="relative flex items-center">
                <select
                    {...rest}
                    id={ids.controlId}
                    disabled={disabled}
                    aria-invalid={invalid || undefined}
                    aria-describedby={ids.describedBy}
                    className={cx(
                        FIELD_INTERACTIVE,
                        FIELD_CONTROL,
                        fieldBorder(invalid),
                        'cursor-pointer appearance-none ps-3 pe-8 *:bg-surface *:text-fg-1'
                    )}
                >
                    {options
                        ? options.map((option) => (
                              <option key={option.value} value={option.value} disabled={option.disabled}>
                                  {option.label}
                              </option>
                          ))
                        : children}
                </select>
                <Icon name="expand_more" size={16} className="pointer-events-none absolute end-2 text-fg-2" />
            </div>
        </FieldShell>
    );
}
