import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const pendingMembers = new Map<string, (member: {
    clerkId: string;
    role: string;
    isManager: boolean;
    isHarnold: boolean;
  }) => void>();

  return {
    auth: {
      isLoaded: true,
      isSignedIn: true,
      userId: 'owner-a',
    },
    pendingMembers,
    api: vi.fn(async (path: string) => {
      if (path === '/api/me') {
        if (state.auth.userId === 'owner-a') {
          return { clerkId: 'owner-a', role: 'master', isManager: false, isHarnold: true };
        }

        return await new Promise((resolve) => {
          state.pendingMembers.set(state.auth.userId, resolve);
        });
      }

      if (path === '/api/team') {
        return [{
          clerkId: state.auth.userId === 'owner-a' ? 'worker-a' : 'worker-b',
          displayName: state.auth.userId === 'owner-a' ? 'Aroha' : 'Matiu',
          status: 'active',
        }];
      }

      return undefined;
    }),
  };
});

vi.mock('@clerk/react', () => ({
  useAuth: () => state.auth,
  useClerk: () => ({ session: { touch: vi.fn() }, openSignIn: vi.fn() }),
}));

vi.mock('@workspace/api-client-react', () => {
  const queryResult = (data: unknown = undefined) => ({
    data,
    error: null,
    isError: false,
    isFetching: false,
    isLoading: false,
    isSuccess: data !== undefined,
    refetch: vi.fn(),
  });
  const mutationResult = () => ({
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
  });

  return {
    customFetch: state.api,
    getGetDailyPlanSettingsQueryKey: () => ['/api/daily-plan/settings'],
    getGetFarmSettingsQueryKey: () => ['/api/farm-settings'],
    getGetFarmTaskSummaryQueryKey: () => ['/api/tasks/summary'],
    getGetTodaysDailyPlanQueryKey: () => ['/api/daily-plan/today'],
    getListAssistantProposalsQueryKey: () => ['/api/assistant/proposals'],
    getListFarmTasksQueryKey: () => ['/api/tasks'],
    getListPendingFarmTasksQueryKey: () => ['/api/tasks/pending'],
    useApproveAssistantProposalTask: mutationResult,
    useApproveFarmTask: mutationResult,
    useCompleteFarmAttachmentUpload: mutationResult,
    useGetDailyPlanSettings: () => queryResult(),
    useGetFarmSettings: () => queryResult({ groups: [], locations: [] }),
    useGetTodaysDailyPlan: () => queryResult(),
    useListAssistantProposals: () => queryResult([]),
    useListPendingFarmTasks: () => queryResult({ tasks: [] }),
    useRefreshDailyPlan: mutationResult,
    useRejectAssistantProposal: mutationResult,
    useRejectAssistantProposalTask: mutationResult,
    useRejectFarmTask: mutationResult,
    useRequestFarmAttachmentUpload: mutationResult,
    useUpdateDailyPlanSettings: mutationResult,
  };
});

vi.mock('@/components/farm-planner', () => {
  const passthrough = ({ children }: { children?: ReactNode }) => children ?? null;
  const empty = () => null;

  return {
    ConflictNotice: empty,
    EmptyState: empty,
    ErrorState: empty,
    PageHeader: empty,
    PlannerShell: passthrough,
    RetryPendingChangesButton: empty,
    SourcePill: empty,
    SyncNotice: empty,
    TaskCard: empty,
    TaskDetailsDialog: empty,
    TaskSkeleton: empty,
    UrgencyPill: empty,
  };
});

vi.mock('@/components/task-form-dialog', () => ({
  TaskFormDialog: ({
    workers = [],
    canAssign = false,
  }: {
    workers?: Array<{ displayName: string }>;
    canAssign?: boolean;
  }) => createElement(
    'div',
    { 'data-testid': 'planner-account-state' },
    `${canAssign ? 'owner' : 'member'}:${workers.map((worker) => worker.displayName).join(',')}`,
  ),
}));

vi.mock('@/components/compact-task-create', () => ({
  CompactTaskCreate: () => null,
}));

vi.mock('@/components/monthly-overview', () => ({
  MonthlyOverview: () => null,
}));

vi.mock('@/components/print-planner', () => ({
  PrintPlanner: () => null,
}));

vi.mock('@/lib/farm-attachment-upload', () => ({
  attachmentErrorMessage: () => 'attachment error',
  uploadFarmAttachment: vi.fn(),
}));

vi.mock('@/lib/offline-fieldbook', () => ({
  defaultTaskViewPreferences: () => ({
    search: '',
    urgency: 'All',
    view: 'open',
    groupFilter: 'All groups',
    monthFilter: 'all',
    calendarScope: 'month',
    weekStart: '2026-08-24',
    assigneeFilter: 'All',
    locationFilter: 'All',
    sourceFilter: 'All',
    overdueFilter: false,
    sort: 'priority',
  }),
  normalizeTaskViewPreferences: (preferences: unknown) => preferences,
  readTaskViewPreferences: async () => ({
    search: '',
    urgency: 'All',
    view: 'open',
    groupFilter: 'All groups',
    monthFilter: 'all',
    calendarScope: 'month',
    weekStart: '2026-08-24',
    assigneeFilter: 'All',
    locationFilter: 'All',
    sourceFilter: 'All',
    overdueFilter: false,
    sort: 'priority',
  }),
  useOfflineFieldbook: () => ({
    authRequired: false,
    conflicts: [],
    failedMutations: [],
    hydrated: true,
    online: true,
    pendingCount: 0,
    readyForScope: true,
    retrying: false,
    serverChecked: true,
    source: 'Google Sheets',
    sourceUrl: '',
    syncing: false,
    syncError: '',
    tasks: [],
    ensureTaskSynced: vi.fn(),
    refresh: vi.fn(),
    removeTask: vi.fn(),
    resolveConflict: vi.fn(),
    retryPendingChanges: vi.fn(async () => ({ pendingCount: 0 })),
    saveTask: vi.fn(),
    syncNow: vi.fn(),
  }),
  writeTaskViewPreferences: async () => undefined,
}));

vi.mock('wouter', () => ({
  Link: ({ children }: { children?: ReactNode }) => children ?? null,
  useLocation: () => ['/tasks', vi.fn()],
  useSearch: () => '',
}));

vi.mock('@radix-ui/react-collapsible', () => {
  const passthrough = ({ children }: { children?: ReactNode }) => children ?? null;
  return { Content: passthrough, Root: passthrough, Trigger: passthrough };
});

import HomePage from './home';
import TasksPage from './tasks';
import WeekPage from './week';

function renderPlannerPages() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <HomePage />
      <TasksPage />
      <WeekPage />
    </QueryClientProvider>,
  );

  return { queryClient, view };
}

beforeEach(() => {
  state.auth.userId = 'owner-a';
  state.api.mockClear();
  state.pendingMembers.clear();
});

afterEach(cleanup);

describe('planner account-scoped member and worker queries', () => {
  it('reuses one member and one owner team request across Today, Tasks, and Weekly Route', async () => {
    renderPlannerPages();

    await waitFor(() => {
      expect(screen.getAllByTestId('planner-account-state').every((element) => element.textContent === 'owner:Aroha')).toBe(true);
    });

    expect(screen.getAllByTestId('planner-account-state')).toHaveLength(2);
    expect(state.api.mock.calls.filter(([path]) => path === '/api/me')).toHaveLength(1);
    expect(state.api.mock.calls.filter(([path]) => path === '/api/team')).toHaveLength(1);
  });

  it('clears the previous member and worker roster while a changed account is resolving', async () => {
    const { queryClient, view } = renderPlannerPages();

    await waitFor(() => expect(screen.getAllByText('Aroha')).toHaveLength(1));

    await act(async () => {
      state.auth.userId = 'owner-b';
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <HomePage />
          <TasksPage />
          <WeekPage />
        </QueryClientProvider>,
      );
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('planner-account-state').every((element) => element.textContent === 'member:')).toBe(true);
    });
    expect(screen.queryByText('Aroha')).toBeNull();
    expect(state.api.mock.calls.filter(([path]) => path === '/api/team')).toHaveLength(1);

    await act(async () => {
      state.pendingMembers.get('owner-b')?.({
        clerkId: 'owner-b',
        role: 'master',
        isManager: false,
        isHarnold: true,
      });
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('planner-account-state').every((element) => element.textContent === 'owner:Matiu')).toBe(true);
    });
    expect(state.api.mock.calls.filter(([path]) => path === '/api/me')).toHaveLength(2);
    expect(state.api.mock.calls.filter(([path]) => path === '/api/team')).toHaveLength(2);
  });
});
