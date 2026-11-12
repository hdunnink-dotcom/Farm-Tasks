import { describe, expect, it } from 'vitest';
import type { FarmTask } from '@workspace/api-client-react';
import { buildRoutePrint, taskTimeOnDay } from './route-print';

const task = (input: Partial<FarmTask>): FarmTask => ({
  id: 'task', task: 'Task', group: 'Orchards', done: false, urgency: 'Medium', month: '', location: '', notes: '', link: '',
  subtasks: [], attachments: [], source: 'Manual', calendarEventId: '', calendarRecurringEventId: '', calendarStart: '',
  calendarUpdated: '', updatedAt: '', assigneeId: '', assigneeName: '', assigneeIds: [], assigneeNames: [], ...input,
  scheduledDates: input.scheduledDates ?? [],
});

describe('taskTimeOnDay', () => {
  it('gives the Auckland start time only on the day it starts', () => {
    expect(taskTimeOnDay({ calendarStart: '2026-11-02T04:30:00.000Z' }, '2026-11-02')).toBe('5:30 pm');
    expect(taskTimeOnDay({ calendarStart: '2026-11-02T08:30:00' }, '2026-11-02')).toBe('8:30 am');
    expect(taskTimeOnDay({ calendarStart: '2026-11-02T04:30:00.000Z' }, '2026-11-03')).toBe('');
    expect(taskTimeOnDay({ calendarStart: '2026-11-02' }, '2026-11-02')).toBe('');
  });
});

describe('buildRoutePrint', () => {
  const spray = task({ id: 'spray', task: 'GRAPES Sulphur 2', urgency: 'Urgent', calendarStart: '2026-11-01T19:30:00.000Z', assigneeNames: ['Otto'], notes: 'MIX per 100 L: Microthiol 200 g.\n\nRECORD in the BioGro diary: litres.' });
  const gorse = task({ id: 'gorse', task: 'Clear gorse', scheduledDates: ['2026-11-02', '2026-11-03'], calendarStart: '2026-11-02', assigneeNames: ['Eli', 'Otto'] });
  const steps = task({ id: 'steps', task: 'Stonefruit zinc', urgency: 'High', calendarStart: '2026-11-03T03:00:00.000Z', subtasks: [{ id: 's1', title: 'Rinse the tank', done: false }] });
  const groups = [
    { key: 'overdue', label: 'Overdue', tasks: [] },
    { key: '2026-11-02', label: 'Monday 2 Nov', tasks: [gorse, spray] },
    { key: '2026-11-03', label: 'Tuesday 3 Nov', tasks: [steps, gorse] },
    { key: '2026-11-04', label: 'Wednesday 4 Nov', tasks: [] },
    { key: '2026-11-05', label: 'Thursday 5 Nov', tasks: [] },
    { key: 'unscheduled', label: 'Any day this week', tasks: [] },
  ];

  it('lists each day in time order, folds empty days and numbers jobs with instructions once', () => {
    const { rows, cards, jobCount } = buildRoutePrint(groups, 'Otto');

    expect(rows.map((row) => row.kind === 'task' ? `${row.time || 'any'} ${row.task.id} ${row.span} [${row.others.join(',')}] ${row.ref ?? '-'}` : `${row.kind}: ${row.label}`)).toEqual([
      'day: Monday 2 Nov',
      'any gorse day 1 of 2 [Eli] -',
      '8:30 am spray  [] 1',
      'day: Tuesday 3 Nov',
      'any gorse day 2 of 2 [Eli] -',
      '4:00 pm steps  [] 2',
      'empty-days: Wednesday 4 Nov – Thursday 5 Nov',
    ]);
    expect(jobCount).toBe(3);
    expect(cards.map(({ ref, task, when }) => `${ref} ${task.id} ${when}`)).toEqual([
      '1 spray Mon 2 Nov · 8:30 am',
      '2 steps Tue 3 Nov · 4:00 pm',
    ]);
    expect(cards[0].notes.record).toEqual(['RECORD in the BioGro diary: litres.']);
  });

  it('reports no jobs when the week is empty', () => {
    expect(buildRoutePrint([{ key: '2026-11-02', label: 'Monday 2 Nov', tasks: [] }]).jobCount).toBe(0);
  });
});
