import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FarmTask } from '@workspace/api-client-react';
import { WeeklyRoutePrintSheet } from './week';
import type { WeekGroup } from '@/lib/week-logic';

function task(overrides: Partial<FarmTask>): FarmTask {
  return {
    id: 'task-1',
    task: 'Check irrigation',
    group: 'Orchard',
    done: false,
    urgency: 'High',
    month: '',
    location: 'North block',
    notes: 'Bring hose key\n\n• Check the valve\n  Then wait for pressure.',
    link: '',
    subtasks: [
      { id: 'step-1', title: 'Check soil moisture', done: false },
      { id: 'step-2', title: 'Stage wheelbarrow', done: true },
    ],
    attachments: [],
    source: 'Manual',
    calendarEventId: '',
    calendarRecurringEventId: '',
    calendarStart: '2026-08-24',
    calendarUpdated: '',
    updatedAt: '2026-08-24T00:00:00.000Z',
    assigneeId: 'worker-1',
    assigneeIds: ['worker-1'],
    assigneeName: 'Tom',
    ...overrides,
    scheduledDates: overrides.scheduledDates ?? [],
  };
}

function groups(): Record<WeekGroup, FarmTask[]> {
  return {
    Overdue: [],
    Monday: [task({ id: 'task-1' })],
    Tuesday: [],
    Wednesday: [],
    Thursday: [],
    Friday: [],
    Saturday: [],
    Sunday: [],
    Unscheduled: [],
  };
}

describe('WeeklyRoutePrintSheet', () => {
  it('prints the selected week, worker, and route task details', () => {
    render(
      <WeeklyRoutePrintSheet
        selectedWeekStart={new Date('2026-08-24T00:00:00')}
        groups={groups()}
        workerLabel="Tom"
      />,
    );

    expect(screen.getByText('Fieldbook · Weekly route')).toBeTruthy();
    expect(screen.getByText('Aug 24 – Aug 30, 2026')).toBeTruthy();
    expect(screen.getByText('Tom')).toBeTruthy();
    expect(screen.getByText('Check irrigation')).toBeTruthy();
    expect(screen.getByText('Orchard · High · North block')).toBeTruthy();
    expect(screen.getByTestId('print-task-notes-task-1').textContent).toBe('Bring hose key\n\n• Check the valve\n  Then wait for pressure.');
    expect(screen.getByTestId('print-task-steps-task-1')).toBeTruthy();
    expect(screen.getByText('Check soil moisture')).toBeTruthy();
    expect(screen.getByText('Stage wheelbarrow')).toBeTruthy();
    expect(screen.queryByText('Tuesday')).toBeNull();
  });
});