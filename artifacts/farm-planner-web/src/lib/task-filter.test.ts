import { describe, expect, it } from 'vitest';
import type { FarmTask } from '@workspace/api-client-react';
import { CURRENT_MONTH, monthOptions } from './task-month';
import { compareTasksUrgentFirst, isTaskOverdue, taskMatchesMonthWithUrgentPin } from './task-filter';

function task(input: Partial<FarmTask>): FarmTask {
  return {
    id: 'task',
    group: 'Orchards',
    task: 'Work',
    done: false,
    urgency: 'Medium',
    month: '',
    location: '',
    latitude: null,
    longitude: null,
    locationCapturedAt: null,
    atlasLink: '',
    notes: '',
    link: '',
    subtasks: [],
    attachments: [],
    source: 'Manual',
    calendarEventId: '',
    calendarRecurringEventId: '',
    calendarStart: '',
    calendarUpdated: '',
    updatedAt: '2026-08-28T00:00:00.000Z',
    assigneeId: '',
    assigneeName: '',
    ...input,
  };
}

describe('task filtering', () => {
  it('keeps all unfinished previous-month work visible in the default current-month scope', () => {
    const overdueMedium = task({ id: 'overdue', urgency: 'Medium', month: '2026-07' });
    const urgentOffMonth = task({ id: 'urgent', urgency: 'Urgent', month: '2026-07' });
    const currentMonth = task({ id: 'current', month: '2026-08' });

    expect(taskMatchesMonthWithUrgentPin(overdueMedium, CURRENT_MONTH, new Date(2026, 7, 28))).toBe(true);
    expect(taskMatchesMonthWithUrgentPin(urgentOffMonth, CURRENT_MONTH)).toBe(true);
    expect([currentMonth, urgentOffMonth].sort(compareTasksUrgentFirst).map((item) => item.id)).toEqual(['urgent', 'current']);
  });

  it('does not pin completed urgent work outside the current month', () => {
    expect(taskMatchesMonthWithUrgentPin(
      task({ urgency: 'Urgent', done: true, month: '2026-07' }),
      CURRENT_MONTH,
    )).toBe(false);
  });

  it('does not carry completed or future work into the current-month scope', () => {
    expect(taskMatchesMonthWithUrgentPin(
      task({ month: '2026-07', done: true }),
      CURRENT_MONTH,
      new Date(2026, 7, 28),
    )).toBe(false);
    expect(taskMatchesMonthWithUrgentPin(
      task({ month: '2026-09' }),
      CURRENT_MONTH,
      new Date(2026, 7, 28),
    )).toBe(false);
  });

  it('hides past months while retaining the current and future month options', () => {
    const options = monthOptions([
      task({ month: '2026-07' }),
      task({ month: '2026-09' }),
      task({ month: '2027-02' }),
    ], new Date(2026, 7, 28));

    expect(options).not.toContain('2026-07');
    expect(options).toEqual(expect.arrayContaining(['2026-08', '2026-09', '2026-12', '2027-02']));
  });

  it('recognizes overdue calendar dates and month-only work', () => {
    const today = new Date(2026, 7, 28);
    expect(isTaskOverdue(task({ calendarStart: '2026-08-27T20:00:00+12:00' }), today)).toBe(true);
    expect(isTaskOverdue(task({ month: '2026-07' }), today)).toBe(true);
    expect(isTaskOverdue(task({ month: '2026-08' }), today)).toBe(false);
  });
});