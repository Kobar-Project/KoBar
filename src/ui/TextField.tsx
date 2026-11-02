import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from './cx';
import { FIELD_CONTROL, FIELD_INTERACTIVE, FIELD_SHAPE, fieldBorder, hasErrorMessage, useFieldIds } from './fieldProps';
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
    /** Leading decorative Material Symbols icon name (`search` form: defaults to "search"). */
    icon?: string;
    /** `field` (default): 46 px form field, radius 16. `search`: 44 px pill with an 18 px search icon. */
    variant?: 'field' | 'search';
}

/** Single-line text input with label, hint and error. `className` styles the wrapper; `ref` and other props go to the <input>. */
export function TextField({
    label,
    hideLabel = false,
    hint,
    error,
    icon: iconProp,
    variant = 'field',
    id,
    type = 'text',
    disabled,
    className,
    ...rest
}: TextFieldProps) {
    const search = variant === 'search';
    const icon = iconProp ?? (search ? 'search' : undefined);
    const ariaInvalid = rest['aria-invalid'];
    const invalid = Boolean(error) || ariaInvalid === true || ariaInvalid === 'true';
    const ids = useFieldIds(id, Boolean(hint), hasErrorMessage(error), rest['aria-describedby']);

    return (
        <FieldShell ids={ids} label={label} hideLabel={hideLabel} hint={hint} error={error} disabled={disabled} className={className}>
            <div className="relative flex items-center">
                {icon && (
                    <Icon
                        name={icon}
                        size={search ? 18 : 20}
                        className={cx('pointer-events-none absolute text-fg-2', search ? 'start-4' : 'start-3.5')}
                    />
                )}
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
                        search ? 'h-11 rounded-full' : FIELD_SHAPE,
                        icon ? 'ps-11 pe-4' : 'px-4',
                        'placeholder:text-fg-3'
                    )}
                />
            </div>
        </FieldShell>
    );
}
