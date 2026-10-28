import { describe, expect, it } from 'vitest';
import type { FarmTask } from '@workspace/api-client-react';
import { buildPlannerAgenda, plannerDateKeys, plannerDateLabel, selectPlannerTasks, sortPlannerTasks } from './planner-30-day';

const task = (id: string, values: Partial<FarmTask> = {}): FarmTask => ({
  id,
  task: id,
  done: false,
  urgency: 'Medium',
  calendarStart: '',
  calendarUpdated: '',
  updatedAt: '',
  group: 'Orchards',
  month: '',
  location: '',
  notes: '',
  link: '',
  subtasks: [],
  attachments: [],
  source: 'Manual',
  calendarEventId: '',
  calendarRecurringEventId: '',
  assigneeId: '',
  assigneeName: '',
  ...values,
} as FarmTask);

describe('planner-30-day', () => {
  it('creates a 30-day range across month boundaries', () => {
    expect(plannerDateKeys('2026-08-30')).toHaveLength(30);
    expect(plannerDateKeys('2026-08-30').slice(0, 3)).toEqual(['2026-08-30', '2026-08-31', '2026-09-01']);
    expect(plannerDateKeys('2026-08-30').at(-1)).toBe('2026-09-28');
  });

  it('groups Auckland dates, overdue work, unscheduled work, and ignores future work', () => {
    const agenda = buildPlannerAgenda([
      task('overdue', { calendarStart: '2026-08-29' }),
      task('completed-before-window', { calendarStart: '2026-08-28', done: true }),
      task('all-day', { calendarStart: '2026-08-30' }),
      task('Auckland-next-day', { calendarStart: '2026-08-30T12:30:00Z' }),
      task('unscheduled', { calendarStart: '' }),
      task('invalid', { calendarStart: 'not a date' }),
      task('outside-window', { calendarStart: '2026-09-29' }),
    ], '2026-08-30');

    expect(agenda.overdue.map(({ id }) => id)).toEqual(['overdue']);
    expect(agenda.days[0].tasks.map(({ id }) => id)).toEqual(['all-day']);
    expect(agenda.days[1].tasks.map(({ id }) => id)).toEqual(['Auckland-next-day']);
    expect(agenda.unscheduled.map(({ id }) => id)).toEqual(['invalid', 'unscheduled']);
    expect(agenda.days.flatMap((day) => day.tasks).some(({ id }) => id === 'outside-window')).toBe(false);
  });

  it('deduplicates task projections and orders same-day work by urgency then time', () => {
    const shared = task('shared', { task: 'Shared', calendarStart: '2026-08-31T09:00:00', urgency: 'Low' });
    const ordered = sortPlannerTasks([
      shared,
      { ...shared },
      task('later-urgent', { calendarStart: '2026-08-31T11:00:00', urgency: 'Urgent' }),
      task('early-high', { calendarStart: '2026-08-31T07:00:00', urgency: 'High' }),
      task('all-day-urgent', { calendarStart: '2026-08-31', urgency: 'Urgent' }),
    ]);

    expect(ordered.map(({ id }) => id)).toEqual(['all-day-urgent', 'later-urgent', 'early-high', 'shared']);
  });

  it('labels today without changing other date labels', () => {
    expect(plannerDateLabel('2026-08-31', '2026-08-31')).toBe('Today · Mon, Aug 31');
    expect(plannerDateLabel('2026-09-01', '2026-08-31')).toBe('Tue, Sep 1');
  });

  it('keeps worker views assigned-only while managers can see the crew', () => {
    const workerTask = task('worker', { assigneeIds: ['worker-1'], done: false });
    const otherTask = task('other', { assigneeIds: ['worker-2'], done: false });
    const completed = task('completed', { assigneeIds: ['worker-1'], done: true });

    expect(selectPlannerTasks([workerTask, otherTask, completed], 'worker-1', false, false).map(({ id }) => id)).toEqual(['worker']);
    expect(selectPlannerTasks([workerTask, otherTask, completed], 'worker-1', false, true).map(({ id }) => id)).toEqual(['worker', 'completed']);
    expect(selectPlannerTasks([workerTask, otherTask, completed], 'manager', true, false).map(({ id }) => id)).toEqual(['worker', 'other']);
  });
});