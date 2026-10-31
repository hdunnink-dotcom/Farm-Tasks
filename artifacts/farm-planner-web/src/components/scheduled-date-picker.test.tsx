import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScheduledDatePicker } from './scheduled-date-picker';

afterEach(cleanup);

describe('ScheduledDatePicker', () => {
  it('hydrates an existing Auckland schedule and selects a date in a navigated month', () => {
    const onChange = vi.fn();
    render(<ScheduledDatePicker value="2026-04-05T21:30:00.000Z" onChange={onChange} />);

    expect(screen.getByTestId('text-calendar-month').textContent).toContain('April 2026');
    expect(screen.getByTestId('calendar-date-2026-04-06').getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByTestId('input-task-calendar-time') as HTMLInputElement).value).toBe('09:30');

    fireEvent.click(screen.getByTestId('button-calendar-next-month'));
    expect(screen.getByTestId('text-calendar-month').textContent).toContain('May 2026');
    fireEvent.click(screen.getByTestId('calendar-date-2026-05-05'));
    expect(onChange).toHaveBeenLastCalledWith('2026-05-04T21:30:00.000Z');
  });

  it('offers no Clear for a date that must stay, such as a Google Calendar task', () => {
    const onChange = vi.fn();
    render(<ScheduledDatePicker value="2026-09-05" onChange={onChange} requireDate />);

    expect(screen.queryByTestId('button-clear-task-calendar')).toBeNull();
    expect(screen.getByTestId('task-schedule-picker').textContent).toContain('always keeps a date');
    fireEvent.click(screen.getByTestId('calendar-date-2026-09-12'));
    expect(onChange).toHaveBeenLastCalledWith('2026-09-12');
  });

  it('clears a schedule and keeps date-only values without inventing a time', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ScheduledDatePicker value="2026-08-30" onChange={onChange} />);

    expect((screen.getByTestId('input-task-calendar-time') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByTestId('button-clear-task-calendar'));
    expect(onChange).toHaveBeenCalledWith('');
    rerender(<ScheduledDatePicker value="" onChange={onChange} />);
    expect(screen.queryByTestId('button-clear-task-calendar')).toBeNull();
  });
});