import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/react';
import { addWeeks, subWeeks, startOfWeek, endOfWeek, format } from 'date-fns';
import { Check, ChevronLeft, ChevronRight, RefreshCw, CalendarDays, MapPin, Printer } from 'lucide-react';
import { type FarmTask } from '@workspace/api-client-react';
import { ErrorState, PageHeader, PlannerShell, RetryPendingChangesButton, SourcePill, SyncNotice, TaskDetailsDialog } from '@/components/farm-planner';
import { AUTH_DISABLED } from '@/lib/auth-config';
import { useOfflineFieldbook } from '@/lib/offline-fieldbook';
import { getTaskWeekGroups, sortWeekTasks, ALL_GROUPS_IN_ORDER, type WeekGroup } from '@/lib/week-logic';
import { useMe } from '@/hooks/use-me';
import { useWorkers } from '@/hooks/use-workers';
import { trackEvent } from '@/lib/analytics';

export default function WeekPage() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const canReadTasks = AUTH_DISABLED || (isLoaded && isSignedIn);
  const memberQuery = useMe(canReadTasks);
  const activeIdentity = AUTH_DISABLED ? 'test-master' : userId ?? null;
  const member = memberQuery.data?.clerkId === activeIdentity ? memberQuery.data : null;
  const workersQuery = useWorkers(member?.role === 'master');
  const workers = workersQuery.data ?? [];
  const accountScope = member?.clerkId === activeIdentity ? member.clerkId : null;
  const offline = useOfflineFieldbook(true, accountScope);
  
  const [selectedWeekStart, setSelectedWeekStart] = useState<Date>(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [detailTask, setDetailTask] = useState<FarmTask | undefined>();
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>('me');
  const [syncFeedback, setSyncFeedback] = useState('');

  useEffect(() => {
    setDetailTask(undefined);
    setSelectedWorkerId('me');
  }, [activeIdentity]);

  const tasks = accountScope && offline.readyForScope ? offline.tasks : [];

  const activeWorkerId = selectedWorkerId === 'me' ? (accountScope ?? '') : selectedWorkerId;
  const selectedWorkerLabel = selectedWorkerId === 'me'
    ? 'My route'
    : workers.find((worker) => worker.clerkId === selectedWorkerId)?.displayName ?? 'Selected worker';

  const weekTasksByGroup = useMemo(() => {
    const groups: Record<WeekGroup, FarmTask[]> = {
      Overdue: [],
      Monday: [],
      Tuesday: [],
      Wednesday: [],
      Thursday: [],
      Friday: [],
      Saturday: [],
      Sunday: [],
      Unscheduled: []
    };

    const myTasks = tasks.filter((task) => {
      const assigneeIds = task.assigneeIds?.length ? task.assigneeIds : task.assigneeId ? [task.assigneeId] : [];
      return assigneeIds.includes(activeWorkerId);
    });

    for (const task of myTasks) {
      for (const group of getTaskWeekGroups(task, selectedWeekStart)) {
        groups[group].push(task);
      }
    }

    for (const group of ALL_GROUPS_IN_ORDER) {
      groups[group] = sortWeekTasks(groups[group]);
    }

    return groups;
  }, [tasks, selectedWeekStart, activeWorkerId]);

  const refresh = () => { void offline.refresh(); };
  const retryPending = async () => {
    setSyncFeedback('Retrying pending changes…');
    try {
      const result = await offline.retryPendingChanges();
      setSyncFeedback(result.pendingCount === 0
        ? 'Changes reached the connected fieldbook.'
        : `${result.pendingCount} change${result.pendingCount === 1 ? '' : 's'} still pending. Your local work is safe.`);
    } catch (error) {
      setSyncFeedback(error instanceof Error ? error.message : 'Could not retry pending changes.');
    }
  };

  const prevWeek = () => setSelectedWeekStart(curr => subWeeks(curr, 1));
  const nextWeek = () => setSelectedWeekStart(curr => addWeeks(curr, 1));
  const thisWeek = () => setSelectedWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));

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
      <div className="page-enter mx-auto max-w-5xl px-5 py-7 md:px-10 md:py-12">
        <PageHeader 
          eyebrow="Field Route" 
          title="Weekly Route" 
          description="Your assigned work, mapped across the week."
          action={
            <button
              type="button"
              onClick={() => {
                trackEvent('tasks_printed', { period: 'week', surface: 'weekly_route', task_count: Object.values(weekTasksByGroup).reduce((total, group) => total + group.length, 0) });
                window.print();
              }}
              data-testid="button-print-weekly-route"
              className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm font-semibold text-[hsl(var(--foreground))] shadow-sm hover:bg-[hsl(var(--muted))]"
            >
              <Printer size={16} /> Print route
            </button>
          }
        />

        <div className="mb-5 flex flex-wrap items-center justify-between gap-4 border-y border-[hsl(var(--border))] py-3">
          <div className="flex items-center gap-3">
            <SourcePill source={offline.online ? offline.source : 'Local fieldbook'} />
            <SyncNotice syncing={offline.syncing} message={!offline.online ? `Offline · ${offline.pendingCount} pending` : offline.retrying ? `Retrying ${offline.pendingCount} pending change${offline.pendingCount === 1 ? '' : 's'}…` : offline.pendingCount ? `${offline.pendingCount} pending sync` : undefined} />
            <RetryPendingChangesButton pendingCount={offline.pendingCount} syncing={offline.syncing} onRetry={retryPending} testId="button-retry-pending-week" />
            <button type="button" onClick={refresh} disabled={offline.syncing} data-testid="button-refresh-week" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 font-mono text-[10px] uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"><RefreshCw size={13} className={offline.syncing ? 'animate-spin' : ''} /> Refresh</button>
          </div>
          
          <div className="flex flex-wrap items-center gap-4">
            {member?.role === 'master' && workers.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
                Viewing:
                <select 
                  value={selectedWorkerId}
                  onChange={(e) => setSelectedWorkerId(e.target.value)}
                  className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 font-medium text-[hsl(var(--foreground))]"
                  data-testid="select-week-worker"
                >
                  <option value="me">My route</option>
                  {workers.filter(w => w.status === 'active' || w.status === 'invited').map(worker => (
                    <option key={worker.clerkId} value={worker.clerkId}>
                      {worker.displayName} {worker.status === 'invited' ? '(Invited)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-1">
              <button type="button" onClick={prevWeek} className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]" data-testid="button-prev-week"><ChevronLeft size={16} /></button>
              <button type="button" onClick={thisWeek} className="px-2 text-xs font-semibold text-[hsl(var(--foreground))] hover:underline" data-testid="button-this-week">
                {format(selectedWeekStart, 'MMM d')} – {format(endOfWeek(selectedWeekStart, { weekStartsOn: 1 }), 'MMM d')}
              </button>
              <button type="button" onClick={nextWeek} className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]" data-testid="button-next-week"><ChevronRight size={16} /></button>
            </div>
          </div>
        </div>
        {syncFeedback && <div className="mb-5 rounded-xl border border-[hsl(var(--accent)/.45)] bg-[hsl(var(--accent)/.12)] px-4 py-3 text-xs font-medium text-[hsl(var(--accent-foreground))]" role="status" data-testid="status-sync-feedback-week">{syncFeedback}</div>}

        {offline.syncError && !tasks.length ? <ErrorState onRetry={refresh} message="The fieldbook could not be refreshed. Your saved offline work is still safe." /> : (
          <div className="mt-8 space-y-8">
            {weekTasksByGroup['Overdue'].length > 0 && (
              <WeekSection 
                title="Overdue" 
                tasks={weekTasksByGroup['Overdue']} 
                onToggle={(task, done) => offline.saveTask(task, { task: task.task, done })}
                onClick={(task) => setDetailTask(task)}
                accent
              />
            )}
            
            <div className="grid gap-6 md:grid-cols-2">
              {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => {
                const group = day as WeekGroup;
                const tasks = weekTasksByGroup[group];
                return (
                  <WeekSection 
                    key={day}
                    title={day}
                    tasks={tasks}
                    onToggle={(task, done) => offline.saveTask(task, { task: task.task, done })}
                    onClick={(task) => setDetailTask(task)}
                  />
                );
              })}
            </div>

            <div className="pt-4 border-t border-[hsl(var(--border))]">
              <WeekSection 
                title="Unscheduled" 
                tasks={weekTasksByGroup['Unscheduled']} 
                onToggle={(task, done) => offline.saveTask(task, { task: task.task, done })}
                onClick={(task) => setDetailTask(task)}
              />
            </div>
          </div>
        )}
      </div>
      <WeeklyRoutePrintSheet
        selectedWeekStart={selectedWeekStart}
        groups={weekTasksByGroup}
        workerLabel={selectedWorkerLabel}
      />
      <TaskDetailsDialog task={accountScope ? detailTask : undefined} onClose={() => setDetailTask(undefined)} />
    </PlannerShell>
  );
}

export function WeeklyRoutePrintSheet({
  selectedWeekStart,
  groups,
  workerLabel,
}: {
  selectedWeekStart: Date;
  groups: Record<WeekGroup, FarmTask[]>;
  workerLabel: string;
}) {
  const populatedGroups = ALL_GROUPS_IN_ORDER
    .map((group) => ({ group, tasks: groups[group] }))
    .filter(({ tasks }) => tasks.length > 0);

  return (
    <article className="print-planner-sheet print-planner-weekly-route" aria-hidden="true">
      <header>
        <div>
          <p>Fieldbook · Weekly route</p>
          <h1>
            {format(selectedWeekStart, 'MMM d')} – {format(endOfWeek(selectedWeekStart, { weekStartsOn: 1 }), 'MMM d, yyyy')}
          </h1>
        </div>
        <p>{workerLabel}</p>
      </header>
      <main>
        {populatedGroups.length === 0 ? (
          <p className="print-no-work">No open work is scheduled for this week.</p>
        ) : populatedGroups.map(({ group, tasks }) => {
          return (
            <section key={group} className="print-task-group">
              <div className="print-group-heading">
                <h2>{group}</h2>
                <span>{tasks.length}</span>
              </div>
              {tasks.map((task) => (
                <div key={task.id} className="print-task-row">
                  <span className="print-checkbox" />
                  <div>
                    <h3>{task.task}</h3>
                    <p className="print-task-meta">{[
                      task.group || 'General',
                      task.urgency,
                      task.location || '',
                    ].filter(Boolean).join(' · ')}</p>
                    {task.notes && (
                      <p className="print-task-notes" data-testid={`print-task-notes-${task.id}`}>
                        {task.notes}
                      </p>
                    )}
                    {task.subtasks?.length > 0 && (
                      <div className="print-task-steps" data-testid={`print-task-steps-${task.id}`}>
                        <p className="print-task-section-label">Steps</p>
                        <ul>
                          {task.subtasks.map((step) => (
                            <li key={step.id} className={step.done ? 'is-done' : undefined}>
                              <span className="print-step-bullet" aria-hidden="true">{step.done ? '✓' : '•'}</span>
                              <span>{step.title}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </main>
      <footer>Printed {new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date())}</footer>
    </article>
  );
}

function WeekSection({ 
  title, 
  tasks, 
  onToggle, 
  onClick,
  accent = false
}: { 
  title: string; 
  tasks: FarmTask[]; 
  onToggle: (task: FarmTask, done: boolean) => void;
  onClick: (task: FarmTask) => void;
  accent?: boolean;
}) {
  return (
    <section>
      <h3 className={`mb-3 flex items-center gap-2 border-b-2 pb-1 font-serif text-xl ${accent ? 'border-[hsl(var(--destructive)/.3)] text-[hsl(var(--destructive))]' : 'border-[hsl(var(--primary)/.3)] text-[hsl(var(--foreground))]'}`}>
        {title} 
        <span className="ml-auto rounded bg-[hsl(var(--muted))] px-2 py-0.5 text-xs font-sans font-medium text-[hsl(var(--muted-foreground))]">{tasks.length}</span>
      </h3>
      
      {tasks.length === 0 ? (
        <p className="px-2 py-3 text-xs italic text-[hsl(var(--muted-foreground))]">No work scheduled.</p>
      ) : (
        <div className="space-y-1">
          {tasks.map(task => (
            <div 
              key={task.id}
              className={`week-task-row group flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-[hsl(var(--muted)/.5)] cursor-pointer ${task.done ? 'opacity-60 bg-[hsl(var(--muted)/.2)]' : ''}`}
              onClick={() => onClick(task)}
            >
              <button 
                type="button"
                aria-label={task.done ? `Reopen task: ${task.task}` : `Complete task: ${task.task}`}
                onClick={(e) => { e.stopPropagation(); onToggle(task, !task.done); }}
                className={`checkbox-custom mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-[6px] border-[1.5px] ${task.done ? 'is-done border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'border-[hsl(var(--input))] bg-[hsl(var(--background))] text-transparent group-hover:border-[hsl(var(--primary))]'}`}
              >
                <Check size={14} strokeWidth={3} />
              </button>
              
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 leading-tight flex-wrap">
                  <span className={`text-[15px] font-medium transition-all ${task.done ? 'text-[hsl(var(--muted-foreground))] line-through' : 'text-[hsl(var(--foreground))]'}`}>
                    {task.task}
                  </span>
                  
                  {!task.done && task.urgency === 'Urgent' && (
                    <span className="shrink-0 rounded bg-[hsl(0_72%_48%/.15)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[hsl(0_65%_38%)]">Urgent</span>
                  )}
                  {!task.done && task.urgency === 'High' && (
                    <span className="shrink-0 rounded bg-[hsl(5_61%_49%/.11)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[hsl(5_61%_42%)]">High</span>
                  )}
                  {!task.done && task.urgency === 'Low' && (
                    <span className="shrink-0 rounded bg-[hsl(156_28%_28%/.09)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[hsl(156_28%_28%)]">Low</span>
                  )}
                </div>
                
                {(task.location || task.notes) && (
                  <div className="mt-1.5 flex items-center gap-3 text-[13px] text-[hsl(var(--muted-foreground))]">
                    {task.location && <span className="flex items-center gap-1 shrink-0"><MapPin size={11} /> {task.location}</span>}
                    {task.notes && <span className="truncate">{task.notes}</span>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
