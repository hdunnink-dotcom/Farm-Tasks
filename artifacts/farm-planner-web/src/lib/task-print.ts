import type { FarmTask } from '@workspace/api-client-react';
import { localMonthKey, taskMatchesMonth } from '@/lib/task-month';
import { taskScheduledDateKeys } from '@/lib/task-calendar';

export type PrintPeriod = 'week' | 'month';

export type PrintTaskGroup = {
  key: string;
  label: string;
  tasks: FarmTask[];
};

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfWeek(date = new Date()): Date {
  const result = startOfDay(date);
  const day = result.getDay();
  result.setDate(result.getDate() - (day === 0 ? 6 : day - 1));
  return result;
}

export function shiftWeek(date: Date, amount: number): Date {
  const result = startOfWeek(date);
  result.setDate(result.getDate() + amount * 7);
  return result;
}

export function shiftMonth(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

export function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function toMonthInputValue(date: Date): string {
  return localMonthKey(date);
}

function taskDates(task: Pick<FarmTask, 'calendarStart' | 'scheduledDates'>): Date[] {
  return taskScheduledDateKeys(task).map((key) => {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day);
  });
}

function prioritySort(a: FarmTask, b: FarmTask): number {
  const rank = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
  return rank[a.urgency] - rank[b.urgency] || a.task.localeCompare(b.task);
}

export function weekPrintGroups(tasks: FarmTask[], selected: Date): PrintTaskGroup[] {
  const start = startOfWeek(selected);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const selectedMonth = localMonthKey(selected);
  const open = tasks.filter((task) => !task.done);
  const overdue = open.filter((task) => {
    const dates = taskDates(task);
    return !dates.some((date) => date >= start && date < end) && dates.some((date) => date < start);
  }).sort(prioritySort);
  const scheduled = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(start);
    date.setDate(date.getDate() + offset);
    const dayTasks = open.filter((task) => taskDates(task).some((taskDate) => taskDate.getTime() === date.getTime())).sort(prioritySort);
    return {
      key: toDateInputValue(date),
      label: new Intl.DateTimeFormat('en-NZ', { weekday: 'long', day: 'numeric', month: 'short' }).format(date),
      tasks: dayTasks,
    };
  });
  const anyDay = open.filter((task) => !taskDates(task).length && taskMatchesMonth(task, selectedMonth)).sort(prioritySort);
  return [
    ...(overdue.length ? [{ key: 'overdue', label: 'Overdue', tasks: overdue }] : []),
    ...scheduled,
    ...(anyDay.length ? [{ key: 'any-day', label: 'Any day this week', tasks: anyDay }] : []),
  ];
}

export function monthPrintGroups(tasks: FarmTask[], selected: Date): PrintTaskGroup[] {
  const monthStart = new Date(selected.getFullYear(), selected.getMonth(), 1);
  const monthEnd = new Date(selected.getFullYear(), selected.getMonth() + 1, 1);
  const selectedMonth = localMonthKey(selected);
  const open = tasks.filter((task) => !task.done);
  const overdue = open.filter((task) => {
    const dates = taskDates(task);
    return !dates.some((date) => date >= monthStart && date < monthEnd) && dates.some((date) => date < monthStart);
  }).sort(prioritySort);
  const byDate = new Map<string, FarmTask[]>();
  open.forEach((task) => {
    taskDates(task).filter((date) => date >= monthStart && date < monthEnd).forEach((date) => {
      const key = toDateInputValue(date);
      const tasksForDate = byDate.get(key) ?? [];
      if (!tasksForDate.some((item) => item.id === task.id)) byDate.set(key, [...tasksForDate, task]);
    });
  });
  const dateGroups = Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, dayTasks]) => ({
    key,
    label: new Intl.DateTimeFormat('en-NZ', { weekday: 'short', day: 'numeric', month: 'long' }).format(new Date(`${key}T12:00:00`)),
    tasks: dayTasks.sort(prioritySort),
  }));
  const anyTime = open.filter((task) => !taskDates(task).length && taskMatchesMonth(task, selectedMonth)).sort(prioritySort);
  return [
    ...(overdue.length ? [{ key: 'overdue', label: 'Overdue', tasks: overdue }] : []),
    ...dateGroups,
    ...(anyTime.length ? [{ key: 'any-time', label: 'Any time this month', tasks: anyTime }] : []),
  ];
}

export function printPeriodLabel(period: PrintPeriod, selected: Date): string {
  if (period === 'month') {
    return new Intl.DateTimeFormat('en-NZ', { month: 'long', year: 'numeric' }).format(selected);
  }
  const start = startOfWeek(selected);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const startLabel = new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short' }).format(start);
  const endLabel = new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }).format(end);
  return `${startLabel} – ${endLabel}`;
}