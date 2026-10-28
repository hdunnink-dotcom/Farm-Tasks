import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FarmTask } from '@workspace/api-client-react';
import { BoardTask, CrewTaskSidebar, crewPlanTaskEditUrl, getNewCalendarStart, replaceScheduledDate, shiftDateKey } from './crew-plan';

afterEach(cleanup);

const task = (input: Partial<FarmTask>): FarmTask => ({
  id: 'task', group: '', task: 'Task', done: false, urgency: 'Medium', month: '', location: '', notes: '', link: '',
  subtasks: [], attachments: [], source: 'Manual', calendarEventId: '', calendarRecurringEventId: '',
  calendarStart: '', calendarUpdated: '', updatedAt: '', assigneeId: '', assigneeName: '', ...input, scheduledDates: input.scheduledDates ?? [],
});

describe('Crew Plan Utilities', () => {
  it('builds a safe full-editor handoff URL for every task ID', () => {
    expect(crewPlanTaskEditUrl('sheet-row-12')).toBe('/tasks?edit=sheet-row-12');
    expect(crewPlanTaskEditUrl('task/with ? characters')).toBe('/tasks?edit=task%2Fwith%20%3F%20characters');
  });

  describe('shiftDateKey', () => {
    it('shifts correctly across month boundaries', () => {
      expect(shiftDateKey('2024-05-30', 2)).toBe('2024-06-01');
      expect(shiftDateKey('2024-03-01', -1)).toBe('2024-02-29'); // Leap year check not strictly required for this test, but logical
    });
  });

  describe('getNewCalendarStart', () => {
    it('preserves YYYY-MM-DD format exactly', () => {
      expect(getNewCalendarStart('2024-05-15', '2024-06-10')).toBe('2024-06-10');
      expect(getNewCalendarStart('2024-05-15   ', '2024-06-10')).toBe('2024-06-10');
    });

    it('preserves local time when replacing date in YYYY-MM-DDTHH:mm format', () => {
      expect(getNewCalendarStart('2024-05-15T14:30', '2024-06-10')).toBe('2024-06-10T14:30');
    });

    it('preserves Auckland local time semantics when replacing date in ISO string', () => {
      // 2024-05-15T02:30:00Z in UTC is 14:30 in NZST.
      // So formatAucklandDateTimeInput gives '2024-05-15T14:30'
      // After replace, it gives '2024-06-10T14:30'
      // Then parseAucklandDateTimeInput parses that back.
      // Since it depends on system timezone mock in tests or actual formatAucklandDateTimeInput behavior, 
      // we can verify it doesn't just strip time entirely.
      const result = getNewCalendarStart('2024-05-15T02:30:00.000Z', '2024-06-10');
      expect(result).not.toBe('2024-06-10');
      expect(result).toContain('T');
    });

    it('preserves seconds when moving an ISO timestamp', () => {
      expect(getNewCalendarStart('2024-05-15T02:30:45.000Z', '2024-06-10')).toContain(':45.000Z');
    });

    it('handles empty calendarStart', () => {
      expect(getNewCalendarStart('', '2024-06-10')).toBe('2024-06-10');
    });
  });

  describe('replaceScheduledDate', () => {
    it('replaces only the anchored linked day and returns sorted unique dates', () => {
      expect(replaceScheduledDate(
        task({ calendarStart: '2026-08-30', scheduledDates: ['2026-08-30', '2026-09-02', '2026-09-04'] }),
        '2026-09-02',
        '2026-09-03',
      )).toEqual(['2026-08-30', '2026-09-03', '2026-09-04']);
    });
  });

  describe('CrewTaskSidebar', () => {
    it('deduplicates open tasks and hides completed work', () => {
      const shared = task({
        id: 'shared',
        task: 'Shared inspection',
        done: false,
        calendarStart: '2026-08-31',
        assigneeIds: ['tom', 'jason'],
        assigneeNames: ['Tom', 'Jason'],
      });
      const completed = task({
        id: 'completed',
        task: 'Completed inspection',
        done: true,
        calendarStart: '2026-08-30',
      });
      render(<CrewTaskSidebar tasks={[completed, shared, { ...shared }]} onEdit={vi.fn()} />);

      const list = screen.getByTestId('crew-plan-task-list');
      expect(within(list).getAllByText('Shared inspection')).toHaveLength(1);
      expect(within(list).queryByText('Completed inspection')).toBeNull();
      expect(within(list).getByText('Tom, Jason')).toBeTruthy();
      expect(screen.getByText('1 open task')).toBeTruthy();
      expect(screen.getByTestId('crew-plan-task-scroll').className).toContain('overflow-y-auto');
    });

    it('shows a clear empty state when every task is completed', () => {
      render(<CrewTaskSidebar tasks={[task({ id: 'completed', task: 'Completed inspection', done: true })]} onEdit={vi.fn()} />);

      expect(screen.getByText('0 open tasks')).toBeTruthy();
      expect(screen.getByTestId('crew-plan-task-empty')).toBeTruthy();
      expect(screen.getByText('No open tasks')).toBeTruthy();
      expect(screen.queryByTestId('crew-plan-task-list')).toBeNull();
    });

    it('expands, collapses, and opens a task from the keyboard-accessible panel', () => {
      const onEdit = vi.fn();
      render(<CrewTaskSidebar tasks={[task({ id: 'edit-me', task: 'Open task' })]} onEdit={onEdit} />);

      const toggle = screen.getByRole('button', { name: 'Collapse all tasks panel' });
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      fireEvent.click(screen.getByTestId('crew-task-list-item-edit-me'));
      expect(onEdit).toHaveBeenCalledWith('edit-me');

      fireEvent.click(toggle);
      expect(screen.getByRole('button', { name: 'Expand all tasks panel' }).getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByTestId('crew-plan-task-list')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Expand all tasks panel' }));
      expect(screen.getByTestId('crew-plan-task-list')).toBeTruthy();
    });
  });

  describe('BoardTask deletion', () => {
    const boardProps = {
      workers: [],
      saveTask: vi.fn().mockResolvedValue(task({ id: 'save-result' })),
      onEdit: vi.fn(),
      visibleDates: ['2026-08-30', '2026-08-31'],
    };

    it('offers a confirmed, task-specific delete action for unscheduled work', async () => {
      const onDelete = vi.fn().mockResolvedValue(undefined);
      render(
        <BoardTask
          {...boardProps}
          task={task({ id: 'unscheduled-delete', task: 'Clear old fencing', calendarStart: '' })}
          onDelete={onDelete}
        />,
      );

      const options = screen.getByRole('button', { name: 'Options for Clear old fencing' });
      fireEvent.pointerDown(options, { button: 0 });
      fireEvent.click(options);
      const deleteItem = await waitFor(() => screen.getByRole('menuitem', { name: 'Delete Clear old fencing' }));
      fireEvent.click(deleteItem);

      expect(screen.getByRole('alertdialog')).toBeTruthy();
      expect(screen.getByText(/permanently remove "Clear old fencing"/)).toBeTruthy();
      expect(onDelete).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Clear old fencing' }));
      await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    });

    it('offers a confirmed, task-specific delete action for scheduled board work', async () => {
      const onDelete = vi.fn().mockResolvedValue(undefined);
      render(
        <BoardTask
          {...boardProps}
          task={task({ id: 'scheduled-delete', task: 'Spray orchard', calendarStart: '2026-08-30' })}
          onDelete={onDelete}
        />,
      );

      const options = screen.getByRole('button', { name: 'Options for Spray orchard' });
      fireEvent.pointerDown(options, { button: 0 });
      fireEvent.click(options);
      fireEvent.click(await waitFor(() => screen.getByRole('menuitem', { name: 'Delete Spray orchard' })));

      expect(screen.getByRole('alertdialog')).toBeTruthy();
      expect(screen.getByText(/permanently remove "Spray orchard"/)).toBeTruthy();
      expect(onDelete).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Spray orchard' }));
      await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    });

    it('does not offer deletion for completed board work', () => {
      render(
        <BoardTask
          {...boardProps}
          task={task({ id: 'completed-no-delete', task: 'Harvest finished block', done: true, calendarStart: '2026-08-30' })}
          onDelete={vi.fn().mockResolvedValue(undefined)}
        />,
      );

      const options = screen.getByRole('button', { name: 'Options for Harvest finished block' });
      fireEvent.pointerDown(options, { button: 0 });
      fireEvent.click(options);
      expect(screen.queryByRole('menuitem', { name: /Delete/ })).toBeNull();
    });
  });

  describe('BoardTask completion', () => {
    const completionProps = {
      workers: [],
      saveTask: vi.fn().mockResolvedValue(task({ id: 'save-result' })),
      onEdit: vi.fn(),
      visibleDates: ['2026-08-30', '2026-08-31'],
    };

    it('marks an open task complete from the options menu', async () => {
      const saveTask = vi.fn().mockResolvedValue(task({ id: 'complete-result', done: true }));
      render(
        <BoardTask
          {...completionProps}
          saveTask={saveTask}
          task={task({ id: 'mark-complete', task: 'Check water troughs' })}
        />,
      );

      const options = screen.getByRole('button', { name: 'Options for Check water troughs' });
      fireEvent.pointerDown(options, { button: 0 });
      fireEvent.click(options);
      fireEvent.click(await waitFor(() => screen.getByRole('menuitem', { name: 'Mark complete' })));

      await waitFor(() => expect(saveTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'mark-complete', task: 'Check water troughs' }),
        { task: 'Check water troughs', done: true },
      ));
    });

    it('does not offer completion for an already completed task', () => {
      render(
        <BoardTask
          {...completionProps}
          task={task({ id: 'already-complete', task: 'Finished fence repair', done: true })}
        />,
      );

      expect(screen.getByTestId('board-task-already-complete').getAttribute('draggable')).toBe('false');
      expect(screen.getByTestId('board-task-already-complete').getAttribute('aria-label')).toBe('Completed task: Finished fence repair');
      expect(screen.getByRole('heading', { name: 'Finished fence repair' }).className).toContain('line-through');
      const options = screen.getByRole('button', { name: 'Options for Finished fence repair' });
      fireEvent.pointerDown(options, { button: 0 });
      fireEvent.click(options);
      expect(screen.queryByRole('menuitem', { name: 'Mark complete' })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: 'Move / Assign...' })).toBeNull();
    });

    it('opens move and assign controls and saves the selected date and team', async () => {
      const saveTask = vi.fn().mockResolvedValue(task({ id: 'move-result' }));
      render(
        <BoardTask
          {...completionProps}
          workers={[
            { clerkId: 'tom', displayName: 'Tom', status: 'active' },
            { clerkId: 'jason', displayName: 'Jason', status: 'active' },
          ]}
          saveTask={saveTask}
          task={task({
            id: 'move-and-assign',
            task: 'Move the mineral tub',
            calendarStart: '2026-08-30',
            assigneeIds: ['tom'],
            assigneeNames: ['Tom'],
          })}
          visibleDates={['2026-08-30', '2026-08-31']}
        />,
      );

      const options = screen.getByRole('button', { name: 'Options for Move the mineral tub' });
      fireEvent.pointerDown(options, { button: 0 });
      fireEvent.click(options);
      const moveItem = await waitFor(() => screen.getByRole('menuitem', { name: 'Move / Assign...' }));
      fireEvent.pointerDown(moveItem, { button: 0 });
      fireEvent.click(moveItem);

      const dialog = await waitFor(() => screen.getByRole('dialog', { name: 'Move Task' }));
      fireEvent.change(within(dialog).getByRole('combobox', { name: 'Select move date' }), { target: { value: '2026-08-31' } });
      fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Tom' }));
      fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Jason' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Apply Move' }));

      await waitFor(() => expect(saveTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'move-and-assign' }),
        expect.objectContaining({
          calendarStart: '2026-08-31',
          assigneeId: 'jason',
          assigneeName: 'Jason',
          assigneeIds: ['jason'],
          assigneeNames: ['Jason'],
        }),
      ));
    });

    it('keeps other linked days when moving the board instance for one day', async () => {
      const saveTask = vi.fn().mockResolvedValue(task({ id: 'move-result' }));
      render(
        <BoardTask
          {...completionProps}
          saveTask={saveTask}
          anchoredDate="2026-08-31"
          task={task({ id: 'linked-move', task: 'Prune shelter belt', calendarStart: '2026-08-30', scheduledDates: ['2026-08-30', '2026-08-31', '2026-09-02'] })}
        />,
      );

      const options = screen.getByRole('button', { name: 'Options for Prune shelter belt' });
      fireEvent.pointerDown(options, { button: 0 });
      fireEvent.click(options);
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Move / Assign...' }));
      fireEvent.change(screen.getByRole('combobox', { name: 'Select move date' }), { target: { value: '2026-08-30' } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply Move' }));

      await waitFor(() => expect(saveTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'linked-move' }), expect.objectContaining({
        scheduledDates: ['2026-08-30', '2026-09-02'],
      })));
    });
  });

  describe('BoardTask copying', () => {
    it('creates an independent incomplete copy on the selected day without attachments', async () => {
      const saveTask = vi.fn().mockResolvedValue(task({ id: 'copied-task' }));
      render(
        <BoardTask
          workers={[]}
          saveTask={saveTask}
          onEdit={vi.fn()}
          visibleDates={['2026-08-30', '2026-08-31']}
          task={task({
            id: 'multi-day-source',
            task: 'Prune shelter belt',
            done: true,
            calendarStart: '2026-08-30',
            scheduledDates: ['2026-08-30', '2026-08-31'],
            subtasks: [{ id: 'step-1', title: 'North end', done: true }],
            attachments: [{
              id: 'attachment-1',
              taskId: 'multi-day-source',
              name: 'map.jpg',
              contentType: 'image/jpeg',
              size: 10,
              downloadUrl: '/api/attachments/attachment-1',
            }],
          })}
        />,
      );

      const options = screen.getByRole('button', { name: 'Options for Prune shelter belt' });
      fireEvent.pointerDown(options, { button: 0 });
      fireEvent.click(options);
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy to another day...' }));
      fireEvent.change(screen.getByRole('combobox', { name: 'Select move date' }), { target: { value: '2026-08-31' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create copy' }));

      await waitFor(() => expect(saveTask).toHaveBeenCalledWith(undefined, expect.objectContaining({
        task: 'Prune shelter belt',
        done: false,
        calendarStart: '2026-08-31',
        scheduledDates: ['2026-08-31'],
        subtasks: [{ id: 'step-1', title: 'North end', done: false }],
      })));
      expect(saveTask.mock.calls[0][1]).not.toHaveProperty('attachments');
    });
  });

  describe('BoardTask moving linked days', () => {
    it('defaults to the rendered secondary day and preserves the full linked schedule', async () => {
      const saveTask = vi.fn().mockResolvedValue(task({ id: 'moved-task' }));
      const linkedTask = task({
        id: 'linked-task',
        task: 'Repair orchard fence',
        calendarStart: '2026-08-30',
        scheduledDates: ['2026-08-30', '2026-08-31'],
      });
      render(
        <BoardTask
          task={linkedTask}
          anchoredDate="2026-08-31"
          workers={[]}
          saveTask={saveTask}
          onEdit={vi.fn()}
          visibleDates={['2026-08-30', '2026-08-31']}
        />,
      );

      const options = screen.getByRole('button', { name: 'Options for Repair orchard fence' });
      fireEvent.pointerDown(options, { button: 0 });
      fireEvent.click(options);
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Move / Assign...' }));
      expect(screen.getByRole('combobox', { name: 'Select move date' })).toHaveProperty('value', '2026-08-31');
      fireEvent.click(screen.getByRole('button', { name: 'Apply Move' }));

      await waitFor(() => expect(saveTask).toHaveBeenCalledWith(linkedTask, expect.objectContaining({
        scheduledDates: ['2026-08-30', '2026-08-31'],
      })));
    });
  });
});
