import type { FarmTask } from '@workspace/api-client-react';
import { localAucklandDateKey, taskScheduledDateKeys } from './task-calendar';
import { compareCrewPlanTasks } from './task-sort';

export type FocusBucket = 'overdue' | 'today' | 'upcoming';

export interface TodayFocus {
  overdue: FarmTask[];
  today: FarmTask[];
  upcoming: FarmTask[];
}

const urgencyRank: Record<FarmTask['urgency'], number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

function addDays(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

/**
 * Overdue: every scheduled day is in the past. Today: one of its days is today.
 * Upcoming: next scheduled day falls within the coming week.
 */
export function focusBucket(task: FarmTask, todayKey: string, upcomingDays = 7): FocusBucket | null {
  if (task.done) return null;
  const days = taskScheduledDateKeys(task);
  if (!days.length) return null;
  if (days.includes(todayKey)) return 'today';
  const next = days.find((day) => day > todayKey);
  if (!next) return 'overdue';
  return next <= addDays(todayKey, upcomingDays) ? 'upcoming' : null;
}

function comparePriorityFirst(a: FarmTask, b: FarmTask): number {
  return urgencyRank[a.urgency] - urgencyRank[b.urgency] || compareCrewPlanTasks(a, b);
}

function nextDay(task: FarmTask, todayKey: string): string {
  return taskScheduledDateKeys(task).find((day) => day > todayKey) ?? '';
}

/** Splits open work into what is late, what is due today and what is coming this week. */
export function buildTodayFocus(tasks: FarmTask[], todayKey = localAucklandDateKey()): TodayFocus {
  const focus: TodayFocus = { overdue: [], today: [], upcoming: [] };
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    const bucket = focusBucket(task, todayKey);
    if (bucket) focus[bucket].push(task);
  }
  focus.overdue.sort(comparePriorityFirst);
  focus.today.sort(comparePriorityFirst);
  focus.upcoming.sort((a, b) => nextDay(a, todayKey).localeCompare(nextDay(b, todayKey)) || comparePriorityFirst(a, b));
  return focus;
}
