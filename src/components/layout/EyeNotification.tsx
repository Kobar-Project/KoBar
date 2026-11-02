import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useT } from '../../i18n/useT';
import { Icon } from '../../ui';
import { cx, INTERACTIVE } from '../../ui/cx';

// Inverse pill like the Toast: --kb-fg-1 fill, shell-coloured text. A button's colour hint shows as a tinted label
// (success / danger / accent) instead of a coloured fill, so it stays readable on both schemes.
const BUTTON_TONE: Record<string, string> = {
    green: 'text-[var(--kb-success)]',
    red: 'text-[var(--kb-danger)]',
    blue: 'text-[var(--kb-accent)]',
    primary: 'text-[var(--kb-accent)]',
};

const EyeNotification: React.FC = () => {
    const t = useT();
    const notification = useAppStore((state) => state.eyeNotification);
    const hideEyeNotification = useAppStore((state) => state.hideEyeNotification);
    const orientation = useAppStore((state) => state.orientation);
    const edgePosition = useAppStore((state) => state.edgePosition);

    if (!notification || !notification.isVisible) return null;

    let positionClasses = '';
    if (orientation === 'horizontal') {
        positionClasses = edgePosition === 'top' ? 'top-full mt-4 right-0' : 'bottom-full mb-4 right-0';
    } else {
        positionClasses = edgePosition === 'left' ? 'left-full ml-4 bottom-0' : 'right-full mr-4 bottom-0';
    }

    const lines = notification.message.split(/\\n|\n/);

    return (
        <div
            role="status"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className={`absolute ${positionClasses} z-[100] flex w-64 flex-col gap-3 rounded-[18px] bg-[var(--kb-fg-1)] py-3 ps-4 pe-2 text-[var(--kb-bg-shell)] shadow-e2 animate-pop-in pointer-events-auto`}
        >
            <div className="flex items-start gap-2.5">
                <Icon name="info" size={20} className="mt-0.5" />
                <p className="min-w-0 flex-1 [font:var(--kb-type-body)]">
                    {lines.map((line, i) => (
                        <React.Fragment key={i}>
                            {line}
                            {i < lines.length - 1 && <br />}
                        </React.Fragment>
                    ))}
                </p>
                <button
                    type="button"
                    aria-label={t('hydrationFailedDismiss')}
                    onClick={hideEyeNotification}
                    className={cx(
                        INTERACTIVE,
                        'inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[color-mix(in_oklab,var(--kb-bg-shell)_14%,transparent)]'
                    )}
                >
                    <Icon name="close" size={18} />
                </button>
            </div>

            {notification.buttons && notification.buttons.length > 0 && (
                <div className="flex flex-wrap justify-end gap-1 pe-1">
                    {notification.buttons.map((btn, idx) => (
                        <button
                            key={idx}
                            type="button"
                            onClick={() => {
                                btn.onClick();
                            }}
                            className={cx(
                                INTERACTIVE,
                                'inline-flex h-8 items-center rounded-full px-3 [font:var(--kb-type-label)] transition-colors hover:bg-[color-mix(in_oklab,var(--kb-bg-shell)_14%,transparent)]',
                                BUTTON_TONE[btn.color] ?? 'text-[var(--kb-bg-container)]'
                            )}
                        >
                            {btn.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default EyeNotification;
