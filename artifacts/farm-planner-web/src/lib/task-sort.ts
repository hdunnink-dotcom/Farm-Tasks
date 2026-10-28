import type { FarmTask } from '@workspace/api-client-react';
import { calendarStartDate, calendarStartDayKey } from './task-calendar';

export type TaskSort = 'priority' | 'date' | 'title' | 'updated';
const urgencyRank: Record<FarmTask['urgency'], number> = {
  Urgent: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

function compareTitleAndId(a: FarmTask, b: FarmTask): number {
  return a.task.localeCompare(b.task) || a.id.localeCompare(b.id);
}

function compareDate(a: FarmTask, b: FarmTask): number {
  const aTime = calendarStartDate(a.calendarStart)?.getTime();
  const bTime = calendarStartDate(b.calendarStart)?.getTime();
  const aValid = Number.isFinite(aTime);
  const bValid = Number.isFinite(bTime);
  if (aValid && bValid && aTime !== bTime) return aTime! - bTime!;
  if (aValid) return -1;
  if (bValid) return 1;
  return compareTitleAndId(a, b);
}

function compareRecentlyUpdated(a: FarmTask, b: FarmTask): number {
  const aTime = new Date(a.updatedAt).getTime();
  const bTime = new Date(b.updatedAt).getTime();
  const aValid = Number.isFinite(aTime);
  const bValid = Number.isFinite(bTime);
  if (aValid && bValid && aTime !== bTime) return bTime - aTime;
  if (aValid) return -1;
  if (bValid) return 1;
  return compareTitleAndId(a, b);
}

function comparePriority(a: FarmTask, b: FarmTask): number {
  const urgencyDifference = urgencyRank[a.urgency] - urgencyRank[b.urgency];
  return urgencyDifference || compareDate(a, b);
}

const aucklandTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Pacific/Auckland',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

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
  const instant = calendarStartDate(normalized);
  if (!instant) return Number.POSITIVE_INFINITY;
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

/** Orders Crew Plan work by Auckland day, priority within the day, time, then stable title and ID. */
export function compareCrewPlanTasks(a: FarmTask, b: FarmTask): number {
  const aDay = calendarStartDayKey(a.calendarStart);
  const bDay = calendarStartDayKey(b.calendarStart);
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
}

/** Removes duplicate assignment projections before sorting the complete Crew Plan list. */
export function orderCrewPlanTasks(tasks: FarmTask[]): FarmTask[] {
  return [...new Map(tasks.map((task) => [task.id, task])).values()].sort(compareCrewPlanTasks);
}

export function compareTasksBySort(sort: TaskSort): (a: FarmTask, b: FarmTask) => number {
  if (sort === 'priority') return comparePriority;
  if (sort === 'date') return compareDate;
  if (sort === 'updated') return compareRecentlyUpdated;
  return compareTitleAndId;
}