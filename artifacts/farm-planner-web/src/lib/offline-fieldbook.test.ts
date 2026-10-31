import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listFarmTasks = vi.fn();
const createFarmTask = vi.fn();
const updateFarmTask = vi.fn();
const deleteFarmTask = vi.fn();

vi.mock('@workspace/api-client-react', () => ({
  createFarmTask,
  deleteFarmTask,
  getGetFarmTaskSummaryQueryKey: () => ['/api/tasks/summary'],
  getListFarmTasksQueryKey: ({ includeDone }: { includeDone: boolean }) => ['/api/tasks', { includeDone }],
  isAuthenticationError: (error: { status?: number }) => error?.status === 401,
  listFarmTasks,
  updateFarmTask,
}));

const FALLBACK_KEY = 'farm-planner-fieldbook:state:signed-out';

type TestTask = {
  id: string;
  task: string;
  group: string;
  done: boolean;
  urgency: 'Urgent' | 'High' | 'Medium' | 'Low';
  month: string;
  location: string;
  notes: string;
  link: string;
  subtasks: Array<{ id: string; label: string; done: boolean }>;
  updatedAt: string;
};

const task = (overrides: Partial<TestTask> = {}): TestTask => ({
  id: 'task-1',
  task: 'Check irrigation',
  group: 'Orchard',
  done: false,
  urgency: 'Medium',
  month: 'August',
  location: 'North field',
  notes: '',
  link: '',
  subtasks: [],
  updatedAt: '2026-08-20T10:00:00.000Z',
  ...overrides,
});

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: new QueryClient() }, children);
}

async function loadHook() {
  const { useOfflineFieldbook } = await import('./offline-fieldbook');
  const result = renderHook(() => useOfflineFieldbook(true), { wrapper });
  await waitFor(() => expect(result.result.current.hydrated).toBe(true));
  return result;
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

function storedState() {
  return JSON.parse(localStorage.getItem(FALLBACK_KEY) ?? '{}') as {
    tasks: TestTask[];
    mutations: Array<{ kind: string; taskId: string; task?: TestTask; data?: Record<string, unknown>; attempts: number; nextAttemptAt: number }>;
    conflicts: unknown[];
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  localStorage.clear();
  setOnline(false);
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
});

afterEach(() => {
  cleanup();
});

describe('useOfflineFieldbook', () => {
  it('keeps recurrence values in local tasks and queued create requests', async () => {
    const result = await loadHook();
    const created = await result.result.current.saveTask(undefined, {
      task: 'Quarterly water check',
      calendarStart: '2026-09-14',
      recurrence: 'quarterly',
    });
    expect(created).toEqual(expect.objectContaining({ recurrence: 'quarterly', repeatWeekly: false }));
    expect(storedState().mutations[0].data).toEqual(expect.objectContaining({ recurrence: 'quarterly' }));
  });

  it('loads a cached snapshot and pending edits while offline, including after reload', async () => {
    const first = await loadHook();
    const created = await first.result.current.saveTask(undefined, { task: 'Walk the west rows', group: 'Orchard' });
    await waitFor(() => expect(first.result.current.tasks).toHaveLength(1));
    expect(first.result.current.online).toBe(false);
    expect(first.result.current.tasks.map((item) => item.task)).toContain('Walk the west rows');
    expect(first.result.current.pendingCount).toBe(1);
    first.unmount();

    const second = await loadHook();
    expect(second.result.current.tasks[0].id).toBe(created.id);
    expect(second.result.current.pendingCount).toBe(1);
    expect(listFarmTasks).not.toHaveBeenCalled();
  });

  it('normalizes legacy mobile cache records before Crew Plan consumes them', async () => {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify({
      tasks: [{
        id: 'legacy-task',
        done: false,
        subtasks: [{ id: 'legacy-step', label: 'Check the old row', done: false }],
      }],
      mutations: [],
      conflicts: [],
    }));

    const result = await loadHook();

    expect(result.result.current.tasks).toEqual([
      expect.objectContaining({
        id: 'legacy-task',
        task: 'Untitled task',
        group: 'Orchards',
        urgency: 'Medium',
        month: '',
        calendarStart: '',
        assigneeIds: [],
        assigneeNames: [],
        subtasks: [{ id: 'legacy-step', title: 'Check the old row', done: false }],
      }),
    ]);
    expect(result.result.current.summary.total).toBe(1);
  });

  it('repairs and retries a stranded legacy edit with an empty recurrence value', async () => {
    const cached = task({ id: 'legacy-edit', task: 'Check the old row', updatedAt: '2026-09-07T00:00:00.000Z' });
    localStorage.setItem(FALLBACK_KEY, JSON.stringify({
      tasks: [{ ...cached, recurrence: '' }],
      mutations: [{
        id: 'legacy-mutation',
        kind: 'update',
        taskId: cached.id,
        data: { task: 'Check the repaired row', recurrence: '' },
        baseUpdatedAt: cached.updatedAt,
        createdAt: Date.now(),
        attempts: 1,
        nextAttemptAt: Number.MAX_SAFE_INTEGER,
        lastError: 'Needs attention',
      }],
      conflicts: [],
    }));
    listFarmTasks.mockResolvedValue({ tasks: [cached], source: 'Google Sheets' });
    updateFarmTask.mockImplementation(async (_taskId: string, input: { task: string; recurrence: string }) => {
      expect(input.recurrence).toBe('none');
      return task({ id: cached.id, task: input.task, updatedAt: '2026-09-07T00:01:00.000Z' });
    });

    const result = await loadHook();
    expect(result.result.current.failedMutations).toHaveLength(0);
    setOnline(true);
    window.dispatchEvent(new Event('online'));

    await waitFor(() => expect(result.result.current.pendingCount).toBe(0));
    await waitFor(() => expect(result.result.current.syncing).toBe(false));
    expect(updateFarmTask).toHaveBeenCalledTimes(1);
  });

  it('queues create, edit, completion, checklist, priority, and delete changes', async () => {
    const result = await loadHook();
    const created = await result.result.current.saveTask(undefined, { task: 'Prune trees', subtasks: [{ id: 'step-1', label: 'Sharpen shears', done: false }] });
    await waitFor(() => expect(result.result.current.tasks).toHaveLength(1));
    const current = result.result.current.tasks[0];
    await result.result.current.saveTask(current, { task: 'Prune trees carefully' });
    await result.result.current.saveTask({ ...current, task: 'Prune trees carefully' }, { task: 'Prune trees carefully', done: true });
    await result.result.current.saveTask({ ...current, task: 'Prune trees carefully', done: true }, { task: 'Prune trees carefully', subtasks: [{ id: 'step-1', label: 'Sharpen shears', done: true }] });
    await result.result.current.saveTask({ ...current, task: 'Prune trees carefully', done: true }, { task: 'Prune trees carefully', urgency: 'High' });
    await result.result.current.removeTask({ ...current, id: created.id, task: 'Prune trees carefully', done: true });

    expect(storedState().mutations.map((mutation) => mutation.kind)).toEqual([
      'create', 'update', 'update', 'update', 'update', 'delete',
    ]);
    expect(storedState().mutations.map((mutation) => mutation.taskId)).toEqual([
      created.id, created.id, created.id, created.id, created.id, created.id,
    ]);
    await waitFor(() => expect(result.result.current.tasks).toHaveLength(0));
  });

  it('replays pending changes in creation order and refreshes from the server', async () => {
    const result = await loadHook();
    await result.result.current.saveTask(undefined, { task: 'Stage compost' });
    await waitFor(() => expect(result.result.current.tasks).toHaveLength(1));
    const local = result.result.current.tasks[0];
    await result.result.current.saveTask(local, { task: 'Stage compost by gate' });

    listFarmTasks
      .mockResolvedValueOnce({ tasks: [] })
      .mockResolvedValueOnce({ tasks: [task({ id: local.id, task: 'Stage compost by gate', updatedAt: '2026-08-23T10:00:00.000Z' })] });
    createFarmTask.mockResolvedValue(task({ id: local.id, task: 'Stage compost', updatedAt: '2026-08-23T09:00:00.000Z' }));
    updateFarmTask.mockResolvedValue(task({ id: local.id, task: 'Stage compost by gate', updatedAt: '2026-08-23T10:00:00.000Z' }));
    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(result.result.current.pendingCount).toBe(0));

    expect(listFarmTasks.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(createFarmTask.mock.invocationCallOrder[0]).toBeLessThan(updateFarmTask.mock.invocationCallOrder[0]);
    expect(result.result.current.tasks[0].task).toBe('Stage compost by gate');

    setOnline(false);
    result.unmount();
    const reloaded = await loadHook();
    await waitFor(() => expect(reloaded.result.current.tasks[0]?.task).toBe('Stage compost by gate'));
  });

  it('does not let an in-flight refresh overwrite a newly queued task', async () => {
    let releaseInitial!: (value: { tasks: TestTask[] }) => void;
    listFarmTasks
      .mockImplementationOnce(() => new Promise((resolve) => { releaseInitial = resolve; }))
      .mockResolvedValue({ tasks: [] });
    createFarmTask.mockImplementation(async (input: { clientTaskId: string; task: string }) =>
      task({ id: input.clientTaskId, task: input.task }),
    );
    setOnline(true);

    const result = await loadHook();
    await waitFor(() => expect(listFarmTasks).toHaveBeenCalledTimes(1));
    const created = await result.result.current.saveTask(undefined, { task: 'Photograph north gate' });
    releaseInitial({ tasks: [] });

    await waitFor(() => expect(createFarmTask).toHaveBeenCalled());
    await waitFor(() => expect(result.result.current.pendingCount).toBe(0));
    expect(result.result.current.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.id, task: 'Photograph north gate' }),
    ]));
  });

  it('shares one account refresh across fieldbook hook instances', async () => {
    let releaseRefresh!: (value: { tasks: TestTask[]; source: string; sourceUrl: string }) => void;
    listFarmTasks.mockImplementationOnce(() => new Promise((resolve) => { releaseRefresh = resolve; }));
    setOnline(true);

    const { useOfflineFieldbook } = await import('./offline-fieldbook');
    const first = renderHook(() => useOfflineFieldbook(false, 'account-1'), { wrapper });
    await waitFor(() => expect(listFarmTasks).toHaveBeenCalledTimes(1));
    const second = renderHook(() => useOfflineFieldbook(true, 'account-1'), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listFarmTasks).toHaveBeenCalledTimes(1);

    releaseRefresh({
      tasks: [task()],
      source: 'Google Sheets',
      sourceUrl: 'https://example.com/fieldbook',
    });
    await waitFor(() => expect(second.result.current.tasks).toHaveLength(1));
    expect(first.result.current.tasks).toHaveLength(1);
    await waitFor(() => expect(second.result.current.source).toBe('Google Sheets'));

    first.unmount();
    second.unmount();
    const third = renderHook(() => useOfflineFieldbook(true, 'account-1'), { wrapper });
    await waitFor(() => expect(third.result.current.serverChecked).toBe(true));
    expect(listFarmTasks).toHaveBeenCalledTimes(1);

    listFarmTasks.mockResolvedValue({
      tasks: [task()],
      source: 'Google Sheets',
      sourceUrl: 'https://example.com/fieldbook',
    });
    await third.result.current.refresh();
    expect(listFarmTasks).toHaveBeenCalledTimes(2);
  });

  it('sends a save straight after a fresh sync and reads the list once afterwards', async () => {
    const serverTask = task({ updatedAt: '2026-08-20T10:00:00.000Z' });
    const savedTask = task({ urgency: 'High', updatedAt: '2026-08-20T10:05:00.000Z' });
    listFarmTasks.mockResolvedValue({ tasks: [serverTask], source: 'Google Sheets' });
    setOnline(true);
    const result = await loadHook();
    await waitFor(() => expect(result.result.current.serverChecked).toBe(true));
    await waitFor(() => expect(result.result.current.syncing).toBe(false));
    expect(listFarmTasks).toHaveBeenCalledTimes(1);

    listFarmTasks.mockResolvedValue({ tasks: [savedTask], source: 'Google Sheets' });
    updateFarmTask.mockResolvedValue(savedTask);
    await result.result.current.saveTask(result.result.current.tasks[0], { task: serverTask.task, urgency: 'High' });

    await waitFor(() => expect(result.result.current.pendingCount).toBe(0));
    await waitFor(() => expect(result.result.current.syncing).toBe(false));
    expect(updateFarmTask).toHaveBeenCalledTimes(1);
    expect(updateFarmTask.mock.calls[0][1]).toEqual(expect.objectContaining({ baseUpdatedAt: serverTask.updatedAt }));
    expect(listFarmTasks).toHaveBeenCalledTimes(2);
    expect(updateFarmTask.mock.invocationCallOrder[0]).toBeLessThan(listFarmTasks.mock.invocationCallOrder[1]);
    expect(result.result.current.tasks[0]).toEqual(expect.objectContaining({ urgency: 'High', updatedAt: savedTask.updatedAt }));
  });

  it('keeps a temporary failure queued with an attempt and retry time', async () => {
    const result = await loadHook();
    await result.result.current.saveTask(undefined, { task: 'Check frost cloth' });
    await waitFor(() => expect(result.result.current.tasks).toHaveLength(1));
    listFarmTasks.mockResolvedValue({ tasks: [] });
    createFarmTask.mockRejectedValue({ status: 503 });
    setOnline(true);
    window.dispatchEvent(new Event('online'));

    await waitFor(() => expect(result.result.current.retrying).toBe(true));
    expect(result.result.current.pendingCount).toBe(1);
    expect(result.result.current.tasks.map((item) => item.task)).toContain('Check frost cloth');
    expect(storedState().mutations[0].attempts).toBe(1);
    expect(storedState().mutations[0].nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it('pauses queued changes for an expired session without losing local work', async () => {
    const result = await loadHook();
    const created = await result.result.current.saveTask(undefined, { task: 'Record fallen fruit' });
    await waitFor(() => expect(result.result.current.tasks).toHaveLength(1));
    listFarmTasks.mockResolvedValue({ tasks: [] });
    createFarmTask.mockRejectedValue({ status: 401 });
    setOnline(true);
    window.dispatchEvent(new Event('online'));

    await waitFor(() => expect(result.result.current.authRequired).toBe(true));
    expect(result.result.current.pendingCount).toBe(1);
    expect(result.result.current.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.id, task: 'Record fallen fruit' }),
    ]));
    expect(storedState().mutations[0]).toEqual(expect.objectContaining({
      taskId: created.id,
      nextAttemptAt: Number.MAX_SAFE_INTEGER,
      lastError: 'Authentication required',
    }));

    createFarmTask.mockResolvedValue(task({ id: created.id, task: 'Record fallen fruit' }));
    const { notifyAuthRecovery } = await import('./offline-fieldbook');
    notifyAuthRecovery('signed-out');
    await waitFor(() => expect(result.result.current.pendingCount).toBe(0));
    await waitFor(() => expect(result.result.current.authRequired).toBe(false));
    expect(result.result.current.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.id, task: 'Record fallen fruit' }),
    ]));
  });

  it('retries a delayed change when the browser tab becomes visible again', async () => {
    const result = await loadHook();
    await result.result.current.saveTask(undefined, { task: 'Check frost cloth' });
    await waitFor(() => expect(result.result.current.tasks).toHaveLength(1));
    listFarmTasks.mockResolvedValue({ tasks: [] });
    createFarmTask.mockRejectedValueOnce({ status: 503 });
    setOnline(true);
    window.dispatchEvent(new Event('online'));

    await waitFor(() => expect(createFarmTask).toHaveBeenCalledTimes(1));
    expect(result.result.current.pendingCount).toBe(1);

    createFarmTask.mockResolvedValue(task({ id: storedState().mutations[0].taskId, task: 'Check frost cloth' }));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(result.result.current.pendingCount).toBe(0));
    expect(createFarmTask).toHaveBeenCalledTimes(2);
  });

  it('manually retries every queued change without deleting local work', async () => {
    const result = await loadHook();
    const created = await result.result.current.saveTask(undefined, { task: 'Repair the north gate' });
    await waitFor(() => expect(result.result.current.tasks).toHaveLength(1));
    listFarmTasks.mockResolvedValue({ tasks: [] });
    createFarmTask.mockRejectedValueOnce({ status: 503 });
    setOnline(true);
    window.dispatchEvent(new Event('online'));

    await waitFor(() => expect(createFarmTask).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.result.current.pendingCount).toBe(1));
    createFarmTask.mockResolvedValue(task({ id: created.id, task: 'Repair the north gate' }));

    const retry = await result.result.current.retryPendingChanges();

    expect(retry.pendingCount).toBe(0);
    expect(result.result.current.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.id, task: 'Repair the north gate' }),
    ]));
    expect(storedState().mutations).toHaveLength(0);
    expect(createFarmTask).toHaveBeenCalledTimes(2);
  });

  it('continues syncing independent changes when the first task has a temporary failure', async () => {
    const result = await loadHook();
    const blocked = await result.result.current.saveTask(undefined, { task: 'Blocked irrigation check' });
    await result.result.current.saveTask(undefined, { task: 'Open the south gate' });
    await result.result.current.saveTask(undefined, { task: 'Check the lambing paddock' });
    await waitFor(() => expect(result.result.current.pendingCount).toBe(3));

    listFarmTasks.mockResolvedValue({ tasks: [], source: 'Google Sheets' });
    createFarmTask.mockImplementation(async (input: { clientTaskId: string; task: string }) => {
      if (input.clientTaskId === blocked.id) throw { status: 503 };
      return task({ id: input.clientTaskId, task: input.task });
    });
    setOnline(true);
    window.dispatchEvent(new Event('online'));

    await waitFor(() => expect(createFarmTask).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.result.current.pendingCount).toBe(1));
    expect(storedState().mutations).toEqual([
      expect.objectContaining({ taskId: blocked.id, attempts: 1 }),
    ]);

    createFarmTask.mockResolvedValue(task({ id: blocked.id, task: 'Blocked irrigation check' }));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(result.result.current.pendingCount).toBe(0));
    expect(createFarmTask).toHaveBeenCalledTimes(4);
  });

  it('rebases queued edits after their local task is created on the server', async () => {
    const result = await loadHook();
    const created = await result.result.current.saveTask(undefined, { task: 'Inspect water tank' });
    const edited = await result.result.current.saveTask(created, { task: 'Inspect upper water tank' });
    await result.result.current.saveTask(edited, { task: 'Inspect upper water tank', done: true });
    await waitFor(() => expect(result.result.current.pendingCount).toBe(3));

    let serverTask = task({ id: created.id, task: 'Inspect water tank', updatedAt: '2026-09-07T01:00:00.000Z' });
    listFarmTasks.mockImplementation(async () => ({ tasks: serverTask ? [serverTask] : [], source: 'Google Sheets' }));
    createFarmTask.mockResolvedValue(serverTask);
    updateFarmTask
      .mockImplementationOnce(async (_taskId: string, input: { task: string; baseUpdatedAt?: string }) => {
        expect(input.baseUpdatedAt).toBe('2026-09-07T01:00:00.000Z');
        serverTask = task({ id: created.id, task: input.task, updatedAt: '2026-09-07T01:01:00.000Z' });
        return serverTask;
      })
      .mockImplementationOnce(async (_taskId: string, input: { task: string; done?: boolean; baseUpdatedAt?: string }) => {
        expect(input.baseUpdatedAt).toBe('2026-09-07T01:01:00.000Z');
        serverTask = task({ id: created.id, task: input.task, done: input.done, updatedAt: '2026-09-07T01:02:00.000Z' });
        return serverTask;
      });

    setOnline(true);
    window.dispatchEvent(new Event('online'));

    await waitFor(() => expect(result.result.current.pendingCount).toBe(0));
    expect(updateFarmTask).toHaveBeenCalledTimes(2);
    expect(result.result.current.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.id, task: 'Inspect upper water tank', done: true }),
    ]));
  });

  it('retries a due queued change when another view mounts during the freshness window', async () => {
    const first = await loadHook();
    await first.result.current.saveTask(undefined, { task: 'Check frost cloth' });
    await waitFor(() => expect(first.result.current.tasks).toHaveLength(1));
    listFarmTasks.mockResolvedValue({ tasks: [], source: 'Google Sheets' });
    createFarmTask.mockRejectedValueOnce({ status: 503 });
    setOnline(true);
    window.dispatchEvent(new Event('online'));

    await waitFor(() => expect(createFarmTask).toHaveBeenCalledTimes(1));
    const dueState = storedState();
    dueState.mutations[0].nextAttemptAt = 0;
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(dueState));
    first.unmount();

    createFarmTask.mockImplementation(async (input: { clientTaskId: string; task: string }) =>
      task({ id: input.clientTaskId, task: input.task }),
    );
    const second = await loadHook();

    await waitFor(() => expect(createFarmTask).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(second.result.current.pendingCount).toBe(0));
  });

  it('keeps a deleted task name available after a permanent delete failure and remount', async () => {
    const deleted = task({ id: 'deleted-task', task: 'Remove old pump shed' });
    localStorage.setItem(FALLBACK_KEY, JSON.stringify({ tasks: [deleted], mutations: [], conflicts: [] }));
    const first = await loadHook();

    await waitFor(() => expect(first.result.current.tasks).toHaveLength(1));
    await first.result.current.removeTask(deleted);
    await waitFor(() => expect(first.result.current.tasks).toHaveLength(0));

    listFarmTasks.mockResolvedValue({ tasks: [deleted] });
    deleteFarmTask.mockRejectedValue({ status: 400 });
    setOnline(true);
    window.dispatchEvent(new Event('online'));

    await waitFor(() => expect(first.result.current.failedMutations).toHaveLength(1));
    expect(first.result.current.failedMutations[0].task?.task).toBe('Remove old pump shed');
    expect(first.result.current.tasks).toHaveLength(0);
    expect(storedState().mutations[0].task?.task).toBe('Remove old pump shed');

    first.unmount();
    const second = await loadHook();

    await waitFor(() => expect(second.result.current.failedMutations).toHaveLength(1));
    const failed = second.result.current.failedMutations[0];
    expect(failed.kind).toBe('delete');
    expect(failed.task?.task).toBe('Remove old pump shed');
    expect(second.result.current.tasks).toHaveLength(0);

    deleteFarmTask.mockResolvedValue(undefined);
    listFarmTasks.mockResolvedValue({ tasks: [] });
    await second.result.current.retryMutation(failed.id);
    await waitFor(() => expect(second.result.current.failedMutations).toHaveLength(0));
    expect(second.result.current.tasks).toHaveLength(0);
  });

  it('refreshes delete recovery when another tab changes the account fieldbook state', async () => {
    const deleted = task({ id: 'cross-tab-delete', task: 'Remove old trellis' });
    const first = await loadHook();
    const failedState = {
      tasks: [],
      mutations: [{
        id: 'cross-tab-delete-operation',
        kind: 'delete',
        taskId: deleted.id,
        task: deleted,
        attempts: 1,
        nextAttemptAt: Number.MAX_SAFE_INTEGER,
        lastError: 'Needs attention',
        createdAt: Date.now(),
      }],
      conflicts: [],
    };
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(failedState));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'farm-planner-fieldbook:change:state:signed-out',
        newValue: 'external-delete-failure',
      }));
    });

    await waitFor(() => expect(first.result.current.failedMutations).toHaveLength(1));
    expect(first.result.current.failedMutations[0].task?.task).toBe('Remove old trellis');
    expect(first.result.current.tasks).toHaveLength(0);

    localStorage.setItem(FALLBACK_KEY, JSON.stringify({ tasks: [], mutations: [], conflicts: [] }));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'farm-planner-fieldbook:change:state:signed-out',
        newValue: 'external-delete-resolved',
      }));
    });

    await waitFor(() => expect(first.result.current.failedMutations).toHaveLength(0));
    expect(first.result.current.tasks).toHaveLength(0);
  });

  it('exposes permanent failures and can retry or discard them without touching other work', async () => {
    const result = await loadHook();
    const created = await result.result.current.saveTask(undefined, { task: 'Repair gate' });
    await result.result.current.saveTask(undefined, { task: 'Check trough' });
    listFarmTasks.mockResolvedValue({ tasks: [] });
    createFarmTask.mockRejectedValueOnce({ status: 400 });
    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(result.result.current.failedMutations).toHaveLength(1));
    const failed = result.result.current.failedMutations[0];
    expect(failed.kind).toBe('create');
    expect(failed.task?.task).toBe('Repair gate');

    await result.result.current.discardMutation(failed.id);
    await waitFor(() => expect(result.result.current.tasks.some((item) => item.id === created.id)).toBe(false));
    expect(result.result.current.tasks.map((item) => item.task)).toContain('Check trough');

    const retryable = await result.result.current.saveTask(undefined, { task: 'Repair pump', calendarStart: '2026-09-14' });
    createFarmTask.mockRejectedValueOnce({ status: 400 });
    await result.result.current.syncNow();
    await waitFor(() => expect(result.result.current.failedMutations.some((item) => item.taskId === retryable.id)).toBe(true));
    createFarmTask.mockResolvedValue(task({ id: retryable.id, task: 'Repair pump' }));
    await result.result.current.retryMutation(result.result.current.failedMutations.find((item) => item.taskId === retryable.id)!.id);
    await waitFor(() => expect(result.result.current.failedMutations.some((item) => item.taskId === retryable.id)).toBe(false));
    const retryCalls = createFarmTask.mock.calls
      .map(([input]) => input)
      .filter((input) => input.clientTaskId === retryable.id);
    expect(retryCalls).toHaveLength(2);
    expect(retryCalls).toEqual([
      expect.objectContaining({ calendarStart: '2026-09-14', clientTaskId: retryable.id }),
      expect.objectContaining({ calendarStart: '2026-09-14', clientTaskId: retryable.id }),
    ]);
  });

  it('isolates cached tasks between account scopes', async () => {
    const { useOfflineFieldbook } = await import('./offline-fieldbook');
    const first = renderHook(() => useOfflineFieldbook(true, 'owner-a'), { wrapper });
    await waitFor(() => expect(first.result.current.hydrated).toBe(true));
    await first.result.current.saveTask(undefined, { task: 'Private owner task' });
    await waitFor(() => expect(first.result.current.tasks).toHaveLength(1));
    first.unmount();

    const second = renderHook(() => useOfflineFieldbook(true, 'worker-b'), { wrapper });
    await waitFor(() => expect(second.result.current.hydrated).toBe(true));
    expect(second.result.current.tasks).toEqual([]);
    expect(second.result.current.pendingCount).toBe(0);
  });

  it('does not let a completed old-account sync overwrite the new account', async () => {
    const ownerTask = task({ id: 'owner-only', task: 'Owner private task' });
    localStorage.setItem('farm-planner-fieldbook:state:owner-a', JSON.stringify({
      tasks: [ownerTask], mutations: [], conflicts: [],
    }));
    let releaseOwner!: (value: { tasks: FarmTask[] }) => void;
    listFarmTasks
      .mockImplementationOnce(() => new Promise((resolve) => { releaseOwner = resolve; }))
      .mockResolvedValue({ tasks: [] });
    setOnline(true);
    const { useOfflineFieldbook } = await import('./offline-fieldbook');
    const result = renderHook(
      ({ scope }) => useOfflineFieldbook(true, scope),
      { wrapper, initialProps: { scope: 'owner-a' } },
    );
    await waitFor(() => expect(result.result.current.tasks[0]?.id).toBe('owner-only'));
    await waitFor(() => expect(listFarmTasks).toHaveBeenCalledTimes(1));

    result.rerender({ scope: 'worker-b' });
    expect(result.result.current.readyForScope).toBe(false);
    await waitFor(() => expect(result.result.current.tasks).toEqual([]));
    releaseOwner({ tasks: [ownerTask] });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(result.result.current.tasks).toEqual([]);
  });

  it('persists validated task view preferences independently for each account', async () => {
    const {
      defaultTaskViewPreferences,
      readTaskViewPreferences,
      writeTaskViewPreferences,
    } = await import('./offline-fieldbook');
    const ownerPreferences = {
      ...defaultTaskViewPreferences(),
      calendarScope: 'week' as const,
      weekStart: '2026-09-07',
      view: 'all' as const,
      sort: 'title' as const,
      locationFilter: 'North field',
    };
    const workerPreferences = {
      ...defaultTaskViewPreferences(),
      calendarScope: 'unscheduled' as const,
      monthFilter: 'unscheduled',
      sort: 'updated' as const,
    };

    await writeTaskViewPreferences('owner-a', ownerPreferences);
    await writeTaskViewPreferences('worker-b', workerPreferences);

    expect(await readTaskViewPreferences('owner-a')).toEqual(ownerPreferences);
    expect(await readTaskViewPreferences('worker-b')).toEqual(workerPreferences);
  });

  it('falls back safely when saved task view values are invalid or obsolete', async () => {
    const { defaultTaskViewPreferences, readTaskViewPreferences } = await import('./offline-fieldbook');
    localStorage.setItem('farm-planner-task-view-preferences:owner-a', JSON.stringify({
      calendarScope: 'quarter',
      monthFilter: '2026-99',
      weekStart: 'not-a-date',
      urgency: 'Critical',
      view: 'archived',
      sort: 'magic',
    }));

    expect(await readTaskViewPreferences('owner-a')).toEqual(defaultTaskViewPreferences());
  });

  it('preserves conflicts and resolves them with the server version or a local retry', async () => {
    const server = task({ task: 'Server wording', updatedAt: '2026-08-23T12:00:00.000Z' });
    localStorage.setItem(FALLBACK_KEY, JSON.stringify({ tasks: [server], mutations: [], conflicts: [] }));
    const result = await loadHook();
    const local = await result.result.current.saveTask(server, { task: 'Local wording' });
    await waitFor(() => expect(result.result.current.tasks[0].task).toBe('Local wording'));
    listFarmTasks.mockResolvedValue({ tasks: [server] });
    updateFarmTask.mockRejectedValue({ status: 409, data: { currentTask: server } });
    setOnline(true);
    window.dispatchEvent(new Event('online'));

    await waitFor(() => expect(result.result.current.conflicts).toHaveLength(1));
    const conflict = result.result.current.conflicts[0];
    expect(conflict.localTask.task).toBe(local.task);
    expect(conflict.serverTask.task).toBe('Server wording');
    await result.result.current.resolveConflict(conflict, 'server');
    await waitFor(() => expect(result.result.current.conflicts).toHaveLength(0));
    expect(result.result.current.tasks[0].task).toBe('Server wording');
    expect(result.result.current.pendingCount).toBe(0);

    const retryConflict = {
      ...conflict,
      id: 'conflict-2',
      localTask: { ...server, task: 'Keep my local wording' },
    };
    updateFarmTask.mockResolvedValue({ updatedAt: '2026-08-23T13:00:00.000Z' });
    await result.result.current.resolveConflict(retryConflict, 'local');
    await waitFor(() => expect(result.result.current.pendingCount).toBe(0));
    expect(updateFarmTask).toHaveBeenCalledWith(server.id, expect.objectContaining({ task: 'Local wording' }));
  });
});