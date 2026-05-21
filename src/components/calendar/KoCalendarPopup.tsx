import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, format, isSameMonth, isSameDay, addMonths, subMonths, eachDayOfInterval, parseISO } from 'date-fns';

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
    const [newEventHours, setNewEventHours] = useState('12');
    const [newEventMinutes, setNewEventMinutes] = useState('00');
    const [newEventNotification, setNewEventNotification] = useState(true);

    useEffect(() => {
        // Just keeping anchor rect check
        if (!koCalendarAnchorRect) return; 
    }, [koCalendarAnchorRect]);

    // We need sidebarPosition because if it exists, our wrapper is absolute, which shifts the coordinate space.
    const sidebarPosition = useAppStore(state => state.sidebarPosition);

    const orientation = useAppStore(state => state.orientation);

    const getPopupStyle = (): React.CSSProperties => {
        if (!koCalendarAnchorRect) return { display: 'none' };
        
        const popupHeight = 440; // Calendar is taller
        const popupWidth = 350;
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
    const isSmartRef = React.useRef(isSmartPositioning);
    React.useEffect(() => { isSmartRef.current = isSmartPositioning; }, [isSmartPositioning]);

    React.useEffect(() => {
        const onDrag = (e: any) => {
            if (!popupRef.current || !koCalendarAnchorRect || !isSmartRef.current) return;
            const newX = e.detail.x;
            const newY = e.detail.y;
            const popupHeight = 440;
            const popupWidth = 350;
            
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
                popupRef.current.style.top = '';
            } else {
                const screenHeight = screenBounds?.height ?? 800;
                let adjustedTop = (koCalendarAnchorRect.top - newY) - 20 + (koCalendarAnchorRect.height / 2) - (popupHeight / 2);
                const maxTop = screenYInViewport + (screenHeight - newY) - popupHeight - 20;
                const minTop = screenYInViewport - newY + 20;
                if (adjustedTop < minTop) adjustedTop = minTop;
                if (adjustedTop > maxTop) adjustedTop = maxTop;
                popupRef.current.style.top = `${adjustedTop}px`;
                popupRef.current.style.left = '';
            }
        };
        document.addEventListener('kobar-drag', onDrag);
        return () => document.removeEventListener('kobar-drag', onDrag);
    }, [koCalendarAnchorRect, screenBounds, orientation]);


    const handlePrevMonth = () => setCurrentDate(subMonths(currentDate, 1));
    const handleNextMonth = () => setCurrentDate(addMonths(currentDate, 1));
    const handleToday = () => setCurrentDate(new Date());

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
                <div className="flex items-center gap-2 min-w-0 max-w-[200px]">
                    <span className="text-xs font-bold text-slate-200 whitespace-nowrap truncate shrink-0">
                        {t(`month_${currentDate.getMonth()}` as any)} {currentDate.getFullYear()}
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
                    <button onClick={handleToday} className="px-2 py-1 bg-white/5 rounded hover:bg-white/10 text-xs font-semibold text-slate-300 transition-colors">{t('today')}</button>
                    <button onClick={handlePrevMonth} className="w-6 h-6 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition-all">
                        <span className="material-symbols-outlined text-[16px]">chevron_left</span>
                    </button>
                    <button onClick={handleNextMonth} className="w-6 h-6 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition-all">
                        <span className="material-symbols-outlined text-[16px]">chevron_right</span>
                    </button>
                    <div className="w-[1px] h-4 bg-white/10 my-auto mx-1" />
                    <button onClick={() => setIsKoCalendarOpen(false)} className="w-6 h-6 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-red-500/20 flex items-center justify-center transition-all">
                        <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                </div>
            </div>

            {/* Grid Days Header */}
            <div className="grid grid-cols-7 gap-1 p-2 pb-0 pt-3">
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                    <div key={i} className="text-center text-[10px] font-bold text-slate-500 uppercase">{d}</div>
                ))}
            </div>

            {/* Grid Body */}
            <div className="grid grid-cols-7 gap-1 p-2 custom-scrollbar overflow-y-auto" style={{ maxHeight: '310px' }}>
                {dayIntervals.map((day, i) => {
                    const isCurrentMonth = isSameMonth(day, monthStart);
                    const isToday = isSameDay(day, new Date());
                    const isSelected = isSameDay(day, selectedDate);
                    
                    // Match events
                    const dayEvents = localEvents.filter(ev => ev.startTime && isSameDay(parseISO(ev.startTime), day));
                    // Match todos
                    const dayTodos = todos.filter(t => t.dueDate && isSameDay(parseISO(t.dueDate), day));

                    return (
                        <div 
                            key={i} 
                            onClick={() => setSelectedDate(day)}
                            onDoubleClick={() => setEditingEventDate(day)}
                            className={`flex flex-col h-14 p-1 rounded-md border border-transparent hover:border-white/10 transition-colors relative cursor-pointer group
                                ${!isCurrentMonth ? 'opacity-30' : 'bg-white/5'}
                                ${isToday ? 'border-primary/30 bg-primary/5' : ''}
                                ${isSelected ? `border-[${koCalendarColor}]/50 bg-[${koCalendarColor}]/10` : ''}
                                ${editingEventDate && isSameDay(day, editingEventDate) ? 'ring-1 ring-primary overflow-visible z-10' : ''}`}
                        >
                            <div className="flex justify-between items-center px-1">
                                <span className="text-[10px] font-bold" style={{ color: isToday ? 'var(--theme-primary)' : isSelected ? koCalendarColor : isCurrentMonth ? '#fff' : 'var(--theme-text-faded)' }}>
                                    {format(day, 'd')}
                                </span>
                                {isSelected && <div className="w-1 h-1 rounded-full" style={{ backgroundColor: koCalendarColor }} />}
                            </div>

                            {/* Event Indicators */}
                            <div className="flex flex-col gap-[2px] mt-auto overflow-hidden">
                                {dayEvents.slice(0, 2).map((ev, ei) => (
                                    <div key={ei} className="w-full h-[3px] rounded-full" style={{ backgroundColor: ev.colorId || koCalendarColor, opacity: 0.8 }} title={ev.title} />
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
            {editingEventDate ? (
                <div className="p-3 border-t border-white/5 bg-black/40 flex flex-col gap-2 flex-1 animate-in slide-in-from-bottom-2">
                    <div className="flex justify-between items-center">
                        <span className="text-xs font-semibold text-slate-300">
                            {editingEventId ? t('editEvent') : t('addEvent')}: {format(editingEventDate, 'MMM d, yyyy')}
                        </span>
                        <button onClick={() => { 
                            setEditingEventDate(null); 
                            setEditingEventId(null);
                            setNewEventTitle(''); 
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
                            
                            if (editingEventId) {
                                updateCalendarEvent(editingEventId, {
                                    title: newEventTitle.trim(),
                                    startTime: eventStart.toISOString(),
                                    endTime: eventStart.toISOString(),
                                    notificationEnabled: newEventNotification,
                                });
                            } else {
                                addCalendarEvent({
                                    title: newEventTitle.trim(),
                                    startTime: eventStart.toISOString(),
                                    endTime: eventStart.toISOString(),
                                    notificationEnabled: newEventNotification,
                                    notificationMinutes: 15,
                                    colorId: koCalendarColor
                                });
                            }
                            setNewEventTitle('');
                            setEditingEventDate(null);
                            setEditingEventId(null);
                    }} className="flex flex-col gap-2">
                        <div className="relative">
                            <input
                                autoFocus
                                type="text"
                                placeholder={t('eventTitle')}
                                value={newEventTitle}
                                onChange={(e) => setNewEventTitle(e.target.value)}
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-primary no-drag-region pr-10"
                            />
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-50">
                                <span className="material-symbols-outlined text-[14px]">event</span>
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

                            <button type="submit" disabled={!newEventTitle.trim()} className="ml-auto px-4 py-1.5 rounded-lg bg-primary text-black text-xs font-bold hover:brightness-110 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
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
                        const agendaData = localEvents
                            .filter(e => e.startTime && new Date(e.startTime) >= targetStartOfDay)
                            .sort((a, b) => new Date(a.startTime!).getTime() - new Date(b.startTime!).getTime());
                        
                        const selectedDayHasEvent = agendaData.length > 0 && isSameDay(parseISO(agendaData[0].startTime!), selectedDate);
                        
                        return (
                            <>
                                <div className="flex justify-between items-center pr-1">
                                    <span className="text-[10px] font-bold text-slate-200 uppercase tracking-widest">
                                        {selectedDayHasEvent ? `${format(selectedDate, 'MMM d')} - ${t('events')}` : t('upcomingEvents')}
                                    </span>
                                    <button onClick={() => setEditingEventDate(selectedDate)} className="w-5 h-5 rounded-full bg-primary/20 text-primary opacity-0 group-hover:opacity-100 transition-opacity hover:bg-primary/40 flex items-center justify-center relative z-20">
                                        <span className="material-symbols-outlined text-[14px]">add</span>
                                    </button>
                                </div>
                                <div className="flex flex-col gap-1 overflow-y-auto custom-scrollbar h-20 animate-in fade-in slide-in-from-top-1">
                                    {agendaData.slice(0, 5).map(ev => {
                                        const eventDate = parseISO(ev.startTime!);
                                        const isEvToday = isSameDay(eventDate, new Date());
                                        const isEvSelected = isSameDay(eventDate, selectedDate);
                                        
                                        return (
                                            <div key={ev.id} className="flex justify-between items-center text-xs group/event hover:bg-white/5 rounded pl-1 pr-1 py-1 -mx-0.5 transition-colors" style={{ backgroundColor: isEvSelected ? `color-mix(in srgb, ${ev.colorId || koCalendarColor} 5%, transparent)` : 'transparent' }}>
                                                <div className="flex items-center gap-2 truncate">
                                                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: isEvSelected ? (ev.colorId || koCalendarColor) : isEvToday ? 'var(--theme-primary)' : 'var(--theme-text-faded)' }} />
                                                    <span className="truncate" style={{ color: isEvSelected ? (ev.colorId || koCalendarColor) : '#fff', fontWeight: isEvSelected ? '600' : '400' }}>{ev.title}</span>
                                                    {ev.notificationEnabled && (
                                                        <span className="material-symbols-outlined text-[10px] text-primary/50 shrink-0">notifications_active</span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span className="text-[10px] group-hover/event:hidden" style={{ color: isEvSelected ? (ev.colorId || koCalendarColor) : '#cbd5e1' }}>
                                                        {isEvSelected ? format(eventDate, 'HH:mm') : format(eventDate, 'MMM d')}
                                                    </span>
                                                    <button 
                                                        onClick={() => {
                                                            const d = parseISO(ev.startTime!);
                                                            setEditingEventDate(d);
                                                            setEditingEventId(ev.id);
                                                            setNewEventTitle(ev.title);
                                                            setNewEventHours(format(d, 'HH'));
                                                            setNewEventMinutes(format(d, 'mm'));
                                                            setNewEventNotification(!!ev.notificationEnabled);
                                                        }}
                                                        className="hidden group-hover/event:flex w-4 h-4 items-center justify-center text-blue-400 hover:text-blue-300 bg-blue-400/10 rounded"
                                                    >
                                                        <span className="material-symbols-outlined text-[12px]">edit</span>
                                                    </button>
                                                    <button 
                                                        onClick={() => deleteCalendarEvent(ev.id)}
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
        </div>
    );
};

export default KoCalendarPopup;
