import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const farmSettingsState = vi.hoisted(() => ({ data: undefined as {
  groups: string[];
  locations: string[];
  defaultGroup: string;
  defaultUrgency: 'Urgent' | 'High' | 'Medium' | 'Low';
  defaultLocation: string;
} | undefined }));
const attachmentMutation = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
const queryClient = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));

vi.mock('@clerk/react', () => ({ useAuth: () => ({ isSignedIn: true }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => queryClient }));
vi.mock('@workspace/api-client-react', () => ({
  getGetFarmSettingsQueryKey: () => ['/api/farm-settings'],
  getListFarmTasksQueryKey: () => ['/api/tasks'],
  useGetFarmSettings: () => ({ data: farmSettingsState.data }),
  useRequestFarmAttachmentUpload: () => ({ mutateAsync: vi.fn() }),
  useCompleteFarmAttachmentUpload: () => ({ mutateAsync: vi.fn() }),
  useDeleteFarmAttachment: () => ({ ...attachmentMutation, isPending: false }),
}));

import { TaskFormDialog } from './task-form-dialog';

afterEach(() => {
  cleanup();
  farmSettingsState.data = undefined;
  attachmentMutation.mutateAsync.mockReset();
  queryClient.invalidateQueries.mockReset();
  vi.unstubAllGlobals();
});

describe('TaskFormDialog assignment', () => {
  it('shows an accessible team picker and keeps canonical and legacy assignment fields aligned', () => {
    const onSave = vi.fn();
    render(
      <TaskFormDialog
        open
        onClose={vi.fn()}
        onSave={onSave}
        canAssign
        workers={[
          { clerkId: 'worker-a', displayName: 'Aroha', status: 'active' },
          { clerkId: 'worker-b', displayName: 'Ben', status: 'invited' },
        ]}
        task={{
          id: 'task-1',
          task: 'Prune row',
          group: 'Orchards',
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
          calendarStart: '',
          scheduledDates: [],
          repeatWeekly: false,
          assigneeId: 'worker-a',
          assigneeName: 'Aroha',
          attachments: [],
          source: 'Manual',
          calendarEventId: '',
          calendarRecurringEventId: '',
          calendarUpdated: '',
          updatedAt: '',
          assigneeIds: ['worker-a'],
          assigneeNames: ['Aroha'],
        }}
      />,
    );

    expect(screen.getByRole('group', { name: 'Assigned team' })).toBeTruthy();
    const aroha = screen.getByRole('checkbox', { name: 'Aroha' }) as HTMLInputElement;
    const ben = screen.getByRole('checkbox', { name: 'Ben (Invited)' }) as HTMLInputElement;
    expect(aroha.checked).toBe(true);
    fireEvent.click(ben);
    fireEvent.submit(screen.getByTestId('button-save-task').closest('form')!);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      assigneeIds: ['worker-a', 'worker-b'],
      assigneeNames: ['Aroha', 'Ben'],
      assigneeId: 'worker-a',
      assigneeName: 'Aroha',
    }), []);
  });

  it('shows workers their assigned team without allowing changes', () => {
    render(
      <TaskFormDialog
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        task={{
          id: 'task-2',
          task: 'Move irrigation',
          group: 'Orchards',
          done: false,
          urgency: 'Medium',
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
          scheduledDates: [],
          calendarUpdated: '',
          updatedAt: '',
          assigneeId: 'worker-a',
          assigneeName: 'Aroha',
          assigneeIds: ['worker-a', 'worker-b'],
          assigneeNames: ['Aroha', 'Ben'],
        }}
      />,
    );
    expect(screen.getByTestId('readonly-task-assignees').textContent).toBe('Aroha, Ben');
    expect(screen.queryByTestId('checkbox-task-assignee-worker-a')).toBeNull();
  });

  it('retains compact handoff values when opening the full editor', () => {
    render(<TaskFormDialog open onClose={vi.fn()} onSave={vi.fn()} canAssign workers={[
      { clerkId: 'worker-a', displayName: 'Aroha', status: 'active' },
      { clerkId: 'worker-b', displayName: 'Ben', status: 'invited' },
    ]} initialDraft={{ task: 'Check fence line', calendarStart: '2026-04-13', assigneeIds: ['worker-a', 'worker-b'], assigneeNames: ['Aroha', 'Ben'], assigneeId: 'worker-a', assigneeName: 'Aroha' }} />);
    expect((screen.getByTestId('input-task-name') as HTMLInputElement).value).toBe('Check fence line');
    expect(screen.getByTestId('checkbox-task-assignee-worker-a')).toHaveProperty('checked', true);
    expect(screen.getByTestId('checkbox-task-assignee-worker-b')).toHaveProperty('checked', true);
  });
});

describe('TaskFormDialog schedule', () => {
  function submitSchedule(calendarStart: string) {
    const onSave = vi.fn();
    render(<TaskFormDialog open onClose={vi.fn()} onSave={onSave} initialDraft={{ task: 'Check fence', calendarStart }} />);
    fireEvent.submit(screen.getByTestId('button-save-task').closest('form')!);
    return onSave;
  }

  it('saves an unscheduled task and a date-only task', () => {
    expect(submitSchedule('').mock.calls[0][0]).toEqual(expect.objectContaining({ calendarStart: '' }));
    cleanup();
    expect(submitSchedule('2026-08-30').mock.calls[0][0]).toEqual(expect.objectContaining({ calendarStart: '2026-08-30' }));
  });

  it('saves one linked task across multiple selected days', () => {
    const onSave = vi.fn();
    render(<TaskFormDialog open onClose={vi.fn()} onSave={onSave} initialDraft={{ task: 'Prune shelter belt', calendarStart: '2026-08-30' }} />);

    fireEvent.change(screen.getByLabelText('Linked task date'), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add day' }));
    expect(screen.getByRole('list', { name: 'Linked scheduled days' }).textContent).toContain('2026-09-01');

    fireEvent.submit(screen.getByTestId('button-save-task').closest('form')!);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      calendarStart: '2026-08-30',
      scheduledDates: ['2026-08-30', '2026-09-01'],
    }), []);
  });

  it('replaces the primary day without retaining it as an implicit linked day', () => {
    const onSave = vi.fn();
    render(<TaskFormDialog open onClose={vi.fn()} onSave={onSave} initialDraft={{ task: 'Prune shelter belt', calendarStart: '2026-08-30' }} />);

    fireEvent.change(screen.getByLabelText('Linked task date'), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add day' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose 2026-08-31' }));
    fireEvent.submit(screen.getByTestId('button-save-task').closest('form')!);

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      calendarStart: '2026-08-31',
      scheduledDates: ['2026-08-31', '2026-09-01'],
    }), []);
  });

  it('allows a recurring task date to be changed without creating a second day', () => {
    const onSave = vi.fn();
    render(<TaskFormDialog open onClose={vi.fn()} onSave={onSave} task={{
      id: 'weekly-task', task: 'Check traps', group: 'Orchards', done: false, urgency: 'Medium',
      month: '', location: '', notes: '', link: '', subtasks: [], attachments: [], source: 'Manual',
      calendarEventId: '', calendarRecurringEventId: '', calendarStart: '2026-08-30',
      scheduledDates: ['2026-08-30'], recurrence: 'weekly', repeatWeekly: true,
      calendarUpdated: '', updatedAt: '', assigneeId: '', assigneeName: '',
    }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose 2026-08-31' }));
    fireEvent.submit(screen.getByTestId('button-save-task').closest('form')!);

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      calendarStart: '2026-08-31',
      scheduledDates: ['2026-08-31'],
      recurrence: 'weekly',
    }), []);
  });

  it('allows an existing stored Auckland instant to be saved unchanged', () => {
    const onSave = submitSchedule('2026-04-05T21:30:00.000Z');

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      calendarStart: '2026-04-05T21:30:00.000Z',
    }), []);
  });

  it('normalizes a valid local Auckland date-time before saving', () => {
    const onSave = submitSchedule('2026-04-06T09:30');

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      calendarStart: '2026-04-05T21:30:00.000Z',
    }), []);
  });

  it('rejects impossible dates and DST-skipped Auckland times with clear copy', () => {
    const onSave = submitSchedule('2026-09-27T02:30');

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('Schedule date & time')).toBeTruthy();
    expect(screen.getByText('Enter a valid Pacific/Auckland date and optional time.')).toBeTruthy();

    cleanup();
    const invalidDateSave = submitSchedule('2026-02-30');
    expect(invalidDateSave).not.toHaveBeenCalled();
  });

  it('offers every recurrence interval and requires a schedule for recurring tasks', () => {
    const onSave = vi.fn();
    render(<TaskFormDialog open onClose={vi.fn()} onSave={onSave} initialDraft={{ task: 'Check traps' }} />);
    const recurrence = screen.getByTestId('select-task-recurrence');
    expect(recurrence.getAttribute('role')).toBe('combobox');
    fireEvent.click(recurrence);
    expect(screen.getByRole('option', { name: 'Every month' })).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: 'Every month' }));
    fireEvent.submit(screen.getByTestId('button-save-task').closest('form')!);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('Recurring tasks require one scheduled date and time.')).toBeTruthy();
  });

  it('maps legacy weekly tasks to weekly and saves the canonical recurrence', () => {
    const onSave = vi.fn();
    render(<TaskFormDialog open onClose={vi.fn()} onSave={onSave} initialDraft={{ task: 'Check traps', calendarStart: '2026-09-14', repeatWeekly: true }} />);
    expect(screen.getByTestId('select-task-recurrence').getAttribute('role')).toBe('combobox');
    fireEvent.click(screen.getByTestId('select-task-recurrence'));
    fireEvent.click(screen.getByRole('option', { name: 'Every 3 months' }));
    fireEvent.submit(screen.getByTestId('button-save-task').closest('form')!);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      recurrence: 'quarterly',
      repeatWeekly: false,
      calendarStart: '2026-09-14',
    }), []);
  });

  it('does not allow imported calendar tasks to become recurring routines', () => {
    render(<TaskFormDialog open onClose={vi.fn()} onSave={vi.fn()} task={{
      id: 'calendar-1', task: 'Calendar task', group: 'Orchards', done: false, urgency: 'Medium',
      month: '', location: '', notes: '', link: '', subtasks: [], attachments: [], source: 'Google Calendar',
      calendarEventId: 'event-1', calendarRecurringEventId: '', calendarStart: '2026-09-14',
      scheduledDates: ['2026-09-14'],
      calendarUpdated: '', updatedAt: '', assigneeId: '', assigneeName: '',
    }} />);
    expect(screen.getByTestId('select-task-recurrence').hasAttribute('data-disabled')).toBe(true);
    expect(screen.getByText('Imported calendar tasks cannot become manual recurring routines.')).toBeTruthy();
  });

  it('awaits an asynchronous save and shows failures without leaving the button stuck', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('The photo upload could not finish.'));
    render(<TaskFormDialog open onClose={vi.fn()} onSave={onSave} initialDraft={{ task: 'Photograph broken gate' }} />);

    fireEvent.submit(screen.getByTestId('button-save-task').closest('form')!);
    expect(screen.getByTestId('button-save-task').textContent).toContain('Saving');

    await waitFor(() => expect(screen.getByTestId('status-form-error').textContent).toContain('photo upload could not finish'));
    expect(screen.getByTestId('button-save-task')).toHaveProperty('disabled', false);
    expect(screen.getByTestId('button-save-task').textContent).toContain('Add to the board');
  });
});

describe('TaskFormDialog farm option order', () => {
  it('uses the configured group order and location suggestion order', () => {
    farmSettingsState.data = {
      groups: ['Planting', 'Orchards', 'Repair'],
      locations: ['South block', 'North block'],
      defaultGroup: 'Planting',
      defaultUrgency: 'Medium',
      defaultLocation: 'South block',
    };
    render(<TaskFormDialog open onClose={vi.fn()} onSave={vi.fn()} />);

    expect(Array.from((screen.getByTestId('select-task-group') as HTMLSelectElement).options, (option) => option.value))
      .toEqual(['Planting', 'Orchards', 'Repair']);
    expect(Array.from(screen.getByTestId('input-task-location').nextElementSibling!.querySelectorAll('option'), (option) => option.value))
      .toEqual(['South block', 'North block']);
  });
});

describe('TaskFormDialog attachment deletion recovery', () => {
  const taskWithAttachment = {
    id: 'task-attachment',
    task: 'Photograph gate',
    group: 'Orchards',
    done: false,
    urgency: 'Medium' as const,
    month: '',
    location: '',
    notes: '',
    link: '',
    subtasks: [],
    attachments: [{
      id: 'attachment-1',
      taskId: 'task-attachment',
      name: 'broken-gate.jpg',
      contentType: 'image/jpeg',
      size: 2048,
      downloadUrl: '/api/attachments/attachment-1',
    }],
    source: 'Manual' as const,
    calendarEventId: '',
    calendarRecurringEventId: '',
    calendarStart: '',
    scheduledDates: [],
    calendarUpdated: '',
    updatedAt: '',
    assigneeId: '',
    assigneeName: '',
  };

  it('keeps a failed deletion visible and offers an accessible named retry', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    attachmentMutation.mutateAsync.mockRejectedValueOnce(new Error('The service is unavailable.'));
    render(<TaskFormDialog open onClose={vi.fn()} onSave={vi.fn()} task={taskWithAttachment} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove broken-gate.jpg' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not remove broken-gate.jpg');
    expect(alert.textContent).toContain('The service is unavailable.');
    expect(screen.getByRole('link', { name: 'broken-gate.jpg' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });

  it('removes the attachment after retry and invalidates all task-list variants once', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    attachmentMutation.mutateAsync
      .mockRejectedValueOnce(new Error('Connection lost.'))
      .mockResolvedValueOnce(undefined);
    render(<TaskFormDialog open onClose={vi.fn()} onSave={vi.fn()} task={taskWithAttachment} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove broken-gate.jpg' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.queryByRole('link', { name: 'broken-gate.jpg' })).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(attachmentMutation.mutateAsync).toHaveBeenCalledTimes(2);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['/api/tasks'] });
  });
});
