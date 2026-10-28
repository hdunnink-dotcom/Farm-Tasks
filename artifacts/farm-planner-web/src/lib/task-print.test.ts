import { describe, expect, it } from 'vitest';
import type { FarmTask } from '@workspace/api-client-react';
import { monthPrintGroups, startOfWeek, weekPrintGroups } from './task-print';

function task(id: string, overrides: Partial<FarmTask> = {}): FarmTask {
  return {
    id,
    task: `Task ${id}`,
    done: false,
    urgency: 'Medium',
    group: 'Orchard',
    location: '',
    notes: '',
    month: '',
    calendarStart: '',
    source: 'Manual',
    assigneeName: '',
    subtasks: [],
    attachments: [],
    ...overrides,
  } as FarmTask;
}

describe('print task grouping', () => {
  it('starts weeks on Monday', () => {
    expect(startOfWeek(new Date('2026-08-28T12:00:00')).toISOString().slice(0, 10)).toBe('2026-08-24');
  });

  it('keeps overdue open work and excludes completed work from a week', () => {
    const groups = weekPrintGroups([
      task('overdue', { calendarStart: '2026-08-20T09:00:00+12:00' }),
      task('monday', { calendarStart: '2026-08-24T09:00:00+12:00' }),
      task('done', { done: true, calendarStart: '2026-08-25T09:00:00+12:00' }),
      task('month-only', { month: '2026-08' }),
    ], new Date('2026-08-28T12:00:00'));

    expect(groups.find((group) => group.key === 'overdue')?.tasks.map((item) => item.id)).toEqual(['overdue']);
    expect(groups.find((group) => group.key === '2026-08-24')?.tasks.map((item) => item.id)).toEqual(['monday']);
    expect(groups.find((group) => group.key === 'any-day')?.tasks.map((item) => item.id)).toEqual(['month-only']);
    expect(groups.flatMap((group) => group.tasks).some((item) => item.id === 'done')).toBe(false);
  });

  it('groups monthly work chronologically with undated month work last', () => {
    const groups = monthPrintGroups([
      task('later', { calendarStart: '2026-08-19T09:00:00+12:00' }),
      task('earlier', { calendarStart: '2026-08-03T09:00:00+12:00' }),
      task('undated', { month: 'August 2026' }),
    ], new Date('2026-08-28T12:00:00'));

    expect(groups.map((group) => group.key)).toEqual(['2026-08-03', '2026-08-19', 'any-time']);
  });

  it('shows linked work in every scheduled day group without duplicating it in overdue', () => {
    const linked = task('linked', {
      calendarStart: '2026-08-20',
      scheduledDates: ['2026-08-20', '2026-08-24', '2026-08-26'],
    });
    const weekGroups = weekPrintGroups([linked], new Date('2026-08-28T12:00:00'));
    expect(weekGroups.find((group) => group.key === 'overdue')).toBeUndefined();
    expect(weekGroups.find((group) => group.key === '2026-08-24')?.tasks.map((item) => item.id)).toEqual(['linked']);
    expect(weekGroups.find((group) => group.key === '2026-08-26')?.tasks.map((item) => item.id)).toEqual(['linked']);

    const monthGroups = monthPrintGroups([linked], new Date('2026-08-28T12:00:00'));
    expect(monthGroups.find((group) => group.key === '2026-08-20')?.tasks.map((item) => item.id)).toEqual(['linked']);
    expect(monthGroups.find((group) => group.key === '2026-08-26')?.tasks.map((item) => item.id)).toEqual(['linked']);
  });
});