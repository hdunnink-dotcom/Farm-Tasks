import type { FarmTask } from '@workspace/api-client-react';

export const ALL_MONTHS = 'all';
export const UNSCHEDULED_MONTH = 'unscheduled';
export const CURRENT_MONTH = 'current';

const monthNames = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date(2020, index, 1)).toLowerCase(),
);

export function localMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

export function taskMonthValue(task: Pick<FarmTask, 'month' | 'calendarStart'>): string {
  return task.month.trim() || task.calendarStart.trim();
}

export function taskMatchesMonth(task: Pick<FarmTask, 'month' | 'calendarStart'>, selected: string): boolean {
  if (selected === ALL_MONTHS) return true;
  const raw = taskMonthValue(task).toLowerCase();
  if (selected === UNSCHEDULED_MONTH) return !raw;
  const key = selected === CURRENT_MONTH ? localMonthKey() : selected;
  const keyMatch = raw.match(/\b(\d{4})-(\d{1,2})\b/);
  if (keyMatch) return `${keyMatch[1]}-${keyMatch[2].padStart(2, '0')}` === key;
  const monthIndex = monthNames.findIndex((name) => raw.includes(name) || name.startsWith(raw));
  const yearMatch = raw.match(/\b(20\d{2})\b/);
  return monthIndex >= 0 && monthIndex === Number(key.slice(5, 7)) - 1 && (!yearMatch || yearMatch[1] === key.slice(0, 4));
}

export function taskMatchesToday(task: Pick<FarmTask, 'calendarStart'>, date = new Date()): boolean {
  if (!task.calendarStart.trim()) return false;
  const eventDate = new Date(task.calendarStart);
  if (Number.isNaN(eventDate.getTime())) return false;
  const eventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate()).getTime();
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return eventDay <= today;
}

export function taskAppearsInToday(
  task: Pick<FarmTask, 'source' | 'calendarStart'>,
  date = new Date(),
): boolean {
  return task.source !== 'Google Calendar' || taskMatchesToday(task, date);
}

export function monthOptions(tasks: FarmTask[]): string[] {
  const currentYear = new Date().getFullYear();
  const keys = new Set(Array.from({ length: 12 }, (_, index) => `${currentYear}-${String(index + 1).padStart(2, '0')}`));
  tasks.map((task) => taskMonthValue(task).match(/\b\d{4}-\d{1,2}\b/)?.[0]).filter(Boolean).forEach((key) => {
    const [year, month] = (key as string).split('-');
    keys.add(`${year}-${month.padStart(2, '0')}`);
  });
  return Array.from(keys).sort();
}

export function monthChoices(existing: string[] = []): string[] {
  const now = new Date();
  const values = new Set(existing.filter(Boolean));
  for (let offset = -6; offset <= 17; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    values.add(localMonthKey(date));
  }
  return Array.from(values).sort();
}