import { describe, expect, it } from 'vitest';
import type { FarmTask } from '@workspace/api-client-react';
import { sortTasksForList } from './task-sort';

const task = (id: string, values: Partial<FarmTask>): FarmTask => ({
  id, task: id, done: false, urgency: 'Medium', calendarStart: '', calendarUpdated: '', updatedAt: '',
  group: 'Admin', month: '', location: '', notes: '', link: '', subtasks: [], attachments: [], source: 'Manual',
  calendarEventId: '', calendarRecurringEventId: '', assigneeId: '', assigneeName: '', ...values,
} as FarmTask);

describe('sortTasksForList', () => {
  const tasks = [
    task('b', { task: 'Bravo', urgency: 'High', calendarStart: '2024-05-15T10:00:00', updatedAt: '2024-05-02T10:00:00' }),
    task('a', { task: 'Alpha', urgency: 'High', calendarStart: '2024-05-15T10:00:00', updatedAt: '2024-05-03T10:00:00' }),
    task('c', { task: 'Charlie', urgency: 'Urgent', calendarStart: '2024-05-20T10:00:00', updatedAt: '2024-05-01T10:00:00' }),
  ];

  it('sorts each requested order with stable deterministic tie-breakers', () => {
    expect(sortTasksForList(tasks, 'priority').map((item) => item.id)).toEqual(['c', 'a', 'b']);
    expect(sortTasksForList(tasks, 'date').map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(sortTasksForList(tasks, 'title').map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(sortTasksForList(tasks, 'updated').map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts recently updated tasks by the full timestamp within the same day', () => {
    const sameDay = [
      task('early', { updatedAt: '2024-05-03T08:00:00Z' }),
      task('late', { updatedAt: '2024-05-03T16:00:00Z' }),
    ];
    expect(sortTasksForList(sameDay, 'updated').map((item) => item.id)).toEqual(['late', 'early']);
  });
});