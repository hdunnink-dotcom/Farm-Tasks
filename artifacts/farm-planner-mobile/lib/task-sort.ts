import type { FarmTask } from '@workspace/api-client-react';
import { usableCalendarDate } from './task-calendar';

export type TaskSort = 'priority' | 'date' | 'title' | 'updated';

const urgencyRank: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

function dateValue(value: string): number {
  return usableCalendarDate(value)?.getTime() ?? Number.POSITIVE_INFINITY;
}

function compareDate(a: string, b: string): number {
  const first = dateValue(a);
  const second = dateValue(b);
  if (first === second) return 0;
  return first - second;
}

function updatedValue(task: FarmTask): number {
  const updatedAt = new Date(task.updatedAt).getTime();
  if (Number.isFinite(updatedAt)) return updatedAt;
  const calendarUpdated = new Date(task.calendarUpdated).getTime();
  return Number.isFinite(calendarUpdated) ? calendarUpdated : Number.NEGATIVE_INFINITY;
}

export function sortTasksForList(tasks: FarmTask[], sort: TaskSort): FarmTask[] {
  return [...tasks].sort((a, b) => {
    let comparison = 0;
    if (sort === 'priority') comparison = (urgencyRank[a.urgency] ?? 99) - (urgencyRank[b.urgency] ?? 99);
    if (sort === 'date') comparison = compareDate(a.calendarStart, b.calendarStart);
    if (sort === 'title') comparison = compareText(a.task, b.task);
    if (sort === 'updated') comparison = updatedValue(b) - updatedValue(a);
    if (comparison) return comparison;

    comparison = compareDate(a.calendarStart, b.calendarStart);
    if (comparison) return comparison;
    comparison = compareText(a.task, b.task);
    if (comparison) return comparison;
    return compareText(a.id, b.id);
  });
}