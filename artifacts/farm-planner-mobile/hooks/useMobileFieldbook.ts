import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createFarmTask,
  listFarmTasks,
  updateFarmTask,
  type FarmTask,
  type TaskInput,
} from '@workspace/api-client-react';
import { createScopeSerializer, reconcileServerTasks } from '../lib/mobile-fieldbook';
import { CURRENT_MONTH } from '../lib/task-month';
import { calendarDateKey, startOfLocalWeek, type CalendarScope, type WeekFilter } from '../lib/task-calendar';
import { type TaskSort } from '../lib/task-sort';
import { taskAssigneeIds, taskAssigneeNames } from '../lib/task-assignment';

type PendingUpdate = {
  id: string;
  kind: 'create' | 'update';
  taskId: string;
  data: TaskInput;
  baseUpdatedAt?: string;
  createdAt: number;
  attempts: number;
};

export type MobileConflict = {
  taskId: string;
  localTask: FarmTask;
  serverTask: FarmTask;
  update: PendingUpdate;
};

type StoredState = {
  tasks: FarmTask[];
  updates: PendingUpdate[];
  conflicts: MobileConflict[];
};

export type MobileTaskViewPreferences = {
  view: 'Open' | 'All' | 'Done';
  calendarScope: CalendarScope;
  monthFilter: string;
  weekFilter: WeekFilter;
  weekStart: string;
  sort: TaskSort;
};

const blankState = (): StoredState => ({ tasks: [], updates: [], conflicts: [] });
const safeScope = (scope: string) => scope.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160) || 'signed-out';
const storageKey = (scope: string) => `farm-planner-mobile-fieldbook:${safeScope(scope)}`;
const taskViewPreferencesKey = (scope: string) => `farm-planner-mobile-task-view-preferences:${safeScope(scope)}`;
const operationId = () => `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const serializeFieldbookOperation = createScopeSerializer();

export function defaultMobileTaskViewPreferences(): MobileTaskViewPreferences {
  return {
    view: 'Open',
    calendarScope: 'month',
    monthFilter: 'all',
    weekFilter: 'week',
    weekStart: startOfLocalWeek(),
    sort: 'priority',
  };
}

function validMonthFilter(value: unknown): value is string {
  if (value === 'all' || value === CURRENT_MONTH || value === 'unscheduled') return true;
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

export function normalizeMobileTaskViewPreferences(value: unknown): MobileTaskViewPreferences {
  const defaults = defaultMobileTaskViewPreferences();
  if (!value || typeof value !== 'object') return defaults;
  const saved = value as Partial<MobileTaskViewPreferences>;
  const calendarScope: CalendarScope = saved.calendarScope === 'week' ? 'week' : 'month';
  const monthFilter = validMonthFilter(saved.monthFilter) ? saved.monthFilter : defaults.monthFilter;
  return {
    view: saved.view === 'All' || saved.view === 'Done' || saved.view === 'Open' ? saved.view : defaults.view,
    calendarScope,
    monthFilter,
    weekFilter: saved.weekFilter === 'unscheduled' || saved.weekFilter === 'week' ? saved.weekFilter : defaults.weekFilter,
    weekStart: validWeekStart(saved.weekStart) ? saved.weekStart : defaults.weekStart,
    sort: saved.sort === 'date' || saved.sort === 'title' || saved.sort === 'updated' || saved.sort === 'priority' ? saved.sort : defaults.sort,
  };
}

export async function readMobileTaskViewPreferences(scope: string): Promise<MobileTaskViewPreferences> {
  try {
    const saved = await AsyncStorage.getItem(taskViewPreferencesKey(scope));
    return saved ? normalizeMobileTaskViewPreferences(JSON.parse(saved)) : defaultMobileTaskViewPreferences();
  } catch {
    return defaultMobileTaskViewPreferences();
  }
}

export async function writeMobileTaskViewPreferences(scope: string, preferences: MobileTaskViewPreferences): Promise<void> {
  try {
    await AsyncStorage.setItem(taskViewPreferencesKey(scope), JSON.stringify(preferences));
  } catch {
    // Preferences are optional and must not block task work if storage is unavailable.
  }
}

export function useMobileTaskViewPreferences(accountScope: string | null) {
  const scope = accountScope ? safeScope(accountScope) : null;
  const [preferences, setPreferences] = useState<MobileTaskViewPreferences>(defaultMobileTaskViewPreferences);
  const [hydratedScope, setHydratedScope] = useState<string | null>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  useEffect(() => {
    let active = true;
    setHydratedScope(null);
    setPreferences(defaultMobileTaskViewPreferences());
    if (!scope) return () => { active = false; };
    void readMobileTaskViewPreferences(scope).then((saved) => {
      if (!active || scopeRef.current !== scope) return;
      setPreferences(saved);
      setHydratedScope(scope);
    });
    return () => { active = false; };
  }, [scope]);

  const readyForScope = Boolean(scope && hydratedScope === scope);
  useEffect(() => {
    if (!readyForScope || !scope) return;
    void writeMobileTaskViewPreferences(scope, preferences);
  }, [preferences, readyForScope, scope]);

  const updatePreferences = useCallback((patch: Partial<MobileTaskViewPreferences>) => {
    if (!readyForScope) return;
    setPreferences((current) => ({ ...current, ...patch }));
  }, [readyForScope]);

  return {
    preferences: readyForScope ? preferences : defaultMobileTaskViewPreferences(),
    readyForScope,
    updatePreferences,
  };
}

async function readState(scope: string): Promise<StoredState> {
  const saved = await AsyncStorage.getItem(storageKey(scope));
  if (!saved) return blankState();
  try {
    const parsed = JSON.parse(saved) as Partial<StoredState>;
    return {
      tasks: parsed.tasks ?? [],
      updates: (parsed.updates ?? []).map((update) => ({ ...update, kind: update.kind ?? 'update' })),
      conflicts: parsed.conflicts ?? [],
    };
  } catch {
    return blankState();
  }
}

async function writeState(scope: string, state: StoredState) {
  await AsyncStorage.setItem(storageKey(scope), JSON.stringify(state));
}

export function useMobileFieldbook(
  accountScope: string | null,
  remoteTasks?: FarmTask[],
  remoteTasksReady = false,
) {
  const scope = accountScope ? safeScope(accountScope) : null;
  const [state, setState] = useState<StoredState>(blankState);
  const [hydrated, setHydrated] = useState(false);
  const [hydratedScope, setHydratedScope] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const scopeRef = useRef(scope);
  const remoteTasksRef = useRef(remoteTasks);
  const remoteTasksReadyRef = useRef(remoteTasksReady);
  const syncInFlight = useRef<{ scope: string; promise: Promise<boolean> } | null>(null);
  scopeRef.current = scope;
  remoteTasksRef.current = remoteTasks;
  remoteTasksReadyRef.current = remoteTasksReady;

  const publish = useCallback((next: StoredState) => {
    if (scopeRef.current !== scope) return;
    setState(next);
  }, [scope]);

  const sync = useCallback((options: { force?: boolean } = {}): Promise<boolean> => {
    if (!scope) return Promise.resolve(false);
    if (syncInFlight.current?.scope === scope) return syncInFlight.current.promise;
    const run = serializeFieldbookOperation(scope, async () => {
      if (scopeRef.current === scope) setSyncing(true);
      let current = await readState(scope);
      try {
        const server = !options.force && remoteTasksReadyRef.current && remoteTasksRef.current
          ? { tasks: remoteTasksRef.current }
          : await listFarmTasks({ includeDone: true });
        if (scopeRef.current === scope) setOnline(true);
        const pendingIds = new Set(current.updates.map((update) => update.taskId));
        current = {
          ...current,
          tasks: reconcileServerTasks(server.tasks, current.tasks, pendingIds),
        };
        for (const update of [...current.updates].sort((a, b) => a.createdAt - b.createdAt)) {
          try {
            const updated = update.kind === 'create'
              ? await createFarmTask({ ...update.data, clientTaskId: update.taskId })
              : await updateFarmTask(update.taskId, { ...update.data, baseUpdatedAt: update.baseUpdatedAt, clientOperationId: update.id });
            current = {
              ...current,
              tasks: current.tasks.map((task) => task.id === updated.id ? updated : task),
              updates: current.updates.filter((item) => item.id !== update.id),
            };
          } catch (error) {
            const response = error as { status?: number; data?: { currentTask?: FarmTask } };
            if (response.status === 409 && response.data?.currentTask) {
              const localTask = current.tasks.find((task) => task.id === update.taskId);
              if (localTask) {
                current = {
                  ...current,
                  updates: current.updates.filter((item) => item.id !== update.id),
                  conflicts: [...current.conflicts, { taskId: update.taskId, localTask, serverTask: response.data.currentTask, update }],
                };
              }
              continue;
            }
            current = {
              ...current,
              updates: current.updates.map((item) => item.id === update.id ? { ...item, attempts: item.attempts + 1 } : item),
            };
            throw error;
          }
        }
        await writeState(scope, current);
        publish(current);
        return true;
      } catch {
        if (scopeRef.current === scope) setOnline(false);
        await writeState(scope, current);
        publish(current);
        return false;
      } finally {
        if (scopeRef.current === scope) setSyncing(false);
      }
    });
    syncInFlight.current = { scope, promise: run };
    void run.finally(() => {
      if (syncInFlight.current?.promise === run) syncInFlight.current = null;
    });
    return run;
  }, [publish, scope]);

  useEffect(() => {
    if (!scope) {
      setState(blankState());
      setHydrated(false);
      setHydratedScope(null);
      return;
    }
    let active = true;
    void readState(scope).then((saved) => {
      if (!active) return;
      publish(saved);
      setHydrated(true);
      setHydratedScope(scope);
    });
    return () => { active = false; };
  }, [publish, scope, sync]);

  useEffect(() => {
    if (!scope || !hydrated || hydratedScope !== scope || !remoteTasksReady) return;
    void sync();
  }, [hydrated, hydratedScope, remoteTasks, remoteTasksReady, scope, sync]);

  useEffect(() => {
    if (!scope) return;
    const interval = setInterval(() => { void sync(); }, 30000);
    return () => clearInterval(interval);
  }, [scope, sync]);

  const saveTask = useCallback(async (task: FarmTask | undefined, data: TaskInput) => {
    if (!scope) return undefined;
    let savedTask: FarmTask | undefined;
    await serializeFieldbookOperation(scope, async () => {
      const current = await readState(scope);
      const taskId = task?.id ?? operationId();
      const localTask: FarmTask = task
        ? { ...task, ...data, updatedAt: new Date().toISOString() }
        : {
            id: taskId,
            task: data.task,
            group: data.group ?? 'Orchards',
            done: data.done ?? false,
            urgency: data.urgency ?? 'Medium',
            month: data.month ?? '',
            location: data.location ?? '',
            latitude: data.latitude ?? null,
            longitude: data.longitude ?? null,
            locationCapturedAt: data.locationCapturedAt ?? null,
            atlasLink: data.atlasLink ?? '',
            notes: data.notes ?? '',
            link: data.link ?? '',
            subtasks: data.subtasks ?? [],
            attachments: [],
            source: 'Manual',
            calendarEventId: '',
            calendarRecurringEventId: '',
            calendarStart: data.calendarStart ?? '',
            scheduledDates: data.scheduledDates
              ?? (data.calendarStart && calendarDateKey(data.calendarStart) ? [calendarDateKey(data.calendarStart)!] : []),
            recurrence: data.recurrence ?? (data.repeatWeekly ? 'weekly' : 'none'),
            calendarUpdated: '',
            updatedAt: new Date().toISOString(),
            assigneeId: data.assigneeId ?? '',
            assigneeName: data.assigneeName ?? '',
             assigneeIds: taskAssigneeIds(data),
             assigneeNames: taskAssigneeNames(data),
            repeatWeekly: data.repeatWeekly ?? data.recurrence === 'weekly',
           } as FarmTask;
      savedTask = localTask;
      const next = {
        ...current,
        tasks: current.tasks.some((item) => item.id === taskId)
          ? current.tasks.map((item) => item.id === taskId ? localTask : item)
          : [...current.tasks, localTask],
        updates: [...current.updates, {
          id: operationId(),
          kind: task ? ('update' as const) : ('create' as const),
          taskId,
          data: task ? data : { ...data, clientTaskId: taskId },
          baseUpdatedAt: task?.updatedAt,
          createdAt: Date.now(),
          attempts: 0,
        }],
      };
      await writeState(scope, next);
      publish(next);
    });
    void sync();
    return savedTask;
  }, [publish, scope, sync]);

  const resolveConflict = useCallback(async (conflict: MobileConflict, choice: 'local' | 'server') => {
    if (!scope) return;
    await serializeFieldbookOperation(scope, async () => {
      const current = await readState(scope);
      const chosen = choice === 'local' ? conflict.localTask : conflict.serverTask;
      const next: StoredState = {
        ...current,
        tasks: current.tasks.map((task) => task.id === conflict.taskId ? chosen : task),
        conflicts: current.conflicts.filter((item) => item.taskId !== conflict.taskId),
        updates: choice === 'local'
          ? [...current.updates, { ...conflict.update, id: operationId(), baseUpdatedAt: conflict.serverTask.updatedAt, attempts: 0 }]
          : current.updates,
      };
      await writeState(scope, next);
      publish(next);
    });
    if (choice === 'local') void sync();
  }, [publish, scope, sync]);

  return {
    tasks: state.tasks,
    hydrated,
    readyForScope: Boolean(scope && hydrated && hydratedScope === scope),
    online,
    syncing,
    pendingCount: state.updates.length,
    conflicts: state.conflicts,
    refresh: () => sync({ force: true }),
    saveTask,
    resolveConflict,
  };
}