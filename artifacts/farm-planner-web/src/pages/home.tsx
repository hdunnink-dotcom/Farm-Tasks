import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Bot, Sparkles, Settings2, Check, AlertTriangle, Sun, CalendarDays } from 'lucide-react';
import { Link } from 'wouter';
import { useAuth } from '@clerk/react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronDown } from 'lucide-react';
import {
  getGetFarmTaskSummaryQueryKey,
  getListFarmTasksQueryKey,
  getGetTodaysDailyPlanQueryKey,
  getListAssistantProposalsQueryKey,
  getGetDailyPlanSettingsQueryKey,
  useCompleteFarmAttachmentUpload,
  useRequestFarmAttachmentUpload,
  useGetTodaysDailyPlan,
  useRefreshDailyPlan,
  useGetDailyPlanSettings,
  useUpdateDailyPlanSettings,
  useListAssistantProposals,
  useApproveAssistantProposalTask,
  useRejectAssistantProposalTask,
  getListPendingFarmTasksQueryKey,
  useListPendingFarmTasks,
  useApproveFarmTask,
  useRejectFarmTask,
  type FarmTask,
} from '@workspace/api-client-react';
import { ConflictNotice, ErrorState, PageHeader, PlannerShell, RetryPendingChangesButton, SourcePill, SyncNotice, TaskCard, TaskSkeleton, TaskDetailsDialog, EmptyState } from '@/components/farm-planner';
import { TaskFormDialog } from '@/components/task-form-dialog';
import { uploadFarmAttachment } from '@/lib/farm-attachment-upload';
import { AUTH_DISABLED } from '@/lib/auth-config';
import { useOfflineFieldbook } from '@/lib/offline-fieldbook';
import { MonthlyOverview } from '@/components/monthly-overview';
import { useMe } from '@/hooks/use-me';
import { useWorkers } from '@/hooks/use-workers';
import { trackEvent } from '@/lib/analytics';
import { buildTodayFocus } from '@/lib/today-focus';
import { localAucklandDateKey } from '@/lib/task-calendar';

const todayLabel = () => new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

type HomeView = 'priority' | 'area';
const HOME_VIEW_KEY = 'farm-planner.home-view';

function readHomeView(): HomeView {
  try {
    return window.localStorage.getItem(HOME_VIEW_KEY) === 'area' ? 'area' : 'priority';
  } catch {
    return 'priority';
  }
}

export default function HomePage() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const canReadTasks = AUTH_DISABLED || (isLoaded && isSignedIn);
  const activeIdentity = AUTH_DISABLED ? 'test-master' : userId ?? null;
  const queryClient = useQueryClient();
  const memberQuery = useMe(canReadTasks);
  const member = memberQuery.data?.clerkId === activeIdentity ? memberQuery.data : null;
  const workersQuery = useWorkers(member?.role === 'master');
  const workers = workersQuery.data ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<FarmTask | undefined>();
  const [detailTask, setDetailTask] = useState<FarmTask | undefined>();
  const [feedback, setFeedback] = useState('');
  const [formError, setFormError] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<HomeView>(readHomeView);
  // Ticked-off work stays in place (struck through) until the next refresh, so a mis-tap is easy to undo.
  const [justCompleted, setJustCompleted] = useState<Set<string>>(() => new Set());
  const stagedCreatedTask = useRef<FarmTask | null>(null);
  const accountScope = member?.clerkId === activeIdentity ? member.clerkId : null;
  const offline = useOfflineFieldbook(false, accountScope);
  useEffect(() => {
    setDetailTask(undefined);
    setEditingTask(undefined);
    setDialogOpen(false);
    setFeedback('');
  }, [activeIdentity]);
  const isOwner = member?.role === 'master';
  const isHarnold = member?.isHarnold === true;

  const planQuery = useGetTodaysDailyPlan({ query: { queryKey: [...getGetTodaysDailyPlanQueryKey(), accountScope], enabled: Boolean(accountScope) } });
  const planSettingsQuery = useGetDailyPlanSettings({ query: { queryKey: [...getGetDailyPlanSettingsQueryKey(), accountScope], enabled: Boolean(accountScope) && isOwner } });
  const updatePlanSettings = useUpdateDailyPlanSettings({
    mutation: {
      onSuccess: () => {
        setFeedback('Daily plan settings updated.');
        queryClient.invalidateQueries({ queryKey: [...getGetDailyPlanSettingsQueryKey(), accountScope] });
      }
    }
  });
  const refreshPlan = useRefreshDailyPlan({
    mutation: {
      onSuccess: () => {
        trackEvent('daily_plan_refreshed');
        setFeedback('Generated new daily plan.');
        queryClient.invalidateQueries({ queryKey: [...getGetTodaysDailyPlanQueryKey(), accountScope] });
      }
    }
  });

  const proposalsQuery = useListAssistantProposals(undefined, { query: { queryKey: [...getListAssistantProposalsQueryKey(), accountScope], enabled: Boolean(accountScope) && isOwner } });
  const pendingTasksQuery = useListPendingFarmTasks({ query: { queryKey: [...getListPendingFarmTasksQueryKey(), accountScope], enabled: Boolean(accountScope) && isHarnold } });
  const approveFarmTask = useApproveFarmTask({ mutation: { onSuccess: () => { trackEvent('worker_submission_reviewed', { outcome: 'approved' }); void pendingTasksQuery.refetch(); invalidateAll(); setFeedback('Worker submission approved.'); }, onError: () => setFeedback('Could not approve that submission.') } });
  const rejectFarmTask = useRejectFarmTask({ mutation: { onSuccess: () => { trackEvent('worker_submission_reviewed', { outcome: 'rejected' }); void pendingTasksQuery.refetch(); invalidateAll(); setFeedback('Worker submission rejected.'); }, onError: () => setFeedback('Could not reject that submission.') } });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: [...getListFarmTasksQueryKey({ includeDone: false }), accountScope] });
    queryClient.invalidateQueries({ queryKey: [...getListFarmTasksQueryKey({ includeDone: true }), accountScope] });
    queryClient.invalidateQueries({ queryKey: [...getGetFarmTaskSummaryQueryKey(), accountScope] });
    queryClient.invalidateQueries({ queryKey: [...getGetTodaysDailyPlanQueryKey(), accountScope] });
    queryClient.invalidateQueries({ queryKey: [...getListAssistantProposalsQueryKey(), accountScope] });
    queryClient.invalidateQueries({ queryKey: [...getListPendingFarmTasksQueryKey(), accountScope] });
  };

  const approveTask = useApproveAssistantProposalTask({
    mutation: {
      onSuccess: () => {
        trackEvent('assistant_suggestion_reviewed', { outcome: 'approved' });
        invalidateAll();
        setFeedback('Approved suggestion to fieldbook.');
      },
      onError: () => setFeedback('Failed to approve suggestion.')
    }
  });
  const rejectTask = useRejectAssistantProposalTask({
    mutation: {
      onSuccess: () => { trackEvent('assistant_suggestion_reviewed', { outcome: 'rejected' }); invalidateAll(); setFeedback('Dismissed suggestion.'); }
    }
  });

  const requestAttachmentUpload = useRequestFarmAttachmentUpload();
  const completeAttachmentUpload = useCompleteFarmAttachmentUpload();

  const tasks = accountScope && offline.readyForScope ? offline.tasks : [];
  const tasksById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
  const focus = useMemo(() => {
    const todayKey = localAucklandDateKey();
    const buckets = buildTodayFocus(tasks.map(t => (t.done && justCompleted.has(t.id) ? { ...t, done: false } : t)), todayKey);
    const live = (list: FarmTask[]) => list.map(t => tasksById.get(t.id) ?? t);
    return { overdue: live(buckets.overdue), today: live(buckets.today), upcoming: live(buckets.upcoming) };
  }, [tasks, tasksById, justCompleted]);
  const renderCard = (task: FarmTask) => (
    <div key={task.id} className="p-1">
      <TaskCard compact task={task} onOpen={() => setDetailTask(task)} onToggle={(done) => handleToggle(task, done)} onToggleSubtask={(subtaskId, done) => handleToggleSubtask(task, subtaskId, done)} onCycleUrgency={() => cycleUrgency(task)} onEdit={() => { setEditingTask(task); setFormError(''); setDialogOpen(true); }} onDelete={() => handleDelete(task)} />
    </div>
  );

  const toggleGroup = (group: string) => setCollapsedGroups(prev => ({ ...prev, [group]: !prev[group] }));

  const changeView = (next: HomeView) => {
    setView(next);
    // The server rebuilds the plan after every change, so fetch its latest copy.
    if (next === 'area') void planQuery.refetch();
    try { window.localStorage.setItem(HOME_VIEW_KEY, next); } catch { /* view choice is only a convenience */ }
  };

  const refresh = () => {
    setFeedback('');
    setJustCompleted(new Set());
    void offline.refresh();
    void Promise.all([planQuery.refetch(), proposalsQuery.refetch()]);
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

  const openCreate = (group?: string) => {
    setEditingTask(undefined);
    setFormError('');
    if (group) {
      // Small trick to prefill group if passing through openCreate
      // Normally TaskFormDialog uses blankDraft, we can't easily pass it without state.
      // We'll manage this by passing a partial task to editingTask with just the group.
      setEditingTask({ group, task: '', done: false, urgency: 'Medium', month: '', location: '', subtasks: [], attachments: [], source: 'Manual', calendarEventId: '', calendarRecurringEventId: '', calendarStart: '', calendarUpdated: '', updatedAt: '', id: '', assigneeId: '', assigneeName: '', notes: '', link: '' } as unknown as FarmTask);
    }
    setDialogOpen(true);
  };

  const handleSave = async (draft: any, attachments: File[] = []) => {
    setFormError('');
    const isNew = !editingTask?.id;
    if (editingTask?.id) {
      await offline.saveTask(editingTask, draft);
      setDialogOpen(false);
       setFeedback(offline.online ? 'Task updated. Syncing to the fieldbook…' : 'Task updated offline. Pending sync.');
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
        invalidateAll();
      }
      stagedCreatedTask.current = null;
      setDialogOpen(false);
       setFeedback(offline.online ? (isOwner ? 'Task added to the board.' : 'Task submitted for Harnold’s review.') : 'Task added offline. Pending sync.');
    }
  };

  const handleDelete = (task: FarmTask) => {
    if (!window.confirm(`Remove “${task.task}” from the fieldbook?`)) return;
    void offline.removeTask(task).then(() => {
      setFeedback(offline.online ? 'Task removed.' : 'Task removed offline. Pending sync.');
    });
  };

  const handleToggle = (task: FarmTask, done: boolean) => {
    setJustCompleted(prev => {
      const next = new Set(prev);
      if (done) next.add(task.id); else next.delete(task.id);
      return next;
    });
    void offline.saveTask(task, { task: task.task, done }).then(() => setFeedback(done ? 'Marked complete.' : 'Task reopened.'));
  };
  const handleToggleSubtask = (task: FarmTask, subtaskId: string, done: boolean) => {
    const updatedSubtasks = task.subtasks.map(st => st.id === subtaskId ? { ...st, done } : st);
    void offline.saveTask(task, { task: task.task, subtasks: updatedSubtasks });
  };
  const cycleUrgency = (task: FarmTask) => {
    const order: FarmTask['urgency'][] = ['Urgent', 'High', 'Medium', 'Low'];
    const next = order[(order.indexOf(task.urgency) + 1) % order.length];
    void offline.saveTask(task, { task: task.task, urgency: next }).then(() => {
      setFeedback(`Priority changed to ${next}.`);
    });
  };

  const pendingProposals = useMemo(() => {
    return proposalsQuery.data?.flatMap(p => p.tasks.filter(t => t.status === 'pending').map(t => ({ ...t, proposalId: p.id }))) || [];
  }, [proposalsQuery.data]);
  const pendingWorkerTasks = pendingTasksQuery.data?.tasks ?? [];

  const isLoading = !offline.hydrated;

  return (
    <PlannerShell
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
        <PageHeader
          eyebrow={todayLabel()}
          title="Today's work."
          description="Automatically prepared fieldbook plan for today."
          action={canReadTasks ? <button type="button" onClick={() => openCreate()} data-testid="button-add-task-home" className="inline-flex w-fit items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-semibold text-[hsl(var(--primary-foreground))] shadow-[0_5px_0_hsl(156_28%_18%)] transition-transform hover:-translate-y-0.5 active:translate-y-0 active:shadow-none"><Plus size={17} /> Add task</button> : <Link href="/sign-in" data-testid="link-sign-in-home" className="inline-flex w-fit items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-semibold text-[hsl(var(--primary-foreground))] shadow-[0_5px_0_hsl(156_28%_18%)]">Sign in to view work</Link>}
        />

        {feedback && <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-[hsl(76_28%_67%/.48)] bg-[hsl(76_35%_92%/.7)] px-4 py-3 text-xs font-medium text-[hsl(155_28%_29%)]" role="status" data-testid="status-feedback-home"><span>{feedback}</span><button type="button" onClick={() => setFeedback('')} aria-label="Dismiss message" data-testid="button-dismiss-feedback"><span className="text-lg leading-none">×</span></button></div>}
        <ConflictNotice conflicts={offline.conflicts} onResolve={(conflict, choice) => void offline.resolveConflict(conflict, choice)} />

        <div className="mb-8 flex flex-wrap items-center justify-between gap-3 border-y border-[hsl(var(--border))] py-3">
          <SourcePill source={offline.online ? offline.source : 'Local fieldbook'} />
          <div className="flex items-center gap-4">
            <SyncNotice syncing={offline.syncing} message={!offline.online ? `Offline · ${offline.pendingCount} pending` : offline.retrying ? `Retrying ${offline.pendingCount} pending change(s)…` : offline.pendingCount ? `${offline.pendingCount} pending sync` : undefined} />
            <RetryPendingChangesButton pendingCount={offline.pendingCount} syncing={offline.syncing} onRetry={retryPending} testId="button-retry-pending-home" />
            <button type="button" onClick={refresh} disabled={offline.syncing || planQuery.isFetching} data-testid="button-refresh-home" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 font-mono text-[10px] uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-50">
              <RefreshCw size={13} className={offline.syncing ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,.6fr)]">
          <main>
            {canReadTasks && (
              <div className="mb-5 inline-flex rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.4)] p-1" role="tablist" aria-label="How to show today's work">
                {([['priority', 'Priority'], ['area', 'By area']] as const).map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => changeView(key)} data-testid={`button-home-view-${key}`} className={`min-h-10 rounded-lg px-4 text-xs font-semibold transition-colors ${view === key ? 'bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}>{label}</button>
                ))}
              </div>
            )}
            {!(AUTH_DISABLED || isLoaded) ? <TaskSkeleton count={4} /> : !canReadTasks ? (
              <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-6 py-12 text-center">
                <h2 className="font-serif text-2xl text-[hsl(var(--foreground))]">Sign in to see the fieldbook</h2>
                <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">The shared Google Sheet is available to approved farm members.</p>
                <Link href="/sign-in" className="mt-5 inline-flex rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-semibold text-[hsl(var(--primary-foreground))]">Sign in</Link>
              </div>
            ) : isLoading || (view === 'area' && planQuery.isLoading) ? (
              <TaskSkeleton count={4} />
            ) : offline.syncError && !tasks.length ? (
              <ErrorState onRetry={refresh} message="The fieldbook could not be refreshed. Your saved offline work is still safe." />
            ) : view === 'priority' ? (
              <div className="space-y-6" data-testid="home-priority-view">
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ['overdue', 'Overdue', focus.overdue, 'text-[hsl(var(--destructive))]'],
                    ['today', 'Today', focus.today, 'text-[hsl(var(--primary))]'],
                    ['upcoming', 'Next 7 days', focus.upcoming, 'text-[hsl(var(--foreground))]'],
                  ] as const).map(([key, label, list, tone]) => (
                    <a key={key} href={`#focus-${key}`} data-testid={`focus-count-${key}`} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2.5">
                      <span className={`block font-serif text-2xl leading-none ${tone}`}>{list.filter(t => !t.done).length}</span>
                      <span className="mt-1 block font-mono text-[10px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">{label}</span>
                    </a>
                  ))}
                </div>
                {focus.overdue.length > 0 && (
                  <section id="focus-overdue" className="scroll-mt-4 overflow-hidden rounded-2xl border border-[hsl(var(--destructive)/.35)] bg-[hsl(var(--card))]" data-testid="focus-section-overdue">
                    <h2 className="flex items-center gap-2 border-b border-[hsl(var(--destructive)/.25)] bg-[hsl(var(--destructive)/.08)] px-4 py-3 font-mono text-[11px] font-semibold uppercase tracking-[.15em] text-[hsl(var(--destructive))]"><AlertTriangle size={14} /> Overdue · do first or move</h2>
                    <div className="divide-y divide-[hsl(var(--border))]">{focus.overdue.map(renderCard)}</div>
                  </section>
                )}
                <section id="focus-today" className="scroll-mt-4 overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]" data-testid="focus-section-today">
                  <h2 className="flex items-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.35)] px-4 py-3 font-mono text-[11px] font-semibold uppercase tracking-[.15em]"><Sun size={14} /> Today · highest priority first</h2>
                  {focus.today.length
                    ? <div className="divide-y divide-[hsl(var(--border))]">{focus.today.map(renderCard)}</div>
                    : <p className="px-4 py-6 text-sm text-[hsl(var(--muted-foreground))]">Nothing scheduled for today.</p>}
                </section>
                {focus.upcoming.length > 0 && (
                  <Collapsible.Root id="focus-upcoming" defaultOpen={focus.today.length + focus.overdue.length < 6} className="scroll-mt-4 overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]" data-testid="focus-section-upcoming">
                    <Collapsible.Trigger asChild>
                      <button type="button" className="group flex w-full items-center gap-2 bg-[hsl(var(--muted)/.35)] px-4 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[.15em]">
                        <CalendarDays size={14} /> Next 7 days
                        <span className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">{focus.upcoming.length}</span>
                        <ChevronDown size={15} className="ml-auto text-[hsl(var(--muted-foreground))] transition-transform group-data-[state=open]:rotate-180" />
                      </button>
                    </Collapsible.Trigger>
                    <Collapsible.Content>
                      <div className="divide-y divide-[hsl(var(--border))] border-t border-[hsl(var(--border))]">{focus.upcoming.map(renderCard)}</div>
                    </Collapsible.Content>
                  </Collapsible.Root>
                )}
              </div>
            ) : planQuery.isError ? (
              <ErrorState onRetry={refresh} message="Could not load today's plan." />
            ) : !planQuery.data || planQuery.data.groups.length === 0 ? (
              <EmptyState onAdd={() => openCreate()} />
            ) : (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="font-serif text-2xl text-[hsl(var(--foreground))]">Daily Plan</h2>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[10px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))] inline-flex items-center gap-1">
                      {planQuery.data.generatedBy === 'claude' ? <><Sparkles size={12} /> Claude generated</> : <><Settings2 size={12} /> Deterministic</>}
                    </span>
                    {isOwner && <button type="button" onClick={() => refreshPlan.mutate()} disabled={refreshPlan.isPending} data-testid="button-regenerate-plan" className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-50">
                      <RefreshCw size={13} className={refreshPlan.isPending ? 'animate-spin' : ''} /> Regenerate
                    </button>}
                  </div>
                </div>

                <div className="space-y-6">
                  {planQuery.data.groups.map(group => {
                    const resolvedTasks = group.items.map(item => tasksById.get(item.taskId)).filter(Boolean) as FarmTask[];
                    if (resolvedTasks.length === 0) return null;
                    const openCount = resolvedTasks.filter(t => !t.done).length;

                    return (
                      <Collapsible.Root key={group.name} open={!collapsedGroups[group.name]} onOpenChange={() => toggleGroup(group.name)} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden" data-testid={`group-daily-plan-${group.name.toLowerCase().replaceAll(' ', '-')}`}>
                        <div className="flex items-center justify-between bg-[hsl(var(--muted)/.35)] px-4 py-3 border-b border-[hsl(var(--border))]">
                          <Collapsible.Trigger asChild>
                            <button type="button" data-testid={`button-toggle-group-${group.name.toLowerCase().replaceAll(' ', '-')}`} className="group flex flex-1 items-center gap-3 text-left">
                              <span className="size-2 rounded-full bg-[hsl(var(--accent))]" />
                              <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[.15em] text-[hsl(var(--foreground))]">{group.name}</h3>
                              <span className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 font-mono text-[10px] text-[hsl(var(--muted-foreground))]">{openCount} open</span>
                              <ChevronDown size={15} className="ml-auto text-[hsl(var(--muted-foreground))] transition-transform group-data-[state=open]:rotate-180" />
                            </button>
                          </Collapsible.Trigger>
                        </div>
                        <Collapsible.Content className="data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
                          <div className="divide-y divide-[hsl(var(--border))]">
                            {resolvedTasks.map(task => (
                              <div key={task.id} className="p-1">
                                <TaskCard compact key={task.id} task={task} onOpen={() => setDetailTask(task)} onToggle={(done) => handleToggle(task, done)} onToggleSubtask={(subtaskId, done) => handleToggleSubtask(task, subtaskId, done)} onCycleUrgency={() => cycleUrgency(task)} onEdit={() => { setEditingTask(task); setFormError(''); setDialogOpen(true); }} onDelete={() => handleDelete(task)} />
                              </div>
                            ))}
                            <div className="p-3">
                              <button type="button" onClick={() => openCreate(group.name)} data-testid={`button-add-task-${group.name.toLowerCase().replaceAll(' ', '-')}`} className="inline-flex items-center gap-2 text-xs font-semibold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]">
                                <Plus size={14} /> Add {group.name.toLowerCase()} task
                              </button>
                            </div>
                          </div>
                        </Collapsible.Content>
                      </Collapsible.Root>
                    );
                  })}
                </div>
              </div>
            )}
          </main>

          <aside className="space-y-6">
            {pendingProposals.length > 0 && (
              <section className="rounded-2xl border border-[hsl(42_74%_64%/.4)] bg-[hsl(42_74%_64%/.08)] p-5" data-testid="panel-assistant-suggestions">
                <div className="flex items-center gap-2 mb-4">
                  <Bot size={18} className="text-[hsl(26_55%_35%)]" />
                  <h3 className="font-serif text-xl text-[hsl(26_55%_30%)]">Suggestions to review</h3>
                  <span className="ml-auto rounded-full bg-[hsl(var(--background))] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]" data-testid="badge-pending-count">{pendingProposals.length} pending</span>
                </div>
                <div className="space-y-4">
                  {pendingProposals.slice(0, 3).map(task => (
                    <div key={task.id} className="rounded-xl border border-[hsl(42_74%_64%/.3)] bg-[hsl(var(--card))] p-4 shadow-sm" data-testid={`assistant-suggestion-${task.id}`}>
                      <h4 className="text-sm font-semibold">{task.title}</h4>
                      <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))] line-clamp-2">{task.rationale}</p>
                      {task.proposedCategory && <p className="mt-2 rounded-lg bg-[hsl(42_74%_64%/.12)] px-2.5 py-2 text-[11px] text-[hsl(26_55%_31%)]">Claude suggested a new category: <strong>{task.proposedCategory}</strong>. Choose the closest approved category before adding it.</p>}
                      <div className="mt-3 flex gap-2">
                        <button type="button" onClick={() => rejectTask.mutate({ proposalId: task.proposalId, taskId: task.id })} disabled={rejectTask.isPending || approveTask.isPending} data-testid={`button-dismiss-suggestion-${task.id}`} className="rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-50">Dismiss</button>
                        {task.proposedCategory
                          ? <Link href="/assistant" data-testid={`link-categorize-suggestion-${task.id}`} className="rounded-lg bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--primary-foreground))]">Choose category</Link>
                          : <button type="button" onClick={() => approveTask.mutate({ proposalId: task.proposalId, taskId: task.id })} disabled={rejectTask.isPending || approveTask.isPending} data-testid={`button-approve-suggestion-${task.id}`} className="rounded-lg bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--primary-foreground))] hover:-translate-y-0.5 transition-transform disabled:opacity-50">Approve</button>}
                      </div>
                    </div>
                  ))}
                  {pendingProposals.length > 3 && (
                    <Link href="/assistant" className="block text-center text-xs font-semibold text-[hsl(var(--primary))] hover:underline" data-testid="link-view-all-suggestions">View {pendingProposals.length - 3} more</Link>
                  )}

                </div>
              </section>
            )}

            {isHarnold && pendingWorkerTasks.length > 0 && (
              <section className="rounded-2xl border border-[hsl(76_44%_45%/.45)] bg-[hsl(76_35%_92%/.45)] p-5" data-testid="panel-worker-approvals">
                <div className="flex items-center gap-2 mb-4">
                  <Check size={18} className="text-[hsl(var(--primary))]" />
                  <h3 className="font-serif text-xl">Worker submissions</h3>
                  <span className="ml-auto rounded-full bg-[hsl(var(--card))] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[.1em]" data-testid="badge-worker-pending-count">{pendingWorkerTasks.length} pending</span>
                </div>
                <div className="space-y-3">
                  {pendingWorkerTasks.map((task) => <div key={task.id} className="rounded-xl border border-[hsl(76_44%_45%/.32)] bg-[hsl(var(--card))] p-4" data-testid={`worker-submission-${task.id}`}>
                    <p className="text-sm font-semibold">{task.task}</p>
                    <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{task.submittedByName || 'Worker'} · {task.group}{task.location ? ` · ${task.location}` : ''}</p>
                    {task.notes && <p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{task.notes}</p>}
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => approveFarmTask.mutate({ taskId: task.id })} disabled={approveFarmTask.isPending || rejectFarmTask.isPending} className="rounded-lg bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50" data-testid={`button-approve-worker-${task.id}`}>Approve</button>
                      <button type="button" onClick={() => { const reviewNote = window.prompt('Reason for rejecting this task:')?.trim(); if (reviewNote) rejectFarmTask.mutate({ taskId: task.id, data: { reviewNote } }); }} disabled={approveFarmTask.isPending || rejectFarmTask.isPending} className="rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-semibold text-[hsl(5_61%_42%)] disabled:opacity-50" data-testid={`button-reject-worker-${task.id}`}>Reject</button>
                    </div>
                  </div>)}
                </div>
              </section>
            )}

            {isOwner && <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5" data-testid="panel-daily-settings">
              <div className="flex items-center gap-2 mb-5">
                <Settings2 size={16} className="text-[hsl(var(--muted-foreground))]" />
                <h3 className="font-serif text-xl">Daily Settings</h3>
              </div>
              {planSettingsQuery.isLoading ? <div className="animate-pulse h-20 bg-[hsl(var(--muted)/.6)] rounded-xl" /> : planSettingsQuery.data ? (
                <div className="space-y-4">
                  <label className="flex items-center justify-between gap-3 text-xs font-semibold">
                    <span>Auto-generate plan</span>
                    <button type="button" role="switch" aria-checked={planSettingsQuery.data.enabled} onClick={() => updatePlanSettings.mutate({ data: { enabled: !planSettingsQuery.data.enabled } })} data-testid="switch-auto-generate" className={`relative h-6 w-11 rounded-full ${planSettingsQuery.data.enabled ? 'bg-[hsl(var(--primary))]' : 'bg-[hsl(var(--muted))]'}`}>
                      <span className={`absolute top-1 size-4 rounded-full bg-white transition-transform ${planSettingsQuery.data.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </label>
                  <label className="block text-xs font-semibold">
                    Max tasks
                    <input type="number" value={planSettingsQuery.data.maxTasks} onChange={(e) => updatePlanSettings.mutate({ data: { maxTasks: parseInt(e.target.value) || 10 } })} data-testid="input-max-tasks" className="field-input mt-1.5 w-full" min="1" max="100" />
                  </label>
                  <label className="block text-xs font-semibold">
                    Run daily at
                    <input type="time" value={planSettingsQuery.data.runAtLocal} onChange={(e) => updatePlanSettings.mutate({ data: { runAtLocal: e.target.value } })} data-testid="input-run-at" className="field-input mt-1.5 w-full" />
                  </label>
                </div>
              ) : (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">Settings unavailable.</p>
              )}
            </section>}
          </aside>
        </div>

        {isOwner && <MonthlyOverview accountScope={accountScope} />}
      </div>

      <TaskFormDialog open={Boolean(accountScope && dialogOpen)} task={accountScope ? editingTask : undefined} error={formError} onClose={() => { stagedCreatedTask.current = null; setDialogOpen(false); }} onSave={handleSave} workers={workers} canAssign={isOwner} />
      <TaskDetailsDialog task={accountScope ? detailTask : undefined} onClose={() => setDetailTask(undefined)} />
    </PlannerShell>
  );
}