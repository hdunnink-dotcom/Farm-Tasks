import { describe, expect, it } from 'vitest';
import type { FarmTask } from '@workspace/api-client-react';
import { buildTodayFocus, focusBucket } from './today-focus';

const task = (input: Partial<FarmTask>): FarmTask => ({
  id: 'task', task: 'Task', done: false, urgency: 'Medium', month: '', location: '', notes: '', link: '',
  subtasks: [], attachments: [], source: 'Manual', calendarEventId: '', calendarRecurringEventId: '',
  calendarStart: '', calendarUpdated: '', updatedAt: '', assigneeId: '', assigneeName: '', ...input,
});

const today = '2026-10-30';

describe('today focus', () => {
  it('treats a task as overdue only when all of its days have passed', () => {
    expect(focusBucket(task({ scheduledDates: ['2026-10-26', '2026-10-27'] }), today)).toBe('overdue');
    expect(focusBucket(task({ scheduledDates: ['2026-10-25', '2027-01-10'] }), today)).toBeNull();
    expect(focusBucket(task({ scheduledDates: ['2026-10-29', '2026-10-30'] }), today)).toBe('today');
    expect(focusBucket(task({ calendarStart: '2026-11-04T09:00:00+13:00' }), today)).toBe('upcoming');
    expect(focusBucket(task({ calendarStart: '2026-11-07' }), today)).toBeNull();
  });

  it('leaves done and unscheduled work out', () => {
    expect(focusBucket(task({ done: true, scheduledDates: ['2026-10-27'] }), today)).toBeNull();
    expect(focusBucket(task({ urgency: 'Urgent' }), today)).toBeNull();
  });

  it('puts the highest priority first, then the scheduled time', () => {
    const focus = buildTodayFocus([
      task({ id: 'medium-early', calendarStart: '2026-10-30T07:30:00+13:00' }),
      task({ id: 'high-late', urgency: 'High', calendarStart: '2026-10-30T17:30:00+13:00' }),
      task({ id: 'medium-late', calendarStart: '2026-10-30T17:30:00+13:00' }),
      task({ id: 'low-overdue', urgency: 'Low', calendarStart: '2026-10-27' }),
      task({ id: 'urgent-overdue', urgency: 'Urgent', calendarStart: '2026-10-28' }),
      task({ id: 'next-week-urgent', urgency: 'Urgent', calendarStart: '2026-11-05' }),
      task({ id: 'tomorrow-low', urgency: 'Low', calendarStart: '2026-10-31' }),
    ], today);
    expect(focus.overdue.map(({ id }) => id)).toEqual(['urgent-overdue', 'low-overdue']);
    expect(focus.today.map(({ id }) => id)).toEqual(['high-late', 'medium-early', 'medium-late']);
    expect(focus.upcoming.map(({ id }) => id)).toEqual(['tomorrow-low', 'next-week-urgent']);
  });

  it('shows a task once when it appears twice in the list', () => {
    const repeated = task({ id: 'same', calendarStart: '2026-10-30' });
    expect(buildTodayFocus([repeated, repeated], today).today).toHaveLength(1);
  });
});
