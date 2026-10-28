import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FarmTask } from '@workspace/api-client-react';
import type { FieldbookConflict } from '@/lib/offline-fieldbook';
import { ConflictNotice } from './farm-planner';

afterEach(cleanup);

function task(overrides: Partial<FarmTask>): FarmTask {
  return {
    id: 'task-1',
    task: 'Check irrigation',
    group: 'Orchards',
    done: false,
    urgency: 'Medium',
    month: '',
    location: 'North block',
    notes: '',
    link: '',
    subtasks: [],
    attachments: [],
    source: 'Manual',
    calendarEventId: '',
    calendarRecurringEventId: '',
    calendarStart: '2026-09-14',
    calendarUpdated: '',
    updatedAt: '2026-09-01T00:00:00.000Z',
    assigneeId: '',
    assigneeName: '',
    recurrence: 'none',
    ...overrides,
    scheduledDates: overrides.scheduledDates ?? [],
  };
}

describe('ConflictNotice', () => {
  it('compares only changed fields before either version is chosen', () => {
    const onResolve = vi.fn();
    const conflict = {
      id: 'conflict-1',
      taskId: 'task-1',
      localTask: task({ notes: 'My field note', recurrence: 'monthly' }),
      serverTask: task({ notes: 'New sheet note', recurrence: 'quarterly' }),
      mutation: {},
      createdAt: 1,
    } as FieldbookConflict;
    render(<ConflictNotice conflicts={[conflict]} onResolve={onResolve} />);

    fireEvent.click(screen.getByRole('button', { name: 'Compare changes' }));
    expect(screen.getByText('My version')).toBeTruthy();
    expect(screen.getByText('Newer sheet version')).toBeTruthy();
    expect(screen.getByText('My field note')).toBeTruthy();
    expect(screen.getByText('New sheet note')).toBeTruthy();
    expect(screen.getByText('monthly')).toBeTruthy();
    expect(screen.queryByText('North block')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Keep my version' }));
    expect(onResolve).toHaveBeenCalledWith(conflict, 'local');
  });

  it('shows a GPS capture timestamp even when the coordinates still match', () => {
    const conflict = {
      id: 'conflict-location',
      taskId: 'task-1',
      localTask: task({ latitude: -41.2, longitude: 172.9, locationCapturedAt: '2026-09-01T01:00:00.000Z' }),
      serverTask: task({ latitude: -41.2, longitude: 172.9, locationCapturedAt: '2026-09-01T02:00:00.000Z' }),
      mutation: {},
      createdAt: 1,
    } as FieldbookConflict;
    render(<ConflictNotice conflicts={[conflict]} onResolve={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare changes' }));
    expect(screen.getByText('Location captured')).toBeTruthy();
    expect(screen.getByText('2026-09-01T01:00:00.000Z')).toBeTruthy();
    expect(screen.getByText('2026-09-01T02:00:00.000Z')).toBeTruthy();
  });
});