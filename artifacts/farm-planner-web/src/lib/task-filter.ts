import type { FarmTask } from '@workspace/api-client-react';
import { CURRENT_MONTH, localMonthKey, taskMatchesMonth, taskMonthValue } from './task-month';
import { taskScheduledDateKeys } from './task-calendar';

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function isTaskOverdue(
  task: Pick<FarmTask, 'done' | 'calendarStart' | 'month'> & { scheduledDates?: string[] },
  today = new Date(),
): boolean {
  if (task.done) return false;
  const calendarDate = taskScheduledDateKeys(task).at(-1);
  if (calendarDate && calendarDate < localDateKey(today)) return true;
  return /^\d{4}-\d{2}$/.test(task.month) && task.month < localMonthKey(today);
}

function isTaskFromPreviousMonth(
  task: Pick<FarmTask, 'month' | 'calendarStart'>,
  today = new Date(),
): boolean {
  const raw = taskMonthValue(task).toLowerCase();
  const currentMonth = localMonthKey(today);
  const keyMatch = raw.match(/\b(\d{4})-(\d{1,2})\b/);
  if (keyMatch) return `${keyMatch[1]}-${keyMatch[2].padStart(2, '0')}` < currentMonth;

  const monthIndex = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ].findIndex((name) => raw.includes(name) || name.startsWith(raw));
  if (monthIndex < 0) return false;
  const year = raw.match(/\b(20\d{2})\b/)?.[1] ?? currentMonth.slice(0, 4);
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}` < currentMonth;
}

export function taskMatchesMonthWithUrgentPin(
  task: Pick<FarmTask, 'done' | 'urgency' | 'month' | 'calendarStart'> & { scheduledDates?: string[] },
  selectedMonth: string,
  today = new Date(),
): boolean {
  if (selectedMonth === CURRENT_MONTH && !task.done && isTaskFromPreviousMonth(task, today)) return true;
  return taskMatchesMonth(task, selectedMonth === CURRENT_MONTH ? localMonthKey(today) : selectedMonth);
}

export function compareTasksUrgentFirst(a: FarmTask, b: FarmTask): number {
  const aPinned = !a.done && a.urgency === 'Urgent';
  const bPinned = !b.done && b.urgency === 'Urgent';
  if (aPinned !== bPinned) return aPinned ? -1 : 1;

  const aTime = a.calendarStart ? new Date(a.calendarStart).getTime() : Number.NaN;
  const bTime = b.calendarStart ? new Date(b.calendarStart).getTime() : Number.NaN;
  const aHasTime = Number.isFinite(aTime);
  const bHasTime = Number.isFinite(bTime);
  if (aHasTime && bHasTime) return aTime - bTime;
  if (aHasTime) return -1;
  if (bHasTime) return 1;
  return a.task.localeCompare(b.task) || a.id.localeCompare(b.id);
}