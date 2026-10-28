import { describe, it, expect } from 'vitest';
import { getTaskWeekGroup, getTaskWeekGroups, sortWeekTasks } from './week-logic';
import type { FarmTask } from '@workspace/api-client-react';

const baseTask: FarmTask = {
  id: '1',
  task: 'Test',
  done: false,
  urgency: 'Medium',
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
  calendarStart: '',
  calendarUpdated: '',
  updatedAt: '',
  assigneeId: '',
  assigneeName: ''
};

describe('Week Logic', () => {
  const weekStart = new Date('2023-10-02T00:00:00Z'); // Monday

  it('groups unscheduled tasks', () => {
    expect(getTaskWeekGroup({ ...baseTask, calendarStart: '' }, weekStart)).toBe('Unscheduled');
  });

  it('hides completed tasks entirely', () => {
    expect(getTaskWeekGroup({ ...baseTask, calendarStart: '', done: true }, weekStart)).toBe(null);
    expect(getTaskWeekGroup({ ...baseTask, calendarStart: '2023-10-01T12:00:00Z', done: true }, weekStart)).toBe(null);
    expect(getTaskWeekGroup({ ...baseTask, calendarStart: '2023-10-03T12:00:00Z', done: true }, weekStart)).toBe(null);
  });

  it('groups overdue tasks', () => {
    expect(getTaskWeekGroup({ ...baseTask, calendarStart: '2023-10-01T10:00:00Z' }, weekStart)).toBe('Overdue');
  });

  it('groups tasks within the week', () => {
    expect(getTaskWeekGroup({ ...baseTask, calendarStart: '2023-10-02T11:00:00Z' }, weekStart)).toBe('Tuesday');
    expect(getTaskWeekGroup({ ...baseTask, calendarStart: '2023-10-07T11:00:00Z' }, weekStart)).toBe('Sunday');
  });

  it('places linked work in each relevant day without an extra overdue entry', () => {
    expect(getTaskWeekGroups({
      ...baseTask,
      calendarStart: '2023-10-01',
      scheduledDates: ['2023-10-01', '2023-10-03', '2023-10-05'],
    }, weekStart)).toEqual(['Tuesday', 'Thursday']);
  });

  it('hides future tasks', () => {
    expect(getTaskWeekGroup({ ...baseTask, calendarStart: '2023-10-09T12:00:00Z' }, weekStart)).toBe(null);
  });

  it('handles invalid calendarStart strings by grouping to Unscheduled', () => {
    expect(getTaskWeekGroup({ ...baseTask, calendarStart: 'invalid-date' }, weekStart)).toBe('Unscheduled');
  });
  
  it('sorts tasks by done, urgency, date, title, handling invalid dates safely', () => {
    const tasks: FarmTask[] = [
      { ...baseTask, id: '1', urgency: 'Low', task: 'Z', calendarStart: '2023-10-03T12:00:00Z' },
      { ...baseTask, id: '2', urgency: 'Urgent', task: 'A', calendarStart: 'invalid-date' }, // acts as date 0
      { ...baseTask, id: '3', urgency: 'Urgent', task: 'B', calendarStart: '2023-10-02T12:00:00Z' },
      { ...baseTask, id: '4', urgency: 'Medium', done: true, task: 'C' },
    ];
    // done tasks last, then urgent (A & B). A is invalid (time 0), B is real date. 0 comes before real date.
    const sorted = sortWeekTasks(tasks);
    expect(sorted.map(t => t.id)).toEqual(['2', '3', '1', '4']);
  });
});
