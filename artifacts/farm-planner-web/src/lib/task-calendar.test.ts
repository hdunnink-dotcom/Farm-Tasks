import { describe, expect, it } from 'vitest';
import { calendarMonthDays, calendarMonthLabel, calendarStartDayKey, formatAucklandDateTimeInput, formatAucklandTaskDate, isValidTaskSchedule, localAucklandDateKey, localWeekStart, normalizeTaskSchedule, parseAucklandDateTimeInput, shiftLocalMonth, taskIsUnscheduled, taskMatchesLocalWeek, taskScheduledDateKeys, weekLabel } from './task-calendar';

describe('task calendar helpers', () => {
  it('matches every selected linked day while retaining a legacy primary date', () => {
    const task = { calendarStart: '2026-08-24', scheduledDates: ['2026-08-31', '2026-08-24', '2026-08-31'] };
    expect(taskScheduledDateKeys(task)).toEqual(['2026-08-24', '2026-08-31']);
    expect(taskMatchesLocalWeek(task, '2026-08-24')).toBe(true);
    expect(taskMatchesLocalWeek(task, '2026-08-31')).toBe(true);
    expect(taskIsUnscheduled({ calendarStart: '', scheduledDates: ['2026-08-31'] })).toBe(false);
  });
  it('round-trips datetime-local fields in Auckland rather than the device timezone', () => {
    expect(parseAucklandDateTimeInput('2026-04-06T09:30')).toBe('2026-04-05T21:30:00.000Z');
    expect(formatAucklandDateTimeInput('2026-04-05T21:30:00.000Z')).toBe('2026-04-06T09:30');
    expect(parseAucklandDateTimeInput('2026-09-27T02:30')).toBeNull();
  });

  it('validates empty, date-only, local, and stored schedule values', () => {
    expect(isValidTaskSchedule('')).toBe(true);
    expect(isValidTaskSchedule('2026-08-30')).toBe(true);
    expect(isValidTaskSchedule('2026-02-30')).toBe(false);
    expect(isValidTaskSchedule('2026-04-06T09:30')).toBe(true);
    expect(isValidTaskSchedule('2026-04-05T21:30:00.000Z')).toBe(true);
    expect(isValidTaskSchedule('2026-09-27T02:30')).toBe(false);
    expect(isValidTaskSchedule('not-a-schedule')).toBe(false);
    expect(normalizeTaskSchedule('2026-04-06T09:30')).toBe('2026-04-05T21:30:00.000Z');
    expect(normalizeTaskSchedule('  ')).toBe('');
  });
  it('uses local Monday through Sunday boundaries', () => {
    const week = localWeekStart(new Date('2026-08-26T12:00:00Z'));
    expect(week).toBe('2026-08-24');
    expect(taskMatchesLocalWeek({ calendarStart: '2026-08-24T09:00:00' }, week)).toBe(true);
    expect(taskMatchesLocalWeek({ calendarStart: '2026-08-30T23:00:00' }, week)).toBe(true);
    expect(taskMatchesLocalWeek({ calendarStart: '2026-08-31T09:00:00' }, week)).toBe(false);
  });

  it('uses Auckland days at UTC offset boundaries while preserving date-only days', () => {
    expect(calendarStartDayKey('2026-08-30T11:30:00Z')).toBe('2026-08-30');
    expect(calendarStartDayKey('2026-08-30T12:30:00Z')).toBe('2026-08-31');
    expect(taskMatchesLocalWeek({ calendarStart: '2026-08-30T12:30:00Z' }, '2026-08-31')).toBe(true);
    expect(taskMatchesLocalWeek({ calendarStart: '2026-08-30T12:30:00Z' }, '2026-08-24')).toBe(false);
    expect(taskMatchesLocalWeek({ calendarStart: '2026-08-31' }, '2026-08-31')).toBe(true);
    expect(weekLabel('2026-08-31')).toBe('Aug 31, 2026 – Sep 6, 2026');
  });

  it('formats timed and all-day schedules in Auckland for task cards', () => {
    expect(formatAucklandTaskDate('2026-08-30T11:30:00Z')).toBe('Aug 30, 2026 · 11:30 PM');
    expect(formatAucklandTaskDate('2026-08-30T12:30:00Z')).toBe('Aug 31, 2026 · 12:30 AM');
    expect(formatAucklandTaskDate('2026-08-30')).toBe('Aug 30, 2026 · All day');
    expect(formatAucklandTaskDate('')).toBeNull();
  });

  it('keeps Auckland week matching stable through daylight-saving offsets', () => {
    expect(calendarStartDayKey('2026-04-04T11:30:00Z')).toBe('2026-04-05');
    expect(calendarStartDayKey('2026-04-05T11:30:00Z')).toBe('2026-04-05');
    expect(taskMatchesLocalWeek({ calendarStart: '2026-04-05T11:30:00Z' }, '2026-03-30')).toBe(true);
  });

  it('makes empty and invalid calendar dates reachable as unscheduled', () => {
    expect(taskIsUnscheduled({ calendarStart: '' })).toBe(true);
    expect(taskIsUnscheduled({ calendarStart: 'not-a-date' })).toBe(true);
    expect(taskIsUnscheduled({ calendarStart: '2026-08-31T99:99' })).toBe(true);
    expect(taskIsUnscheduled({ calendarStart: '2026-08-24T09:00:00' })).toBe(false);
  });

  it('moves months across year boundaries', () => {
    expect(shiftLocalMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftLocalMonth('2026-12', 1)).toBe('2027-01');
  });

  it('creates a Monday-first six-week month grid and labels it consistently', () => {
    expect(calendarMonthLabel('2026-08')).toBe('August 2026');
    expect(calendarMonthDays('2026-08')).toHaveLength(42);
    expect(calendarMonthDays('2026-08').slice(0, 7)).toEqual([
      '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02',
    ]);
    expect(calendarMonthDays('2026-08')).toContain('2026-08-31');
  });

  it('gets the current calendar day in Auckland rather than the device timezone', () => {
    expect(localAucklandDateKey(new Date('2026-08-30T12:30:00.000Z'))).toBe('2026-08-31');
  });
});