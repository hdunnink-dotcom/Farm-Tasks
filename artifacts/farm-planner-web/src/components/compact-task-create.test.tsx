import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompactTaskCreate } from './compact-task-create';

afterEach(cleanup);

describe('CompactTaskCreate', () => {
  it('hands title, Auckland day, and the whole team to the full editor without saving', () => {
    const onSave = vi.fn();
    const onContinue = vi.fn();
    render(<CompactTaskCreate open onOpenChange={vi.fn()} initialDate="2026-04-13" initialAssigneeIds={['aroha']} workers={[
      { clerkId: 'aroha', displayName: 'Aroha', status: 'active' },
      { clerkId: 'ben', displayName: 'Ben', status: 'invited' },
    ]} onSave={onSave} onContinue={onContinue} />);

    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Check fence line' } });
    fireEvent.click(screen.getByLabelText('Ben (Invited)'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to full editor' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({
      task: 'Check fence line',
      calendarStart: '2026-04-13',
      assigneeIds: ['aroha', 'ben'],
      assigneeNames: ['Aroha', 'Ben'],
      assigneeId: 'aroha',
      assigneeName: 'Aroha',
    }));
  });

  it('saves a Crew Plan task with its date-only Auckland schedule', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(<CompactTaskCreate open onOpenChange={onOpenChange} initialDate="2026-09-14" workers={[]} onSave={onSave} onContinue={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'BioGro Audit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      task: 'BioGro Audit',
      calendarStart: '2026-09-14',
    })));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
