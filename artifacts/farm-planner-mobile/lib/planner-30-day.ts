import type { FarmTask } from '@workspace/api-client-react';
import { calendarDateKey } from './task-calendar';
import { taskAssignedTo } from './task-assignment';

const PLANNER_TIME_ZONE = 'Pacific/Auckland';
const urgencyRank: Record<FarmTask['urgency'], number> = {
  Urgent: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

const aucklandTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: PLANNER_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function shiftDay(key: string, amount: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function compareTitleAndId(a: FarmTask, b: FarmTask): number {
  return a.task.localeCompare(b.task, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id);
}

function scheduledTimeOfDay(value: string): number {
  const normalized = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return -1;
  const localTime = normalized.match(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?/);
  if (localTime && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) {
    return Number(localTime[1]) * 3_600_000
      + Number(localTime[2]) * 60_000
      + Number(localTime[3] ?? 0) * 1_000
      + Number((localTime[4] ?? '').padEnd(3, '0'));
  }
  const instant = new Date(normalized);
  if (Number.isNaN(instant.getTime())) return Number.POSITIVE_INFINITY;
  const parts = Object.fromEntries(
    aucklandTimeFormatter.formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return Number(parts.hour) * 3_600_000
    + Number(parts.minute) * 60_000
    + Number(parts.second) * 1_000
    + instant.getUTCMilliseconds();
}

/** Returns consecutive Auckland calendar dates, independent of the device timezone. */
export function plannerDateKeys(startKey: string, count = 30): string[] {
  return Array.from({ length: count }, (_, index) => shiftDay(startKey, index));
}

/** Returns today's Auckland calendar date for rolling planner navigation. */
export function plannerTodayKey(now = new Date()): string {
  return calendarDateKey(now.toISOString()) ?? now.toISOString().slice(0, 10);
}

/** Moves the planner window by calendar days, preserving date-only semantics. */
export function shiftPlannerDate(startKey: string, amount: number): string {
  return shiftDay(startKey, amount);
}

/** Orders tasks like the Crew Plan: Auckland day, urgency, time, title, then ID. */
export function sortPlannerTasks(tasks: FarmTask[]): FarmTask[] {
  return [...new Map(tasks.map((task) => [task.id, task])).values()].sort((a, b) => {
    const aDay = calendarDateKey(a.calendarStart);
    const bDay = calendarDateKey(b.calendarStart);
    if (aDay && bDay) {
      const dayDifference = aDay.localeCompare(bDay);
      if (dayDifference) return dayDifference;
      const urgencyDifference = urgencyRank[a.urgency] - urgencyRank[b.urgency];
      if (urgencyDifference) return urgencyDifference;
      const timeDifference = scheduledTimeOfDay(a.calendarStart) - scheduledTimeOfDay(b.calendarStart);
      if (timeDifference) return timeDifference;
      return compareTitleAndId(a, b);
    }
    if (aDay) return -1;
    if (bDay) return 1;
    const urgencyDifference = urgencyRank[a.urgency] - urgencyRank[b.urgency];
    return urgencyDifference || compareTitleAndId(a, b);
  });
}

export type PlannerDay = {
  dateKey: string;
  tasks: FarmTask[];
};

export type PlannerAgenda = {
  days: PlannerDay[];
  overdue: FarmTask[];
  unscheduled: FarmTask[];
};

export function selectPlannerTasks(
  tasks: FarmTask[],
  accountId: string,
  canManage: boolean,
  includeCompleted: boolean,
): FarmTask[] {
  const accountTasks = canManage ? tasks : tasks.filter((task) => taskAssignedTo(task, accountId));
  return [...new Map(
    accountTasks
      .filter((task) => includeCompleted || !task.done)
      .map((task) => [task.id, task]),
  ).values()];
}

/** Places visible tasks into the rolling window, overdue, or unscheduled sections. */
export function buildPlannerAgenda(tasks: FarmTask[], startKey: string, count = 30): PlannerAgenda {
  const dateKeys = plannerDateKeys(startKey, count);
  const endKey = dateKeys[dateKeys.length - 1];
  const days = dateKeys.map((dateKey) => ({ dateKey, tasks: [] as FarmTask[] }));
  const dayIndexes = new Map(dateKeys.map((dateKey, index) => [dateKey, index]));
  const overdue: FarmTask[] = [];
  const unscheduled: FarmTask[] = [];

  for (const task of sortPlannerTasks(tasks)) {
    const dateKey = calendarDateKey(task.calendarStart);
    if (!dateKey) {
      unscheduled.push(task);
      continue;
    }
    const dayIndex = dayIndexes.get(dateKey);
    if (dayIndex !== undefined) {
      days[dayIndex].tasks.push(task);
    } else if (dateKey < startKey && !task.done) {
      overdue.push(task);
    } else if (dateKey > endKey) {
      continue;
    }
  }

  return { days, overdue, unscheduled };
}

export function plannerDateLabel(dateKey: string, todayKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
  return dateKey === todayKey ? `Today · ${label}` : label;
}

export function plannerRangeLabel(startKey: string, endKey: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${formatter.format(new Date(`${startKey}T00:00:00.000Z`))} – ${formatter.format(new Date(`${endKey}T00:00:00.000Z`))}`;
}