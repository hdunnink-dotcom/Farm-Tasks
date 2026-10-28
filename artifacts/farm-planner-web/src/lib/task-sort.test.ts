import { describe, expect, it } from 'vitest';
import type { FarmTask } from '@workspace/api-client-react';
import { compareTasksBySort, orderCrewPlanTasks } from './task-sort';

const task = (input: Partial<FarmTask>): FarmTask => ({
  id: 'task', task: 'Task', done: false, urgency: 'Medium', month: '', location: '', notes: '', link: '',
  subtasks: [], attachments: [], source: 'Manual', calendarEventId: '', calendarRecurringEventId: '',
  calendarStart: '', calendarUpdated: '', updatedAt: '', assigneeId: '', assigneeName: '', ...input,
});

describe('task sorting', () => {
  it('sorts every priority level from urgent through low', () => {
    const tasks = [
      task({ id: 'low', urgency: 'Low' }),
      task({ id: 'medium', urgency: 'Medium' }),
      task({ id: 'urgent', urgency: 'Urgent' }),
      task({ id: 'high', urgency: 'High' }),
    ];
    expect(tasks.sort(compareTasksBySort('priority')).map(({ id }) => id)).toEqual(['urgent', 'high', 'medium', 'low']);
  });

  it('sorts dates with unscheduled tasks last and stable title/id ties', () => {
    const tasks = [task({ id: 'c', task: 'Alpha' }), task({ id: 'b', task: 'Zulu', calendarStart: '2026-08-02T09:00:00' }), task({ id: 'a', task: 'Alpha', calendarStart: '2026-08-01T09:00:00' })];
    expect(tasks.sort(compareTasksBySort('date')).map(({ id }) => id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts recently updated descending with deterministic ties', () => {
    const tasks = [task({ id: 'b', task: 'Beta', updatedAt: '2026-08-01T00:00:00Z' }), task({ id: 'a', task: 'Alpha', updatedAt: '2026-08-01T00:00:00Z' }), task({ id: 'c', updatedAt: '' })];
    expect(tasks.sort(compareTasksBySort('updated')).map(({ id }) => id)).toEqual(['a', 'b', 'c']);
  });

  it('orders Crew Plan tasks by Auckland day, priority, time, and stable title', () => {
    const tasks = [
      task({ id: 'unscheduled', task: 'No date', urgency: 'Urgent' }),
      task({ id: 'later-low', task: 'Later low', urgency: 'Low', calendarStart: '2026-08-02T08:00:00+12:00' }),
      task({ id: 'early-high-z', task: 'Zulu', urgency: 'High', calendarStart: '2026-08-01T07:00:00+12:00' }),
      task({ id: 'early-high-a', task: 'Alpha', urgency: 'High', calendarStart: '2026-08-01T09:00:00+12:00' }),
      task({ id: 'early-urgent', task: 'Urgent work', urgency: 'Urgent', calendarStart: '2026-08-01' }),
      task({ id: 'auckland-next-day', task: 'After midnight', urgency: 'Urgent', calendarStart: '2026-08-01T12:30:00Z' }),
    ];

    expect(orderCrewPlanTasks(tasks).map(({ id }) => id)).toEqual([
      'early-urgent',
      'early-high-z',
      'early-high-a',
      'auckland-next-day',
      'later-low',
      'unscheduled',
    ]);
  });

  it('shows a multi-worker task only once in the ordered Crew Plan list', () => {
    const shared = task({ id: 'shared', task: 'Shared task', assigneeIds: ['tom', 'jason'] });
    expect(orderCrewPlanTasks([shared, { ...shared }]).map(({ id }) => id)).toEqual(['shared']);
  });
});