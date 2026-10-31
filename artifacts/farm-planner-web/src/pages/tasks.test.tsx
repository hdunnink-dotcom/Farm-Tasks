import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  routeSearch: 'edit=task-a',
  setLocation: vi.fn(),
  defaults: {
    search: '',
    urgency: 'All',
    view: 'open',
    groupFilter: 'All groups',
    monthFilter: 'current',
    calendarScope: 'month',
    weekStart: '2026-08-24',
    assigneeFilter: 'All',
    locationFilter: 'All',
    sourceFilter: 'All',
    overdueFilter: false,
    sort: 'priority',
  },
  preferences: {
    search: '',
    urgency: 'All',
    view: 'open',
    groupFilter: 'All groups',
    monthFilter: 'current',
    calendarScope: 'month',
    weekStart: '2026-08-24',
    assigneeFilter: 'All',
    locationFilter: 'All',
    sourceFilter: 'All',
    overdueFilter: false,
    sort: 'priority',
  },
  query: {
    data: undefined as { tasks: Array<Record<string, unknown>>; source: string } | undefined,
    isSuccess: false,
    isError: false,
    isFetching: true,
    isLoading: true,
    refetch: vi.fn(),
  },
  offlineTasks: [] as Array<Record<string, unknown>>,
  serverChecked: false,
    settings: undefined as { groups: string[]; locations: string[] } | undefined,
}));

vi.mock('wouter', () => ({
  useLocation: () => ['/tasks', state.setLocation],
  useSearch: () => state.routeSearch,
}));

vi.mock('@/hooks/use-me', () => ({
  useMe: () => ({ data: { role: 'master', clerkId: 'owner-a' } }),
}));

vi.mock('@/hooks/use-workers', () => ({
  useWorkers: () => ({ data: [] }),
}));

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: 'owner-a' }),
  useClerk: () => ({ session: { touch: vi.fn() }, openSignIn: vi.fn() }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  }),
}));

vi.mock('@workspace/api-client-react', () => ({
  getGetFarmTaskSummaryQueryKey: () => ['/api/tasks/summary'],
  getGetFarmSettingsQueryKey: () => ['/api/farm-settings'],
  getListFarmTasksQueryKey: () => ['/api/tasks'],
  useListFarmTasks: () => state.query,
  useGetFarmSettings: () => ({ data: state.settings }),
  useRequestFarmAttachmentUpload: () => ({ mutateAsync: vi.fn() }),
  useCompleteFarmAttachmentUpload: () => ({ mutateAsync: vi.fn() }),
  customFetch: vi.fn(async (path: string) => path === '/api/me'
    ? { role: 'master', clerkId: 'owner-a' }
    : []),
}));

vi.mock('@/lib/offline-fieldbook', () => {
  return {
    defaultTaskViewPreferences: () => state.defaults,
    normalizeTaskViewPreferences: (value: typeof state.preferences) => value,
    readTaskViewPreferences: async () => state.preferences,
    writeTaskViewPreferences: async () => undefined,
    useOfflineFieldbook: () => ({
      readyForScope: true,
      online: true,
      hydrated: true,
      tasks: state.offlineTasks,
      pendingCount: 0,
      syncing: false,
      retrying: false,
      syncError: '',
      authRequired: false,
      serverChecked: state.serverChecked,
      source: 'Google Sheets',
      sourceUrl: 'https://docs.google.com/spreadsheets/d/test',
      failedMutations: [],
      conflicts: [],
      refresh: vi.fn(),
      refetch: vi.fn(),
      saveTask: vi.fn(),
      removeTask: vi.fn(),
      resolveConflict: vi.fn(),
    }),
  };
});

vi.mock('@/components/farm-planner', () => ({
  PlannerShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageHeader: () => <div />,
  ConflictNotice: () => null,
  EmptyState: () => null,
  ErrorState: () => null,
  SourcePill: () => null,
  SyncNotice: () => null,
      RetryPendingChangesButton: () => null,
  TaskCard: ({ task }: { task: { id: string; task: string } }) => <div data-testid={`task-card-${task.id}`}>{task.task}</div>,
  TaskSkeleton: () => <div data-testid="tasks-loading" />,
  UrgencyPill: () => null,
  TaskDetailsDialog: () => null,
}));

vi.mock('@/components/task-form-dialog', () => ({
  TaskFormDialog: ({ open, task }: { open: boolean; task?: { task?: string } }) => open
    ? <div data-testid="full-task-editor">{task?.task}</div>
    : null,
}));

vi.mock('@/components/compact-task-create', () => ({ CompactTaskCreate: () => null }));
vi.mock('@/components/print-planner', () => ({ PrintPlanner: () => null }));

import TasksPage, { resolveEditTaskHandoff } from './tasks';

afterEach(() => {
  cleanup();
  state.routeSearch = 'edit=task-a';
  state.setLocation.mockReset();
  state.preferences = { ...state.defaults };
  state.settings = undefined;
  state.query.data = undefined;
  state.query.isSuccess = false;
  state.query.isError = false;
  state.query.isFetching = true;
  state.query.isLoading = true;
  state.offlineTasks = [];
  state.serverChecked = false;
});

describe('task editor handoff', () => {
  it('waits for account-scoped tasks before resolving the selected task', () => {
    const tasks = [{ id: 'task-a', title: 'Prune row' }];

    expect(resolveEditTaskHandoff('task-a', [], false)).toBe('waiting');
    expect(resolveEditTaskHandoff('task-a', tasks, true)).toBe(tasks[0]);
  });

  it('navigates from an edit URL into the full editor after tasks finish loading', async () => {
    const view = render(<TasksPage />);
    await act(async () => undefined);

    expect(screen.queryByTestId('full-task-editor')).toBeNull();

    state.offlineTasks = [{
        id: 'task-a',
        task: 'Prune row',
        group: 'Orchards',
        done: false,
        urgency: 'Medium',
        month: '',
        location: '',
        notes: '',
        link: '',
        subtasks: [],
        attachments: [],
        source: 'Google Sheets',
        calendarEventId: '',
        calendarRecurringEventId: '',
        calendarStart: '2026-08-30',
        calendarUpdated: '',
        updatedAt: '2026-08-30T00:00:00.000Z',
        assigneeId: 'worker-a',
        assigneeName: 'Aroha',
        assigneeIds: ['worker-a'],
        assigneeNames: ['Aroha'],
      }];
    state.query.isSuccess = true;
    state.query.isFetching = false;
    state.query.isLoading = false;
    state.serverChecked = true;
    view.rerender(<TasksPage />);

    expect((await screen.findByTestId('full-task-editor')).textContent).toContain('Prune row');
    await waitFor(() => expect(state.setLocation).toHaveBeenCalledWith('/tasks', { replace: true }));
  });

  it('reports a missing task only after task data is ready', () => {
    expect(resolveEditTaskHandoff('missing-task', [], false)).toBe('waiting');
    expect(resolveEditTaskHandoff('missing-task', [], true)).toBeNull();
  });
});

describe('All Tasks search', () => {
  const task = (id: string, title: string, location: string, notes: string) => ({
    id,
    task: title,
    group: 'Orchards',
    done: false,
    urgency: 'Medium',
    month: '',
    location,
    notes,
    link: '',
    subtasks: [],
    attachments: [],
    source: 'Google Sheets',
    calendarEventId: '',
    calendarRecurringEventId: '',
    calendarStart: '2026-08-30',
    calendarUpdated: '',
    updatedAt: '2026-08-30T00:00:00.000Z',
    assigneeId: '',
    assigneeName: '',
    assigneeIds: [] as string[],
    assigneeNames: [] as string[],
  });

  function renderReadyTasks(taskRows = [
    task('task-a', 'Prune pear row', 'North orchard', 'Bring loppers'),
    task('task-b', 'Prepare audit papers', 'Office', 'BioGro checklist'),
  ]) {
    state.routeSearch = '';
    state.offlineTasks = taskRows;
    state.query.isSuccess = true;
    state.query.isFetching = false;
    state.query.isLoading = false;
    state.serverChecked = true;
    return render(<TasksPage />);
  }

  it('shows a labeled full-width search row above the filter criteria', async () => {
    renderReadyTasks();

    const searchInput = await screen.findByRole('searchbox', { name: 'Search all tasks' });
    const searchRow = screen.getByTestId('task-search-row');
    const filterCriteria = screen.getByTestId('task-filter-criteria');

    expect(searchRow.contains(searchInput)).toBe(true);
    expect(searchRow.compareDocumentPosition(filterCriteria) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(searchInput.className).toContain('min-h-12');
  });

  it('filters task results as search text is entered', async () => {
    renderReadyTasks();
    await screen.findByTestId('task-card-task-a');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search all tasks' }), { target: { value: 'biogro' } });

    expect(screen.queryByTestId('task-card-task-a')).toBeNull();
    expect(screen.getByTestId('task-card-task-b').textContent).toContain('Prepare audit papers');
  });

  it('shows only work nobody has been given when Unassigned is chosen', async () => {
    renderReadyTasks([
      task('task-a', 'Prune pear row', 'North orchard', ''),
      { ...task('task-b', 'Cut broom in paddock 75', 'Gully 2', ''), assigneeId: 'worker-j', assigneeName: 'Jason', assigneeIds: ['worker-j'], assigneeNames: ['Jason'] },
    ]);
    await screen.findByTestId('task-card-task-b');

    const select = screen.getByTestId('select-filter-assignee') as HTMLSelectElement;
    expect(Array.from(select.options, (option) => option.textContent)).toEqual(['All assignees', 'Unassigned', 'Jason']);
    fireEvent.change(select, { target: { value: '__unassigned__' } });

    expect(screen.getByTestId('task-card-task-a').textContent).toContain('Prune pear row');
    expect(screen.queryByTestId('task-card-task-b')).toBeNull();
  });

  it('keeps task filter options in the configured Farm Defaults order', async () => {
    state.settings = {
      groups: ['Planting', 'Orchards', 'Repair'],
      locations: ['South block', 'North block'],
    };
    renderReadyTasks([
      task('task-a', 'Prune pear row', 'South block', 'Bring loppers'),
      task('task-b', 'Prepare audit papers', 'North block', 'BioGro checklist'),
    ]);

    expect(Array.from((screen.getByTestId('select-filter-group') as HTMLSelectElement).options, (option) => option.value))
      .toEqual(['All groups', 'Planting', 'Orchards', 'Repair']);
    expect(Array.from((screen.getByTestId('select-filter-location') as HTMLSelectElement).options, (option) => option.value))
      .toEqual(['All', 'South block', 'North block']);
  });

  it('announces restored calendar and task view selections', async () => {
    state.preferences = {
      ...state.defaults,
      calendarScope: 'unscheduled',
      monthFilter: 'unscheduled',
      view: 'done',
    };
    renderReadyTasks();

    const unscheduledButton = screen.getByTestId('button-calendar-unscheduled');
    await waitFor(() => expect(unscheduledButton.getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByTestId('button-calendar-month').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('button-calendar-week').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('button-view-open').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('button-view-all').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('button-view-done').getAttribute('aria-pressed')).toBe('true');
  });
});
