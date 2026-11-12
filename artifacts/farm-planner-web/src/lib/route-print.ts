import type { FarmTask } from '@workspace/api-client-react';
import { calendarStartDate, calendarStartDayKey, taskScheduledDateKeys } from './task-calendar';
import { parsePrintNotes, type PrintNotes } from './print-notes';

/** A printed group: a day (key YYYY-MM-DD) or a named group such as Overdue. */
export interface RoutePrintGroup {
  key: string;
  label: string;
  tasks: FarmTask[];
}

export type GlanceRow =
  | { kind: 'day'; label: string }
  | { kind: 'empty-days'; label: string }
  | { kind: 'task'; task: FarmTask; time: string; span: string; others: string[]; ref: number | null };

export interface InstructionCard {
  ref: number;
  task: FarmTask;
  when: string;
  notes: PrintNotes;
}

export interface RoutePrint {
  rows: GlanceRow[];
  cards: InstructionCard[];
  jobCount: number;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const urgencyRank: Record<FarmTask['urgency'], number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
const aucklandTime = new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', hour: 'numeric', minute: '2-digit', hour12: true });
const shortDay = new Intl.DateTimeFormat('en-NZ', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

function minutesOfDay(time: string): number {
  const match = time.match(/^(\d+):(\d+)\s*(am|pm)$/i);
  if (!match) return -1;
  return (Number(match[1]) % 12 + (match[3].toLowerCase() === 'pm' ? 12 : 0)) * 60 + Number(match[2]);
}

/** The task's start time on that day, such as "8:30 am", or "" for all-day work. */
export function taskTimeOnDay(task: Pick<FarmTask, 'calendarStart'>, dayKey: string): string {
  const start = task.calendarStart?.trim() ?? '';
  if (!start.includes('T') || calendarStartDayKey(start) !== dayKey) return '';
  const written = start.match(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):([0-5]\d)/);
  if (written && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(start)) {
    const hour = Number(written[1]);
    return `${hour % 12 || 12}:${written[2]} ${hour < 12 ? 'am' : 'pm'}`;
  }
  const instant = calendarStartDate(start);
  return instant ? aucklandTime.format(instant).replace(/\s*([ap])\.?m\.?$/i, ' $1m').toLowerCase() : '';
}

function assigneeNames(task: FarmTask): string[] {
  return task.assigneeNames?.length ? task.assigneeNames : task.assigneeName ? [task.assigneeName] : [];
}

function dayLabel(key: string): string {
  return shortDay.format(new Date(`${key}T00:00:00Z`)).replace(',', '');
}

/**
 * Lays out a week for paper: one overview row per job per day (runs of empty
 * days folded into one line), and each job's instructions once, numbered in
 * the order they first appear. `printedFor` is left out of the "with" column.
 * Without `instructions` (a month to-do list) jobs get no numbers or cards.
 */
export function buildRoutePrint(groups: RoutePrintGroup[], printedFor = '', instructions = true): RoutePrint {
  const rows: GlanceRow[] = [];
  const refs = new Map<string, number>();
  const daysById = new Map<string, string[]>();
  const tasksById = new Map<string, FarmTask>();
  let emptyRun: RoutePrintGroup[] = [];

  const flushEmpty = () => {
    if (!emptyRun.length) return;
    const first = emptyRun[0].label;
    const last = emptyRun[emptyRun.length - 1].label;
    rows.push({ kind: 'empty-days', label: emptyRun.length === 1 ? first : `${first} – ${last}` });
    emptyRun = [];
  };

  for (const group of groups) {
    const isDay = DAY_KEY.test(group.key);
    if (!group.tasks.length) {
      if (isDay) emptyRun.push(group);
      continue;
    }
    flushEmpty();
    rows.push({ kind: 'day', label: group.label });
    const ordered = [...group.tasks]
      .map((task) => ({ task, time: isDay ? taskTimeOnDay(task, group.key) : '' }))
      .sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time)
        || urgencyRank[a.task.urgency] - urgencyRank[b.task.urgency]
        || a.task.task.localeCompare(b.task.task));
    for (const { task, time } of ordered) {
      tasksById.set(task.id, task);
      if (isDay) daysById.set(task.id, [...(daysById.get(task.id) ?? []), group.key]);
      if (instructions && (task.notes?.trim() || task.subtasks?.length) && !refs.has(task.id)) refs.set(task.id, refs.size + 1);
      const scheduled = taskScheduledDateKeys(task);
      const span = isDay
        ? scheduled.length > 1 ? `day ${scheduled.indexOf(group.key) + 1} of ${scheduled.length}` : ''
        : group.key === 'overdue' && scheduled.length ? `was due ${dayLabel(scheduled[scheduled.length - 1])}` : '';
      rows.push({
        kind: 'task',
        task,
        time,
        span,
        others: assigneeNames(task).filter((name) => name !== printedFor),
        ref: refs.get(task.id) ?? null,
      });
    }
  }
  flushEmpty();

  const cards = [...refs.entries()].map(([id, ref]) => {
    const task = tasksById.get(id)!;
    const days = daysById.get(id) ?? [];
    const time = days.map((day) => taskTimeOnDay(task, day)).find(Boolean) ?? '';
    return {
      ref,
      task,
      when: [days.map(dayLabel).join(', '), time].filter(Boolean).join(' · '),
      notes: parsePrintNotes(task.notes ?? ''),
    };
  });
  return { rows, cards, jobCount: tasksById.size };
}
