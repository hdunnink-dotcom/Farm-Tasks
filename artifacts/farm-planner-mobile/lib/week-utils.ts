import { type FarmTask } from '@workspace/api-client-react';

export type TaskGroup = 'overdue' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday' | 'no-date';
const AUCKLAND = 'Pacific/Auckland';

function aucklandDayKey(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: AUCKLAND, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date).reduce<Record<string, string>>((result, part) => {
      if (part.type !== 'literal') result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localDayKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function addDaysToKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function getStartOfWeek(date: Date): Date {
  const key = aucklandDayKey(date.toISOString());
  if (!key) return new Date(NaN);
  const [year, month, day] = key.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  const weekday = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return d;
}

export function getEndOfWeek(startOfWeek: Date): Date {
  const d = new Date(startOfWeek);
  d.setUTCDate(d.getUTCDate() + 6);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

export function addWeeks(date: Date, weeks: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d;
}

const URGENCY_RANK: Record<string, number> = {
  Urgent: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

export function sortTasks(tasks: FarmTask[]): FarmTask[] {
  return [...tasks].sort((a, b) => {
    const rankA = URGENCY_RANK[a.urgency] ?? 99;
    const rankB = URGENCY_RANK[b.urgency] ?? 99;
    if (rankA !== rankB) return rankA - rankB;

    const dateA = a.calendarStart ? new Date(a.calendarStart).getTime() : 0;
    const dateB = b.calendarStart ? new Date(b.calendarStart).getTime() : 0;
    if (dateA !== dateB) return dateA - dateB;

    return a.task.localeCompare(b.task);
  });
}

export function groupTasks(tasks: FarmTask[], currentWeekStart: Date): Record<TaskGroup, FarmTask[]> {
  const startKey = localDayKey(currentWeekStart);
  const endKey = addDaysToKey(startKey, 6);
  
  const groups: Record<TaskGroup, FarmTask[]> = {
    overdue: [],
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
    'no-date': [],
  };

  const dayMap: TaskGroup[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  for (const task of tasks) {
    if (task.done) continue;

    const taskDay = task.calendarStart ? aucklandDayKey(task.calendarStart) : null;

    if (!taskDay) {
      groups['no-date'].push(task);
    } else {
      if (taskDay < startKey) {
        groups.overdue.push(task);
      } else if (taskDay <= endKey) {
        const day = new Date(`${taskDay}T00:00:00Z`).getUTCDay();
        const groupName = dayMap[day];
        if (groupName) {
          groups[groupName].push(task);
        }
      } else {
        // Future week tasks are ignored in the current week view
      }
    }
  }

  for (const key in groups) {
    groups[key as TaskGroup] = sortTasks(groups[key as TaskGroup]);
  }

  return groups;
}
