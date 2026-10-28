import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Circle, CloudOff, LoaderCircle, Pencil, Plus, RefreshCw, RotateCcw, UsersRound } from 'lucide-react';
import type { FarmTask, TaskInput } from '@workspace/api-client-react';
import type { Worker } from '@/hooks/use-workers';
import { formatAucklandTaskDate, localAucklandDateKey, taskScheduledDateKeys } from '@/lib/task-calendar';
import { orderCrewPlanTasks } from '@/lib/task-sort';
import type { FieldbookConflict, FailedMutation } from '@/lib/offline-fieldbook';
import { failedMutationReason } from '@/lib/failed-mutation';
import { ConflictNotice } from '@/components/farm-planner';

export type MobileCrewAgendaView = 'team' | 'mine';
export type MobileCrewAgendaStatusFilter = 'open' | 'all';
export type MobileCrewAgendaSyncState = 'synced' | 'syncing' | 'offline' | 'error' | string;
export type MobileCrewAgendaRetryState = boolean | 'idle' | 'retrying' | 'failed' | 'error';

export interface MobileCrewAgendaProps {
  tasks: FarmTask[];
  workers: Worker[];
  currentUserId: string;
  canManageTeam: boolean;
  visibleDateKeys: string[];
  currentStartDate: string;
  syncState: MobileCrewAgendaSyncState;
  pendingCount: number;
  retryState: MobileCrewAgendaRetryState;
  currentView: MobileCrewAgendaView;
  currentStatusFilter: MobileCrewAgendaStatusFilter;
  onViewChange: (view: MobileCrewAgendaView) => void;
  onStatusFilterChange: (filter: MobileCrewAgendaStatusFilter) => void;
  onDateChange: (startDate: string) => void;
  onRefresh: () => void | Promise<void>;
  onAddTask: (dateKey: string) => void;
  onOpenTask: (task: FarmTask) => void;
  onSaveTask: (task: FarmTask | undefined, data: TaskInput) => void | Promise<unknown>;
  failedMutations?: FailedMutation[];
  conflicts?: FieldbookConflict[];
  onRetryMutation?: (mutationId: string) => void | Promise<void>;
  onDiscardMutation?: (mutationId: string) => void | Promise<void>;
  onResolveConflict?: (conflict: FieldbookConflict, choice: 'local' | 'server') => void | Promise<void>;
  errorMessage?: string;
}

type AgendaDay = {
  dateKey: string;
  tasks: FarmTask[];
};

function shiftDateKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return localAucklandDateKey();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateLabel(dateKey: string, todayKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  const label = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
  return dateKey === todayKey ? `Today · ${label}` : label;
}

function rangeLabel(startDate: string, dateKeys: string[]): string {
  const first = dateKeys[0] ?? startDate;
  const last = dateKeys[dateKeys.length - 1] ?? shiftDateKey(startDate, 29);
  const formatter = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  });
  const firstDate = new Date(`${first}T00:00:00.000Z`);
  const lastDate = new Date(`${last}T00:00:00.000Z`);
  if (Number.isNaN(firstDate.getTime()) || Number.isNaN(lastDate.getTime())) return '30-day window';
  return `${formatter.format(firstDate)} – ${formatter.format(lastDate)}`;
}

function isAssignedTo(task: FarmTask, userId: string): boolean {
  const ids = task.assigneeIds?.length ? task.assigneeIds : task.assigneeId ? [task.assigneeId] : [];
  return ids.includes(userId);
}

function taskInputForSave(task: FarmTask, done: boolean): TaskInput {
  return {
    group: task.group,
    task: task.task,
    done,
    urgency: task.urgency,
    month: task.month,
    location: task.location,
    latitude: task.latitude,
    longitude: task.longitude,
    locationCapturedAt: task.locationCapturedAt,
    atlasLink: task.atlasLink,
    notes: task.notes,
    link: task.link,
    subtasks: task.subtasks,
    calendarStart: task.calendarStart,
    scheduledDates: task.scheduledDates,
    recurrence: task.recurrence,
    repeatWeekly: task.repeatWeekly,
    assigneeId: task.assigneeId,
    assigneeName: task.assigneeName,
    assigneeIds: task.assigneeIds,
    assigneeNames: task.assigneeNames,
  };
}

function taskTime(task: FarmTask): string {
  const formatted = formatAucklandTaskDate(task.calendarStart);
  if (!formatted) return 'Time not set';
  const separator = formatted.indexOf(' · ');
  return separator === -1 ? 'All day' : formatted.slice(separator + 3);
}

function assigneeNames(task: FarmTask, workers: Worker[]): string[] {
  const names = task.assigneeNames?.length
    ? task.assigneeNames
    : task.assigneeName
      ? [task.assigneeName]
      : (task.assigneeIds ?? []).map((id) => workers.find((worker) => worker.clerkId === id)?.displayName ?? '');
  return names.map((name) => name.trim()).filter(Boolean);
}

function urgencyClasses(urgency: FarmTask['urgency']): string {
  if (urgency === 'Urgent') return 'border-[hsl(var(--destructive)/.28)] bg-[hsl(var(--destructive)/.09)] text-[hsl(var(--destructive))]';
  if (urgency === 'High') return 'border-[hsl(26_47%_52%/.3)] bg-[hsl(26_47%_52%/.1)] text-[hsl(26_47%_38%)]';
  if (urgency === 'Medium') return 'border-[hsl(var(--accent)/.38)] bg-[hsl(var(--accent)/.16)] text-[hsl(157_22%_25%)]';
  return 'border-[hsl(var(--border))] bg-[hsl(var(--muted)/.6)] text-[hsl(var(--muted-foreground))]';
}

interface AgendaTaskRowProps {
  task: FarmTask;
  workers: Worker[];
  saving: boolean;
  onComplete: (task: FarmTask) => void;
  onOpen: (task: FarmTask) => void;
}

const AgendaTaskRow = memo(function AgendaTaskRow({ task, workers, saving, onComplete, onOpen }: AgendaTaskRowProps) {
  const names = assigneeNames(task, workers);
  const visibleNames = names.slice(0, 2);
  const remainingNames = names.length - visibleNames.length;

  return (
    <article
      className={`rounded-2xl border p-4 shadow-[0_2px_0_hsl(157_22%_17%/.04)] transition-opacity ${task.done ? 'border-[hsl(var(--border)/.7)] bg-[hsl(var(--muted)/.45)] opacity-75' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))]'}`}
      data-testid={`mobile-crew-task-${task.id}`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          className={`mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl border transition-colors ${task.done ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary)/.6)] hover:text-[hsl(var(--primary))]'}`}
          onClick={() => onComplete(task)}
          disabled={saving}
          aria-label={task.done ? `Reopen ${task.task}` : `Complete ${task.task}`}
          data-testid={`mobile-crew-task-${task.id}-complete`}
        >
          {saving ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : task.done ? <Check size={18} strokeWidth={2.6} aria-hidden="true" /> : <Circle size={18} strokeWidth={1.8} aria-hidden="true" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md border px-2 py-1 font-mono text-[9px] font-medium uppercase tracking-[.12em] ${urgencyClasses(task.urgency)}`}>{task.urgency}</span>
            {task.done && <span className="font-mono text-[9px] uppercase tracking-[.12em] text-[hsl(var(--primary))]">Completed</span>}
          </div>
          <h3 className={`mt-2 text-[15px] font-semibold leading-5 text-[hsl(var(--foreground))] ${task.done ? 'line-through decoration-[hsl(var(--muted-foreground)/.7)]' : ''}`}>{task.task}</h3>
        </div>
      </div>

      <div className="ml-14 mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-[hsl(var(--muted-foreground))]">
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays size={13} aria-hidden="true" />
          {taskTime(task)}
        </span>
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <UsersRound size={13} aria-hidden="true" />
          <span className="truncate">
            {visibleNames.length ? visibleNames.join(', ') : 'Open crew'}
            {remainingNames > 0 ? ` +${remainingNames}` : ''}
          </span>
        </span>
      </div>

      <div className="ml-14 mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => onComplete(task)}
          disabled={saving}
          className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-xs font-semibold transition-colors ${task.done ? 'border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]' : 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(156_28%_23%)]'}`}
          data-testid={`mobile-crew-task-${task.id}-complete-action`}
        >
          {task.done ? 'Reopen' : 'Complete'}
        </button>
        <button
          type="button"
          onClick={() => onOpen(task)}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 text-xs font-semibold text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--muted))]"
          data-testid={`mobile-crew-task-${task.id}-edit`}
        >
          <Pencil size={14} aria-hidden="true" />
          Edit
        </button>
      </div>
    </article>
  );
});

export function MobileCrewAgenda({
  tasks,
  workers,
  currentUserId,
  canManageTeam,
  visibleDateKeys,
  currentStartDate,
  syncState,
  pendingCount,
  retryState,
  currentView,
  currentStatusFilter,
  onViewChange,
  onStatusFilterChange,
  onDateChange,
  onRefresh,
  onAddTask,
  onOpenTask,
  onSaveTask,
  failedMutations = [],
  conflicts = [],
  onRetryMutation,
  onDiscardMutation,
  onResolveConflict,
  errorMessage,
}: MobileCrewAgendaProps) {
  const [savingTaskIds, setSavingTaskIds] = useState<Set<string>>(() => new Set());
  const [actionError, setActionError] = useState('');
  const [mutationAction, setMutationAction] = useState<string | null>(null);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const todayKey = localAucklandDateKey();
  const dates = useMemo(() => visibleDateKeys.length ? visibleDateKeys : Array.from({ length: 30 }, (_, index) => shiftDateKey(currentStartDate, index)), [currentStartDate, visibleDateKeys]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const filteredTasks = useMemo(() => {
    const scoped = currentView === 'mine' ? tasks.filter((task) => isAssignedTo(task, currentUserId)) : tasks;
    const statusFiltered = currentStatusFilter === 'open' ? scoped.filter((task) => !task.done) : scoped;
    return orderCrewPlanTasks(statusFiltered);
  }, [currentStatusFilter, currentUserId, currentView, tasks]);

  const { dateGroups, unscheduledTasks } = useMemo(() => {
    const dateSet = new Set(dates);
    const groups = new Map<string, FarmTask[]>();
    const unscheduled: FarmTask[] = [];
    filteredTasks.forEach((task) => {
      const keys = taskScheduledDateKeys(task);
      if (!keys.length) {
        if (!task.done) unscheduled.push(task);
      } else {
        keys.filter((key) => dateSet.has(key)).forEach((key) => {
          const group = groups.get(key) ?? [];
          if (!group.some((item) => item.id === task.id)) group.push(task);
          groups.set(key, group);
        });
      }
    });
    return {
      dateGroups: dates
        .map((dateKey) => ({ dateKey, tasks: groups.get(dateKey) ?? [] }))
        .filter((group) => group.tasks.length > 0) as AgendaDay[],
      unscheduledTasks: unscheduled,
    };
  }, [dates, filteredTasks]);

  const visibleTaskCount = new Set([...unscheduledTasks, ...dateGroups.flatMap((group) => group.tasks)].map((task) => task.id)).size;
  const isRetrying = retryState === true || retryState === 'retrying';
  const syncIsError = syncState === 'error' || retryState === 'error' || retryState === 'failed';
  const effectiveOffline = !online || syncState === 'offline';
  const syncLabel = isRetrying ? 'Retrying pending changes' : syncState === 'syncing' ? 'Saving locally' : effectiveOffline ? 'Offline · saved on this device' : syncIsError ? 'Sync needs attention' : pendingCount > 0 ? 'Saved locally · waiting to sync' : 'Up to date';
  const syncIcon = effectiveOffline ? CloudOff : isRetrying || syncState === 'syncing' ? LoaderCircle : syncIsError ? RefreshCw : Check;

  const handleComplete = useCallback(async (task: FarmTask) => {
    if (savingTaskIds.has(task.id)) return;
    setActionError('');
    setSavingTaskIds((current) => new Set(current).add(task.id));
    try {
      await onSaveTask(task, taskInputForSave(task, !task.done));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not save that change. It is still safe to try again.');
    } finally {
      setSavingTaskIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  }, [onSaveTask, savingTaskIds]);

  const handleRefresh = useCallback(() => {
    void onRefresh();
  }, [onRefresh]);

  const handleMutationAction = useCallback(async (mutationId: string, action: 'retry' | 'discard') => {
    const callback = action === 'retry' ? onRetryMutation : onDiscardMutation;
    if (!callback || mutationAction) return;
    setMutationAction(`${action}:${mutationId}`);
    setActionError('');
    try {
      await callback(mutationId);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : `Could not ${action} that change.`);
    } finally {
      setMutationAction(null);
    }
  }, [mutationAction, onDiscardMutation, onRetryMutation]);

  const handleDateShift = useCallback((amount: number) => {
    onDateChange(shiftDateKey(currentStartDate, amount));
  }, [currentStartDate, onDateChange]);

  const SyncIcon = syncIcon;
  const showEmpty = dateGroups.length === 0 && unscheduledTasks.length === 0;

  return (
    <section className="min-h-[100dvh] bg-[hsl(var(--background))] pb-24" aria-label="Mobile crew agenda" data-testid="mobile-crew-agenda">
      <header className="sticky top-0 z-20 border-b border-[hsl(var(--border))] bg-[hsl(42_45%_97%/.96)] px-4 pb-3 pt-4 backdrop-blur-md">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--primary))]">Fieldbook / crew</p>
            <h1 className="mt-1 font-serif text-[28px] leading-none text-[hsl(var(--foreground))]">The run sheet</h1>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--primary))] shadow-[0_2px_0_hsl(157_22%_17%/.05)] transition-colors hover:bg-[hsl(var(--muted))]"
            aria-label={syncIsError ? 'Retry sync' : 'Refresh crew agenda'}
            data-testid="mobile-crew-refresh"
          >
            <RefreshCw size={18} className={syncState === 'syncing' || isRetrying ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
        </div>

        <div className={`mt-4 flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[11px] ${syncIsError ? 'border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.07)] text-[hsl(var(--destructive))]' : effectiveOffline || pendingCount > 0 ? 'border-[hsl(var(--accent)/.45)] bg-[hsl(var(--accent)/.13)] text-[hsl(var(--accent-foreground))]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card)/.7)] text-[hsl(var(--muted-foreground))]'}`} data-testid="mobile-crew-sync-status" aria-live="polite">
          <SyncIcon size={14} className={isRetrying || syncState === 'syncing' ? 'animate-spin' : ''} aria-hidden="true" />
          <span className="font-medium">{syncLabel}</span>
          {pendingCount > 0 && <span className="ml-auto rounded-md bg-[hsl(var(--card)/.7)] px-2 py-1 font-mono text-[10px]">{pendingCount} pending</span>}
        </div>

        <div className="mt-3 flex rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.72)] p-1" role="tablist" aria-label="Agenda scope">
          {(['team', 'mine'] as const).filter((view) => canManageTeam || view === 'mine').map((view) => (
            <button
              type="button"
              key={view}
              role="tab"
              aria-selected={currentView === view}
              onClick={() => onViewChange(view)}
              className={`min-h-10 flex-1 rounded-lg px-3 text-xs font-semibold capitalize transition-colors ${currentView === view ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-sm' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'}`}
              data-testid={`mobile-crew-view-${view}`}
            >
              {view === 'team' ? 'Team work' : 'My work'}
            </button>
          ))}
        </div>

        <div className="mt-2 flex items-center gap-2">
          <div className="flex flex-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.72)] p-1" role="tablist" aria-label="Task status">
            {(['open', 'all'] as const).map((filter) => (
              <button
                type="button"
                key={filter}
                role="tab"
                aria-selected={currentStatusFilter === filter}
                onClick={() => onStatusFilterChange(filter)}
                className={`min-h-10 flex-1 rounded-lg px-2 text-xs font-semibold capitalize transition-colors ${currentStatusFilter === filter ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'}`}
                data-testid={`mobile-crew-status-${filter}`}
              >
                {filter === 'open' ? 'Open' : 'All'}
              </button>
            ))}
          </div>
          <span className="min-w-[68px] text-right font-mono text-[10px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">{visibleTaskCount} {visibleTaskCount === 1 ? 'task' : 'tasks'}</span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-xl px-4">
        <div className="flex items-center justify-between border-b border-[hsl(var(--border))] py-3" data-testid="mobile-crew-date-controls">
          <button type="button" onClick={() => handleDateShift(-7)} className="flex min-h-11 items-center gap-1 rounded-xl px-2 text-xs font-semibold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]" aria-label="Previous 7 days" data-testid="mobile-crew-previous">
            <ChevronLeft size={17} aria-hidden="true" /> Previous
          </button>
          <button type="button" onClick={() => onDateChange(todayKey)} className={`flex min-h-11 flex-col items-center justify-center rounded-xl px-3 text-center transition-colors ${currentStartDate === todayKey ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]'}`} data-testid="mobile-crew-today">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold"><CalendarDays size={14} aria-hidden="true" /> {currentStartDate === todayKey ? 'Today' : 'Back to today'}</span>
            <span className="mt-0.5 font-mono text-[9px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]" data-testid="mobile-crew-date-range">{rangeLabel(currentStartDate, dates)}</span>
          </button>
          <button type="button" onClick={() => handleDateShift(7)} className="flex min-h-11 items-center gap-1 rounded-xl px-2 text-xs font-semibold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]" aria-label="Next 7 days" data-testid="mobile-crew-next">
            Next <ChevronRight size={17} aria-hidden="true" />
          </button>
        </div>

        {(errorMessage || actionError) && (
          <aside className="mt-4 rounded-2xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.07)] p-4 text-sm text-[hsl(var(--destructive))]" role="alert" data-testid="mobile-crew-error">
            <div className="flex items-start gap-3">
              <RefreshCw size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">The latest changes did not arrive.</p>
                <p className="mt-1 text-xs leading-5">{actionError || errorMessage}</p>
              </div>
              <button type="button" onClick={handleRefresh} className="min-h-10 rounded-lg border border-[hsl(var(--destructive)/.28)] px-3 text-xs font-semibold" data-testid="mobile-crew-retry">Retry</button>
            </div>
          </aside>
        )}

        {conflicts.length > 0 && onResolveConflict && (
          <div className="mt-4">
            <ConflictNotice conflicts={conflicts} onResolve={(conflict, choice) => void onResolveConflict(conflict, choice)} />
          </div>
        )}

        {failedMutations.length > 0 && (
          <section className="mt-4 rounded-2xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.06)] p-4" aria-labelledby="mobile-crew-needs-attention-title" data-testid="mobile-crew-failed-changes">
            <div className="flex items-start gap-3">
              <RefreshCw size={17} className="mt-0.5 shrink-0 text-[hsl(var(--destructive))]" aria-hidden="true" />
              <div>
                <h2 id="mobile-crew-needs-attention-title" className="text-sm font-semibold text-[hsl(var(--destructive))]">Changes needing attention</h2>
                <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Your local work is safe. Retry a change when the connection is ready, or discard only the failed sync.</p>
              </div>
            </div>
            <ul className="mt-3 space-y-3">
              {failedMutations.map((mutation) => (
                <li key={mutation.id} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
                  <p className="text-sm font-semibold text-[hsl(var(--foreground))]">{mutation.task?.task ?? `Task ${mutation.taskId}`}</p>
                  <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{mutation.kind} failed: {failedMutationReason(mutation)}</p>
                  <div className="mt-3 flex gap-2">
                    {onRetryMutation && <button type="button" onClick={() => void handleMutationAction(mutation.id, 'retry')} disabled={mutationAction !== null} className="min-h-10 flex-1 rounded-lg bg-[hsl(var(--primary))] px-3 text-xs font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50" data-testid={`mobile-crew-retry-change-${mutation.id}`}>{mutationAction === `retry:${mutation.id}` ? 'Retrying…' : 'Retry'}</button>}
                    {onDiscardMutation && <button type="button" onClick={() => void handleMutationAction(mutation.id, 'discard')} disabled={mutationAction !== null} className="min-h-10 rounded-lg border border-[hsl(var(--border))] px-3 text-xs font-semibold disabled:opacity-50" data-testid={`mobile-crew-discard-change-${mutation.id}`}>{mutationAction === `discard:${mutation.id}` ? 'Discarding…' : 'Discard local change'}</button>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {unscheduledTasks.length > 0 && (
          <section className="mt-4 rounded-2xl border border-dashed border-[hsl(var(--accent)/.75)] bg-[hsl(var(--accent)/.08)] p-3" aria-labelledby="mobile-crew-unscheduled-title" data-testid="mobile-crew-unscheduled">
            <div className="flex items-start justify-between gap-3 px-1 pb-2">
              <div>
                <h2 id="mobile-crew-unscheduled-title" className="text-sm font-semibold text-[hsl(var(--foreground))]">Unscheduled open work</h2>
                <p className="mt-1 text-[11px] leading-4 text-[hsl(var(--muted-foreground))]">Still open, waiting for a day on the run sheet.</p>
              </div>
              <span className="rounded-md bg-[hsl(var(--accent)/.2)] px-2 py-1 font-mono text-[10px] text-[hsl(var(--accent-foreground))]">{unscheduledTasks.length}</span>
            </div>
            <div className="space-y-3">
              {unscheduledTasks.map((task) => <AgendaTaskRow key={task.id} task={task} workers={workers} saving={savingTaskIds.has(task.id)} onComplete={handleComplete} onOpen={onOpenTask} />)}
            </div>
          </section>
        )}

        {dateGroups.length > 0 && (
          <div className="space-y-6 py-5">
            {dateGroups.map(({ dateKey, tasks: dayTasks }) => (
              <section key={dateKey} aria-labelledby={`mobile-crew-date-${dateKey}`} data-testid={`mobile-crew-date-group-${dateKey}`}>
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 id={`mobile-crew-date-${dateKey}`} className={`font-serif text-[21px] ${dateKey === todayKey ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--foreground))]'}`}>{dateLabel(dateKey, todayKey)}</h2>
                  {canManageTeam && <button type="button" onClick={() => onAddTask(dateKey)} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]" data-testid={`mobile-crew-add-task-${dateKey}`}>
                    <Plus size={14} aria-hidden="true" /> Add
                  </button>}
                </div>
                <div className="space-y-3">
                  {dayTasks.map((task) => <AgendaTaskRow key={task.id} task={task} workers={workers} saving={savingTaskIds.has(task.id)} onComplete={handleComplete} onOpen={onOpenTask} />)}
                </div>
              </section>
            ))}
          </div>
        )}

        {showEmpty && (
          <div className="my-10 rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] px-6 py-10 text-center" data-testid="mobile-crew-empty">
            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[hsl(var(--accent)/.2)] text-[hsl(var(--primary))]">
              <CalendarDays size={23} aria-hidden="true" />
            </div>
            <h2 className="mt-4 font-serif text-xl text-[hsl(var(--foreground))]">{currentView === 'mine' ? 'Nothing assigned to you' : currentStatusFilter === 'open' ? 'A clear run sheet' : 'No work in this window'}</h2>
            <p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-[hsl(var(--muted-foreground))]">{currentStatusFilter === 'open' ? 'There is no open work in these 30 days. Add the next job when it is ready.' : 'Try another window to see work further along the calendar.'}</p>
            {canManageTeam && <button type="button" onClick={() => onAddTask(currentStartDate)} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 text-xs font-semibold text-[hsl(var(--primary-foreground))] hover:bg-[hsl(156_28%_23%)]" data-testid="mobile-crew-add-task-empty">
              <Plus size={15} aria-hidden="true" /> Add task
            </button>}
          </div>
        )}

        <footer className="flex items-center justify-center gap-2 pb-6 pt-2 text-center font-mono text-[9px] uppercase tracking-[.13em] text-[hsl(var(--muted-foreground))]" data-testid="mobile-crew-footer-status">
          <RotateCcw size={12} aria-hidden="true" />
          Changes save here first; sync catches up when there is a connection.
          {!canManageTeam && <span className="sr-only">Assignment changes are managed by your farm manager.</span>}
        </footer>
      </div>
    </section>
  );
}
