import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  createFarmTask,
  deleteFarmTask,
  getGetFarmTaskSummaryQueryKey,
  getListFarmTasksQueryKey,
  isAuthenticationError,
  listFarmTasks,
  updateFarmTask,
  type FarmTask,
  type TaskInput,
  type TaskSummary,
} from '@workspace/api-client-react';
import { CURRENT_MONTH } from './task-month';
import { type CalendarScope, localWeekStart } from './task-calendar';
import { type TaskSort } from './task-sort';
import { trackEvent } from './analytics';

type MutationKind = 'create' | 'update' | 'delete';
type QueuedMutation = {
  id: string;
  kind: MutationKind;
  taskId: string;
  task?: FarmTask;
  data?: TaskInput;
  baseUpdatedAt?: string;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  /** Why the server refused the change, shown to the user. */
  serverMessage?: string;
};
const AUTH_REQUIRED_ERROR = 'Authentication required';

/** Plain-language reason for a change the server refused. */
function refusalMessage(error: unknown): string | undefined {
  const response = error as { status?: number; data?: { error?: unknown } };
  if (response?.status === 404) return 'This task no longer exists. Discard this change.';
  const message = typeof response?.data?.error === 'string' ? response.data.error.trim() : '';
  return message ? message.slice(0, 240) : undefined;
}

const AUTH_REQUIRED_MESSAGE = 'Your sign-in expired. Renew access to sync pending changes.';
export type FailedMutation = Pick<QueuedMutation, 'id' | 'kind' | 'taskId' | 'attempts' | 'lastError' | 'serverMessage'> & {
  task?: FarmTask;
};
export type FieldbookConflict = {
  id: string;
  taskId: string;
  localTask: FarmTask;
  serverTask: FarmTask;
  mutation: QueuedMutation;
  createdAt: number;
};
type PersistedState = {
  tasks: FarmTask[];
  mutations: QueuedMutation[];
  conflicts: FieldbookConflict[];
  confirmedCreates?: Record<string, number>;
};

export type TaskViewPreferences = {
  search: string;
  urgency: 'All' | 'Urgent' | 'Low' | 'Medium' | 'High';
  view: 'open' | 'all' | 'done';
  groupFilter: string;
  monthFilter: string;
  calendarScope: CalendarScope;
  weekStart: string;
  assigneeFilter: string;
  locationFilter: string;
  sourceFilter: string;
  overdueFilter: boolean;
  sort: TaskSort;
};

const DB_NAME = 'farm-planner-fieldbook';
const DB_VERSION = 1;
const TASK_VIEW_PREFERENCES_KEY = 'farm-planner-task-view-preferences';
const STATE_CHANGE_KEY_PREFIX = `${DB_NAME}:change:`;
const emptyState = (): PersistedState => ({ tasks: [], mutations: [], conflicts: [] });
const memoryStates = new Map<string, PersistedState>();
const stateTransactions = new Map<string, Promise<void>>();
const syncRuns = new Map<string, Promise<void>>();
const syncSnapshots = new Map<string, {
  source: { name?: string; url?: string };
  error: string;
  retrying: boolean;
  authRequired: boolean;
  checkedAt: number;
}>();
const AUTO_SYNC_FRESH_MS = 30_000;
const AUTO_RETRY_INTERVAL_MS = 5_000;
let dbPromise: Promise<IDBDatabase | null> | null = null;
let stateChangeChannel: BroadcastChannel | null | undefined;
const AUTH_RECOVERY_EVENT = 'farm-planner-auth-recovered';

/** Notify fieldbook queues that Clerk has successfully renewed a session. */
export function notifyAuthRecovery(userId?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(AUTH_RECOVERY_EVENT, { detail: { userId } }));
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function normalizeScheduledDates(value: unknown, calendarStart: unknown): string[] {
  const dates = Array.isArray(value) ? value.filter((item): item is string => /^\d{4}-\d{2}-\d{2}$/.test(item)) : [];
  const legacy = typeof calendarStart === 'string' && /^\d{4}-\d{2}-\d{2}/.test(calendarStart)
    ? calendarStart.slice(0, 10)
    : '';
  return Array.from(new Set([...dates, ...(legacy ? [legacy] : [])])).sort();
}

const recurrenceValues = new Set(['none', 'weekly', 'biweekly', 'every4weeks', 'monthly', 'quarterly', 'yearly']);

function normalizeQueuedTaskInput(value: unknown): { data?: TaskInput; repairedRecurrence: boolean } {
  if (!value || typeof value !== 'object') return { data: undefined, repairedRecurrence: false };
  const input = { ...(value as Record<string, unknown>) };
  input.scheduledDates = normalizeScheduledDates(input.scheduledDates, input.calendarStart);
  if (!Object.prototype.hasOwnProperty.call(input, 'recurrence')
    || recurrenceValues.has(input.recurrence as string)) {
    return { data: input as unknown as TaskInput, repairedRecurrence: false };
  }
  input.recurrence = input.repeatWeekly === true ? 'weekly' : 'none';
  input.repeatWeekly = input.recurrence === 'weekly';
  return { data: input as unknown as TaskInput, repairedRecurrence: true };
}

function normalizeCachedTask(value: unknown): FarmTask | null {
  if (!value || typeof value !== 'object') return null;
  const task = value as Partial<FarmTask> & Record<string, unknown>;
  const id = typeof task.id === 'string' ? task.id.trim() : '';
  if (!id) return null;

  const urgency = task.urgency === 'Urgent'
    || task.urgency === 'High'
    || task.urgency === 'Medium'
    || task.urgency === 'Low'
    ? task.urgency
    : 'Medium';
  const source = task.source === 'Google Calendar' ? task.source : 'Manual';
  const recurrence = task.recurrence === 'weekly'
    || task.recurrence === 'biweekly'
    || task.recurrence === 'every4weeks'
    || task.recurrence === 'monthly'
    || task.recurrence === 'quarterly'
    || task.recurrence === 'yearly'
    ? task.recurrence
    : task.repeatWeekly
      ? 'weekly'
      : 'none';
  const subtasks = Array.isArray(task.subtasks)
    ? task.subtasks.flatMap((value, index) => {
      if (!value || typeof value !== 'object') return [];
      const step = value as unknown as Record<string, unknown>;
      const title = typeof step.title === 'string'
        ? step.title
        : typeof step.label === 'string'
          ? step.label
          : '';
      if (!title.trim()) return [];
      return [{
        id: typeof step.id === 'string' && step.id ? step.id : `${id}-step-${index + 1}`,
        title,
        done: step.done === true,
      }];
    })
    : [];

  return {
    ...task,
    id,
    group: typeof task.group === 'string' ? task.group : 'Orchards',
    task: typeof task.task === 'string' && task.task.trim() ? task.task : 'Untitled task',
    done: task.done === true,
    urgency,
    month: typeof task.month === 'string' ? task.month : '',
    location: typeof task.location === 'string' ? task.location : '',
    notes: typeof task.notes === 'string' ? task.notes : '',
    link: typeof task.link === 'string' ? task.link : '',
    subtasks,
    attachments: Array.isArray(task.attachments) ? task.attachments : [],
    source,
    calendarEventId: typeof task.calendarEventId === 'string' ? task.calendarEventId : '',
    calendarRecurringEventId: typeof task.calendarRecurringEventId === 'string' ? task.calendarRecurringEventId : '',
    calendarStart: typeof task.calendarStart === 'string' ? task.calendarStart : '',
    scheduledDates: normalizeScheduledDates(task.scheduledDates, task.calendarStart),
    recurrence,
    repeatWeekly: recurrence === 'weekly',
    calendarUpdated: typeof task.calendarUpdated === 'string' ? task.calendarUpdated : '',
    updatedAt: typeof task.updatedAt === 'string' ? task.updatedAt : '',
    assigneeId: typeof task.assigneeId === 'string' ? task.assigneeId : '',
    assigneeName: typeof task.assigneeName === 'string' ? task.assigneeName : '',
    assigneeIds: normalizeStringArray(task.assigneeIds),
    assigneeNames: normalizeStringArray(task.assigneeNames),
  };
}

export function normalizePersistedState(value: unknown): PersistedState {
  if (!value || typeof value !== 'object') return emptyState();
  const state = value as Partial<PersistedState>;
  const tasks = Array.isArray(state.tasks)
    ? state.tasks.map(normalizeCachedTask).filter((task): task is FarmTask => task !== null)
    : [];
  const mutations = Array.isArray(state.mutations)
    ? state.mutations.filter((mutation): mutation is QueuedMutation => Boolean(mutation && typeof mutation === 'object'))
      .map((mutation) => {
        const task = normalizeCachedTask(mutation.task);
        const normalizedInput = normalizeQueuedTaskInput(mutation.data);
        const repairedFailure = normalizedInput.repairedRecurrence && mutation.lastError === 'Needs attention';
        return {
          ...mutation,
          data: normalizedInput.data,
          task: task ?? undefined,
          ...(repairedFailure ? { nextAttemptAt: 0, lastError: undefined } : {}),
        };
      })
    : [];
  const conflicts = Array.isArray(state.conflicts)
    ? state.conflicts.flatMap((conflict) => {
      if (!conflict || typeof conflict !== 'object') return [];
      const localTask = normalizeCachedTask(conflict.localTask);
      const serverTask = normalizeCachedTask(conflict.serverTask);
      if (!localTask || !serverTask || !conflict.mutation) return [];
      return [{ ...conflict, localTask, serverTask } as FieldbookConflict];
    })
    : [];
  const confirmedCreates = state.confirmedCreates && typeof state.confirmedCreates === 'object'
    ? Object.fromEntries(Object.entries(state.confirmedCreates)
      .filter((entry): entry is [string, number] => typeof entry[1] === 'number'))
    : undefined;
  return { tasks, mutations, conflicts, confirmedCreates };
}

function safeScope(scope: string): string {
  return scope.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180) || 'signed-out';
}

function stateKey(scope: string): string {
  return `state:${safeScope(scope)}`;
}

function fallbackKey(scope: string): string {
  return `${DB_NAME}:${stateKey(scope)}`;
}

function stateChangeKey(scope: string): string {
  return `${STATE_CHANGE_KEY_PREFIX}${stateKey(scope)}`;
}

function getStateChangeChannel(): BroadcastChannel | null {
  if (stateChangeChannel !== undefined) return stateChangeChannel;
  const BrowserBroadcastChannel = typeof window === 'undefined' ? undefined : window.BroadcastChannel;
  if (typeof BrowserBroadcastChannel !== 'function') {
    stateChangeChannel = null;
    return stateChangeChannel;
  }
  try {
    stateChangeChannel = new BrowserBroadcastChannel(`${DB_NAME}:changes`);
  } catch {
    stateChangeChannel = null;
  }
  return stateChangeChannel;
}

function notifyStateChange(scope: string): void {
  try {
    getStateChangeChannel()?.postMessage({ scope });
  } catch {
    // The storage event below remains available when the channel is closed.
  }
  try {
    // The storage event is the fallback for browsers without BroadcastChannel,
    // and also covers browser contexts that do not share the same channel.
    localStorage.setItem(stateChangeKey(scope), operationId());
  } catch {
    // State synchronization must not make a successful local write fail.
  }
}

export function defaultTaskViewPreferences(): TaskViewPreferences {
  return {
    search: '',
    urgency: 'All',
    view: 'open',
    groupFilter: 'All groups',
    monthFilter: CURRENT_MONTH,
    calendarScope: 'month',
    weekStart: localWeekStart(),
    assigneeFilter: 'All',
    locationFilter: 'All',
    sourceFilter: 'All',
    overdueFilter: false,
    sort: 'priority',
  };
}

function validMonthFilter(value: unknown): value is string {
  if (value === CURRENT_MONTH || value === 'all' || value === 'unscheduled') return true;
  if (typeof value !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) return false;
  const [year, month] = value.split('-').map(Number);
  return year >= 2000 && year <= 2100 && new Date(year, month, 0).getMonth() + 1 === month;
}

function validWeekStart(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 2000 && year <= 2100
    && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function normalizeTaskViewPreferences(value: unknown): TaskViewPreferences {
  const defaults = defaultTaskViewPreferences();
  if (!value || typeof value !== 'object') return defaults;
  const saved = value as Partial<TaskViewPreferences>;
  const calendarScope: CalendarScope = saved.calendarScope === 'week' || saved.calendarScope === 'unscheduled'
    ? saved.calendarScope
    : 'month';
  const monthFilter = validMonthFilter(saved.monthFilter) ? saved.monthFilter : defaults.monthFilter;
  return {
    search: typeof saved.search === 'string' ? saved.search : defaults.search,
    urgency: saved.urgency === 'Urgent' || saved.urgency === 'Low' || saved.urgency === 'Medium' || saved.urgency === 'High' || saved.urgency === 'All'
      ? saved.urgency
      : defaults.urgency,
    view: saved.view === 'all' || saved.view === 'done' || saved.view === 'open' ? saved.view : defaults.view,
    groupFilter: typeof saved.groupFilter === 'string' && saved.groupFilter.length > 0 ? saved.groupFilter : defaults.groupFilter,
    monthFilter: calendarScope === 'unscheduled' ? 'unscheduled' : monthFilter,
    calendarScope: monthFilter === 'unscheduled' ? 'unscheduled' : calendarScope,
    weekStart: validWeekStart(saved.weekStart) ? saved.weekStart : defaults.weekStart,
    assigneeFilter: typeof saved.assigneeFilter === 'string' && saved.assigneeFilter.length > 0 ? saved.assigneeFilter : defaults.assigneeFilter,
    locationFilter: typeof saved.locationFilter === 'string' && saved.locationFilter.length > 0 ? saved.locationFilter : defaults.locationFilter,
    sourceFilter: typeof saved.sourceFilter === 'string' && saved.sourceFilter.length > 0 ? saved.sourceFilter : defaults.sourceFilter,
    overdueFilter: typeof saved.overdueFilter === 'boolean' ? saved.overdueFilter : defaults.overdueFilter,
    sort: saved.sort === 'date' || saved.sort === 'title' || saved.sort === 'updated' || saved.sort === 'priority' ? saved.sort : defaults.sort,
  };
}

function taskViewPreferencesKey(scope: string): string {
  return `${TASK_VIEW_PREFERENCES_KEY}:${safeScope(scope)}`;
}

export async function readTaskViewPreferences(scope: string): Promise<TaskViewPreferences> {
  try {
    const saved = localStorage.getItem(taskViewPreferencesKey(scope));
    return saved ? normalizeTaskViewPreferences(JSON.parse(saved)) : defaultTaskViewPreferences();
  } catch {
    return defaultTaskViewPreferences();
  }
}

export async function writeTaskViewPreferences(scope: string, preferences: TaskViewPreferences): Promise<void> {
  try {
    localStorage.setItem(taskViewPreferencesKey(scope), JSON.stringify(preferences));
  } catch {
    // Preferences are helpful but must not block task work when storage is unavailable.
  }
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbPromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return dbPromise;
}

async function readState(scope: string): Promise<PersistedState> {
  const memoryState = memoryStates.get(scope) ?? emptyState();
  const db = await openDb();
  if (!db) {
    try {
      const saved = localStorage.getItem(fallbackKey(scope));
      return saved ? normalizePersistedState(JSON.parse(saved)) : normalizePersistedState(memoryState);
    } catch { return memoryState; }
  }
  return new Promise((resolve) => {
    const request = db.transaction('state', 'readonly').objectStore('state').get(stateKey(scope));
    request.onsuccess = () => resolve(normalizePersistedState(request.result));
    request.onerror = () => resolve(memoryState);
  });
}

async function writeState(scope: string, state: PersistedState): Promise<void> {
  memoryStates.set(scope, state);
  const db = await openDb();
  if (!db) {
    try { localStorage.setItem(fallbackKey(scope), JSON.stringify(state)); } catch { /* memory remains available */ }
    notifyStateChange(scope);
    return;
  }
  await new Promise<void>((resolve) => {
    const request = db.transaction('state', 'readwrite').objectStore('state').put(state, stateKey(scope));
    request.onsuccess = request.onerror = () => resolve();
  });
  notifyStateChange(scope);
}

async function readLatestState(scope: string): Promise<PersistedState> {
  await stateTransactions.get(scope)?.catch(() => undefined);
  return readState(scope);
}

async function updateState(
  scope: string,
  update: (current: PersistedState) => PersistedState,
): Promise<PersistedState> {
  const previous = stateTransactions.get(scope) ?? Promise.resolve();
  let saved = emptyState();
  const transaction = previous.catch(() => undefined).then(async () => {
    saved = update(await readState(scope));
    await writeState(scope, saved);
  });
  stateTransactions.set(scope, transaction);
  try {
    await transaction;
    return saved;
  } finally {
    if (stateTransactions.get(scope) === transaction) stateTransactions.delete(scope);
  }
}

function operationId(): string {
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function taskFromInput(id: string, input: TaskInput): FarmTask {
  const assigneeIds = input.assigneeIds?.length ? input.assigneeIds : input.assigneeId ? [input.assigneeId] : [];
  const assigneeNames = input.assigneeNames?.length ? input.assigneeNames : input.assigneeName ? [input.assigneeName] : [];
  return {
    id, task: input.task, group: input.group ?? 'Orchards', done: input.done ?? false,
    urgency: input.urgency ?? 'Medium', month: input.month ?? '', location: input.location ?? '',
    latitude: input.latitude ?? null, longitude: input.longitude ?? null,
    locationCapturedAt: input.locationCapturedAt ?? null, atlasLink: input.atlasLink ?? '',
    notes: input.notes ?? '', link: input.link ?? '', subtasks: input.subtasks ?? [], attachments: [],
    source: 'Manual', calendarEventId: '', calendarRecurringEventId: '', calendarStart: input.calendarStart ?? '',
    scheduledDates: normalizeScheduledDates(input.scheduledDates, input.calendarStart),
    recurrence: input.recurrence ?? (input.repeatWeekly ? 'weekly' : 'none'),
    repeatWeekly: input.repeatWeekly ?? input.recurrence === 'weekly',
    calendarUpdated: '', updatedAt: new Date().toISOString(), assigneeId: assigneeIds[0] ?? '',
    assigneeName: assigneeNames[0] ?? '',
    assigneeIds,
    assigneeNames,
  };
}

function normalizeAssignmentInput(input: TaskInput): TaskInput {
  const hasAssignment = input.assigneeIds !== undefined
    || input.assigneeNames !== undefined
    || input.assigneeId !== undefined
    || input.assigneeName !== undefined;
  if (!hasAssignment) return input;
  const assigneeIds = input.assigneeIds ?? (input.assigneeId ? [input.assigneeId] : []);
  const assigneeNames = input.assigneeNames ?? (input.assigneeName ? [input.assigneeName] : []);
  return {
    ...input,
    assigneeIds,
    assigneeNames,
    assigneeId: assigneeIds[0] ?? '',
    assigneeName: assigneeNames[0] ?? '',
  };
}

function isTemporary(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  return !status || status === 408 || status === 429 || status >= 500;
}

function reconcileTasks(serverTasks: FarmTask[], current: PersistedState, preserveIds = new Set<string>()): FarmTask[] {
  const safeServerTasks = serverTasks
    .map(normalizeCachedTask)
    .filter((task): task is FarmTask => task !== null);
  const localPendingIds = new Set(current.mutations.map((mutation) => mutation.taskId));
  const pendingDeleteIds = new Set(current.mutations
    .filter((mutation) => mutation.kind === 'delete')
    .map((mutation) => mutation.taskId));
  const confirmedIds = Object.entries(current.confirmedCreates ?? {})
    .filter(([, expiresAt]) => expiresAt > Date.now())
    .map(([id]) => id);
  const protectedIds = new Set([...localPendingIds, ...confirmedIds, ...preserveIds]);
  const serverIds = new Set(safeServerTasks.map((task) => task.id));
  const merged = safeServerTasks
    .filter((task) => !pendingDeleteIds.has(task.id))
    .map((task) => protectedIds.has(task.id)
      ? (current.tasks.find((item) => item.id === task.id) ?? task)
      : task);
  for (const localTask of current.tasks) {
    if (protectedIds.has(localTask.id) && !serverIds.has(localTask.id)) merged.push(localTask);
  }
  return merged;
}

function reconcileConfirmations(serverTasks: FarmTask[], current: PersistedState): Record<string, number> {
  const serverIds = new Set(serverTasks.map((task) => task.id));
  return Object.fromEntries(Object.entries(current.confirmedCreates ?? {})
    .filter(([id, expiresAt]) => !serverIds.has(id) && expiresAt > Date.now()));
}

function settleMutation(
  mutations: QueuedMutation[],
  completedId: string,
  taskId: string,
  updatedAt?: string,
): { mutations: QueuedMutation[]; hasLaterTaskMutation: boolean } {
  let completed = false;
  let hasLaterTaskMutation = false;
  const remaining: QueuedMutation[] = [];

  for (const mutation of mutations) {
    if (mutation.id === completedId) {
      completed = true;
      continue;
    }
    if (completed && mutation.taskId === taskId) {
      hasLaterTaskMutation = true;
      remaining.push(updatedAt ? { ...mutation, baseUpdatedAt: updatedAt } : mutation);
      continue;
    }
    remaining.push(mutation);
  }

  return { mutations: remaining, hasLaterTaskMutation };
}

export function useOfflineFieldbook(
  includeDone: boolean,
  accountScope: string | null | undefined = 'signed-out',
  authReady = true,
) {
  const hasVerifiedScope = typeof accountScope === 'string' && accountScope.length > 0;
  const scope = accountScope ? safeScope(accountScope) : 'signed-out';
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => [...getListFarmTasksQueryKey({ includeDone }), scope], [includeDone, scope]);
  const [state, setState] = useState<PersistedState>(() => memoryStates.get(scope) ?? emptyState());
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [hydrated, setHydrated] = useState(false);
  const [hydratedScope, setHydratedScope] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  const [serverChecked, setServerChecked] = useState(false);
  const [source, setSource] = useState<{ name?: string; url?: string }>({});
  const scopeRef = useRef(scope);
  const foregroundSyncRef = useRef(false);
  const wasAuthReadyRef = useRef(false);
  const hydrationRecoveryRef = useRef<string | null>(null);
  const recoveryGenerationRef = useRef(0);
  scopeRef.current = scope;

  const refreshState = useCallback(async () => {
    if (!hasVerifiedScope) {
      setState(emptyState());
      setHydrated(false);
      setHydratedScope(null);
      return;
    }
    const next = await readLatestState(scope);
    if (scopeRef.current !== scope) return;
    setState(next);
    setHydrated(true);
    setHydratedScope(scope);
    setAuthRequired(next.mutations.some((mutation) => mutation.lastError === AUTH_REQUIRED_ERROR));
    queryClient.setQueryData(queryKey, { tasks: next.tasks.filter((task) => includeDone || !task.done), source: 'Local fieldbook' });
  }, [hasVerifiedScope, includeDone, queryClient, queryKey, scope]);

  const sync = useCallback(async (force = true, retryDelayed = false) => {
    if (!hasVerifiedScope || !online) return;
    const recent = syncSnapshots.get(scope);
    const currentState = !force && recent ? await readLatestState(scope) : null;
    const hasDueMutation = currentState?.mutations.some((mutation) => mutation.nextAttemptAt <= Date.now()) ?? false;
    if (!force && recent && (recent.authRequired || (!recent.error && !hasDueMutation && Date.now() - recent.checkedAt < AUTO_SYNC_FRESH_MS))) {
      if (scopeRef.current === scope) {
        setSource(recent.source);
        setSyncError(recent.error);
        setRetrying(recent.retrying);
        setAuthRequired(recent.authRequired);
        setServerChecked(true);
      }
      await refreshState();
      return;
    }
    const existing = syncRuns.get(scope);
    if (existing) {
      if (scopeRef.current === scope) setSyncing(true);
      try {
        await existing;
        if (scopeRef.current === scope) {
          const shared = syncSnapshots.get(scope);
          if (shared) {
            setSource(shared.source);
            setSyncError(shared.error);
            setRetrying(shared.retrying);
            setAuthRequired(shared.authRequired);
          }
          setServerChecked(true);
        }
        await refreshState();
        if (force) {
          const latest = await readLatestState(scope);
          const hasDueMutation = latest.mutations.some((mutation) => mutation.nextAttemptAt < Number.MAX_SAFE_INTEGER
            && (retryDelayed || mutation.nextAttemptAt <= Date.now()));
          if (hasDueMutation) {
            while (syncRuns.get(scope) === existing) {
              await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
            }
            await sync(true, retryDelayed);
          }
        }
        if (scopeRef.current === scope) {
          const finalSnapshot = syncSnapshots.get(scope);
          if (finalSnapshot) {
            setSource(finalSnapshot.source);
            setSyncError(finalSnapshot.error);
            setRetrying(finalSnapshot.retrying);
            setAuthRequired(finalSnapshot.authRequired);
          }
        }
      } finally {
        if (scopeRef.current === scope) setSyncing(false);
      }
      return;
    }
    const run = (async () => {
      if (scopeRef.current === scope) {
        setSyncing(true);
        setSyncError('');
        setAuthRequired(false);
      }
      let current = await readLatestState(scope);
      let authRequiredForRun = false;
      try {
        // A save right after a good sync goes straight to the server: the
        // server checks baseUpdatedAt, and the list is read once after the
        // write anyway. This saves a full task-list download per change.
        const lastRun = syncSnapshots.get(scope);
        const skipFirstRead = Boolean(lastRun && !lastRun.error && !lastRun.authRequired
          && Date.now() - lastRun.checkedAt < AUTO_SYNC_FRESH_MS
          && current.mutations.some((mutation) => mutation.nextAttemptAt <= Date.now()));
        const server = skipFirstRead ? null : await listFarmTasks({ includeDone: true });
        if (server) {
          if (scopeRef.current === scope) {
            setSource({ name: server.source, url: server.sourceUrl });
          }
          current = await updateState(scope, (latest) => ({
            ...latest,
            tasks: reconcileTasks(server.tasks, latest),
            confirmedCreates: reconcileConfirmations(server.tasks, latest),
          }));
        }
        let changedServer = false;
        const blockedTaskIds = new Set<string>();
        const queuedMutationIds = current.mutations.map((mutation) => mutation.id);
        for (const mutationId of queuedMutationIds) {
          const mutation = current.mutations.find((item) => item.id === mutationId);
          if (!mutation) continue;
          if (mutation.nextAttemptAt === Number.MAX_SAFE_INTEGER
            || blockedTaskIds.has(mutation.taskId)
            || (!retryDelayed && mutation.nextAttemptAt > Date.now())) continue;
          try {
            if (mutation.kind === 'create') {
              const created = await createFarmTask(mutation.data!);
              changedServer = true;
              current = await updateState(scope, (latest) => {
                const settled = settleMutation(latest.mutations, mutation.id, mutation.taskId, created.updatedAt);
                return {
                  ...latest,
                  tasks: settled.hasLaterTaskMutation
                    ? latest.tasks
                    : latest.tasks.some((task) => task.id === created.id)
                      ? latest.tasks.map((task) => task.id === created.id ? created : task)
                      : [...latest.tasks, created],
                  confirmedCreates: {
                    ...(latest.confirmedCreates ?? {}),
                    [created.id]: Date.now() + 10 * 60 * 1000,
                  },
                  mutations: settled.mutations,
                };
              });
            } else if (mutation.kind === 'delete') {
              await deleteFarmTask(mutation.taskId, {
                headers: { 'Idempotency-Key': mutation.id },
              });
              changedServer = true;
              current = await updateState(scope, (latest) => ({
                ...latest,
                mutations: latest.mutations.filter((item) => item.id !== mutation.id),
              }));
            } else {
              const updated = await updateFarmTask(mutation.taskId, { ...mutation.data!, baseUpdatedAt: mutation.baseUpdatedAt, clientOperationId: mutation.id } as TaskInput & { baseUpdatedAt?: string; clientOperationId?: string });
              changedServer = true;
              current = await updateState(scope, (latest) => {
                const settled = settleMutation(latest.mutations, mutation.id, mutation.taskId, updated.updatedAt);
                return {
                  ...latest,
                  tasks: settled.hasLaterTaskMutation
                    ? latest.tasks
                    : latest.tasks.map((task) => task.id === updated.id ? updated : task),
                  mutations: settled.mutations,
                };
              });
            }
          } catch (error) {
            const response = error as { status?: number; data?: { currentTask?: FarmTask } };
            if (isAuthenticationError(error)) {
              authRequiredForRun = true;
              current = await updateState(scope, (latest) => ({
                ...latest,
                mutations: latest.mutations.map((item) => item.nextAttemptAt === Number.MAX_SAFE_INTEGER
                  ? item
                  : { ...item, nextAttemptAt: Number.MAX_SAFE_INTEGER, lastError: AUTH_REQUIRED_ERROR }),
              }));
              break;
            } else if (response.status === 409 && response.data?.currentTask) {
              current = await updateState(scope, (latest) => {
                const localTask = latest.tasks.find((task) => task.id === mutation.taskId);
                return localTask ? {
                  ...latest,
                  mutations: latest.mutations.filter((item) => item.id !== mutation.id),
                  conflicts: [...latest.conflicts, { id: operationId(), taskId: mutation.taskId, localTask, serverTask: response.data!.currentTask!, mutation, createdAt: Date.now() }],
                } : latest;
              });
              blockedTaskIds.add(mutation.taskId);
            } else if (isTemporary(error)) {
              const attempts = mutation.attempts + 1;
              current = await updateState(scope, (latest) => ({
                ...latest,
                mutations: latest.mutations.map((item) => item.id === mutation.id ? { ...item, attempts, nextAttemptAt: Date.now() + Math.min(300000, 2000 * 2 ** attempts), lastError: 'Temporary connection problem' } : item),
              }));
              setRetrying(true);
              blockedTaskIds.add(mutation.taskId);
            } else {
              const serverMessage = refusalMessage(error);
              current = await updateState(scope, (latest) => ({
                ...latest,
                mutations: latest.mutations.map((item) => item.id === mutation.id ? { ...item, attempts: item.attempts + 1, nextAttemptAt: Number.MAX_SAFE_INTEGER, lastError: 'Needs attention', serverMessage } : item),
              }));
              blockedTaskIds.add(mutation.taskId);
            }
          }
        }
        // A second read is only needed after a write (for example, completing a
        // recurring task can materialize its next occurrence). A read-only
        // startup now uses the first response instead of fetching the list twice.
        const fresh = changedServer || !server ? await listFarmTasks({ includeDone: true }) : server;
        if (scopeRef.current === scope) {
          setSource({ name: fresh.source, url: fresh.sourceUrl });
        }
        const saved = await updateState(scope, (latest) => ({
          ...latest,
          tasks: reconcileTasks(fresh.tasks, latest),
          confirmedCreates: reconcileConfirmations(fresh.tasks, latest),
        }));
        const persistedAuthRequired = saved.mutations.some((mutation) => mutation.lastError === AUTH_REQUIRED_ERROR);
        const runRequiresAuth = authRequiredForRun || persistedAuthRequired;
        syncSnapshots.set(scope, {
          source: { name: fresh.source, url: fresh.sourceUrl },
          error: runRequiresAuth ? AUTH_REQUIRED_MESSAGE : '',
          retrying: saved.mutations.length > 0,
          authRequired: runRequiresAuth,
          checkedAt: Date.now(),
        });
        if (scopeRef.current === scope) {
          queryClient.setQueryData([...getListFarmTasksQueryKey({ includeDone: true }), scope], { tasks: saved.tasks, source: 'Google Sheets' });
          queryClient.setQueryData([...getListFarmTasksQueryKey({ includeDone: false }), scope], { tasks: saved.tasks.filter((task) => !task.done), source: 'Google Sheets' });
          setRetrying(saved.mutations.length > 0);
          setAuthRequired(runRequiresAuth);
          setSyncError(runRequiresAuth ? AUTH_REQUIRED_MESSAGE : '');
        }
      } catch (error) {
        const authenticationError = isAuthenticationError(error);
        const message = error instanceof Error ? error.message : 'Could not reach the fieldbook.';
        if (authenticationError) {
          current = await updateState(scope, (latest) => ({
            ...latest,
            mutations: latest.mutations.map((item) => item.nextAttemptAt === Number.MAX_SAFE_INTEGER
              ? item
              : { ...item, nextAttemptAt: Number.MAX_SAFE_INTEGER, lastError: AUTH_REQUIRED_ERROR }),
          }));
        }
        syncSnapshots.set(scope, {
          source: syncSnapshots.get(scope)?.source ?? {},
          error: authenticationError ? AUTH_REQUIRED_MESSAGE : message,
          retrying: true,
          authRequired: authenticationError,
          checkedAt: 0,
        });
        if (scopeRef.current === scope) {
          setRetrying(true);
          setAuthRequired(authenticationError);
          setSyncError(authenticationError ? AUTH_REQUIRED_MESSAGE : message);
        }
      } finally {
        if (scopeRef.current === scope) {
          setSyncing(false);
          setServerChecked(true);
        }
        await refreshState();
      }
    })();
    syncRuns.set(scope, run);
    try {
      await run;
    } finally {
      if (syncRuns.get(scope) === run) syncRuns.delete(scope);
    }
  }, [hasVerifiedScope, online, queryClient, refreshState, scope]);

  useEffect(() => {
    if (!hasVerifiedScope) {
      setState(emptyState());
      setHydrated(false);
      setHydratedScope(null);
      setRetrying(false);
      setSyncError('');
      setAuthRequired(false);
      setServerChecked(false);
      setSource({});
      return;
    }
    setState(memoryStates.get(scope) ?? emptyState());
    setHydrated(false);
    setHydratedScope(null);
    setRetrying(false);
    setServerChecked(false);
    void refreshState();
  }, [hasVerifiedScope, scope, refreshState]);

  useEffect(() => {
    const onOnline = () => { setOnline(true); setRetrying(false); };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);
  useEffect(() => {
    if (!hasVerifiedScope) return;
    const channel = getStateChangeChannel();
    const onBroadcastChange = (event: MessageEvent<{ scope?: string }>) => {
      if (event.data?.scope !== scope) return;
      void refreshState();
    };
    const onStorageChange = (event: StorageEvent) => {
      if (event.key !== stateChangeKey(scope)) return;
      void refreshState();
    };
    channel?.addEventListener('message', onBroadcastChange);
    window.addEventListener('storage', onStorageChange);
    return () => {
      channel?.removeEventListener('message', onBroadcastChange);
      window.removeEventListener('storage', onStorageChange);
    };
  }, [hasVerifiedScope, refreshState, scope]);
  // Authentication failures are deliberately durable so that a signed-out
  // browser never consumes another account's queued work. Once Clerk has
  // loaded a signed-in session again, only the mutations explicitly marked
  // Authentication required are released. The snapshot is cleared first:
  // otherwise the auto-sync freshness guard would keep serving the old
  // auth-required result and never perform the replay.
  useEffect(() => {
    if (!hasVerifiedScope || !hydrated || !authReady) {
      if (!authReady || !hasVerifiedScope) wasAuthReadyRef.current = false;
      return;
    }
    if (wasAuthReadyRef.current) return;
    wasAuthReadyRef.current = true;
    let cancelled = false;
    void (async () => {
      // An in-flight request may be the request which marked the queue as
      // auth-blocked. Let its state transaction finish before releasing
      // mutations, otherwise that older run could re-block them after this
      // effect has reset their retry times.
      await syncRuns.get(scope)?.catch(() => undefined);
      if (cancelled || scopeRef.current !== scope) return;
      const current = await readLatestState(scope);
      if (cancelled || scopeRef.current !== scope) return;
      const blocked = current.mutations.some((mutation) => mutation.lastError === AUTH_REQUIRED_ERROR);
      if (!blocked) return;
      syncSnapshots.delete(scope);
      await updateState(scope, (latest) => ({
        ...latest,
        mutations: latest.mutations.map((mutation) => mutation.lastError === AUTH_REQUIRED_ERROR
          ? { ...mutation, nextAttemptAt: 0, lastError: undefined }
          : mutation),
      }));
      if (!cancelled && scopeRef.current === scope) await sync(true);
    })();
    return () => { cancelled = true; };
  }, [authReady, hasVerifiedScope, hydrated, scope, sync]);
  // Clerk can renew silently while isLoaded/isSignedIn remain unchanged. The
  // recovery flow emits an explicit signal in that case; scope and mutation
  // IDs make the release idempotent across tabs, rerenders, and rehydration.
  useEffect(() => {
    if (!hasVerifiedScope || !authReady) return;
    const releaseAndReplay = async () => {
      const current = await readLatestState(scope);
      if (scopeRef.current !== scope) return;
      const blockedIds = current.mutations
        .filter((mutation) => mutation.lastError === AUTH_REQUIRED_ERROR)
        .map((mutation) => mutation.id);
      if (!blockedIds.length) return;
      const key = `${scope}:${recoveryGenerationRef.current}:${blockedIds.join(',')}`;
      if (hydrationRecoveryRef.current === key) return;
      hydrationRecoveryRef.current = key;
      syncSnapshots.delete(scope);
      await updateState(scope, (latest) => ({
        ...latest,
        mutations: latest.mutations.map((mutation) => mutation.lastError === AUTH_REQUIRED_ERROR
          ? { ...mutation, nextAttemptAt: 0, lastError: undefined }
          : mutation),
      }));
      if (scopeRef.current === scope && online) await sync(true);
    };
    const onRecovery = (event: Event) => {
      const userId = (event as CustomEvent<{ userId?: string }>).detail?.userId;
      if (!userId || safeScope(userId) === scope) {
        recoveryGenerationRef.current += 1;
        void releaseAndReplay();
      }
    };
    window.addEventListener(AUTH_RECOVERY_EVENT, onRecovery);
    // A reload has no recovery event, so release a persisted auth-blocked
    // queue once when its authenticated scope finishes rehydrating.
    if (hydrated && !hydrationRecoveryRef.current) void releaseAndReplay();
    return () => window.removeEventListener(AUTH_RECOVERY_EVENT, onRecovery);
  }, [authReady, hasVerifiedScope, hydrated, online, scope, sync]);
  useEffect(() => { if (hasVerifiedScope && online && hydrated) void sync(false); }, [hasVerifiedScope, online, hydrated, sync]);
  const nextRetryAt = useMemo(() => {
    const retryable = state.mutations
      .map((mutation) => mutation.nextAttemptAt)
      .filter((nextAttemptAt) => nextAttemptAt < Number.MAX_SAFE_INTEGER);
    return retryable.length ? Math.min(...retryable) : null;
  }, [state.mutations]);
  useEffect(() => {
    if (!hasVerifiedScope || !online || !hydrated || nextRetryAt === null) return;
    let cancelled = false;
    let timer: number | undefined;
    const schedule = async () => {
      const latest = await readLatestState(scope);
      if (cancelled || scopeRef.current !== scope) return;
      const pendingRetryAt = latest.mutations
        .map((mutation) => mutation.nextAttemptAt)
        .filter((nextAttemptAt) => nextAttemptAt < Number.MAX_SAFE_INTEGER);
      if (!pendingRetryAt.length) return;
      const dueAt = Math.min(...pendingRetryAt);
      const delay = dueAt <= Date.now()
        ? AUTO_RETRY_INTERVAL_MS
        : Math.max(0, dueAt - Date.now());
      timer = window.setTimeout(() => {
        void sync(false).finally(() => {
          if (!cancelled) void schedule();
        });
      }, delay);
    };
    void schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [hasVerifiedScope, hydrated, nextRetryAt, online, scope, sync]);
  useEffect(() => {
    const retryOnForeground = () => {
      if (!hasVerifiedScope || !online || !hydrated || foregroundSyncRef.current) return;
      foregroundSyncRef.current = true;
      void sync(true, true).finally(() => {
        foregroundSyncRef.current = false;
      });
    };
    const retryOnVisibility = () => {
      if (document.visibilityState === 'hidden') return;
      retryOnForeground();
    };
    window.addEventListener('pageshow', retryOnForeground);
    document.addEventListener('visibilitychange', retryOnVisibility);
    return () => {
      window.removeEventListener('pageshow', retryOnForeground);
      document.removeEventListener('visibilitychange', retryOnVisibility);
    };
  }, [hasVerifiedScope, hydrated, online, sync]);

  const enqueue = useCallback(async (kind: MutationKind, taskId: string, data?: TaskInput, baseUpdatedAt?: string) => {
    if (!hasVerifiedScope) throw new Error('Account identity has not been verified.');
    const mutation: QueuedMutation = { id: operationId(), kind, taskId, data: normalizeQueuedTaskInput(data).data, baseUpdatedAt, createdAt: Date.now(), attempts: 0, nextAttemptAt: 0 };
    await updateState(scope, (current) => ({ ...current, mutations: [...current.mutations, mutation] }));
    await refreshState();
    if (online) void sync();
  }, [hasVerifiedScope, online, refreshState, scope, sync]);

  const saveTask = useCallback(async (task: FarmTask | undefined, data: TaskInput) => {
    if (!hasVerifiedScope) throw new Error('Account identity has not been verified.');
    data = normalizeAssignmentInput(normalizeQueuedTaskInput(data).data ?? data);
    const mutationId = operationId();
    const syncState = online ? 'online' : 'offline';
    if (task) {
      const next = { ...task, ...data, updatedAt: new Date().toISOString() };
      await updateState(scope, (current) => ({
        ...current,
        tasks: current.tasks.map((item) => item.id === task.id ? next : item),
        mutations: [...current.mutations, { id: mutationId, kind: 'update', taskId: task.id, data, baseUpdatedAt: task.updatedAt, createdAt: Date.now(), attempts: 0, nextAttemptAt: 0 }],
      }));
      await refreshState();
      if (online) void sync();
      trackEvent('task_saved', {
        action: 'update',
        sync_state: syncState,
        has_recurrence: Boolean(data.recurrence || data.repeatWeekly),
      });
      if (typeof data.done === 'boolean' && data.done !== task.done) {
        trackEvent('task_status_changed', { completed: data.done, sync_state: syncState });
      }
      return next;
    }
    const id = operationId();
    const next = taskFromInput(id, data);
    await updateState(scope, (current) => ({
      ...current,
      tasks: [...current.tasks, next],
      mutations: [...current.mutations, { id: mutationId, kind: 'create', taskId: id, data: { ...data, clientTaskId: id } as TaskInput, createdAt: Date.now(), attempts: 0, nextAttemptAt: 0 }],
    }));
    await refreshState();
    if (online) void sync();
    trackEvent('task_saved', {
      action: 'create',
      sync_state: syncState,
      has_recurrence: Boolean(data.recurrence || data.repeatWeekly),
    });
    return next;
  }, [hasVerifiedScope, online, refreshState, scope, sync]);

  const removeTask = useCallback(async (task: FarmTask) => {
    if (!hasVerifiedScope) throw new Error('Account identity has not been verified.');
    await updateState(scope, (current) => ({
      ...current,
      tasks: current.tasks.filter((item) => item.id !== task.id),
    mutations: [...current.mutations, { id: operationId(), kind: 'delete', taskId: task.id, task, baseUpdatedAt: task.updatedAt, createdAt: Date.now(), attempts: 0, nextAttemptAt: 0 }],
    }));
    await refreshState();
    if (online) void sync();
    trackEvent('task_deleted', { sync_state: online ? 'online' : 'offline' });
  }, [hasVerifiedScope, online, refreshState, scope, sync]);

  const ensureTaskSynced = useCallback(async (taskId: string) => {
    if (!hasVerifiedScope) throw new Error('Account identity has not been verified.');
    if (!online) throw new Error('Reconnect before uploading attachments.');
    await sync();
    const current = await readLatestState(scope);
    const pending = current.mutations.find((mutation) => mutation.taskId === taskId);
    if (pending) {
      throw new Error(pending.lastError === 'Needs attention'
        ? 'The task was saved locally, but the fieldbook rejected it. Fix the task before adding the photo.'
        : 'The task was saved locally, but has not reached the fieldbook yet. Try adding the photo again shortly.');
    }
    return current.tasks.find((task) => task.id === taskId);
  }, [hasVerifiedScope, online, scope, sync]);

  const retryMutation = useCallback(async (mutationId: string) => {
    if (!hasVerifiedScope) throw new Error('Account identity has not been verified.');
    const current = await readState(scope);
    if (!current.mutations.some((mutation) => mutation.id === mutationId && mutation.nextAttemptAt === Number.MAX_SAFE_INTEGER)) {
      throw new Error('That failed change is no longer available to retry.');
    }
    await writeState(scope, {
      ...current,
      mutations: current.mutations.map((mutation) => mutation.id === mutationId
        ? { ...mutation, nextAttemptAt: 0, lastError: undefined, serverMessage: undefined }
        : mutation),
    });
    await refreshState();
    if (online) await sync();
  }, [hasVerifiedScope, online, refreshState, scope, sync]);

  const retryPendingChanges = useCallback(async () => {
    if (!hasVerifiedScope) throw new Error('Account identity has not been verified.');
    const current = await readState(scope);
    const pendingBefore = current.mutations.length;
    if (current.mutations.length > 0) {
      await updateState(scope, (latest) => ({
        ...latest,
        mutations: latest.mutations.map((mutation) => ({
          ...mutation,
          nextAttemptAt: 0,
          lastError: undefined,
        })),
      }));
      await refreshState();
      if (online) await sync(true, true);
    }
    const pendingCount = (await readLatestState(scope)).mutations.length;
    if (pendingCount === 0 && scopeRef.current === scope) {
      setAuthRequired(false);
      setSyncError('');
    }
    trackEvent('pending_changes_retried', {
      pending_before: pendingBefore,
      pending_after: pendingCount,
      sync_state: online ? 'online' : 'offline',
      outcome: pendingCount === 0 ? 'synced' : 'still_pending',
    });
    return { pendingCount };
  }, [hasVerifiedScope, online, refreshState, scope, sync]);

  const discardMutation = useCallback(async (mutationId: string) => {
    if (!hasVerifiedScope) throw new Error('Account identity has not been verified.');
    const current = await readState(scope);
    const mutation = current.mutations.find((item) => item.id === mutationId && item.nextAttemptAt === Number.MAX_SAFE_INTEGER);
    if (!mutation) throw new Error('That failed change is no longer available to discard.');
    if (!online && mutation.kind !== 'create') {
      throw new Error('Reconnect before discarding this server-backed change.');
    }
    const relatedMutationIds = mutation.kind === 'create'
      ? new Set(current.mutations.filter((item) => item.taskId === mutation.taskId).map((item) => item.id))
      : new Set([mutation.id]);
    let next: PersistedState = {
      ...current,
      mutations: current.mutations.filter((item) => !relatedMutationIds.has(item.id)),
      tasks: mutation.kind === 'create'
        ? current.tasks.filter((task) => task.id !== mutation.taskId)
        : current.tasks,
    };
    if (online && mutation.kind !== 'create') {
      const server = await listFarmTasks({ includeDone: true });
      next = {
        ...next,
        tasks: reconcileTasks(server.tasks, next),
        confirmedCreates: reconcileConfirmations(server.tasks, next),
      };
    }
    await writeState(scope, next);
    await refreshState();
  }, [hasVerifiedScope, online, refreshState, scope]);

  const resolveConflict = useCallback(async (conflict: FieldbookConflict, choice: 'local' | 'server') => {
    if (!hasVerifiedScope) throw new Error('Account identity has not been verified.');
    const current = await readState(scope);
    const tasks = current.tasks.map((task) => task.id === conflict.taskId ? (choice === 'local' ? conflict.localTask : conflict.serverTask) : task);
    await writeState(scope, { ...current, tasks, conflicts: current.conflicts.filter((item) => item.id !== conflict.id) });
    if (choice === 'local') await enqueue('update', conflict.taskId, conflict.mutation.data, conflict.serverTask.updatedAt);
    await refreshState();
  }, [enqueue, hasVerifiedScope, refreshState, scope]);

  const tasks = useMemo(() => state.tasks.filter((task) => includeDone || !task.done), [includeDone, state.tasks]);
  const summary: TaskSummary = useMemo(() => {
    const all = state.tasks;
    const month = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date()).toLowerCase();
    return { total: all.length, open: all.filter((task) => !task.done).length, done: all.filter((task) => task.done).length, highPriority: all.filter((task) => !task.done && (task.urgency === 'Urgent' || task.urgency === 'High')).length, dueThisMonth: all.filter((task) => !task.done && task.month.toLowerCase().includes(month)).length };
  }, [state.tasks]);
  const failedMutations: FailedMutation[] = useMemo(() => state.mutations
    .filter((mutation) => mutation.nextAttemptAt === Number.MAX_SAFE_INTEGER)
    .map((mutation) => ({ ...mutation, task: state.tasks.find((task) => task.id === mutation.taskId) ?? mutation.task })), [state.mutations, state.tasks]);
  return {
    tasks,
    summary,
    hydrated,
    readyForScope: hasVerifiedScope && hydrated && hydratedScope === scope,
    online,
    syncing,
    retrying,
    syncError,
    authRequired,
    serverChecked,
    source: source.name,
    sourceUrl: source.url,
    pendingCount: state.mutations.length,
    failedMutations,
    conflicts: state.conflicts,
    refresh: () => sync(true),
    syncNow: () => sync(true),
    ensureTaskSynced,
    saveTask,
    removeTask,
    retryMutation,
    retryPendingChanges,
    discardMutation,
    resolveConflict,
  };
}