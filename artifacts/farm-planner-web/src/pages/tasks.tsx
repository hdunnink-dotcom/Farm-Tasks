import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useAuth, useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, ExternalLink, Filter, ListFilter, Plus, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import {
  getGetFarmTaskSummaryQueryKey,
  getGetFarmSettingsQueryKey,
  getListFarmTasksQueryKey,
  useGetFarmSettings,
  useRequestFarmAttachmentUpload,
  useCompleteFarmAttachmentUpload,
  type FarmTask,
  type TaskInput,
} from '@workspace/api-client-react';
import { ConflictNotice, EmptyState, ErrorState, PageHeader, PlannerShell, RetryPendingChangesButton, SourcePill, SyncNotice, TaskCard, TaskSkeleton, UrgencyPill, TaskDetailsDialog } from '@/components/farm-planner';
import { TaskFormDialog } from '@/components/task-form-dialog';
import { CompactTaskCreate } from '@/components/compact-task-create';
import { CURRENT_MONTH, localMonthKey, monthLabel, monthOptions } from '@/lib/task-month';
import { attachmentErrorMessage, uploadFarmAttachment } from '@/lib/farm-attachment-upload';
import { AUTH_DISABLED } from '@/lib/auth-config';
import { defaultTaskViewPreferences, normalizeTaskViewPreferences, readTaskViewPreferences, useOfflineFieldbook, writeTaskViewPreferences, type TaskViewPreferences } from '@/lib/offline-fieldbook';
import { FARM_MAP_START_URL, googleMapsRouteUrl } from '@/lib/task-map-links';
import { PrintPlanner } from '@/components/print-planner';
import { isTaskOverdue, taskMatchesMonthWithUrgentPin } from '@/lib/task-filter';
import { type CalendarScope, localWeekStart, shiftLocalMonth, shiftLocalWeek, taskIsUnscheduled, taskMatchesLocalWeek, weekLabel } from '@/lib/task-calendar';
import { compareTasksBySort, type TaskSort } from '@/lib/task-sort';
import { DEFAULT_FARM_GROUPS } from '@/lib/farm-settings-options';
import { useMe } from '@/hooks/use-me';
import { useWorkers } from '@/hooks/use-workers';

export function resolveEditTaskHandoff<T extends { id: string }>(
  editId: string,
  tasks: ReadonlyArray<T>,
  tasksReady: boolean,
): T | 'waiting' | null {
  if (!editId || !tasksReady) return 'waiting';
  return tasks.find((task) => task.id === editId) ?? null;
}

export default function TasksPage() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const clerk = useClerk();
  const canReadTasks = AUTH_DISABLED || (isLoaded && isSignedIn);
  const activeIdentity = AUTH_DISABLED ? 'test-master' : userId ?? null;
  const memberQuery = useMe(canReadTasks);
  const member = memberQuery.data?.clerkId === activeIdentity ? memberQuery.data : null;
  const workersQuery = useWorkers(member?.role === 'master');
  const workers = workersQuery.data ?? [];
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [urgency, setUrgency] = useState<'All' | 'Urgent' | 'Low' | 'Medium' | 'High'>('All');
  const [view, setView] = useState<'open' | 'all' | 'done'>('open');
  const [groupFilter, setGroupFilter] = useState('All groups');
  const [monthFilter, setMonthFilter] = useState(CURRENT_MONTH);
  const [calendarScope, setCalendarScope] = useState<CalendarScope>('month');
  const [weekStart, setWeekStart] = useState(() => localWeekStart());
  const [sort, setSort] = useState<TaskSort>('priority');
  const [assigneeFilter, setAssigneeFilter] = useState('All');
  const [locationFilter, setLocationFilter] = useState('All');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [overdueFilter, setOverdueFilter] = useState(false);
  const [taskViewPreferencesReady, setTaskViewPreferencesReady] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [initialDraft, setInitialDraft] = useState<TaskInput | undefined>();
  const [editingTask, setEditingTask] = useState<FarmTask | undefined>();
  const [detailTask, setDetailTask] = useState<FarmTask | undefined>();
  const [feedback, setFeedback] = useState('');
  const [renewingAccess, setRenewingAccess] = useState(false);
  const [formError, setFormError] = useState('');
  const [handoffError, setHandoffError] = useState('');
  const accountScope = member?.clerkId === activeIdentity ? member.clerkId : null;
  const offline = useOfflineFieldbook(true, accountScope, Boolean(isLoaded && isSignedIn && userId));
  const [location, setLocation] = useLocation();
  const routeSearch = useSearch();
  const handledHandoff = useRef('');
  const stagedCreatedTask = useRef<FarmTask | null>(null);
  useEffect(() => {
    setDetailTask(undefined);
    setEditingTask(undefined);
    setDialogOpen(false);
    setHandoffError('');
    handledHandoff.current = '';
  }, [activeIdentity]);
  const farmSettingsQuery = useGetFarmSettings({
    query: {
      queryKey: getGetFarmSettingsQueryKey(),
      enabled: member?.role === 'master' || member?.role === 'manager',
    },
  });
  const requestAttachmentUpload = useRequestFarmAttachmentUpload();
  const completeAttachmentUpload = useCompleteFarmAttachmentUpload();
  const tasks = accountScope && offline.readyForScope ? offline.tasks : [];
  const groups = useMemo(() => {
    const taskGroups = Array.from(new Set(tasks.map((task) => task.group || 'General').filter(Boolean)));
    const configuredGroups = farmSettingsQuery.data?.groups?.length ? farmSettingsQuery.data.groups : DEFAULT_FARM_GROUPS;
    return ['All groups', ...configuredGroups, ...taskGroups.filter((group) => !configuredGroups.includes(group))];
  }, [farmSettingsQuery.data?.groups, tasks]);
  const locations = useMemo(() => {
    const taskLocations = Array.from(new Set(tasks.map((task) => task.location).filter(Boolean)));
    const configuredLocations = farmSettingsQuery.data?.locations ?? [];
    const orderedLocations = configuredLocations.length
      ? [...configuredLocations, ...taskLocations.filter((location) => !configuredLocations.includes(location))]
      : taskLocations.sort();
    return ['All locations', ...orderedLocations];
  }, [farmSettingsQuery.data?.locations, tasks]);
  const sources = useMemo(() => ['All sources', ...Array.from(new Set(tasks.map(t => t.source).filter(Boolean))).sort()], [tasks]);
  const assignees = useMemo(() => ['All assignees', ...Array.from(new Set(tasks.flatMap((task) => task.assigneeNames?.length ? task.assigneeNames : task.assigneeName ? [task.assigneeName] : []))).sort()], [tasks]);
  const availableMonths = monthOptions(tasks);
  const taskViewPreferences = useMemo<TaskViewPreferences>(() => ({
    search,
    urgency,
    view,
    groupFilter,
    monthFilter,
    calendarScope,
    weekStart,
    assigneeFilter,
    locationFilter,
    sourceFilter,
    overdueFilter,
    sort,
  }), [search, urgency, view, groupFilter, monthFilter, calendarScope, weekStart, assigneeFilter, locationFilter, sourceFilter, overdueFilter, sort]);
  useEffect(() => {
    let active = true;
    const defaults = defaultTaskViewPreferences();
    setTaskViewPreferencesReady(false);
    setSearch(defaults.search);
    setUrgency(defaults.urgency);
    setView(defaults.view);
    setGroupFilter(defaults.groupFilter);
    setMonthFilter(defaults.monthFilter);
    setCalendarScope(defaults.calendarScope);
    setWeekStart(defaults.weekStart);
    setAssigneeFilter(defaults.assigneeFilter);
    setLocationFilter(defaults.locationFilter);
    setSourceFilter(defaults.sourceFilter);
    setOverdueFilter(defaults.overdueFilter);
    setSort(defaults.sort);
    if (!accountScope) return () => { active = false; };
    void readTaskViewPreferences(accountScope).then((saved) => {
      if (!active) return;
      const preferences = normalizeTaskViewPreferences(saved);
      setSearch(preferences.search);
      setUrgency(preferences.urgency);
      setView(preferences.view);
      setGroupFilter(preferences.groupFilter);
      setMonthFilter(preferences.monthFilter);
      setCalendarScope(preferences.calendarScope);
      setWeekStart(preferences.weekStart);
      setAssigneeFilter(preferences.assigneeFilter);
      setLocationFilter(preferences.locationFilter);
      setSourceFilter(preferences.sourceFilter);
      setOverdueFilter(preferences.overdueFilter);
      setSort(preferences.sort);
      setTaskViewPreferencesReady(true);
    });
    return () => { active = false; };
  }, [accountScope]);
  useEffect(() => {
    if (!taskViewPreferencesReady || !accountScope) return;
    void writeTaskViewPreferences(accountScope, taskViewPreferences);
  }, [accountScope, taskViewPreferences, taskViewPreferencesReady]);
  useEffect(() => {
    if (![CURRENT_MONTH, 'all', 'unscheduled'].includes(monthFilter) && !/^\d{4}-\d{2}$/.test(monthFilter)) {
      setMonthFilter(CURRENT_MONTH);
    }
  }, [monthFilter]);
  useEffect(() => {
    const handoffKey = `${location}?${routeSearch}`;
    if (!accountScope || !offline.readyForScope || !routeSearch || handledHandoff.current === handoffKey) return;
    const params = new URLSearchParams(routeSearch);
    const editId = params.get('edit');
    const title = params.get('title');
    if (editId) {
      const taskDataReady = offline.online ? offline.serverChecked : offline.hydrated;
      const handoff = resolveEditTaskHandoff(editId, tasks, taskDataReady);
      if (handoff === 'waiting') return;
      if (!handoff) {
        setHandoffError(offline.syncError && !offline.tasks.length
          ? 'Could not load that task. Refresh and try again.'
          : 'That task is no longer available in this account.');
        handledHandoff.current = handoffKey;
        setLocation('/tasks', { replace: true });
        return;
      }
      setHandoffError('');
      setInitialDraft(undefined);
      setEditingTask(handoff);
      setDialogOpen(true);
    } else if (title) {
      const ids = params.getAll('assigneeId').filter(Boolean);
      const names = params.getAll('assigneeName').filter(Boolean);
      setHandoffError('');
      setEditingTask(undefined);
      setInitialDraft({
        task: title,
        calendarStart: params.get('date') ?? '',
        assigneeIds: ids,
        assigneeNames: names,
        assigneeId: ids[0] ?? '',
        assigneeName: names[0] ?? '',
      });
      setDialogOpen(true);
    } else {
      return;
    }
    handledHandoff.current = handoffKey;
    setLocation('/tasks', { replace: true });
  }, [accountScope, location, offline.hydrated, offline.online, offline.readyForScope, offline.serverChecked, offline.syncError, offline.tasks.length, routeSearch, setLocation, tasks]);
  useEffect(() => {
    const taskFilterOptionsReady = offline.readyForScope;
    if (!taskViewPreferencesReady || !taskFilterOptionsReady) return;
    if (groupFilter !== 'All groups' && !groups.includes(groupFilter)) setGroupFilter('All groups');
    if (locationFilter !== 'All' && !locations.includes(locationFilter)) setLocationFilter('All');
    if (sourceFilter !== 'All' && !sources.includes(sourceFilter)) setSourceFilter('All');
    if (assigneeFilter !== 'All' && !assignees.includes(assigneeFilter)) setAssigneeFilter('All');
  }, [assigneeFilter, assignees, groupFilter, groups, locationFilter, locations, offline.readyForScope, sourceFilter, sources, taskViewPreferencesReady]);

  const filteredTasks = useMemo(() => {
    let result = tasks.filter((task) => {
      const queryText = `${task.task} ${task.group} ${task.location} ${task.notes}`.toLowerCase();
      const matchesSearch = queryText.includes(search.toLowerCase());
      const matchesUrgency = urgency === 'All' || task.urgency === urgency;
      const matchesView = view === 'all' || (view === 'done' ? task.done : !task.done);
      const matchesGroup = groupFilter === 'All groups' || (task.group || 'General') === groupFilter;
       const matchesCalendarScope = calendarScope === 'month'
         ? taskMatchesMonthWithUrgentPin(task, monthFilter)
         : calendarScope === 'week'
           ? taskMatchesLocalWeek(task, weekStart)
           : taskIsUnscheduled(task);
      const taskAssignees = task.assigneeNames?.length ? task.assigneeNames : task.assigneeName ? [task.assigneeName] : [];
      const matchesAssignee = assigneeFilter === 'All' || taskAssignees.includes(assigneeFilter);
      const matchesLocation = locationFilter === 'All' || task.location === locationFilter || (locationFilter === 'All locations' && true);
      const matchesSource = sourceFilter === 'All' || task.source === sourceFilter || (sourceFilter === 'All sources' && true);
      const matchesOverdue = !overdueFilter || isTaskOverdue(task);
       return matchesSearch && matchesUrgency && matchesView && matchesGroup && matchesCalendarScope && matchesAssignee && matchesLocation && matchesSource && matchesOverdue;
    });

     result.sort(compareTasksBySort(sort));

    return result;
   }, [tasks, search, urgency, view, groupFilter, monthFilter, calendarScope, weekStart, assigneeFilter, locationFilter, sourceFilter, overdueFilter, sort]);
   const activePeriodLabel = calendarScope === 'week'
     ? `week of ${weekLabel(weekStart)}`
     : calendarScope === 'unscheduled'
       ? 'unscheduled work'
       : monthFilter === 'all'
         ? 'all months'
         : monthLabel(monthFilter === CURRENT_MONTH ? localMonthKey() : monthFilter);
   const periodRouteUrl = useMemo(
     () => googleMapsRouteUrl(tasks.filter((task) => !task.done && (
       calendarScope === 'month'
         ? taskMatchesMonthWithUrgentPin(task, monthFilter)
         : calendarScope === 'week'
           ? taskMatchesLocalWeek(task, weekStart)
           : taskIsUnscheduled(task)
     ))),
     [tasks, calendarScope, monthFilter, weekStart],
  );
   const resetFilters = () => {
     setSearch(''); setUrgency('All'); setGroupFilter('All groups'); setView('open'); setMonthFilter(CURRENT_MONTH);
     setCalendarScope('month'); setWeekStart(localWeekStart()); setLocationFilter('All'); setAssigneeFilter('All');
     setSourceFilter('All'); setOverdueFilter(false); setSort('priority');
   };
   const navigatePeriod = (direction: -1 | 1) => {
     if (calendarScope === 'week') setWeekStart((current) => shiftLocalWeek(current, direction));
     if (calendarScope === 'month') {
       const currentMonth = monthFilter === CURRENT_MONTH || monthFilter === 'all' || monthFilter === 'unscheduled' ? localMonthKey() : monthFilter;
       setMonthFilter(shiftLocalMonth(currentMonth, direction));
     }
   };

  const refresh = () => { setFeedback(''); void offline.refresh(); };
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [...getListFarmTasksQueryKey({ includeDone: true }), accountScope] });
    void queryClient.invalidateQueries({ queryKey: [...getListFarmTasksQueryKey({ includeDone: false }), accountScope] });
    void queryClient.invalidateQueries({ queryKey: [...getGetFarmTaskSummaryQueryKey(), accountScope] });
  };
  const optimisticallyUpdateTask = (taskId: string, patch: Partial<FarmTask>) => {
    queryClient.setQueryData<{ tasks: FarmTask[] }>([...getListFarmTasksQueryKey({ includeDone: true }), accountScope], (current) => {
      if (!current?.tasks) return current;
      return { ...current, tasks: current.tasks.map((item) => item.id === taskId ? { ...item, ...patch } : item) };
    });
  };
  const updateSummaryForDone = (task: FarmTask, done: boolean) => {
    const delta = done === task.done ? 0 : done ? -1 : 1;
    queryClient.setQueryData([...getGetFarmTaskSummaryQueryKey(), accountScope], (current: { open: number; done: number; highPriority: number; dueThisMonth: number } | undefined) => current ? {
      ...current,
      open: current.open + delta,
      done: current.done - delta,
      highPriority: current.highPriority + (task.urgency === 'Urgent' || task.urgency === 'High' ? delta : 0),
      dueThisMonth: current.dueThisMonth + delta * (task.month.toLowerCase().includes(new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date()).toLowerCase()) ? 1 : 0),
    } : current);
  };
  const openCreate = () => { setEditingTask(undefined); setInitialDraft(undefined); setFormError(''); setQuickCreateOpen(true); };
  const openEdit = (task: FarmTask) => { setInitialDraft(undefined); setEditingTask(task); setFormError(''); setDialogOpen(true); };
  const save = async (draft: TaskInput, attachments: File[] = []) => {
    setFormError('');
    if (editingTask?.id) {
      await offline.saveTask(editingTask, draft);
      setDialogOpen(false);
       setFeedback(offline.online ? 'Changes saved. Syncing to the fieldbook…' : 'Changes saved offline. Pending sync.');
    } else {
       const created = stagedCreatedTask.current ?? await offline.saveTask(undefined, draft);
       stagedCreatedTask.current = created;
       if (attachments.length) {
          if (!offline.online) {
            throw new Error('The task is saved offline. Reconnect and press Add to the board again to upload the photo.');
          }
          await offline.ensureTaskSynced(created.id);
         for (const file of attachments) {
           await uploadFarmAttachment({ taskId: created.id, file, requestUpload: requestAttachmentUpload, completeUpload: completeAttachmentUpload });
         }
          invalidate();
       }
       stagedCreatedTask.current = null;
       setDialogOpen(false);
       setFeedback(offline.online ? 'New task added.' : 'New task added offline. Pending sync.');
    }
  };
  const continueQuickCreate = (draft: TaskInput) => {
    setQuickCreateOpen(false);
    setEditingTask(undefined);
    setInitialDraft(draft);
    setDialogOpen(true);
  };
  const toggle = (task: FarmTask, done: boolean) => {
    void offline.saveTask(task, { task: task.task, done }).then(() => setFeedback(done ? 'Task complete. It will stay in the record.' : 'Task reopened.'));
  };
  const toggleSubtask = (task: FarmTask, subtaskId: string, done: boolean) => {
    const updatedSubtasks = task.subtasks.map(st => st.id === subtaskId ? { ...st, done } : st);
    void offline.saveTask(task, { task: task.task, subtasks: updatedSubtasks });
  };
  const cycleUrgency = (task: FarmTask) => {
    const order: FarmTask['urgency'][] = ['Urgent', 'High', 'Medium', 'Low'];
    const next = order[(order.indexOf(task.urgency) + 1) % order.length];
    void offline.saveTask(task, { task: task.task, urgency: next }).then(() => setFeedback(`Priority changed to ${next}.`));
  };
  const remove = (task: FarmTask) => {
    if (!window.confirm(`Delete “${task.task}”? This removes it from the connected sheet.`)) return;
    void offline.removeTask(task).then(() => setFeedback(offline.online ? 'Task deleted from the fieldbook.' : 'Task deleted offline. Pending sync.'));
  };
  const retryPending = async () => {
    setFeedback('Retrying pending changes…');
    try {
      const result = await offline.retryPendingChanges();
      setFeedback(result.pendingCount === 0
        ? 'Changes reached the connected fieldbook.'
        : `${result.pendingCount} change${result.pendingCount === 1 ? '' : 's'} still pending. Your local work is safe.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not retry pending changes.');
    }
  };
  const renewAccess = async () => {
    if (renewingAccess) return;
    setRenewingAccess(true);
    setFeedback('Renewing access…');
    try {
      if (clerk.session) {
        await clerk.session.touch();
        const result = await offline.retryPendingChanges();
        setFeedback(result.pendingCount === 0
          ? 'Changes reached the connected fieldbook.'
          : `${result.pendingCount} change${result.pendingCount === 1 ? '' : 's'} still pending. Your local work is safe.`);
      } else {
        clerk.openSignIn({ forceRedirectUrl: window.location.href });
      }
    } catch {
      clerk.openSignIn({ forceRedirectUrl: window.location.href });
    } finally {
      setRenewingAccess(false);
    }
  };

  return (
    <PlannerShell
      loadSourceQuery={false}
      syncStatus={{
        online: offline.online,
        syncing: offline.syncing,
        retrying: offline.retrying,
        pendingCount: offline.pendingCount,
        failedCount: offline.failedMutations?.length ?? 0,
        conflictCount: offline.conflicts?.length ?? 0,
        sourceUrl: offline.sourceUrl,
      }}
    >
      <div className="page-enter mx-auto max-w-[1440px] px-5 py-7 md:px-10 md:py-12 xl:px-14">
        <PageHeader eyebrow="All tasks" title="All tasks." description="Search and update the shared task list." action={<div className="flex items-center gap-2"><PrintPlanner tasks={tasks} /><button type="button" onClick={openCreate} data-testid="button-add-task" className="inline-flex w-fit items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-semibold text-[hsl(var(--primary-foreground))] shadow-[0_5px_0_hsl(156_28%_18%)] transition-transform hover:-translate-y-0.5 active:translate-y-0 active:shadow-none"><Plus size={17} /> Add task</button></div>} />

        {feedback && <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-[hsl(76_28%_67%/.48)] bg-[hsl(76_35%_92%/.7)] px-4 py-3 text-xs font-medium text-[hsl(155_28%_29%)]" role="status" data-testid="status-feedback-tasks"><span>{feedback}</span><button type="button" onClick={() => setFeedback('')} data-testid="button-dismiss-feedback-tasks" className="text-lg leading-none">×</button></div>}
         {offline.authRequired && <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[hsl(var(--accent)/.55)] bg-[hsl(var(--accent)/.12)] px-4 py-3 text-sm text-[hsl(var(--foreground))]" role="alert" data-testid="status-auth-recovery-tasks"><div><strong className="font-semibold">Renew access to sync your fieldbook.</strong><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Your local changes are safe and will stay queued while you renew your sign-in.</p></div><button type="button" onClick={() => void renewAccess()} disabled={renewingAccess} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-3 py-2 text-xs font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50" data-testid="button-renew-fieldbook-access"><RefreshCw size={14} className={renewingAccess ? 'animate-spin' : ''} />{renewingAccess ? 'Renewing…' : 'Renew access'}</button></div>}
        {handoffError && <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.08)] px-4 py-3 text-sm text-[hsl(var(--destructive))]" role="alert" data-testid="status-task-handoff-error"><span>{handoffError}</span><button type="button" onClick={() => setHandoffError('')} aria-label="Dismiss task editor error" className="text-lg leading-none">×</button></div>}
         <ConflictNotice conflicts={offline.conflicts} onResolve={(conflict, choice) => void offline.resolveConflict(conflict, choice)} />
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-y border-[hsl(var(--border))] py-3"><SourcePill source={offline.online ? offline.source : 'Local fieldbook'} /><div className="flex items-center gap-4"><SyncNotice syncing={offline.syncing} message={!offline.online ? `Offline · ${offline.pendingCount} pending` : (offline.conflicts?.length ?? 0) ? `${offline.conflicts.length} conflict${offline.conflicts.length === 1 ? '' : 's'} need review` : (offline.failedMutations?.length ?? 0) ? `${offline.failedMutations.length} change${offline.failedMutations.length === 1 ? '' : 's'} need attention` : offline.retrying ? `Retrying ${offline.pendingCount} pending change${offline.pendingCount === 1 ? '' : 's'}…` : offline.pendingCount ? `${offline.pendingCount} pending sync` : 'Up to date'} /><RetryPendingChangesButton pendingCount={offline.pendingCount} syncing={offline.syncing} onRetry={retryPending} testId="button-retry-pending-tasks" /><button type="button" onClick={refresh} disabled={offline.syncing} data-testid="button-refresh-tasks" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 font-mono text-[10px] uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"><RefreshCw size={13} className={offline.syncing ? 'animate-spin' : ''} /> Refresh</button></div></div>

        <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.5)] p-4 md:p-5">
          <div data-testid="task-search-row">
            <label htmlFor="all-tasks-search" className="block text-sm font-semibold text-[hsl(var(--foreground))]">Search all tasks</label>
            <div className="relative mt-2">
              <Search size={19} aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
              <input id="all-tasks-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} data-testid="input-search-tasks" placeholder="Search by task, place, or note" style={{ paddingRight: '3rem' }} className="field-input min-h-12 py-3.5 text-base" />
            </div>
          </div>
          <div data-testid="task-filter-criteria" className="mt-5 border-t border-[hsl(var(--border))] pt-4">
            <div className="flex flex-wrap gap-2">
               <label className="relative"><SlidersHorizontal size={14} aria-hidden="true" className="pointer-events-none absolute right-8 top-3 text-[hsl(var(--muted-foreground))]" /><select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} data-testid="select-filter-group" style={{ paddingRight: '3.5rem' }} className="field-input min-w-[130px] pr-14"><option>All groups</option>{groups.slice(1).map((group) => <option key={group}>{group}</option>)}</select></label>
               <label className="relative"><Filter size={14} aria-hidden="true" className="pointer-events-none absolute right-8 top-3 text-[hsl(var(--muted-foreground))]" /><select value={urgency} onChange={(event) => setUrgency(event.target.value as typeof urgency)} data-testid="select-filter-urgency" style={{ paddingRight: '3.5rem' }} className="field-input min-w-[128px] pr-14"><option value="All">All priority</option><option value="Urgent">Urgent</option><option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option></select></label>
              <label className="relative"><select value={monthFilter} onChange={(event) => { const value = event.target.value; setMonthFilter(value); setCalendarScope(value === 'unscheduled' ? 'unscheduled' : 'month'); }} data-testid="select-filter-month" className="field-input min-w-[140px] pr-8"><option value="all">All months</option><option value={CURRENT_MONTH}>Current month</option><option value="unscheduled">Unscheduled</option>{availableMonths.map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}</select></label>
              <label className="relative"><select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} data-testid="select-filter-location" className="field-input min-w-[140px] pr-8">{locations.map(loc => <option key={loc} value={loc === 'All locations' ? 'All' : loc}>{loc}</option>)}</select></label>
              <label className="relative"><select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)} data-testid="select-filter-assignee" className="field-input min-w-[140px] pr-8">{assignees.map(a => <option key={a} value={a === 'All assignees' ? 'All' : a}>{a}</option>)}</select></label>
              <label className="relative"><select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} data-testid="select-filter-source" className="field-input min-w-[140px] pr-8">{sources.map(s => <option key={s} value={s === 'All sources' ? 'All' : s}>{s}</option>)}</select></label>
              <label className="relative"><select value={sort} onChange={(event) => setSort(event.target.value as TaskSort)} data-testid="select-sort-tasks" className="field-input min-w-[150px] pr-8"><option value="priority">Priority</option><option value="date">Date</option><option value="title">Title</option><option value="updated">Recently updated</option></select></label>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border))] pt-4">
            <div className="flex items-center gap-1 rounded-xl bg-[hsl(var(--muted))] p-1" aria-label="Calendar scope">
              <button type="button" aria-pressed={calendarScope === 'month'} onClick={() => { setCalendarScope('month'); if (monthFilter === 'unscheduled') setMonthFilter(CURRENT_MONTH); }} data-testid="button-calendar-month" className={`rounded-lg px-3 py-2 text-xs font-semibold ${calendarScope === 'month' ? 'bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}>Month</button>
              <button type="button" aria-pressed={calendarScope === 'week'} onClick={() => setCalendarScope('week')} data-testid="button-calendar-week" className={`rounded-lg px-3 py-2 text-xs font-semibold ${calendarScope === 'week' ? 'bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}>Week</button>
              <button type="button" aria-pressed={calendarScope === 'unscheduled'} onClick={() => { setCalendarScope('unscheduled'); setMonthFilter('unscheduled'); }} data-testid="button-calendar-unscheduled" className={`rounded-lg px-3 py-2 text-xs font-semibold ${calendarScope === 'unscheduled' ? 'bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}>Unscheduled</button>
            </div>
            <div className="flex items-center gap-2">
              {calendarScope !== 'unscheduled' && <><button type="button" onClick={() => navigatePeriod(-1)} data-testid="button-period-previous" aria-label="Previous period" className="rounded-lg border border-[hsl(var(--border))] p-2 hover:bg-[hsl(var(--muted))]"><ChevronLeft size={16} /></button><span className="min-w-[190px] text-center text-sm font-semibold text-[hsl(var(--foreground))]" data-testid="text-active-period">{activePeriodLabel}</span><button type="button" onClick={() => navigatePeriod(1)} data-testid="button-period-next" aria-label="Next period" className="rounded-lg border border-[hsl(var(--border))] p-2 hover:bg-[hsl(var(--muted))]"><ChevronRight size={16} /></button><button type="button" onClick={() => calendarScope === 'week' ? setWeekStart(localWeekStart()) : setMonthFilter(CURRENT_MONTH)} data-testid="button-period-current" className="ml-1 text-xs font-semibold text-[hsl(var(--primary))] hover:underline">Current</button></>}
              {calendarScope === 'unscheduled' && <span className="text-sm font-semibold text-[hsl(var(--foreground))]" data-testid="text-active-period">Unscheduled tasks</span>}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border))] pt-4">
            <div className="flex items-center gap-1 overflow-x-auto">
              {(['open', 'all', 'done'] as const).map((option) => <button key={option} type="button" aria-pressed={view === option} onClick={() => setView(option)} data-testid={`button-view-${option}`} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold capitalize transition-colors ${view === option ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'}`}>{option === 'open' ? 'Open work' : option === 'done' ? 'Completed' : 'Everything'}</button>)}
              <button type="button" onClick={() => setOverdueFilter(!overdueFilter)} data-testid="button-view-overdue" className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${overdueFilter ? 'bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'}`}>Overdue</button>
            </div>
            <div className="flex items-center gap-3">
              {(search || urgency !== 'All' || groupFilter !== 'All groups' || monthFilter !== CURRENT_MONTH || calendarScope !== 'month' || locationFilter !== 'All' || assigneeFilter !== 'All' || sourceFilter !== 'All' || overdueFilter || sort !== 'priority') && (
                <button type="button" onClick={resetFilters} className="text-xs font-semibold text-[hsl(var(--muted-foreground))] hover:underline" data-testid="button-reset-filters">Reset filters</button>
              )}
              <span className="hidden items-center gap-1.5 font-mono text-[10px] uppercase tracking-[.09em] text-[hsl(var(--muted-foreground))] sm:flex"><ListFilter size={13} /> {filteredTasks.length} shown</span>
            </div>
          </div>
          <div className="mt-3 border-t border-[hsl(var(--border))] pt-3">
            {periodRouteUrl ? <a href={periodRouteUrl} target="_blank" rel="noreferrer" data-testid="open-period-map" className="inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-3 py-2 text-xs font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]"><Filter size={14} />Map open tasks for {activePeriodLabel}</a> : <div className="flex flex-wrap items-center gap-3"><p className="text-xs text-[hsl(var(--muted-foreground))]">Save a GPS pin on an open task to map this period’s field route.</p><a href={FARM_MAP_START_URL} target="_blank" rel="noreferrer" data-testid="open-farm-map" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[hsl(var(--primary))] hover:underline">Open farm map <ExternalLink size={12} /></a></div>}
          </div>
        </section>

        <div className="mt-7">
             {!taskViewPreferencesReady || !offline.hydrated ? <TaskSkeleton count={6} /> : offline.syncError && !tasks.length ? <ErrorState onRetry={refresh} message="The fieldbook could not be refreshed. Your saved offline work is still safe." /> : filteredTasks.length === 0 ? (tasks.length === 0 && !search && view === 'open' && calendarScope === 'month' && monthFilter === 'all' ? <EmptyState onAdd={openCreate} /> : <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-6 py-14 text-center" data-testid="state-no-filter-results"><div className="mx-auto flex size-11 items-center justify-center rounded-full bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"><Search size={18} /></div><h2 className="mt-4 font-serif text-2xl text-[hsl(var(--foreground))]">{calendarScope !== 'month' || monthFilter !== 'all' ? `No work for ${activePeriodLabel}` : 'Nothing matches that trail'}</h2><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{calendarScope !== 'month' || monthFilter !== 'all' ? 'Try another period or clear the filters.' : 'Try a wider search or clear one of the filters.'}</p><button type="button" onClick={resetFilters} data-testid="button-clear-filters" className="mt-5 rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-xs font-semibold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]">Clear filters</button></div>) : (
            <div className="mx-auto max-w-5xl space-y-2">{filteredTasks.map((task) => <TaskCard compact key={task.id} task={task} onOpen={() => setDetailTask(task)} onToggle={(done) => toggle(task, done)} onToggleSubtask={(subtaskId, done) => toggleSubtask(task, subtaskId, done)} onCycleUrgency={() => cycleUrgency(task)} onEdit={() => openEdit(task)} onDelete={() => remove(task)} />)}</div>
          )}
        </div>
        {tasks.length > 0 && <div className="mt-7 flex items-center justify-between border-t border-[hsl(var(--border))] pt-4 text-[11px] text-[hsl(var(--muted-foreground))]"><span data-testid="text-task-count">{filteredTasks.length} of {tasks.length} tasks shown</span><span className="inline-flex items-center gap-1.5"><Check size={13} /> changes sync to source</span></div>}
      </div>
      <CompactTaskCreate open={Boolean(accountScope && quickCreateOpen)} onOpenChange={setQuickCreateOpen} workers={workers} onSave={async (draft) => { await offline.saveTask(undefined, draft); setFeedback('New task added.'); }} onContinue={continueQuickCreate} />
      <TaskFormDialog open={Boolean(accountScope && dialogOpen)} task={accountScope ? editingTask : undefined} initialDraft={initialDraft} error={formError} onClose={() => { stagedCreatedTask.current = null; setDialogOpen(false); setInitialDraft(undefined); }} onSave={save} workers={workers} canAssign={member?.role === 'master'} />
      <TaskDetailsDialog task={accountScope ? detailTask : undefined} onClose={() => setDetailTask(undefined)} />
    </PlannerShell>
  );
}
