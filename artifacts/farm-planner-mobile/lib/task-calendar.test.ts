import { describe, expect, it } from 'vitest';
import { addLocalWeeks, calendarDateKey, calendarMonthDays, calendarMonthLabel, formatAucklandDateTimeInput, formatAucklandTaskDate, parseAucklandDateTimeInput, shiftCalendarMonth, startOfLocalWeek, taskMatchesCalendarPeriod, taskMatchesWeek, usableCalendarDate, weekLabel } from './task-calendar';

describe('task-calendar', () => {
  it('parses scheduled input as Auckland time and rejects invalid text', () => {
    expect(parseAucklandDateTimeInput('2026-04-06T09:30')).toBe('2026-04-05T21:30:00.000Z');
    expect(formatAucklandDateTimeInput('2026-04-05T21:30:00.000Z')).toBe('2026-04-06T09:30');
    expect(parseAucklandDateTimeInput('invalid')).toBeNull();
  });
  it('uses a local Monday through Sunday week and rejects unusable dates', () => {
    const week = startOfLocalWeek(new Date('2024-05-15T12:00:00Z'));
    expect(week).toBe('2024-05-13');
    expect(taskMatchesWeek({ calendarStart: '2024-05-13T09:00:00Z' }, week)).toBe(true);
    expect(taskMatchesWeek({ calendarStart: '2024-05-19T10:00:00Z' }, week)).toBe(true);
    expect(taskMatchesWeek({ calendarStart: '2024-05-20T00:00:00Z' }, week)).toBe(false);
    expect(usableCalendarDate('not-a-date')).toBeNull();
    expect(usableCalendarDate('2024-02-31')).toBeNull();
    expect(usableCalendarDate('2024-05-13T99:99')).toBeNull();
    expect(weekLabel(week)).toBe('May 13 – May 19, 2024');
    expect(addLocalWeeks(week, 1)).toBe('2024-05-20');
  });

  it('makes blank and invalid week dates available through Unscheduled', () => {
    const week = '2024-05-13';
    expect(taskMatchesCalendarPeriod({ month: 'May 2024', calendarStart: '' }, 'week', 'all', 'unscheduled', week)).toBe(true);
    expect(taskMatchesCalendarPeriod({ month: '', calendarStart: 'bad date' }, 'week', 'all', 'unscheduled', week)).toBe(true);
    expect(taskMatchesCalendarPeriod({ month: '', calendarStart: '2024-05-14T10:00:00' }, 'week', 'all', 'unscheduled', week)).toBe(false);
  });

  it('uses Pacific/Auckland days for instants while preserving date-only values', () => {
    const week = '2026-08-31';
    expect(calendarDateKey('2026-08-30T12:30:00Z')).toBe('2026-08-31');
    expect(taskMatchesWeek({ calendarStart: '2026-08-30T12:30:00Z' }, week)).toBe(true);
    expect(calendarDateKey('2026-08-30')).toBe('2026-08-30');
    expect(taskMatchesWeek({ calendarStart: '2026-08-30' }, week)).toBe(false);
    expect(calendarDateKey('2026-08-31T00:30:00')).toBe('2026-08-31');
  });

  it('formats timed and all-day schedules in Auckland for task cards', () => {
    expect(formatAucklandTaskDate('2026-08-30T11:30:00Z')).toBe('Aug 30, 2026 · 11:30 PM');
    expect(formatAucklandTaskDate('2026-08-30T12:30:00Z')).toBe('Aug 31, 2026 · 12:30 AM');
    expect(formatAucklandTaskDate('2026-08-30')).toBe('Aug 30, 2026 · All day');
    expect(formatAucklandTaskDate('')).toBeNull();
  });

  it('uses calendarStart validity for Month Unscheduled even when month exists', () => {
    const week = '2026-08-31';
    expect(taskMatchesCalendarPeriod({ month: 'August 2026', calendarStart: '' }, 'month', 'unscheduled', 'week', week)).toBe(true);
    expect(taskMatchesCalendarPeriod({ month: 'August 2026', calendarStart: 'not a date' }, 'month', 'unscheduled', 'week', week)).toBe(true);
    expect(taskMatchesCalendarPeriod({ month: '', calendarStart: '2026-08-30' }, 'month', 'unscheduled', 'week', week)).toBe(false);
  });

  it('creates a Monday-first six-week month grid for the schedule picker', () => {
    expect(calendarMonthLabel('2026-08')).toBe('August 2026');
    expect(calendarMonthDays('2026-08')).toHaveLength(42);
    expect(calendarMonthDays('2026-08').slice(0, 7)).toEqual([
      '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02',
    ]);
    expect(shiftCalendarMonth('2026-12', 1)).toBe('2027-01');
  });
});