import React, { useState } from 'react';
import { Icon, IconButton, Toggle } from '../../ui';
import { cx, INTERACTIVE } from '../../ui/cx';

const Accordion: React.FC<{
    title: string;
    icon: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
    masterToggle?: { isOn: boolean; onToggle: () => void };
    /** Increase to expand the accordion from outside (T-215 backup hint). */
    openSignal?: number;
}> = ({ title, icon, defaultOpen = true, children, masterToggle, openSignal }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const [seenSignal, setSeenSignal] = useState(openSignal);
    if (openSignal !== seenSignal) {
        setSeenSignal(openSignal);
        if (openSignal) setIsOpen(true);
    }

    return (
        <div className="overflow-hidden rounded-xl bg-surface">
            <div className="flex w-full items-center justify-between p-6">
                <button
                    type="button"
                    aria-expanded={isOpen}
                    className={cx(
                        INTERACTIVE,
                        'flex flex-1 cursor-pointer items-center gap-2 rounded-md text-start transition-colors hover:bg-[var(--kb-fill-hover)]'
                    )}
                    onClick={() => setIsOpen(!isOpen)}
                >
                    <Icon name={icon} size={24} className="text-accent" />
                    <h3 className="[font:var(--kb-type-subtitle)] text-fg-1">{title}</h3>
                </button>

                <div className="flex items-center gap-4">
                    {masterToggle && <Toggle checked={masterToggle.isOn} onChange={masterToggle.onToggle} label={title} hideLabel />}
                    <IconButton
                        icon="expand_more"
                        label={title}
                        size={32}
                        tooltip={false}
                        onClick={() => setIsOpen(!isOpen)}
                        className={isOpen ? 'rotate-180' : ''}
                    />
                </div>
            </div>
            {isOpen && <div className="mt-2 border-t border-stroke px-6 pt-4 pb-6">{children}</div>}
        </div>
    );
};

export default Accordion;
