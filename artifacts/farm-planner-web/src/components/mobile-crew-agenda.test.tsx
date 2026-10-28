import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FarmTask } from '@workspace/api-client-react';
import { localAucklandDateKey } from '@/lib/task-calendar';
import { MobileCrewAgenda } from './mobile-crew-agenda';

afterEach(cleanup);

const task = (input: Partial<FarmTask>): FarmTask => ({
  id: 'task',
  group: 'Orchards',
  task: 'Task',
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
  calendarUpdated: '',
  updatedAt: '2026-09-01T00:00:00.000Z',
  assigneeId: '',
  assigneeName: '',
  assigneeIds: [],
  assigneeNames: [],
  ...input,
  scheduledDates: input.scheduledDates ?? [],
});

function renderAgenda({
  tasks = [],
  canManageTeam = true,
  currentView = 'team',
  currentStatusFilter = 'all',
}: {
  tasks?: FarmTask[];
  canManageTeam?: boolean;
  currentView?: 'team' | 'mine';
  currentStatusFilter?: 'open' | 'all';
} = {}) {
  const today = localAucklandDateKey();
  const onViewChange = vi.fn();
  const onStatusFilterChange = vi.fn();
  const onDateChange = vi.fn();
  const onRefresh = vi.fn();
  const onAddTask = vi.fn();
  const onOpenTask = vi.fn();
  const onSaveTask = vi.fn().mockResolvedValue(undefined);

  render(
    <MobileCrewAgenda
      tasks={tasks}
      workers={[
        { clerkId: 'tom', displayName: 'Tom', status: 'active' },
        { clerkId: 'jason', displayName: 'Jason', status: 'active' },
      ]}
      currentUserId="tom"
      canManageTeam={canManageTeam}
      visibleDateKeys={[today]}
      currentStartDate={today}
      syncState="synced"
      pendingCount={0}
      retryState="idle"
      currentView={currentView}
      currentStatusFilter={currentStatusFilter}
      onViewChange={onViewChange}
      onStatusFilterChange={onStatusFilterChange}
      onDateChange={onDateChange}
      onRefresh={onRefresh}
      onAddTask={onAddTask}
      onOpenTask={onOpenTask}
      onSaveTask={onSaveTask}
    />,
  );

  return { today, onViewChange, onStatusFilterChange, onDateChange, onRefresh, onAddTask, onOpenTask, onSaveTask };
}

describe('MobileCrewAgenda', () => {
  it('shows completed team work by default and keeps an explicit Open-only filter', () => {
    const today = localAucklandDateKey();
    renderAgenda({
      tasks: [
        task({ id: 'team-task', task: 'Inspect the pear row', calendarStart: today, assigneeIds: ['tom', 'jason'], assigneeNames: ['Tom', 'Jason'] }),
        task({ id: 'done-task', task: 'Finished irrigation check', done: true, calendarStart: today, assigneeIds: ['jason'], assigneeNames: ['Jason'] }),
      ],
    });

    expect(screen.getByText('Inspect the pear row')).toBeTruthy();
    expect(screen.getByText('Tom, Jason')).toBeTruthy();
    const completedTitle = screen.getByText('Finished irrigation check');
    expect(completedTitle.className).toContain('line-through');
    expect(screen.getByText('Completed')).toBeTruthy();
    expect(screen.getByTestId('mobile-crew-status-all').getAttribute('aria-selected')).toBe('true');

    cleanup();
    renderAgenda({
      currentStatusFilter: 'open',
      tasks: [
        task({ id: 'team-task', task: 'Inspect the pear row', calendarStart: today, assigneeIds: ['tom', 'jason'], assigneeNames: ['Tom', 'Jason'] }),
        task({ id: 'done-task', task: 'Finished irrigation check', done: true, calendarStart: today, assigneeIds: ['jason'], assigneeNames: ['Jason'] }),
      ],
    });
    expect(screen.queryByText('Finished irrigation check')).toBeNull();
    expect(screen.getByTestId('mobile-crew-status-open').getAttribute('aria-selected')).toBe('true');
  });

  it('keeps worker views personal and does not offer team-only add controls', () => {
    const today = localAucklandDateKey();
    renderAgenda({
      canManageTeam: false,
      currentView: 'mine',
      tasks: [
        task({ id: 'mine-task', task: 'Tom checks the gate', calendarStart: today, assigneeIds: ['tom'], assigneeNames: ['Tom'] }),
        task({ id: 'other-task', task: 'Jason checks the pump', calendarStart: today, assigneeIds: ['jason'], assigneeNames: ['Jason'] }),
      ],
    });

    expect(screen.getByText('Tom checks the gate')).toBeTruthy();
    expect(screen.queryByText('Jason checks the pump')).toBeNull();
    expect(screen.queryByTestId('mobile-crew-view-team')).toBeNull();
    expect(screen.queryByTestId(`mobile-crew-add-task-${today}`)).toBeNull();
  });

  it('saves completion locally and opens the full editor explicitly', async () => {
    const today = localAucklandDateKey();
    const result = renderAgenda({
      tasks: [task({ id: 'complete-me', task: 'Check water troughs', calendarStart: today, assigneeIds: ['tom'], assigneeNames: ['Tom'] })],
    });

    fireEvent.click(screen.getByTestId('mobile-crew-task-complete-me-complete-action'));
    await waitFor(() => expect(result.onSaveTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'complete-me' }),
      expect.objectContaining({ task: 'Check water troughs', done: true }),
    ));

    fireEvent.click(screen.getByTestId('mobile-crew-task-complete-me-edit'));
    expect(result.onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'complete-me' }));
  });

  it('reopens completed work from the same phone action used to complete it', async () => {
    const today = localAucklandDateKey();
    const result = renderAgenda({
      tasks: [task({ id: 'reopen-me', task: 'Reopen irrigation check', done: true, calendarStart: today, assigneeIds: ['tom'], assigneeNames: ['Tom'] })],
    });

    fireEvent.click(screen.getByTestId('mobile-crew-task-reopen-me-complete-action'));

    await waitFor(() => expect(result.onSaveTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'reopen-me', done: true }),
      expect.objectContaining({ task: 'Reopen irrigation check', done: false }),
    ));
  });

  it('exposes failed sync recovery and refresh controls on a phone', async () => {
    const today = localAucklandDateKey();
    const onRetryMutation = vi.fn().mockResolvedValue(undefined);
    const onDiscardMutation = vi.fn().mockResolvedValue(undefined);
    render(
      <MobileCrewAgenda
        tasks={[task({ id: 'failed-task', task: 'Retry this task', calendarStart: today })]}
        workers={[]}
        currentUserId="owner-a"
        canManageTeam
        visibleDateKeys={[today]}
        currentStartDate={today}
        syncState="error"
        pendingCount={1}
        retryState="failed"
        currentView="team"
        currentStatusFilter="open"
        onViewChange={vi.fn()}
        onStatusFilterChange={vi.fn()}
        onDateChange={vi.fn()}
        onRefresh={vi.fn()}
        onAddTask={vi.fn()}
        onOpenTask={vi.fn()}
        onSaveTask={vi.fn()}
        onRetryMutation={onRetryMutation}
        onDiscardMutation={onDiscardMutation}
        failedMutations={[{ id: 'mutation-1', kind: 'update', taskId: 'failed-task', attempts: 2, lastError: 'Needs attention', task: task({ id: 'failed-task', task: 'Retry this task' }) }]}
      />,
    );

    expect(screen.getByTestId('mobile-crew-failed-changes')).toBeTruthy();
    fireEvent.click(screen.getByTestId('mobile-crew-retry-change-mutation-1'));
    await waitFor(() => expect(onRetryMutation).toHaveBeenCalledWith('mutation-1'));
    fireEvent.click(screen.getByTestId('mobile-crew-discard-change-mutation-1'));
    await waitFor(() => expect(onDiscardMutation).toHaveBeenCalledWith('mutation-1'));
    expect(screen.getByTestId('mobile-crew-refresh')).toBeTruthy();
  });

  it('restores failed delete recovery after a phone agenda remount', () => {
    const today = localAucklandDateKey();
    const deletedTask = task({
      id: 'failed-delete-task',
      task: 'Clear old fencing',
      calendarStart: today,
    });
    const failedDelete = {
      id: 'failed-delete-operation',
      kind: 'delete' as const,
      taskId: deletedTask.id,
      attempts: 1,
      lastError: 'Needs attention',
      task: deletedTask,
    };
    const onRetryMutation = vi.fn().mockResolvedValue(undefined);
    const onDiscardMutation = vi.fn().mockResolvedValue(undefined);
    const renderRemountedAgenda = () => render(
      <MobileCrewAgenda
        tasks={[]}
        workers={[]}
        currentUserId="owner-a"
        canManageTeam
        visibleDateKeys={[today]}
        currentStartDate={today}
        syncState="error"
        pendingCount={1}
        retryState="failed"
        currentView="team"
        currentStatusFilter="open"
        onViewChange={vi.fn()}
        onStatusFilterChange={vi.fn()}
        onDateChange={vi.fn()}
        onRefresh={vi.fn()}
        onAddTask={vi.fn()}
        onOpenTask={vi.fn()}
        onSaveTask={vi.fn()}
        onRetryMutation={onRetryMutation}
        onDiscardMutation={onDiscardMutation}
        failedMutations={[failedDelete]}
      />,
    );

    const firstView = renderRemountedAgenda();
    firstView.unmount();
    renderRemountedAgenda();

    expect(screen.queryByTestId('mobile-crew-task-failed-delete-task')).toBeNull();
    expect(screen.getByText('Clear old fencing')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Discard local change' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps the date range navigation explicit', () => {
    const result = renderAgenda();
    fireEvent.click(screen.getByTestId('mobile-crew-previous'));
    fireEvent.click(screen.getByTestId('mobile-crew-previous'));
    expect(result.onDateChange).toHaveBeenNthCalledWith(1, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(result.onDateChange).toHaveBeenNthCalledWith(2, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    fireEvent.click(screen.getByTestId('mobile-crew-next'));
    expect(result.onDateChange).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    fireEvent.click(screen.getByTestId('mobile-crew-today'));
    expect(result.onDateChange).toHaveBeenLastCalledWith(result.today);
    expect(within(screen.getByTestId('mobile-crew-date-controls')).getByRole('button', { name: 'Previous 7 days' })).toBeTruthy();
  });

  it('keeps phone controls touch-sized without introducing horizontal scrolling', () => {
    const today = localAucklandDateKey();
    renderAgenda({
      tasks: [task({ id: 'phone-targets', task: 'Phone target task', calendarStart: today, assigneeIds: ['tom'], assigneeNames: ['Tom'] })],
    });

    const agenda = screen.getByTestId('mobile-crew-agenda');
    expect(agenda.className).not.toContain('overflow-x');
    expect(Array.from(agenda.querySelectorAll<HTMLElement>('[class*="overflow-x"]'))).toHaveLength(0);
    expect(screen.getByTestId('mobile-crew-refresh').className).toContain('size-11');
    expect(screen.getByTestId('mobile-crew-previous').className).toContain('min-h-11');
    expect(screen.getByTestId('mobile-crew-today').className).toContain('min-h-11');
    expect(screen.getByTestId('mobile-crew-next').className).toContain('min-h-11');
    expect(screen.getByTestId('mobile-crew-task-phone-targets-complete-action').className).toContain('min-h-11');
    expect(screen.getByTestId('mobile-crew-task-phone-targets-edit').className).toContain('min-h-11');
  });
});