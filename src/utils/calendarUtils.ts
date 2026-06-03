import { isSameDay, startOfDay, endOfDay, parseISO, addDays } from 'date-fns';
import type { CalendarEvent } from '../store/useAppStore';

export function isEventOccurringOnDateIgnoreCount(event: CalendarEvent, date: Date): boolean {
    if (!event.startTime) return false;
    
    const eventStart = startOfDay(parseISO(event.startTime));
    const targetDate = startOfDay(date);
    
    // Event cannot occur before its start date
    if (targetDate < eventStart) return false;
    
    // Check recurrence exceptions
    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    const day = String(targetDate.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    if (event.recurrenceExceptions && event.recurrenceExceptions.includes(dateStr)) {
        return false;
    }
    
    // If there is an end date for recurrence, the event cannot occur after it
    if (event.recurrence && event.recurrence !== 'none' && event.recurrenceEndDate) {
        const recurrenceEnd = endOfDay(parseISO(event.recurrenceEndDate));
        if (targetDate > recurrenceEnd) return false;
    }
    
    // Check occurrence based on recurrence type
    if (!event.recurrence || event.recurrence === 'none') {
        return isSameDay(eventStart, targetDate);
    }
    
    switch (event.recurrence) {
        case 'daily':
            return true;
            
        case 'weekly':
            if (event.recurrenceDays && event.recurrenceDays.length > 0) {
                return event.recurrenceDays.includes(targetDate.getDay());
            }
            // Fallback to original start day
            return targetDate.getDay() === eventStart.getDay();
            
        case 'monthly': {
            const targetDay = targetDate.getDate();
            if (event.recurrenceDates && event.recurrenceDates.length > 0) {
                if (event.recurrenceDates.includes(targetDay)) return true;
                
                // Last day of month fallback
                const lastDayOfTargetMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();
                if (targetDay === lastDayOfTargetMonth) {
                    return event.recurrenceDates.some(d => d >= lastDayOfTargetMonth);
                }
                return false;
            }
            
            const startDay = eventStart.getDate();
            if (targetDay === startDay) return true;
            const lastDayOfTargetMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();
            if (targetDay === lastDayOfTargetMonth && startDay > lastDayOfTargetMonth) {
                return true;
            }
            return false;
        }
            
        case 'yearly': {
            const targetMonth = targetDate.getMonth();
            const targetDayVal = targetDate.getDate();
            const startMonth = eventStart.getMonth();
            const startDayVal = eventStart.getDate();
            if (targetMonth === startMonth && targetDayVal === startDayVal) return true;
            
            // Leap year handling
            if (startMonth === 1 && startDayVal === 29 && targetMonth === 1 && targetDayVal === 28) {
                const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
                if (!isLeap(targetDate.getFullYear())) {
                    return true;
                }
            }
            return false;
        }
            
        default:
            return false;
    }
}

export function isEventOccurringOnDate(event: CalendarEvent, date: Date): boolean {
    if (!isEventOccurringOnDateIgnoreCount(event, date)) return false;
    
    // Check recurrence count limit
    if (event.recurrenceCount !== undefined && event.recurrenceCount !== null && event.recurrence && event.recurrence !== 'none') {
        const eventStart = startOfDay(parseISO(event.startTime));
        const targetDate = startOfDay(date);
        
        let occurrenceIndex = 0;
        const curr = new Date(eventStart);
        while (curr <= targetDate) {
            if (isEventOccurringOnDateIgnoreCount(event, curr)) {
                occurrenceIndex++;
            }
            curr.setDate(curr.getDate() + 1);
        }
        
        if (occurrenceIndex > event.recurrenceCount) {
            return false;
        }
    }
    
    return true;
}

export function getEventOccurrenceOnDate(event: CalendarEvent, targetDate: Date): CalendarEvent {
    const originalStart = parseISO(event.startTime);
    const originalEnd = parseISO(event.endTime);
    
    // Calculate duration in ms
    const duration = originalEnd.getTime() - originalStart.getTime();
    
    // Construct new start time keeping hours, minutes, seconds, ms of original, but year, month, date of target
    const occurrenceStart = new Date(targetDate);
    occurrenceStart.setHours(originalStart.getHours());
    occurrenceStart.setMinutes(originalStart.getMinutes());
    occurrenceStart.setSeconds(originalStart.getSeconds());
    occurrenceStart.setMilliseconds(originalStart.getMilliseconds());
    
    const occurrenceEnd = new Date(occurrenceStart.getTime() + duration);
    
    return {
        ...event,
        startTime: occurrenceStart.toISOString(),
        endTime: occurrenceEnd.toISOString(),
    };
}

export function getEventsForDate(events: CalendarEvent[], date: Date): CalendarEvent[] {
    return events
        .filter(event => isEventOccurringOnDate(event, date))
        .map(event => getEventOccurrenceOnDate(event, date));
}

export function getEventsForInterval(events: CalendarEvent[], start: Date, end: Date): CalendarEvent[] {
    const occurrences: CalendarEvent[] = [];
    
    // Iterate over each day in the interval
    const current = new Date(start);
    while (current <= end) {
        const dayEvents = getEventsForDate(events, current);
        occurrences.push(...dayEvents);
        current.setDate(current.getDate() + 1);
    }
    
    return occurrences;
}

export function getUpcomingOccurrences(events: CalendarEvent[], fromDate: Date, daysCount: number = 30): CalendarEvent[] {
    const start = startOfDay(fromDate);
    const end = endOfDay(addDays(start, daysCount));
    
    return getEventsForInterval(events, start, end);
}
