import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from './cx';
import { FIELD_CONTROL, FIELD_INTERACTIVE, fieldBorder, hasErrorMessage, useFieldIds } from './fieldProps';
import { FieldShell } from './FieldShell';
import { Icon } from './Icon';

export interface TextFieldProps extends Omit<ComponentPropsWithRef<'input'>, 'size'> {
    /** Visible label, associated with the input via htmlFor/id (id is generated unless given). */
    label: ReactNode;
    /** Keeps the label for assistive technology only. */
    hideLabel?: boolean;
    /** Helper text below the input, linked with aria-describedby. */
    hint?: ReactNode;
    /** Marks the input aria-invalid; a message is shown below it and linked with aria-describedby (`true` = no message). */
    error?: ReactNode;
    /** Leading decorative Material Symbols icon name. */
    icon?: string;
}

/** Single-line text input with label, hint and error. `className` styles the wrapper; `ref` and other props go to the <input>. */
export function TextField({
    label,
    hideLabel = false,
    hint,
    error,
    icon,
    id,
    type = 'text',
    disabled,
    className,
    ...rest
}: TextFieldProps) {
    const ariaInvalid = rest['aria-invalid'];
    const invalid = Boolean(error) || ariaInvalid === true || ariaInvalid === 'true';
    const ids = useFieldIds(id, Boolean(hint), hasErrorMessage(error), rest['aria-describedby']);

    return (
        <FieldShell ids={ids} label={label} hideLabel={hideLabel} hint={hint} error={error} disabled={disabled} className={className}>
            <div className="relative flex items-center">
                {icon && <Icon name={icon} size={16} className="pointer-events-none absolute start-2 text-fg-2" />}
                <input
                    {...rest}
                    id={ids.controlId}
                    type={type}
                    disabled={disabled}
                    aria-invalid={invalid || undefined}
                    aria-describedby={ids.describedBy}
                    className={cx(
                        FIELD_INTERACTIVE,
                        FIELD_CONTROL,
                        fieldBorder(invalid),
                        icon ? 'ps-8 pe-3' : 'px-3',
                        'placeholder:text-fg-3'
                    )}
                />
            </div>
        </FieldShell>
    );
}
