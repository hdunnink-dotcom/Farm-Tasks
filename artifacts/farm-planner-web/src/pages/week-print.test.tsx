import { render, screen, within } from '@testing-library/react';
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
    notes: 'Bring hose key\n\n• Check the valve\n  Then wait for pressure.\n\nDO NOT\n- Leave the valve open.\n\nRECORD in the BioGro diary: litres.',
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
    assigneeIds: ['worker-1', 'worker-2'],
    assigneeName: 'Tom',
    assigneeNames: ['Tom', 'Aroha'],
    ...overrides,
    scheduledDates: overrides.scheduledDates ?? [],
  };
}

function groups(monday: FarmTask[] = [task({ id: 'task-1' })]): Record<WeekGroup, FarmTask[]> {
  return {
    Overdue: [],
    Monday: monday,
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
  it('prints the week at a glance, then the job instructions once with steps, warnings and a record strip', () => {
    render(<WeeklyRoutePrintSheet selectedWeekStart={new Date('2026-08-24T00:00:00')} groups={groups()} workerLabel="Tom" />);

    expect(screen.getByText('Fieldbook · Weekly route · Tom')).toBeTruthy();
    expect(screen.getByText('Mon 24 – Sun 30 Aug 2026')).toBeTruthy();
    expect(screen.getByText('Monday 24 Aug')).toBeTruthy();
    expect(screen.getByText(/Tuesday 25 Aug – Sunday 30 Aug/)).toBeTruthy();

    const row = screen.getByTestId('route-print-row-task-1');
    expect(row.textContent).toContain('Any time');
    expect(row.textContent).toContain('Check irrigation');
    expect(row.textContent).toContain('Aroha');
    expect(row.textContent).not.toContain('Tom');

    const card = screen.getByTestId('route-print-card-task-1');
    expect(within(card).getByText('Check soil moisture')).toBeTruthy();
    expect(within(card).getByText('Stage wheelbarrow')).toBeTruthy();
    expect(within(card).getByText('Bring hose key')).toBeTruthy();
    expect(within(card).getByText('Check the valve')).toBeTruthy();
    expect(card.querySelector('.route-print-warning')?.textContent).toContain('Leave the valve open.');
    expect(card.querySelector('.route-print-record')?.textContent).toContain('Litres');
  });

  it('leaves done work off the paper and says when nothing is left', () => {
    render(<WeeklyRoutePrintSheet selectedWeekStart={new Date('2026-08-24T00:00:00')} groups={groups([task({ id: 'done', done: true })])} workerLabel="My route" />);
    expect(screen.queryByTestId('route-print-row-done')).toBeNull();
    expect(screen.getByText('No open work is scheduled for this week.')).toBeTruthy();
  });
});
