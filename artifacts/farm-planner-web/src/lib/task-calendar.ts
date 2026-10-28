import type { FarmTask } from '@workspace/api-client-react';

export type CalendarScope = 'month' | 'week' | 'unscheduled';

const AUCKLAND_TIME_ZONE = 'Pacific/Auckland';
const aucklandDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: AUCKLAND_TIME_ZONE, month: 'short', day: 'numeric', year: 'numeric',
});
const aucklandTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: AUCKLAND_TIME_ZONE, hour: 'numeric', minute: '2-digit',
});

function dateTimeParts(date: Date): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: AUCKLAND_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

/** Formats an instant for a datetime-local control in the farm's timezone. */
export function formatAucklandDateTimeInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = dateTimeParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Interprets a datetime-local control as Pacific/Auckland, never device time. */
export function parseAucklandDateTimeInput(value: string): string | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(\.\d{1,9})?)?$/);
  if (!match || !isValidAucklandDateKey(`${match[1]}-${match[2]}-${match[3]}`)) return null;
  const desired = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0));
  let instant = desired;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = dateTimeParts(new Date(instant));
    instant += desired - Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  }
  const result = new Date(instant);
  // NZDT's skipped hour cannot identify an Auckland instant.
  return formatAucklandDateTimeInput(result.toISOString()) === value.slice(0, 16) ? result.toISOString() : null;
}

/** Normalizes supported task schedule values while preserving date-only and stored instant values. */
export function normalizeTaskSchedule(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return calendarStartDayKey(normalized) !== null ? normalized : null;
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) return parseAucklandDateTimeInput(normalized);
  return calendarStartDate(normalized) !== null ? normalized : null;
}

/** Returns whether a task schedule is empty, date-only, local Auckland time, or a valid stored instant. */
export function isValidTaskSchedule(value: string): boolean {
  return normalizeTaskSchedule(value) !== null;
}

function dateKeyFromParts(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function isValidAucklandDateKey(key: string): boolean {
  const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}

/** Canonical linked-work days, with legacy calendarStart retained as a fallback. */
export function taskScheduledDateKeys(task: { calendarStart?: string; scheduledDates?: string[] }): string[] {
  const scheduled = Array.isArray(task.scheduledDates)
    ? task.scheduledDates.filter((key): key is string => typeof key === 'string' && isValidAucklandDateKey(key))
    : [];
  const legacy = typeof task.calendarStart === 'string' ? calendarStartDayKey(task.calendarStart) : null;
  return Array.from(new Set([...scheduled, ...(legacy ? [legacy] : [])])).sort();
}

function dateFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function shiftDateKey(key: string, days: number): string {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKeyFromParts(date, 'UTC');
}

function statedDayKey(value: string): string | null {
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?)?$/);
  if (!match) return null;
  return isValidAucklandDateKey(match[1]) ? match[1] : null;
}

export function calendarStartDate(value: string): Date | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const isoDay = normalized.match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/);
  if (isoDay && !isValidAucklandDateKey(isoDay[1])) return null;
  const statedDay = statedDayKey(normalized);
  if (statedDay) return dateFromKey(statedDay);
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The event's calendar day in Pacific/Auckland. Date-only values keep their stated day. */
export function calendarStartDayKey(value: string): string | null {
  const normalized = value.trim();
  const statedDay = statedDayKey(normalized);
  if (statedDay) return statedDay;
  const date = calendarStartDate(normalized);
  return date ? dateKeyFromParts(date, AUCKLAND_TIME_ZONE) : null;
}

/** Formats a task schedule for cards while keeping date-only calendar entries all-day. */
export function formatAucklandTaskDate(value: string): string | null {
  const normalized = value.trim();
  const dayKey = calendarStartDayKey(normalized);
  if (!dayKey) return null;
  const dateLabel = aucklandDateFormatter.format(dateFromKey(dayKey));
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return `${dateLabel} · All day`;

  const localTime = normalized.match(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):([0-5]\d)/);
  if (localTime && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) {
    const hour = Number(localTime[1]);
    const minute = localTime[2];
    return `${dateLabel} · ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(Date.UTC(2020, 0, 1, hour, Number(minute))))}`;
  }

  const date = calendarStartDate(normalized);
  return date ? `${dateLabel} · ${aucklandTimeFormatter.format(date)}` : null;
}

/** Concise display label for a linked schedule without repeating the same work. */
export function formatTaskScheduledDates(task: { calendarStart?: string; scheduledDates?: string[] }): string | null {
  const dates = taskScheduledDateKeys(task);
  if (!dates.length) return null;
  if (dates.length === 1) return formatAucklandTaskDate(task.calendarStart ?? dates[0]) ?? dates[0];
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  const first = formatter.format(dateFromKey(dates[0]));
  const last = formatter.format(dateFromKey(dates[dates.length - 1]));
  return `${first} – ${last} · ${dates.length} days`;
}

export function taskHasUsableCalendarStart(task: { calendarStart: string; scheduledDates?: string[] }): boolean {
  return taskScheduledDateKeys(task).length > 0;
}

export function taskIsUnscheduled(task: { calendarStart: string; scheduledDates?: string[] }): boolean {
  return !taskHasUsableCalendarStart(task);
}

export function localWeekStart(date = new Date()): string {
  const dayKey = dateKeyFromParts(date, AUCKLAND_TIME_ZONE);
  const daysSinceMonday = (dateFromKey(dayKey).getUTCDay() + 6) % 7;
  return shiftDateKey(dayKey, -daysSinceMonday);
}

export function shiftLocalWeek(weekStart: string, weeks: number): string {
  return shiftDateKey(weekStart, weeks * 7);
}

export function taskMatchesLocalWeek(task: { calendarStart: string; scheduledDates?: string[] }, weekStart: string): boolean {
  return taskScheduledDateKeys(task).some((taskDay) => taskDay >= weekStart && taskDay < shiftDateKey(weekStart, 7));
}

export function weekLabel(weekStart: string): string {
  const format = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  return `${format.format(dateFromKey(weekStart))} – ${format.format(dateFromKey(shiftDateKey(weekStart, 6)))}`;
}

export function shiftLocalMonth(monthKey: string, months: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year, month - 1 + months, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function localAucklandDateKey(date = new Date()): string {
  return dateKeyFromParts(date, AUCKLAND_TIME_ZONE);
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
    return dateKeyFromParts(date, 'UTC');
  });
}