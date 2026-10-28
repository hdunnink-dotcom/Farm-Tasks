import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FarmTask } from '@workspace/api-client-react';
import { localAucklandDateKey } from '@/lib/task-calendar';

const state = vi.hoisted(() => ({
  location: '/crew-plan',
  setLocation: vi.fn(),
  me: { clerkId: 'owner-a', role: 'master', isHarnold: true },
  workers: [
    { clerkId: 'tom', displayName: 'Tom', status: 'active' },
    { clerkId: 'jason', displayName: 'Jason', status: 'active' },
  ],
  tasks: [] as FarmTask[],
  saveTask: vi.fn(),
  removeTask: vi.fn(),
  failedMutations: [] as Array<{
    id: string;
    kind: 'create' | 'update' | 'delete';
    taskId: string;
    attempts: number;
    lastError?: string;
    task?: FarmTask;
  }>,
  retryMutation: vi.fn(),
  discardMutation: vi.fn(),
  weather: {
    data: undefined as unknown,
    isLoading: true,
    isFetching: true,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  readyForScope: true,
}));

vi.mock('wouter', () => ({
  useLocation: () => [state.location, state.setLocation],
}));

vi.mock('@/hooks/use-me', () => ({
  useMe: () => ({
    data: state.me,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/use-workers', () => ({
  useWorkers: () => ({
    data: state.workers,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/lib/offline-fieldbook', () => ({
   useOfflineFieldbook: () => ({
    tasks: state.tasks,
    saveTask: state.saveTask,
    removeTask: state.removeTask,
    syncing: false,
    retrying: false,
    pendingCount: 0,
    failedMutations: state.failedMutations,
    conflicts: [],
    resolveConflict: vi.fn(),
    retryMutation: state.retryMutation,
    discardMutation: state.discardMutation,
     readyForScope: state.readyForScope,
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => state.weather,
  useMutation: () => ({
    error: null,
    isPending: false,
    mutate: vi.fn(),
  }),
  useQueryClient: () => ({ setQueryData: vi.fn() }),
}));

vi.mock('@workspace/api-client-react', () => ({
  customFetch: vi.fn(),
}));

vi.mock('@/components/farm-planner', () => ({
  PlannerShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  ConflictNotice: () => null,
  ErrorState: ({ message }: { message?: string }) => <p role="alert">{message}</p>,
  SyncNotice: () => null,
  UrgencyPill: ({ urgency }: { urgency: string }) => <span data-testid={`status-urgency-${urgency.toLowerCase()}`}>{urgency}</span>,
}));

import CrewPlanPage, { shiftDateKey } from './crew-plan';

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

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

function dataTransfer(data: string) {
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    setData: vi.fn(),
    getData: vi.fn(() => data),
  };
}

function openTaskOptions(taskTitle: string) {
  const options = screen.getByRole('button', { name: `Options for ${taskTitle}` });
  fireEvent.pointerDown(options, { button: 0 });
  fireEvent.click(options);
}

beforeEach(() => {
  state.location = '/crew-plan';
  state.setLocation.mockReset();
  state.me = { clerkId: 'owner-a', role: 'master', isHarnold: true };
  window.history.replaceState({}, '', '/crew-plan');
  state.tasks = [
    task({
      id: 'move-task',
      task: 'Move irrigation supplies',
      calendarStart: localAucklandDateKey(),
      assigneeId: 'tom',
      assigneeName: 'Tom',
      assigneeIds: ['tom'],
      assigneeNames: ['Tom'],
    }),
    task({
      id: 'edit-task',
      task: 'Edit orchard notes',
      calendarStart: localAucklandDateKey(),
      assigneeId: 'jason',
      assigneeName: 'Jason',
      assigneeIds: ['jason'],
      assigneeNames: ['Jason'],
    }),
    task({
      id: 'complete-task',
      task: 'Check water troughs',
      calendarStart: localAucklandDateKey(),
      assigneeId: 'tom',
      assigneeName: 'Tom',
      assigneeIds: ['tom'],
      assigneeNames: ['Tom'],
    }),
    task({
      id: 'completed-history',
      task: 'Finished winter pruning',
      done: true,
      calendarStart: shiftDateKey(localAucklandDateKey(), -14),
      assigneeId: 'jason',
      assigneeName: 'Jason',
      assigneeIds: ['jason'],
      assigneeNames: ['Jason'],
    }),
    task({
      id: 'delete-task',
      task: 'Clear old fencing',
      calendarStart: '',
    }),
  ];
  state.saveTask.mockReset();
  state.saveTask.mockResolvedValue(task({ id: 'saved-task' }));
  state.removeTask.mockReset();
  state.removeTask.mockResolvedValue(undefined);
  state.failedMutations = [];
  state.retryMutation.mockReset();
  state.retryMutation.mockResolvedValue(undefined);
  state.discardMutation.mockReset();
  state.discardMutation.mockResolvedValue(undefined);
  state.weather.data = undefined;
  state.weather.isLoading = true;
  state.weather.isFetching = true;
  state.weather.error = null;
  state.weather.refetch.mockReset();
  state.readyForScope = true;
  setViewport(1440);
});

afterEach(cleanup);

describe('authenticated /crew-plan browser smoke path', () => {
  it('keeps manager work visible with assignments, priority, overdue, completed, and sync recovery states', () => {
    const today = localAucklandDateKey();
    state.tasks = [
      task({
        id: 'priority-task',
        task: 'Urgent pump inspection',
        urgency: 'Urgent',
        calendarStart: today,
        assigneeIds: ['tom'],
        assigneeNames: ['Tom'],
      }),
      task({
        id: 'unassigned-task',
        task: 'Assign the windfall sorting',
        calendarStart: today,
      }),
      task({
        id: 'completed-manager-task',
        task: 'Completed manager handoff',
        done: true,
        calendarStart: today,
        assigneeIds: ['jason'],
        assigneeNames: ['Jason'],
      }),
      task({
        id: 'overdue-task',
        task: 'Overdue fence repair',
        urgency: 'High',
        calendarStart: shiftDateKey(today, -1),
        assigneeIds: ['jason'],
        assigneeNames: ['Jason'],
      }),
    ];
    state.failedMutations = [{
      id: 'failed-update-operation',
      kind: 'update',
      taskId: 'priority-task',
      attempts: 2,
      lastError: 'Sheet is temporarily unavailable',
      task: state.tasks[0],
    }];

    render(<CrewPlanPage />);

    const board = screen.getByTestId('crew-plan-grid-scroll');
    expect(screen.getAllByText('Tom').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Jason').length).toBeGreaterThan(0);
    expect(screen.getByText('Unassigned/Open work')).toBeTruthy();
    expect(within(board).getByTestId('status-urgency-urgent')).toBeTruthy();
    expect(within(board).getByTestId('board-task-unassigned-task')).toBeTruthy();
    expect(within(board).getByTestId('board-task-completed-manager-task')).toBeTruthy();
    expect(screen.getByTestId('crew-task-list-item-overdue-task')).toBeTruthy();

    expect(within(board).getByRole('heading', { name: 'Changes needing attention' })).toBeTruthy();
    expect(within(board).getByText(/Sheet is temporarily unavailable/)).toBeTruthy();
    expect(within(board).getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(within(board).getByRole('button', { name: 'Discard local change' })).toBeTruthy();
    expect(within(board).getByRole('button', { name: 'Edit task' })).toBeTruthy();
  });

  it('keeps the desktop board usable through planning, editing, completion, and deletion', async () => {
    const view = render(<CrewPlanPage />);
    const today = localAucklandDateKey();
    const tomorrow = new Date(`${today}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowKey = tomorrow.toISOString().slice(0, 10);

    expect(window.location.pathname).toBe('/crew-plan');
    expect(screen.getByRole('heading', { name: '30-Day Board' })).toBeTruthy();
    expect(screen.getByTestId('crew-plan-grid-scroll')).toBeTruthy();
    expect(screen.getByTestId('crew-weather-loading')).toBeTruthy();

    const range = screen.getByTestId('desktop-crew-date-range');
    expect(range?.textContent).toBeTruthy();
    const initialRange = range?.textContent;
    expect(screen.getByTestId('desktop-crew-status-all').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('board-task-completed-history')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    const completedHistory = screen.getByTestId('board-task-completed-history');
    expect(completedHistory.getAttribute('aria-label')).toBe('Completed task: Finished winter pruning');
    expect(within(completedHistory).getByRole('heading', { name: 'Finished winter pruning' }).className).toContain('line-through');
    fireEvent.click(screen.getByTestId('desktop-crew-status-open'));
    expect(screen.queryByTestId('board-task-completed-history')).toBeNull();
    fireEvent.click(screen.getByTestId('desktop-crew-status-all'));
    expect(screen.getByTestId('board-task-completed-history')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to today' }));
    expect(range?.textContent).toBe(initialRange);
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(range?.textContent).not.toBe(initialRange);
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(range?.textContent).toBe(initialRange);
    fireEvent.click(screen.getByRole('button', { name: 'Reset to today' }));

    state.weather.isLoading = false;
    state.weather.isFetching = false;
    state.weather.error = new Error('Weather forecast access has not been configured yet.');
    view.rerender(<CrewPlanPage />);
    expect(screen.getByTestId('crew-weather-unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry weather forecast' }));
    expect(state.weather.refetch).toHaveBeenCalledTimes(1);

    const moveCard = screen.getByTestId('board-task-move-task');
    const unassignedRow = screen.getByText('Unassigned/Open work').closest('tr');
    expect(unassignedRow).toBeTruthy();
    const dropTarget = within(unassignedRow!).getByRole('button', { name: `Add task for ${tomorrowKey}` }).parentElement;
    expect(dropTarget).toBeTruthy();
    const dragData = dataTransfer(JSON.stringify({ taskId: 'move-task' }));
    fireEvent.dragStart(moveCard, { dataTransfer: dragData });
    fireEvent.drop(dropTarget!, { dataTransfer: dragData });
    await waitFor(() => expect(state.saveTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'move-task' }),
      expect.objectContaining({ calendarStart: tomorrowKey, assigneeIds: [] }),
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Add Task' }));
    const quickAdd = screen.getByRole('dialog', { name: 'Quick add task' });
    fireEvent.change(within(quickAdd).getByLabelText('Task title'), { target: { value: 'Inspect new saplings' } });
    fireEvent.click(within(quickAdd).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.saveTask).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ task: 'Inspect new saplings' }),
    ));

    openTaskOptions('Edit orchard notes');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit full details' }));
    expect(state.setLocation).toHaveBeenCalledWith('/tasks?edit=edit-task');

    openTaskOptions('Check water troughs');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Mark complete' }));
    await waitFor(() => expect(state.saveTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'complete-task' }),
      { task: 'Check water troughs', done: true },
    ));

    openTaskOptions('Clear old fencing');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete Clear old fencing' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(state.removeTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Clear old fencing' }));
    await waitFor(() => expect(state.removeTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'delete-task', task: 'Clear old fencing' }),
    ));

    view.unmount();
  });

  it('shows deleted task recovery without offering an edit path after permanent rejection', async () => {
    const deletedTask = task({
      id: 'failed-delete-task',
      task: 'Clear old fencing',
      calendarStart: '',
    });
    state.tasks = [deletedTask];
    state.removeTask.mockImplementation(async (queuedTask: FarmTask) => {
      state.tasks = state.tasks.filter((taskRow) => taskRow.id !== queuedTask.id);
      state.failedMutations = [{
        id: 'failed-delete-operation',
        kind: 'delete',
        taskId: queuedTask.id,
        attempts: 1,
        lastError: 'Needs attention',
        task: queuedTask,
      }];
    });
    const view = render(<CrewPlanPage />);

    openTaskOptions('Clear old fencing');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete Clear old fencing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Clear old fencing' }));

    await waitFor(() => expect(state.removeTask).toHaveBeenCalledWith(deletedTask));
    view.unmount();
    const reloadedView = render(<CrewPlanPage />);

    const desktopBoard = screen.getByTestId('crew-plan-grid-scroll');
    expect(within(desktopBoard).getByRole('heading', { name: 'Changes needing attention' })).toBeTruthy();
    expect(within(desktopBoard).getByText('Clear old fencing')).toBeTruthy();
    expect(within(desktopBoard).queryByTestId('board-task-failed-delete-task')).toBeNull();
    expect((within(desktopBoard).getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(desktopBoard).getByRole('button', { name: 'Discard local change' }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(desktopBoard).queryByRole('button', { name: 'Edit task' })).toBeNull();
    expect(within(desktopBoard).queryByRole('link', { name: /edit task/i })).toBeNull();

    fireEvent.click(within(desktopBoard).getByRole('button', { name: 'Retry' }));
    fireEvent.click(within(desktopBoard).getByRole('button', { name: 'Discard local change' }));
    expect(state.retryMutation).toHaveBeenCalledWith('failed-delete-operation');
    expect(state.discardMutation).toHaveBeenCalledWith('failed-delete-operation');

    state.failedMutations = [];
    reloadedView.rerender(<CrewPlanPage />);
    expect(within(screen.getByTestId('crew-plan-grid-scroll')).queryByRole('heading', { name: 'Changes needing attention' })).toBeNull();
    expect(within(screen.getByTestId('crew-plan-grid-scroll')).queryByTestId('board-task-failed-delete-task')).toBeNull();

    reloadedView.unmount();
  });

  it.each([
    ['desktop', 1440],
    ['phone', 390],
  ])('keeps the %s board shell discoverable and scrollable at %s px', (_viewport, width) => {
    setViewport(width);
    render(<CrewPlanPage />);

    if (width < 1024) {
      expect(screen.getByTestId('mobile-crew-agenda')).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'The run sheet' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Previous 7 days' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Next 7 days' })).toBeTruthy();
      expect(screen.getByTestId('mobile-crew-date-controls')).toBeTruthy();
    } else {
      expect(screen.getByTestId('crew-plan-grid-scroll')).toBeTruthy();
      expect(screen.getByRole('heading', { name: '30-Day Board' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Previous week' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Next week' })).toBeTruthy();
      expect(screen.getByTestId('crew-plan-task-sidebar')).toBeTruthy();
    }
  });

  it('moves through earlier phone windows repeatedly and shows completed work by default', () => {
    setViewport(390);
    render(<CrewPlanPage />);

    const mobileAgenda = screen.getByTestId('mobile-crew-agenda');
    const dateControls = within(mobileAgenda).getByTestId('mobile-crew-date-controls');
    const initialRange = within(dateControls).getByTestId('mobile-crew-date-range').textContent;
    expect(within(mobileAgenda).getByTestId('mobile-crew-status-all').getAttribute('aria-selected')).toBe('true');

    fireEvent.click(within(mobileAgenda).getByTestId('mobile-crew-previous'));
    const firstPreviousRange = within(dateControls).getByTestId('mobile-crew-date-range').textContent;
    expect(firstPreviousRange).not.toBe(initialRange);

    fireEvent.click(within(mobileAgenda).getByTestId('mobile-crew-previous'));
    const secondPreviousRange = within(dateControls).getByTestId('mobile-crew-date-range').textContent;
    expect(secondPreviousRange).not.toBe(firstPreviousRange);
    expect(within(mobileAgenda).getByText('Finished winter pruning').className).toContain('line-through');

    fireEvent.click(within(mobileAgenda).getByTestId('mobile-crew-status-open'));
    expect(within(mobileAgenda).queryByText('Finished winter pruning')).toBeNull();
    fireEvent.click(within(mobileAgenda).getByTestId('mobile-crew-status-all'));
    expect(within(mobileAgenda).getByText('Finished winter pruning')).toBeTruthy();

    fireEvent.click(within(mobileAgenda).getByTestId('mobile-crew-today'));
    expect(within(dateControls).getByTestId('mobile-crew-date-range').textContent).toBe(initialRange);
  });

  it('keeps worker phone work private and removes manager-only team controls', () => {
    const today = localAucklandDateKey();
    state.me = { clerkId: 'tom', role: 'worker', isHarnold: false };
    state.tasks = [
      task({
        id: 'worker-task',
        task: 'Tom checks the gate',
        calendarStart: today,
        assigneeIds: ['tom'],
        assigneeNames: ['Tom'],
      }),
      task({
        id: 'teammate-task',
        task: 'Jason checks the pump',
        calendarStart: today,
        assigneeIds: ['jason'],
        assigneeNames: ['Jason'],
      }),
    ];
    setViewport(390);
    render(<CrewPlanPage />);

    const agenda = screen.getByTestId('mobile-crew-agenda');
    expect(within(agenda).getByText('Tom checks the gate')).toBeTruthy();
    expect(within(agenda).queryByText('Jason checks the pump')).toBeNull();
    expect(within(agenda).queryByTestId('mobile-crew-view-team')).toBeNull();
    expect(within(agenda).queryByTestId(`mobile-crew-add-task-${today}`)).toBeNull();
    expect(screen.queryByRole('heading', { name: '30-Day Board' })).toBeNull();
    expect(screen.getByText('Assignment changes are managed by your farm manager.')).toBeTruthy();
  });

  it('keeps hook order stable while the authenticated cache hydrates', () => {
    setViewport(390);
    state.readyForScope = false;
    const view = render(<CrewPlanPage />);

    expect(screen.queryByTestId('mobile-crew-agenda')).toBeNull();

    state.readyForScope = true;
    view.rerender(<CrewPlanPage />);

    expect(screen.getByTestId('mobile-crew-agenda')).toBeTruthy();
    view.unmount();
  });
});