import type { FarmTask } from '@workspace/api-client-react';
import { taskScheduledDateKeys } from '@/lib/task-calendar';

export type WeekGroup = 'Overdue' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday' | 'Unscheduled';

export const DAYS_IN_ORDER: WeekGroup[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const ALL_GROUPS_IN_ORDER: WeekGroup[] = ['Overdue', ...DAYS_IN_ORDER, 'Unscheduled'];

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function getTaskWeekGroups(task: FarmTask, weekStart: Date): WeekGroup[] {
  if (task.done) return []; // Exclude completed tasks from the active week route
  const taskDays = taskScheduledDateKeys(task);
  if (!taskDays.length) return ['Unscheduled'];
  // Week navigation is Monday-first. Task dates, however, are always read in
  // the farm's Pacific/Auckland calendar rather than the viewer's device zone.
  const start = localDayKey(weekStart);
  const end = addDays(start, 6);
  const days: WeekGroup[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const inWeek = taskDays.filter((taskDay) => taskDay >= start && taskDay <= end)
    .map((taskDay) => days[new Date(`${taskDay}T00:00:00Z`).getUTCDay()]);
  // A linked task shown on a current-week day is not also an aggregate overdue
  // entry. This avoids showing the same work twice in the weekly summary.
  if (inWeek.length) return inWeek;
  return taskDays.some((taskDay) => taskDay < start) ? ['Overdue'] : [];
}

export function getTaskWeekGroup(task: FarmTask, weekStart: Date): WeekGroup | null {
  return getTaskWeekGroups(task, weekStart)[0] ?? null;
}

const urgencyRank: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

const getTimeSafe = (dStr: string) => {
  if (!dStr) return 0;
  const t = new Date(dStr).getTime();
  return isNaN(t) ? 0 : t;
};

export function sortWeekTasks(tasks: FarmTask[]): FarmTask[] {
  return [...tasks].sort((a, b) => {
    // 1. Incomplete before complete (failsafe)
    if (a.done !== b.done) return a.done ? 1 : -1;
    
    // 2. Higher urgency first
    const rankA = urgencyRank[a.urgency] ?? 4;
    const rankB = urgencyRank[b.urgency] ?? 4;
    if (rankA !== rankB) return rankA - rankB;
    
    // 3. Date (earlier first)
    const dateA = getTimeSafe(a.calendarStart);
    const dateB = getTimeSafe(b.calendarStart);
    if (dateA !== dateB) return dateA - dateB;

    // 4. Title alphabetical
    return (a.task || '').localeCompare(b.task || '');
  });
}
