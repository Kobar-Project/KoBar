import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { CalendarEvent } from '../../store/useAppStore';
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, format, isSameMonth, isSameDay, addMonths, subMonths, eachDayOfInterval, parseISO } from 'date-fns';
import { getEventsForDate, getUpcomingOccurrences } from '../../utils/calendarUtils';

interface HolidayData {
    date: string;
    name?: string;
    type?: string[];
}

const KoCalendarPopup: React.FC = () => {
    const edgePosition = useAppStore(state => state.edgePosition);
    const koCalendarAnchorRect = useAppStore(state => state.koCalendarAnchorRect);
    const setIsKoCalendarOpen = useAppStore(state => state.setIsKoCalendarOpen);
    const design = useAppStore(state => state.design);
    const glassOpacity = useAppStore(state => state.glassOpacity);
    const screenBounds = useAppStore(state => state.screenBounds);
    const isSmartPositioning = useAppStore(state => state.isPopupSmartPositioning);
    const isMac = useAppStore(state => state.isMac);
    
    const todos = useAppStore(state => state.todos);
    const localEvents = useAppStore(state => state.localEvents);
    const addCalendarEvent = useAppStore(state => state.addCalendarEvent);
    const updateCalendarEvent = useAppStore(state => state.updateCalendarEvent);
    const deleteCalendarEvent = useAppStore(state => state.deleteCalendarEvent);
    const koCalendarColor = useAppStore(state => state.koCalendarColor);
    const t = useAppStore(state => state.t);

    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [editingEventDate, setEditingEventDate] = useState<Date | null>(null);
    const [editingEventId, setEditingEventId] = useState<string | null>(null);
    const [newEventTitle, setNewEventTitle] = useState('');
    const [newEventDescription, setNewEventDescription] = useState('');
    const [newEventMeetingLink, setNewEventMeetingLink] = useState('');
    const [newEventHours, setNewEventHours] = useState('12');
    const [newEventMinutes, setNewEventMinutes] = useState('00');
    const [newEventNotification, setNewEventNotification] = useState(true);
    const [newEventColor, setNewEventColor] = useState(koCalendarColor);
    const [newEventRecurrence, setNewEventRecurrence] = useState<'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'>('none');
    const [newEventRecurrenceEndDate, setNewEventRecurrenceEndDate] = useState<string>('');
    const [newEventRecurrenceEndType, setNewEventRecurrenceEndType] = useState<'never' | 'date' | 'count'>('never');
    const [newEventRecurrenceCount, setNewEventRecurrenceCount] = useState<number>(10);
    const [newEventRecurrenceDays, setNewEventRecurrenceDays] = useState<number[]>([]);
    const [newEventRecurrenceDatesInput, setNewEventRecurrenceDatesInput] = useState<string>('');
    const [deletingOccurrence, setDeletingOccurrence] = useState<{ event: CalendarEvent, date: Date } | null>(null);
    const [pendingHolidays, setPendingHolidays] = useState<HolidayData[] | null>(null);
    const [importColor, setImportColor] = useState<string>(koCalendarColor);

    useEffect(() => {
        // Just keeping anchor rect check
        if (!koCalendarAnchorRect) return; 
    }, [koCalendarAnchorRect]);

    // We need sidebarPosition because if it exists, our wrapper is absolute, which shifts the coordinate space.
    const sidebarPosition = useAppStore(state => state.sidebarPosition);

    const orientation = useAppStore(state => state.orientation);

    const getPopupStyle = (): React.CSSProperties => {
        if (!koCalendarAnchorRect) return { display: 'none' };
        
        const popupHeight = 620; // Calendar is taller
        const popupWidth = 440;
        const screenHeight = screenBounds?.height ?? 800;
        const screenWidth = screenBounds?.width ?? 1200;
        const offsetTop = sidebarPosition ? sidebarPosition.y : 0;
        const offsetLeft = sidebarPosition ? sidebarPosition.x : 0;

        const style: React.CSSProperties = {
            position: 'absolute',
            width: popupWidth,
            zIndex: 99999,
            backgroundColor: design === 'style2' 
                ? `color-mix(in srgb, var(--theme-surface) ${glassOpacity}%, transparent)` 
                : 'var(--theme-bg-dark)',
            borderColor: design === 'style2' ? 'rgba(255, 255, 255, 0.1)' : 'var(--theme-border)',
            backdropFilter: design === 'style2' ? (isMac ? 'blur(8px)' : 'blur(20px)') : 'none',
            WebkitBackdropFilter: design === 'style2' ? (isMac ? 'blur(8px)' : 'blur(20px)') : 'none',
            willChange: 'transform, opacity',
            transitionProperty: 'opacity, transform, filter'
        };

        const screenXInViewport = (screenBounds?.x ?? 0) - window.screenX;
        const screenYInViewport = (screenBounds?.y ?? 0) - window.screenY;

        if (orientation === "horizontal") {
            let adjustedLeft = (koCalendarAnchorRect.left - offsetLeft) + (koCalendarAnchorRect.width / 2) - (popupWidth / 2);
            const maxLeft = screenXInViewport + (screenWidth - offsetLeft) - popupWidth - 20;
            const minLeft = screenXInViewport - offsetLeft + 20;
            if (adjustedLeft < minLeft) adjustedLeft = minLeft;
            if (adjustedLeft > maxLeft) adjustedLeft = maxLeft;

            if (!isSmartPositioning) {
                style.left = '50%';
                style.transform = 'translateX(-50%)';
            } else {
                style.left = adjustedLeft;
            }

            if (edgePosition === 'top') {
                style.top = '100%';
                style.marginTop = '12px';
            } else {
                style.bottom = '100%';
                style.marginBottom = '12px';
            }
        } else {
            let adjustedTop = (koCalendarAnchorRect.top - offsetTop) - 20 + (koCalendarAnchorRect.height / 2) - (popupHeight / 2);
            const maxTop = screenYInViewport + (screenHeight - offsetTop) - popupHeight - 20;
            const minTop = screenYInViewport - offsetTop + 20;
            if (adjustedTop < minTop) adjustedTop = minTop;
            if (adjustedTop > maxTop) adjustedTop = maxTop;

            if (!isSmartPositioning) {
                style.top = '50%';
                style.transform = 'translateY(-50%)';
            } else {
                style.top = adjustedTop;
            }

            if (edgePosition === 'left') {
                style.left = '100%';
                style.marginLeft = '12px';
            } else {
                style.right = '100%';
                style.marginRight = '12px';
            }
        }
        return style;
    };

    const popupRef = React.useRef<HTMLDivElement>(null);
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const isSmartRef = React.useRef(isSmartPositioning);
    React.useEffect(() => { isSmartRef.current = isSmartPositioning; }, [isSmartPositioning]);

    React.useEffect(() => {
        const onDrag = (e: Event) => {
            const customEvent = e as CustomEvent<{ x: number; y: number }>;
            if (!popupRef.current || !koCalendarAnchorRect || !isSmartRef.current) return;
            const newX = customEvent.detail.x;
            const newY = customEvent.detail.y;
            const popupHeight = 620;
            const popupWidth = 440;
            
            const screenXInViewport = (screenBounds?.x ?? 0) - window.screenX;
        const screenYInViewport = (screenBounds?.y ?? 0) - window.screenY;

        if (orientation === "horizontal") {
                const screenWidth = screenBounds?.width ?? 1200;
                let adjustedLeft = (koCalendarAnchorRect.left - newX) + (koCalendarAnchorRect.width / 2) - (popupWidth / 2);
                const maxLeft = screenXInViewport + (screenWidth - newX) - popupWidth - 20;
                const minLeft = screenXInViewport - newX + 20;
                if (adjustedLeft < minLeft) adjustedLeft = minLeft;
                if (adjustedLeft > maxLeft) adjustedLeft = maxLeft;
                popupRef.current.style.left = `${adjustedLeft}px`;

            } else {
                const screenHeight = screenBounds?.height ?? 800;
                let adjustedTop = (koCalendarAnchorRect.top - newY) - 20 + (koCalendarAnchorRect.height / 2) - (popupHeight / 2);
                const maxTop = screenYInViewport + (screenHeight - newY) - popupHeight - 20;
                const minTop = screenYInViewport - newY + 20;
                if (adjustedTop < minTop) adjustedTop = minTop;
                if (adjustedTop > maxTop) adjustedTop = maxTop;
                popupRef.current.style.top = `${adjustedTop}px`;

            }
        };
        document.addEventListener('kobar-drag', onDrag);
        return () => document.removeEventListener('kobar-drag', onDrag);
    }, [koCalendarAnchorRect, screenBounds, orientation]);


    const handlePrevMonth = () => setCurrentDate(subMonths(currentDate, 1));
    const handleNextMonth = () => setCurrentDate(addMonths(currentDate, 1));
    const handleToday = () => setCurrentDate(new Date());

    const handleImportHolidays = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target?.result as string);
                if (json && json.holidays && Array.isArray(json.holidays)) {
                    setPendingHolidays(json.holidays);
                    setImportColor(koCalendarColor);
                }
            } catch (err) {
                console.error("Failed to parse holidays JSON", err);
            }
        };
        reader.readAsText(file);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    // Generate Calendar Grid
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart, { weekStartsOn: 1 }); // Monday start
    const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
    const dayIntervals = eachDayOfInterval({ start: startDate, end: endDate });

    return (
        <div
            ref={popupRef}
            className="border shadow-2xl pointer-events-auto animate-in fade-in zoom-in duration-200 overflow-hidden flex flex-col rounded-xl"
            style={getPopupStyle()}
        >
            {/* Header */}
            <div className="flex justify-between items-center p-4 pb-2 border-b border-white/5 drag-region">
                <div className="flex items-center gap-2 min-w-0 max-w-[250px]">
                    <span className="text-sm font-bold text-slate-200 whitespace-nowrap truncate shrink-0">
                        {(t as (key: string) => string)(`month_${currentDate.getMonth()}`)} {currentDate.getFullYear()}
                    </span>
                    {/* Tiny Color Picker */}
                    <div className="flex gap-1 ml-1 no-drag-region shrink-0">
                        {['#60a5fa', '#f87171', '#4ade80', '#fbbf24', '#a78bfa'].map(color => (
                            <button 
                                key={color}
                                onClick={() => useAppStore.getState().setKoCalendarColor(color)}
                                className={`w-2 h-2 rounded-full transition-transform hover:scale-150 ${koCalendarColor === color ? 'ring-1 ring-white scale-125' : 'opacity-50 hover:opacity-100'}`}
                                style={{ backgroundColor: color }}
                            />
                        ))}
                    </div>
                </div>
                <div className="flex gap-1 shrink-0 no-drag-region">
                    <button onClick={() => fileInputRef.current?.click()} className="w-7 h-7 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition-all" title={(t as (k: string) => string)('importHolidays') || "Import Holidays"}>
                        <span className="material-symbols-outlined text-[18px]">download</span>
                    </button>
                    <input 
                        type="file" 
                        accept=".json" 
                        ref={fileInputRef} 
                        onChange={handleImportHolidays} 
                        style={{ display: 'none' }} 
                    />
                    <button onClick={handleToday} className="px-3 py-1.5 bg-white/5 rounded hover:bg-white/10 text-sm font-semibold text-slate-300 transition-colors">{t('today')}</button>
                    <button onClick={handlePrevMonth} className="w-7 h-7 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition-all">
                        <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                    </button>
                    <button onClick={handleNextMonth} className="w-7 h-7 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition-all">
                        <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                    </button>
                    <div className="w-[1px] h-5 bg-white/10 my-auto mx-1" />
                    <button onClick={() => setIsKoCalendarOpen(false)} className="w-7 h-7 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-red-500/20 flex items-center justify-center transition-all">
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>
            </div>

            {/* Grid Days Header */}
            <div className="grid grid-cols-7 gap-1 p-2 pb-0 pt-3">
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                    <div key={i} className="text-center text-xs font-bold text-slate-500 uppercase">{d}</div>
                ))}
            </div>

            {/* Grid Body */}
            <div className="grid grid-cols-7 gap-1 p-2 custom-scrollbar overflow-y-auto" style={{ maxHeight: '400px' }}>
                {dayIntervals.map((day, i) => {
                    const isCurrentMonth = isSameMonth(day, monthStart);
                    const isToday = isSameDay(day, new Date());
                    const isSelected = isSameDay(day, selectedDate);
                    
                    // Match events
                    const dayEvents = getEventsForDate(localEvents, day);
                    // Match todos
                    const dayTodos = todos.filter(t => t.dueDate && isSameDay(parseISO(t.dueDate), day));

                    return (
                        <div 
                            key={i} 
                            onClick={() => setSelectedDate(day)}
                            onDoubleClick={() => {
                                setEditingEventDate(day);
                                setNewEventColor(koCalendarColor);
                            }}
                            className={`flex flex-col h-[70px] p-1.5 rounded-md border border-transparent hover:border-white/10 transition-colors relative cursor-pointer group
                                ${!isCurrentMonth ? 'opacity-30' : 'bg-white/5'}
                                ${isToday ? 'border-primary/30 bg-primary/5' : ''}
                                ${isSelected ? `border-[${koCalendarColor}]/50 bg-[${koCalendarColor}]/10` : ''}
                                ${editingEventDate && isSameDay(day, editingEventDate) ? 'ring-1 ring-primary overflow-visible z-10' : ''}`}
                        >
                            <div className="flex justify-between items-center px-1 mb-1">
                                <span className="text-xs font-bold" style={{ color: isToday ? 'var(--theme-primary)' : isSelected ? koCalendarColor : isCurrentMonth ? '#fff' : 'var(--theme-text-faded)' }}>
                                    {format(day, 'd')}
                                </span>
                                {isSelected && <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: koCalendarColor }} />}
                            </div>

                            {/* Event Indicators */}
                            <div className="flex flex-col gap-[3px] mt-auto overflow-hidden">
                                {dayEvents.slice(0, 2).map((ev, ei) => (
                                    <div key={ei} className="w-full h-1 rounded-full" style={{ backgroundColor: ev.colorId || koCalendarColor, opacity: 0.8 }} title={ev.title} />
                                ))}
                                {dayTodos.length > 0 && (
                                    <div className="flex items-center justify-start gap-[2px] px-0.5">
                                        <div className="w-full h-[2px] rounded-full bg-primary/40" />
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
            
            {/* Quick Agenda View / Add Event View at the bottom */}
            {pendingHolidays ? (
                <div className="p-3 border-t border-white/5 bg-black/40 flex flex-col gap-2 flex-1 animate-in slide-in-from-bottom-2">
                    <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-semibold text-slate-300">
                            {(t as (k: string) => string)('importHolidays') || "Import Holidays"}
                        </span>
                        <button onClick={() => setPendingHolidays(null)} className="w-6 h-6 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all">
                            <span className="material-symbols-outlined text-[16px]">close</span>
                        </button>
                    </div>
                    <div className="text-xs text-slate-400 mb-2">
                        Found {pendingHolidays.length} holidays. Select a color to associate with them:
                    </div>
                    <div className="flex gap-2 bg-black/20 border border-white/10 rounded-lg p-2 w-fit mx-auto mb-2">
                        {['#60a5fa', '#f87171', '#4ade80', '#fbbf24', '#a78bfa'].map(color => (
                            <button 
                                key={color}
                                type="button"
                                onClick={() => setImportColor(color)}
                                className={`w-5 h-5 rounded-full transition-transform hover:scale-125 ${importColor === color ? 'ring-2 ring-white scale-125' : 'opacity-50 hover:opacity-100'}`}
                                style={{ backgroundColor: color }}
                            />
                        ))}
                    </div>
                    <div className="mt-auto pt-2 flex justify-end">
                        <button 
                            onClick={() => {
                                const currentEvents = useAppStore.getState().localEvents;
                                const addedKeys = new Set<string>();

                                pendingHolidays.forEach((holiday: HolidayData) => {
                                    if (holiday.date) {
                                        const date = new Date(holiday.date);
                                        date.setHours(0, 0, 0, 0);
                                        const startTime = date.toISOString();
                                        const title = holiday.name || 'Holiday';
                                        
                                        const key = `${title}-${startTime}`;
                                        const isDuplicate = currentEvents.some(ev => ev.title === title && ev.startTime === startTime);

                                        if (!isDuplicate && !addedKeys.has(key)) {
                                            addedKeys.add(key);
                                            addCalendarEvent({
                                                title: title,
                                                startTime: startTime,
                                                endTime: startTime,
                                                notificationEnabled: false,
                                                notificationMinutes: 15,
                                                colorId: importColor
                                            });
                                        }
                                    }
                                });
                                setPendingHolidays(null);
                            }}
                            className="w-full px-6 py-2 rounded-lg bg-primary text-black text-sm font-bold hover:brightness-110 active:scale-95 transition-all"
                        >
                            Import {pendingHolidays.length} Holidays
                        </button>
                    </div>
                </div>
            ) : editingEventDate ? (
                <div className="p-3 border-t border-white/5 bg-black/40 flex flex-col gap-2 flex-1 animate-in slide-in-from-bottom-2">
                    <div className="flex justify-between items-center">
                        <span className="text-xs font-semibold text-slate-300">
                            {editingEventId ? t('editEvent') : t('addEvent')}: {format(editingEventDate, 'MMM d, yyyy')}
                        </span>
                        <button onClick={() => { 
                            setEditingEventDate(null); 
                            setEditingEventId(null);
                            setNewEventTitle(''); 
                            setNewEventDescription('');
                            setNewEventMeetingLink('');
                            setNewEventRecurrence('none');
                            setNewEventRecurrenceEndDate('');
                            setNewEventRecurrenceEndType('never');
                            setNewEventRecurrenceCount(10);
                            setNewEventRecurrenceDays([]);
                            setNewEventRecurrenceDatesInput('');
                        }} className="w-5 h-5 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all">
                            <span className="material-symbols-outlined text-[12px]">close</span>
                        </button>
                    </div>
                    <form onSubmit={(e) => {
                        e.preventDefault();
                            const eventStart = new Date(editingEventDate);
                            eventStart.setHours(parseInt(newEventHours, 10));
                            eventStart.setMinutes(parseInt(newEventMinutes, 10));
                            eventStart.setSeconds(0);
                            
                            const recEndDateISO = newEventRecurrence !== 'none' && newEventRecurrenceEndType === 'date' && newEventRecurrenceEndDate 
                                ? new Date(newEventRecurrenceEndDate + 'T23:59:59').toISOString() 
                                : undefined;

                            const recCount = newEventRecurrence !== 'none' && newEventRecurrenceEndType === 'count'
                                ? newEventRecurrenceCount
                                : undefined;

                            const recDays = newEventRecurrence === 'weekly' && newEventRecurrenceDays.length > 0
                                ? newEventRecurrenceDays
                                : undefined;

                            const recDates = newEventRecurrence === 'monthly' && newEventRecurrenceDatesInput.trim()
                                ? newEventRecurrenceDatesInput.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= 1 && n <= 31)
                                : undefined;

                            if (editingEventId) {
                                updateCalendarEvent(editingEventId, {
                                    title: newEventTitle.trim(),
                                    description: newEventDescription.trim(),
                                    meetingLink: newEventMeetingLink.trim(),
                                    startTime: eventStart.toISOString(),
                                    endTime: eventStart.toISOString(),
                                    notificationEnabled: newEventNotification,
                                    colorId: newEventColor,
                                    recurrence: newEventRecurrence,
                                    recurrenceEndDate: recEndDateISO,
                                    recurrenceCount: recCount,
                                    recurrenceDays: recDays,
                                    recurrenceDates: recDates
                                });
                            } else {
                                addCalendarEvent({
                                    title: newEventTitle.trim(),
                                    description: newEventDescription.trim(),
                                    meetingLink: newEventMeetingLink.trim(),
                                    startTime: eventStart.toISOString(),
                                    endTime: eventStart.toISOString(),
                                    notificationEnabled: newEventNotification,
                                    notificationMinutes: 15,
                                    colorId: newEventColor,
                                    recurrence: newEventRecurrence,
                                    recurrenceEndDate: recEndDateISO,
                                    recurrenceCount: recCount,
                                    recurrenceDays: recDays,
                                    recurrenceDates: recDates
                                });
                            }
                            setNewEventTitle('');
                            setNewEventDescription('');
                            setNewEventMeetingLink('');
                            setNewEventRecurrence('none');
                            setNewEventRecurrenceEndDate('');
                            setNewEventRecurrenceEndType('never');
                            setNewEventRecurrenceCount(10);
                            setNewEventRecurrenceDays([]);
                            setNewEventRecurrenceDatesInput('');
                            setEditingEventDate(null);
                            setEditingEventId(null);
                    }} className="flex flex-col gap-2">
                        <div className="relative flex flex-col gap-2">
                            <div className="relative">
                                <input
                                    autoFocus
                                    type="text"
                                    placeholder={(t as (k: string) => string)('eventTitle') || 'Event Title'}
                                    value={newEventTitle}
                                    onChange={(e) => setNewEventTitle(e.target.value)}
                                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-primary no-drag-region pr-10"
                                />
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-50">
                                    <span className="material-symbols-outlined text-[14px]">event</span>
                                </div>
                            </div>
                            <textarea
                                placeholder={(t as (k: string) => string)('eventDescription') || 'Description (optional)'}
                                value={newEventDescription}
                                onChange={(e) => setNewEventDescription(e.target.value)}
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-primary no-drag-region resize-none custom-scrollbar"
                                rows={2}
                            />
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder={(t as (k: string) => string)('meetingLink') || 'Meeting Link (optional)'}
                                    value={newEventMeetingLink}
                                    onChange={(e) => setNewEventMeetingLink(e.target.value)}
                                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 pl-8 text-white text-xs focus:outline-none focus:border-primary no-drag-region"
                                />
                                <div className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-50">
                                    <span className="material-symbols-outlined text-[14px]">link</span>
                                </div>
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1 bg-black/20 border border-white/10 rounded-lg p-1">
                                <span className="material-symbols-outlined text-[14px] text-slate-500 ml-1">schedule</span>
                                <div className="flex items-center">
                                    <input 
                                        type="text" 
                                        maxLength={2}
                                        value={newEventHours}
                                        onChange={(e) => {
                                            const v = e.target.value.replace(/\D/g, '').slice(0, 2);
                                            if (parseInt(v) < 24 || v === '') setNewEventHours(v);
                                        }}
                                        onBlur={() => setNewEventHours(prev => prev.padStart(2, '0'))}
                                        className="w-6 bg-transparent text-center text-xs text-white outline-none font-bold"
                                    />
                                    <span className="text-slate-600">:</span>
                                    <input 
                                        type="text" 
                                        maxLength={2}
                                        value={newEventMinutes}
                                        onChange={(e) => {
                                            const v = e.target.value.replace(/\D/g, '').slice(0, 2);
                                            if (parseInt(v) < 60 || v === '') setNewEventMinutes(v);
                                        }}
                                        onBlur={() => setNewEventMinutes(prev => prev.padStart(2, '0'))}
                                        className="w-6 bg-transparent text-center text-xs text-white outline-none font-bold"
                                    />
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={() => setNewEventNotification(!newEventNotification)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-[10px] font-bold uppercase tracking-wider
                                    ${newEventNotification ? 'bg-primary/20 border-primary/40 text-primary' : 'bg-white/5 border-white/10 text-slate-500'}`}
                            >
                                <span className={`material-symbols-outlined text-[16px] ${newEventNotification ? 'animate-wiggle' : ''}`}>
                                    {newEventNotification ? 'notifications_active' : 'notifications_off'}
                                </span>
                                {newEventNotification ? t('alertOn') : t('noAlert')}
                            </button>
                        </div>

                        <div className="flex items-center gap-2">
                            {/* Recurrence Selector */}
                            <div className="flex items-center gap-1 bg-black/20 border border-white/10 rounded-lg p-1 text-xs select-none">
                                <span className="material-symbols-outlined text-[14px] text-slate-500 ml-1">repeat</span>
                                <select
                                    value={newEventRecurrence}
                                    onChange={(e) => setNewEventRecurrence(e.target.value as any)}
                                    className="bg-transparent text-white border-0 outline-none font-semibold text-xs py-0.5 px-1 cursor-pointer"
                                >
                                    <option value="none" className="bg-slate-900 text-white">{t('recurrenceNone') || 'Does not repeat'}</option>
                                    <option value="daily" className="bg-slate-900 text-white">{t('recurrenceDaily') || 'Daily'}</option>
                                    <option value="weekly" className="bg-slate-900 text-white">{t('recurrenceWeekly') || 'Weekly'}</option>
                                    <option value="monthly" className="bg-slate-900 text-white">{t('recurrenceMonthly') || 'Monthly'}</option>
                                    <option value="yearly" className="bg-slate-900 text-white">{t('recurrenceYearly') || 'Yearly'}</option>
                                </select>
                            </div>

                             {/* Recurrence End Conditions Selector & Inputs */}
                            {newEventRecurrence !== 'none' && (
                                <>
                                    <div className="flex items-center gap-1 bg-black/20 border border-white/10 rounded-lg p-1 text-xs select-none">
                                        <span className="material-symbols-outlined text-[14px] text-slate-500 ml-1">event_busy</span>
                                        <select
                                            value={newEventRecurrenceEndType}
                                            onChange={(e) => setNewEventRecurrenceEndType(e.target.value as any)}
                                            className="bg-transparent text-white border-0 outline-none font-semibold text-xs py-0.5 px-1 cursor-pointer"
                                        >
                                            <option value="never" className="bg-slate-900 text-white">{t('recurrenceEndsNever') || 'Never'}</option>
                                            <option value="date" className="bg-slate-900 text-white">{t('recurrenceEndsOn') || 'On Date'}</option>
                                            <option value="count" className="bg-slate-900 text-white">{t('recurrenceEndsAfter') || 'After'}</option>
                                        </select>
                                    </div>

                                    {newEventRecurrenceEndType === 'date' && (
                                        <div className="flex items-center gap-1 bg-black/20 border border-white/10 rounded-lg p-1 text-xs">
                                            <input
                                                type="date"
                                                value={newEventRecurrenceEndDate}
                                                onChange={(e) => setNewEventRecurrenceEndDate(e.target.value)}
                                                className="bg-transparent text-white border-0 outline-none font-semibold text-xs py-0.5 px-1 cursor-pointer [color-scheme:dark]"
                                            />
                                        </div>
                                    )}

                                    {newEventRecurrenceEndType === 'count' && (
                                        <div className="flex items-center gap-1 bg-black/20 border border-white/10 rounded-lg p-1 text-xs">
                                            <input
                                                type="number"
                                                min={1}
                                                value={newEventRecurrenceCount}
                                                onChange={(e) => setNewEventRecurrenceCount(parseInt(e.target.value, 10) || 1)}
                                                className="w-8 bg-transparent text-center text-white border-0 outline-none font-bold text-xs"
                                            />
                                            <span className="text-slate-400 text-[10px] pr-1">{t('occurrences') || 'occurrences'}</span>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Weekly: Select days of the week */}
                        {newEventRecurrence === 'weekly' && (
                            <div className="flex flex-col gap-1 mt-1 bg-black/20 border border-white/10 rounded-lg p-2">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Repeat on</span>
                                <div className="flex gap-1.5">
                                    {[
                                        { label: 'M', value: 1 },
                                        { label: 'T', value: 2 },
                                        { label: 'W', value: 3 },
                                        { label: 'T', value: 4 },
                                        { label: 'F', value: 5 },
                                        { label: 'S', value: 6 },
                                        { label: 'S', value: 0 },
                                    ].map(day => {
                                        const isSelected = newEventRecurrenceDays.includes(day.value);
                                        return (
                                            <button
                                                key={day.value}
                                                type="button"
                                                onClick={() => {
                                                    if (isSelected) {
                                                        setNewEventRecurrenceDays(newEventRecurrenceDays.filter(d => d !== day.value));
                                                    } else {
                                                        setNewEventRecurrenceDays([...newEventRecurrenceDays, day.value]);
                                                    }
                                                }}
                                                className={`w-6 h-6 rounded-full text-[10px] font-bold transition-all flex items-center justify-center border
                                                    ${isSelected 
                                                        ? 'bg-primary border-primary text-black font-extrabold' 
                                                        : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10'}`}
                                            >
                                                {day.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Monthly: Comma-separated days of month */}
                        {newEventRecurrence === 'monthly' && (
                            <div className="flex flex-col gap-1 mt-1 bg-black/20 border border-white/10 rounded-lg p-2">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Repeat on dates (e.g. 1, 15)</span>
                                <input
                                    type="text"
                                    placeholder="e.g. 1, 15"
                                    value={newEventRecurrenceDatesInput}
                                    onChange={(e) => setNewEventRecurrenceDatesInput(e.target.value)}
                                    className="w-full bg-black/40 border border-white/10 rounded-lg px-2.5 py-1 text-white text-xs focus:outline-none focus:border-primary no-drag-region"
                                />
                            </div>
                        )}

                        <div className="flex items-center gap-2 mt-1">
                            <div className="flex gap-1.5 bg-black/20 border border-white/10 rounded-lg p-1.5">
                                {['#60a5fa', '#f87171', '#4ade80', '#fbbf24', '#a78bfa'].map(color => (
                                    <button 
                                        key={color}
                                        type="button"
                                        onClick={() => setNewEventColor(color)}
                                        className={`w-4 h-4 rounded-full transition-transform hover:scale-125 ${newEventColor === color ? 'ring-2 ring-white scale-125' : 'opacity-50 hover:opacity-100'}`}
                                        style={{ backgroundColor: color }}
                                    />
                                ))}
                            </div>
                            <button type="submit" disabled={!newEventTitle.trim()} className="ml-auto px-6 py-1.5 rounded-lg bg-primary text-black text-sm font-bold hover:brightness-110 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                                {editingEventId ? t('updateEvent') : t('saveEvent')}
                            </button>
                        </div>
                    </form>
                </div>
            ) : (
                <div className="p-3 border-t border-white/5 bg-black/20 flex flex-col gap-2 flex-1 relative group overflow-hidden">
                    {(() => {
                        // Filter events starting from the start of the selected date
                        const targetStartOfDay = new Date(selectedDate);
                        targetStartOfDay.setHours(0,0,0,0);
                        
                        const agendaData = getUpcomingOccurrences(localEvents, targetStartOfDay, 30)
                            .sort((a, b) => parseISO(a.startTime!).getTime() - parseISO(b.startTime!).getTime());
                        
                        const selectedDayHasEvent = agendaData.length > 0 && isSameDay(parseISO(agendaData[0].startTime!), selectedDate);
                        
                        return (
                            <>
                                <div className="flex justify-between items-center pr-1">
                                    <span className="text-xs font-bold text-slate-200 uppercase tracking-widest">
                                        {selectedDayHasEvent ? `${format(selectedDate, 'MMM d')} - ${t('events')}` : t('upcomingEvents')}
                                    </span>
                                    <button onClick={() => {
                                        setEditingEventDate(selectedDate);
                                        setNewEventColor(koCalendarColor);
                                    }} className="w-6 h-6 rounded-full bg-primary/20 text-primary opacity-0 group-hover:opacity-100 transition-opacity hover:bg-primary/40 flex items-center justify-center relative z-20">
                                        <span className="material-symbols-outlined text-[16px]">add</span>
                                    </button>
                                </div>
                                <div className="flex flex-col gap-1 overflow-y-auto overflow-x-hidden custom-scrollbar h-[160px] animate-in fade-in slide-in-from-top-1 pr-1">
                                    {agendaData.slice(0, 8).map(ev => {
                                        const eventDate = parseISO(ev.startTime!);
                                        const isEvToday = isSameDay(eventDate, new Date());
                                        const isEvSelected = isSameDay(eventDate, selectedDate);
                                        
                                        return (
                                            <div key={`${ev.id}-${ev.startTime}`} className="flex justify-between items-center text-sm group/event hover:bg-white/5 rounded px-2 py-1.5 transition-colors" style={{ backgroundColor: isEvSelected ? `color-mix(in srgb, ${ev.colorId || koCalendarColor} 5%, transparent)` : 'transparent' }}>
                                                <div className="flex items-start gap-2.5 flex-1 min-w-0 mr-3 mt-1">
                                                    <div className="w-2 h-2 rounded-full shrink-0 mt-1" style={{ backgroundColor: isEvSelected ? (ev.colorId || koCalendarColor) : isEvToday ? 'var(--theme-primary)' : 'var(--theme-text-faded)' }} />
                                                    <div className="flex flex-col min-w-0 flex-1">
                                                        <div className="flex items-center gap-1">
                                                            <span className="truncate" style={{ color: isEvSelected ? (ev.colorId || koCalendarColor) : '#fff', fontWeight: isEvSelected ? '600' : '400' }}>{ev.title}</span>
                                                            {ev.recurrence && ev.recurrence !== 'none' && (
                                                                <span className="material-symbols-outlined text-[12px] text-slate-400 shrink-0" title={t('recurrence') || 'Recurring'}>repeat</span>
                                                            )}
                                                            {ev.meetingLink && (
                                                                <button onClick={(e) => { e.stopPropagation(); window.api?.openExternal?.(ev.meetingLink!); }} className="text-blue-400 hover:text-blue-300 ml-1 shrink-0 bg-blue-400/10 rounded-full w-5 h-5 flex items-center justify-center transition-colors" title={(t as (k: string) => string)('joinMeeting') || 'Join Meeting'}>
                                                                    <span className="material-symbols-outlined text-[12px]">videocam</span>
                                                                </button>
                                                            )}
                                                            {ev.notificationEnabled && (
                                                                <span className="material-symbols-outlined text-xs text-primary/50 shrink-0">notifications_active</span>
                                                            )}
                                                        </div>
                                                        {ev.description && (
                                                            <span className="text-[10px] text-slate-400 truncate mt-0.5" title={ev.description}>{ev.description}</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span className="text-xs group-hover/event:hidden" style={{ color: isEvSelected ? (ev.colorId || koCalendarColor) : '#cbd5e1' }}>
                                                        {isEvSelected ? format(eventDate, 'HH:mm') : format(eventDate, 'MMM d')}
                                                    </span>
                                                    <button 
                                                        onClick={() => {
                                                            const originalEvent = useAppStore.getState().localEvents.find(e => e.id === ev.id) || ev;
                                                            const d = parseISO(originalEvent.startTime);
                                                            setEditingEventDate(d);
                                                            setEditingEventId(originalEvent.id);
                                                            setNewEventTitle(originalEvent.title);
                                                            setNewEventDescription(originalEvent.description || '');
                                                            setNewEventMeetingLink(originalEvent.meetingLink || '');
                                                            setNewEventHours(format(parseISO(ev.startTime!), 'HH'));
                                                            setNewEventMinutes(format(parseISO(ev.startTime!), 'mm'));
                                                            setNewEventNotification(!!originalEvent.notificationEnabled);
                                                            setNewEventColor(originalEvent.colorId || koCalendarColor);
                                                            setNewEventRecurrence(originalEvent.recurrence || 'none');
                                                            setNewEventRecurrenceEndDate(originalEvent.recurrenceEndDate ? format(parseISO(originalEvent.recurrenceEndDate), 'yyyy-MM-dd') : '');
                                                            const recEndType = originalEvent.recurrenceCount !== undefined
                                                                ? 'count'
                                                                : originalEvent.recurrenceEndDate
                                                                    ? 'date'
                                                                    : 'never';
                                                            setNewEventRecurrenceEndType(recEndType);
                                                            setNewEventRecurrenceCount(originalEvent.recurrenceCount || 10);
                                                            setNewEventRecurrenceDays(originalEvent.recurrenceDays || []);
                                                            setNewEventRecurrenceDatesInput(originalEvent.recurrenceDates ? originalEvent.recurrenceDates.join(', ') : '');
                                                        }}
                                                        className="hidden group-hover/event:flex w-4 h-4 items-center justify-center text-blue-400 hover:text-blue-300 bg-blue-400/10 rounded"
                                                    >
                                                        <span className="material-symbols-outlined text-[12px]">edit</span>
                                                    </button>
                                                    <button 
                                                        onClick={() => {
                                                            if (ev.recurrence && ev.recurrence !== 'none') {
                                                                setDeletingOccurrence({ event: ev, date: parseISO(ev.startTime!) });
                                                            } else {
                                                                deleteCalendarEvent(ev.id);
                                                            }
                                                        }}
                                                        className="hidden group-hover/event:flex w-4 h-4 items-center justify-center text-red-400 hover:text-red-300 bg-red-400/10 rounded"
                                                    >
                                                        <span className="material-symbols-outlined text-[12px]">delete</span>
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {agendaData.length === 0 && (
                                        <div className="flex flex-col items-center justify-center h-full opacity-30 mt-1">
                                           <span className="text-[10px] text-slate-500 italic">{t('noEventsFound')}</span>
                                        </div>
                                    )}
                                </div>
                            </>
                        );
                    })()}
                </div>
            )}

            {deletingOccurrence && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-[99999] flex items-center justify-center p-4 select-none animate-in fade-in duration-200">
                    <div className="bg-slate-900/90 border border-white/10 rounded-xl p-4 w-full max-w-[340px] flex flex-col gap-3 shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="flex flex-col gap-1">
                            <span className="text-xs font-bold text-slate-200 uppercase tracking-widest">
                                {t('deleteOccurrencePromptTitle') || 'Delete Recurring Event'}
                            </span>
                            <span className="text-[10px] text-slate-400 truncate" title={deletingOccurrence.event.title}>
                                "{deletingOccurrence.event.title}"
                            </span>
                        </div>
                        <div className="flex flex-col gap-2">
                            <button
                                                                onClick={() => {
                                                                    const { event, date } = deletingOccurrence;
                                                                    const year = date.getFullYear();
                                                                    const month = String(date.getMonth() + 1).padStart(2, '0');
                                                                    const day = String(date.getDate()).padStart(2, '0');
                                                                    const exceptionDateStr = `${year}-${month}-${day}`;
                                                                    
                                                                    const originalEvent = useAppStore.getState().localEvents.find(e => e.id === event.id);
                                                                    if (originalEvent) {
                                                                        const exceptions = originalEvent.recurrenceExceptions || [];
                                                                        updateCalendarEvent(event.id, {
                                                                            recurrenceExceptions: [...exceptions, exceptionDateStr]
                                                                        });
                                                                    }
                                                                    setDeletingOccurrence(null);
                                                                }}
                                                                className="w-full text-left px-3 py-2 text-xs font-semibold rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                                                            >
                                                                {t('deleteOnlyThisOccurrence') || 'Only this occurrence'}
                                                            </button>

                                                            <button
                                                                onClick={() => {
                                                                    const { event, date } = deletingOccurrence;
                                                                    const originalEvent = useAppStore.getState().localEvents.find(e => e.id === event.id);
                                                                    if (originalEvent) {
                                                                        const eventStart = parseISO(originalEvent.startTime);
                                                                        const compareDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
                                                                        const compareStart = new Date(eventStart.getFullYear(), eventStart.getMonth(), eventStart.getDate());
                                                                        
                                                                        if (compareDate.getTime() <= compareStart.getTime()) {
                                                                            deleteCalendarEvent(event.id);
                                                                        } else {
                                                                            const prevDay = new Date(date.getTime() - 24 * 60 * 60 * 1000);
                                                                            prevDay.setHours(23, 59, 59, 999);
                                                                            updateCalendarEvent(event.id, {
                                                                                recurrenceEndDate: prevDay.toISOString()
                                                                            });
                                                                        }
                                                                    }
                                                                    setDeletingOccurrence(null);
                                                                }}
                                                                className="w-full text-left px-3 py-2 text-xs font-semibold rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                                                            >
                                                                {t('deleteThisAndFollowingOccurrences') || 'This and all following events'}
                                                            </button>

                                                            <button
                                                                onClick={() => {
                                                                    const { event } = deletingOccurrence;
                                                                    deleteCalendarEvent(event.id);
                                                                    setDeletingOccurrence(null);
                                                                }}
                                                                className="w-full text-left px-3 py-2 text-xs font-bold rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 hover:text-red-100 hover:bg-red-500/30 transition-colors"
                                                            >
                                                                {t('deleteAllOccurrences') || 'All events in the series'}
                                                            </button>
                        </div>
                        <div className="flex justify-end border-t border-white/5 pt-2">
                            <button
                                onClick={() => setDeletingOccurrence(null)}
                                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                            >
                                {t('cancel') || 'Cancel'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default KoCalendarPopup;
