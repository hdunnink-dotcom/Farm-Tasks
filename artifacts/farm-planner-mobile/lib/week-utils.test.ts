import { describe, expect, it } from 'vitest';
import { getStartOfWeek, getEndOfWeek, groupTasks, sortTasks, addWeeks } from './week-utils';
import { type FarmTask } from '@workspace/api-client-react';

const mockTask = (id: string, overrides: Partial<FarmTask>): FarmTask => ({
  id,
  task: `Task ${id}`,
  done: false,
  urgency: 'Medium',
  calendarStart: '',
  group: 'Admin',
  month: '',
  location: '',
  notes: '',
  link: '',
  subtasks: [],
  attachments: [],
  source: 'Manual',
  calendarEventId: '',
  calendarRecurringEventId: '',
  calendarUpdated: '',
  updatedAt: '',
  assigneeId: '',
  assigneeName: '',
  ...overrides,
} as FarmTask);

describe('week-utils', () => {
  it('identifies start and end of week (Monday start)', () => {
    // 2023-11-01 is a Wednesday
    const wed = new Date('2023-11-01T12:00:00Z');
    const start = getStartOfWeek(wed);
    expect(start.getDay()).toBe(1); // Monday
    expect(start.getDate()).toBe(30); // Oct 30

    const end = getEndOfWeek(start);
    expect(end.getDay()).toBe(0); // Sunday
    expect(end.getDate()).toBe(5); // Nov 5
  });

  it('sorts tasks by urgency, then date, then title', () => {
    const tasks = [
      mockTask('1', { urgency: 'Low', task: 'Z', calendarStart: '2023-11-02T00:00:00Z' }),
      mockTask('2', { urgency: 'High', task: 'A', calendarStart: '2023-11-02T00:00:00Z' }),
      mockTask('3', { urgency: 'Urgent', task: 'M', calendarStart: '2023-11-02T00:00:00Z' }),
      mockTask('4', { urgency: 'High', task: 'B', calendarStart: '2023-11-01T00:00:00Z' }),
    ];

    const sorted = sortTasks(tasks);
    expect(sorted.map((t) => t.id)).toEqual(['3', '4', '2', '1']);
  });

  it('groups tasks correctly, excluding completed', () => {
    const weekStart = new Date('2023-10-30T00:00:00Z'); // Monday
    const tasks = [
      mockTask('overdue1', { calendarStart: '2023-10-29T00:00:00Z' }), // Sunday before
      mockTask('done_overdue', { calendarStart: '2023-10-29T00:00:00Z', done: true }), // Should be ignored
      mockTask('wed1', { calendarStart: '2023-11-01T00:00:00Z' }), // Wednesday
      mockTask('done_wed', { calendarStart: '2023-11-01T00:00:00Z', done: true }), // Should be ignored
      mockTask('future', { calendarStart: '2023-11-06T00:00:00Z' }), // Monday after
      mockTask('noDate1', { calendarStart: '' }),
      mockTask('invalidDate', { calendarStart: 'invalid-date' }),
    ];

    const grouped = groupTasks(tasks, weekStart);
    
    expect(grouped.overdue.map(t => t.id)).toEqual(['overdue1']);
    expect(grouped.wednesday.map(t => t.id)).toEqual(['wed1']);
    expect(grouped.monday).toEqual([]);
    expect(grouped['no-date'].map(t => t.id)).toEqual(['noDate1', 'invalidDate']);
  });

  it('adds weeks correctly', () => {
    const start = new Date('2023-11-01T12:00:00Z');
    const next = addWeeks(start, 1);
    expect(next.getDate()).toBe(8);
    const prev = addWeeks(start, -1);
    expect(prev.getDate()).toBe(25);
    expect(prev.getMonth()).toBe(9); // October
  });
});
