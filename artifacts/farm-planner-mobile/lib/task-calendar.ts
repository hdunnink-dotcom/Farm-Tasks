import type { FarmTask } from '@workspace/api-client-react';
import { UNSCHEDULED_MONTH, taskMatchesMonth } from './task-month';

export type CalendarScope = 'month' | 'week';
export type WeekFilter = 'week' | 'unscheduled';

const PLANNER_TIME_ZONE = 'Pacific/Auckland';
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_WITHOUT_ZONE = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?$/;
const aucklandDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: PLANNER_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const aucklandDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: PLANNER_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const aucklandCardDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PLANNER_TIME_ZONE, month: 'short', day: 'numeric', year: 'numeric',
});
const aucklandCardTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PLANNER_TIME_ZONE, hour: 'numeric', minute: '2-digit',
});

function aucklandDateTimeParts(date: Date): Record<string, string> {
  return Object.fromEntries(aucklandDateTimeFormatter.formatToParts(date)
    .filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

export function formatAucklandDateTimeInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = aucklandDateTimeParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Returns null for malformed or DST-skipped Auckland local times. */
export function parseAucklandDateTimeInput(value: string): string | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match || !isValidDateKey(`${match[1]}-${match[2]}-${match[3]}`)) return null;
  const desired = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  let instant = desired;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = aucklandDateTimeParts(new Date(instant));
    instant += desired - Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  }
  const result = new Date(instant);
  return formatAucklandDateTimeInput(result.toISOString()) === value ? result.toISOString() : null;
}

function isValidDateKey(value: string): boolean {
  const match = value.match(DATE_KEY);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3]);
}

function keyFromParts(parts: Intl.DateTimeFormatPart[]): string {
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/** Planner day in Pacific/Auckland. Date-only values retain their stated calendar day. */
export function calendarDateKey(value: string): string | null {
  const trimmed = value.trim();
  if (DATE_KEY.test(trimmed)) return isValidDateKey(trimmed) ? trimmed : null;
  // Offset-less datetimes do not identify an instant; keep their written calendar day
  // rather than letting the device's timezone decide it.
  const localDateTime = trimmed.match(DATE_TIME_WITHOUT_ZONE);
  const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  if (localDateTime && !hasExplicitZone) {
    return isValidDateKey(localDateTime[1]) ? localDateTime[1] : null;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed) && !hasExplicitZone) return null;
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : keyFromParts(aucklandDateFormatter.formatToParts(date));
}

/** Formats a task schedule for cards without turning an all-day date into midnight. */
export function formatAucklandTaskDate(value: string): string | null {
  const trimmed = value.trim();
  const key = calendarDateKey(trimmed);
  if (!key) return null;
  const dateLabel = aucklandCardDateFormatter.format(new Date(`${key}T00:00:00.000Z`));
  if (DATE_KEY.test(trimmed)) return `${dateLabel} · All day`;

  const localTime = trimmed.match(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):([0-5]\d)/);
  if (localTime && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const hour = Number(localTime[1]);
    const minute = Number(localTime[2]);
    return `${dateLabel} · ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(Date.UTC(2020, 0, 1, hour, minute)))}`;
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : `${dateLabel} · ${aucklandCardTimeFormatter.format(date)}`;
}

/** Compatibility date representation whose UTC fields are the planner calendar day. */
export function usableCalendarDate(value: string): Date | null {
  const key = calendarDateKey(value);
  return key ? new Date(`${key}T00:00:00.000Z`) : null;
}

function dayOfWeek(key: string): number {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function shiftDays(key: string, amount: number): string {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

/** A YYYY-MM-DD Monday key, calculated in Pacific/Auckland rather than device time. */
export function startOfLocalWeek(date = new Date()): string {
  const key = keyFromParts(aucklandDateFormatter.formatToParts(date));
  const day = dayOfWeek(key);
  return shiftDays(key, -(day === 0 ? 6 : day - 1));
}

export function addLocalWeeks(weekStart: string, amount: number): string {
  return shiftDays(weekStart, amount * 7);
}

export function calendarMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}

/** Returns a Monday-first six-week grid of Auckland calendar date keys. */
export function calendarMonthDays(monthKey: string): string[] {
  const [year, month] = monthKey.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(1 + index - mondayOffset);
    return date.toISOString().slice(0, 10);
  });
}

export function shiftCalendarMonth(monthKey: string, amount: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function keyLabel(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

export function weekLabel(weekStart: string): string {
  const end = shiftDays(weekStart, 6);
  const startYear = weekStart.slice(0, 4);
  const endYear = end.slice(0, 4);
  return startYear === endYear
    ? `${keyLabel(weekStart)} – ${keyLabel(end)}, ${endYear}`
    : `${keyLabel(weekStart)}, ${startYear} – ${keyLabel(end)}, ${endYear}`;
}

export function taskMatchesWeek(task: Pick<FarmTask, 'calendarStart'>, weekStart: string): boolean {
  const key = calendarDateKey(task.calendarStart);
  return Boolean(key && key >= weekStart && key <= shiftDays(weekStart, 6));
}

export function taskMatchesCalendarPeriod(
  task: Pick<FarmTask, 'month' | 'calendarStart'>,
  scope: CalendarScope,
  monthFilter: string,
  weekFilter: WeekFilter,
  weekStart: string,
): boolean {
  if (scope === 'month') {
    return monthFilter === UNSCHEDULED_MONTH
      ? !calendarDateKey(task.calendarStart)
      : taskMatchesMonth(task, monthFilter);
  }
  if (weekFilter === 'unscheduled') return !calendarDateKey(task.calendarStart);
  return taskMatchesWeek(task, weekStart);
}

export function calendarPeriodLabel(
  scope: CalendarScope,
  monthFilter: string,
  weekFilter: WeekFilter,
  weekStart: string,
  monthLabel: (key: string) => string,
  currentMonthKey: string,
): string {
  if (scope === 'week') return weekFilter === 'unscheduled' ? 'Unscheduled' : weekLabel(weekStart);
  if (monthFilter === 'all') return 'All months';
  if (monthFilter === UNSCHEDULED_MONTH) return 'Unscheduled';
  return monthLabel(monthFilter === 'current' ? currentMonthKey : monthFilter);
}