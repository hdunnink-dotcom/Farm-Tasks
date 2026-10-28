import { useState, useMemo, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { MoreHorizontal, Plus, Settings2, Users, ArrowLeft, ArrowRight, RotateCcw, ChevronLeft, ChevronRight, ClipboardList, Trash2, CheckCircle2 } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Dialog from '@radix-ui/react-dialog';
import * as AlertDialog from '@radix-ui/react-alert-dialog';

import { ConflictNotice, PlannerShell, PageHeader, ErrorState, SyncNotice, UrgencyPill } from '@/components/farm-planner';
import { CompactTaskCreate } from '@/components/compact-task-create';
import { CrewWeatherForecast } from '@/components/crew-weather-forecast';
import { MobileCrewAgenda } from '@/components/mobile-crew-agenda';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useOfflineFieldbook } from '@/lib/offline-fieldbook';
import { failedMutationReason } from '@/lib/failed-mutation';
import { localAucklandDateKey, calendarStartDayKey, formatAucklandDateTimeInput, formatTaskScheduledDates, parseAucklandDateTimeInput, taskScheduledDateKeys } from '@/lib/task-calendar';
import { orderCrewPlanTasks } from '@/lib/task-sort';
import { useMe } from '@/hooks/use-me';
import { useWorkers, type Worker } from '@/hooks/use-workers';
import type { FarmTask, TaskInput } from '@workspace/api-client-react';

type SaveTask = (task: FarmTask | undefined, data: TaskInput) => Promise<FarmTask>;

export function shiftDateKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

export function crewPlanTaskEditUrl(taskId: string): string {
  return `/tasks?edit=${encodeURIComponent(taskId)}`;
}

export function getNewCalendarStart(oldCalendarStart: string, newDateKey: string) {
  if (!oldCalendarStart) return newDateKey;
  if (/^\d{4}-\d{2}-\d{2}$/.test(oldCalendarStart.trim())) {
    return newDateKey;
  }
  const localTimeMatch = oldCalendarStart.match(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(\.\d+)?)?/);
  if (localTimeMatch && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(oldCalendarStart)) {
    return `${newDateKey}T${localTimeMatch[1]}:${localTimeMatch[2]}${localTimeMatch[3] ? `:${localTimeMatch[3]}${localTimeMatch[4] ?? ''}` : ''}`;
  }
  const instant = new Date(oldCalendarStart);
  const instantParts = Number.isNaN(instant.getTime()) ? null : Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const aucklandLocal = instantParts
    ? `${newDateKey}T${instantParts.hour}:${instantParts.minute}:${instantParts.second}`
    : formatAucklandDateTimeInput(oldCalendarStart); 
  if (aucklandLocal) {
    const timePart = aucklandLocal.split('T')[1];
    if (timePart) {
      const newLocal = instantParts ? aucklandLocal : `${newDateKey}T${timePart}`;
      return parseAucklandDateTimeInput(newLocal) || newLocal;
    }
  }
  return newDateKey;
}

/** Replaces the board instance being moved without losing its other linked days. */
export function replaceScheduledDate(task: Pick<FarmTask, 'calendarStart' | 'scheduledDates'>, anchoredDate: string | null, targetDate: string): string[] {
  return Array.from(new Set([
    ...taskScheduledDateKeys(task).filter((date) => date !== anchoredDate),
    targetDate,
  ])).sort();
}

export function CrewTaskSidebar({ tasks, onEdit }: { tasks: FarmTask[]; onEdit: (taskId: string) => void }) {
  const [open, setOpen] = useState(true);
  const orderedTasks = useMemo(() => orderCrewPlanTasks(tasks.filter((task) => !task.done)), [tasks]);
  const taskCountLabel = `${orderedTasks.length} open task${orderedTasks.length === 1 ? '' : 's'}`;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={`h-full shrink-0 transition-[width] duration-200 ${open ? 'w-[340px]' : 'w-14'}`}
    >
      <aside
        className="flex h-full min-h-0 w-full flex-col border-l border-[hsl(var(--border))] bg-[hsl(var(--card)/.96)] shadow-[-6px_0_18px_hsl(157_22%_17%/.05)]"
        aria-label="All tasks"
        data-testid="crew-plan-task-sidebar"
      >
        <div className={`flex shrink-0 items-center border-b border-[hsl(var(--border))] ${open ? 'justify-between gap-3 px-4 py-4' : 'justify-center py-4'}`}>
          {open && (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <ClipboardList size={17} className="shrink-0 text-[hsl(var(--primary))]" />
                <h2 className="font-serif text-xl text-[hsl(var(--foreground))]">All tasks</h2>
              </div>
               <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{taskCountLabel}</p>
            </div>
          )}
          <CollapsibleTrigger asChild>
            <button
              type="button"
              aria-label={open ? 'Collapse all tasks panel' : 'Expand all tasks panel'}
              aria-controls="crew-plan-all-tasks"
              aria-expanded={open}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              data-testid="button-toggle-crew-task-sidebar"
            >
              {open ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
            </button>
          </CollapsibleTrigger>
        </div>

        {!open && (
          <div className="flex flex-1 flex-col items-center gap-3 pt-4 text-[hsl(var(--muted-foreground))]" aria-hidden="true">
            <ClipboardList size={18} />
             <span className="font-mono text-[10px]">{orderedTasks.length}</span>
          </div>
        )}

        <CollapsibleContent id="crew-plan-all-tasks" className="min-h-0 flex-1 overflow-y-auto" data-testid="crew-plan-task-scroll">
          {orderedTasks.length > 0 ? (
            <ol className="space-y-2 p-3" data-testid="crew-plan-task-list">
              {orderedTasks.map((task) => {
                const scheduledLabel = formatTaskScheduledDates(task) ?? 'Unscheduled';
                const assignees = task.assigneeNames?.length ? task.assigneeNames : task.assigneeName ? [task.assigneeName] : [];
                return (
                  <li key={task.id}>
                    <button
                      type="button"
                      onClick={() => onEdit(task.id)}
                      className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-left transition-colors hover:border-[hsl(var(--primary)/.45)] hover:bg-[hsl(var(--background))]"
                      data-testid={`crew-task-list-item-${task.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold leading-5 text-[hsl(var(--foreground))]">{task.task}</span>
                        <UrgencyPill urgency={task.urgency} />
                      </div>
                      <p className="mt-2 text-[11px] font-medium text-[hsl(var(--primary))]">{scheduledLabel}</p>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-[hsl(var(--muted-foreground))]">
                        <span className="truncate">{assignees.length ? assignees.join(', ') : 'Unassigned'}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="p-5 text-center" data-testid="crew-plan-task-empty">
              <p className="text-sm font-semibold text-[hsl(var(--foreground))]">No open tasks</p>
              <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Completed work is hidden from this list.</p>
            </div>
          )}
        </CollapsibleContent>
      </aside>
    </Collapsible>
  );
}

export function BoardTask({ task, workers, saveTask, onEdit, onDelete, visibleDates, anchoredDate }: { task: FarmTask; workers: Worker[]; saveTask: SaveTask; onEdit: () => void; onDelete?: () => Promise<void>; visibleDates: string[]; anchoredDate?: string }) {
  const [isMoveMenuOpen, setIsMoveMenuOpen] = useState(false);
  const [scheduleAction, setScheduleAction] = useState<'move' | 'copy'>('move');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [moveDate, setMoveDate] = useState(() => anchoredDate ?? (calendarStartDayKey(task.calendarStart || '') || localAucklandDateKey()));
  const [moveWorkers, setMoveWorkers] = useState<string[]>(() => task.assigneeIds?.length ? task.assigneeIds : (task.assigneeId ? [task.assigneeId] : []));

  useEffect(() => {
    if (isMoveMenuOpen) {
      setMoveDate(anchoredDate ?? (calendarStartDayKey(task.calendarStart || '') || localAucklandDateKey()));
      setMoveWorkers(task.assigneeIds?.length ? task.assigneeIds : (task.assigneeId ? [task.assigneeId] : []));
      setError(null);
    }
  }, [anchoredDate, isMoveMenuOpen, task]);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ taskId: task.id, anchoredDate }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const doMove = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const newCalendarStart = getNewCalendarStart(task.calendarStart || '', moveDate);
      const oldDate = anchoredDate ?? calendarStartDayKey(task.calendarStart || '');
      const assigneeId = moveWorkers.length > 0 ? moveWorkers[0] : '';
      const assigneeName = moveWorkers.length > 0 ? (workers.find(w => w.clerkId === assigneeId)?.displayName || '') : '';
      const assigneeNames = moveWorkers.map(id => workers.find(w => w.clerkId === id)?.displayName || '');
      
      const data: TaskInput = {
        task: task.task,
        group: task.group,
        done: task.done,
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
        calendarStart: newCalendarStart,
        scheduledDates: scheduleAction === 'copy' ? [moveDate] : replaceScheduledDate(task, oldDate, moveDate),
        recurrence: task.recurrence,
        repeatWeekly: task.repeatWeekly,
        assigneeId,
        assigneeName,
        assigneeIds: moveWorkers,
        assigneeNames
      };
      if (scheduleAction === 'copy') {
        await saveTask(undefined, {
          ...data,
          done: false,
          // A copy starts fresh, including independently completable steps. Attachments
          // deliberately remain on the original task rather than aliasing upload records.
          subtasks: task.subtasks.map((step) => ({ ...step, done: false })),
        });
      } else {
        await saveTask(task, data);
      }
      setIsMoveMenuOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Move failed');
    } finally {
      setIsSaving(false);
    }
  };

  const markComplete = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await saveTask(task, { task: task.task, done: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not mark the task complete.');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleWorker = (id: string) => {
    setMoveWorkers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const assigneeNamesDisplay = task.assigneeNames?.length ? task.assigneeNames.join(', ') : (task.assigneeName || 'Unassigned');
  const canDelete = Boolean(onDelete && !task.done);

  return (
    <div 
      draggable={!task.done}
      onDragStart={handleDragStart}
      aria-label={task.done ? `Completed task: ${task.task}` : `Open task: ${task.task}`}
      className={`group relative mb-2 rounded-xl border p-2.5 shadow-sm transition-all ${task.done ? 'cursor-default border-[hsl(var(--border)/.7)] bg-[hsl(var(--muted)/.45)] opacity-75' : 'cursor-grab border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--primary)/.4)] hover:shadow-md active:cursor-grabbing'} ${isSaving ? 'pointer-events-none opacity-50' : ''}`}
      data-testid={`board-task-${task.id}`}
    >
      <div className="flex justify-between items-start mb-1.5 gap-2">
        <span className="font-mono text-[9px] uppercase tracking-wider text-[hsl(var(--primary))] truncate">{task.group || 'General'}</span>
        {task.done ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-[hsl(var(--primary)/.1)] px-1.5 py-1 font-mono text-[9px] uppercase tracking-wider text-[hsl(var(--primary))]">
            <CheckCircle2 size={11} aria-hidden="true" /> Completed
          </span>
        ) : <UrgencyPill urgency={task.urgency} />}
      </div>
      <h4 className={`line-clamp-2 text-xs font-semibold leading-snug text-[hsl(var(--foreground))] ${task.done ? 'line-through decoration-[hsl(var(--muted-foreground)/.7)]' : ''}`}>{task.task}</h4>
      <p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))] truncate" data-testid={`board-task-assignees-${task.id}`}>
        {assigneeNamesDisplay}
      </p>

      {error && <div className="mt-1 text-[10px] text-[hsl(var(--destructive))] leading-tight" role="alert">{error}</div>}
      
      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity bg-[hsl(var(--card))] rounded shadow-sm">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button aria-label={`Options for ${task.task}`} className="p-1 rounded hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="z-50 min-w-[160px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-1.5 shadow-lg text-sm text-[hsl(var(--foreground))] font-sans animate-in fade-in zoom-in-95">
              {!task.done && <DropdownMenu.Item onSelect={() => { void markComplete(); }} className="flex items-center gap-2 px-2.5 py-2 outline-none hover:bg-[hsl(var(--muted))] rounded-lg cursor-pointer">
                <CheckCircle2 size={14} className="text-[hsl(var(--primary))]" /> Mark complete
              </DropdownMenu.Item>}
              <DropdownMenu.Item onSelect={onEdit} className="flex items-center gap-2 px-2.5 py-2 outline-none hover:bg-[hsl(var(--muted))] rounded-lg cursor-pointer">
                <Settings2 size={14} className="text-[hsl(var(--muted-foreground))]" /> Edit full details
              </DropdownMenu.Item>
              {!task.done && <DropdownMenu.Item onSelect={() => { setScheduleAction('move'); setIsMoveMenuOpen(true); }} className="flex items-center gap-2 px-2.5 py-2 outline-none hover:bg-[hsl(var(--muted))] rounded-lg cursor-pointer">
                <Users size={14} className="text-[hsl(var(--muted-foreground))]" /> Move / Assign...
              </DropdownMenu.Item>}
              <DropdownMenu.Item onSelect={() => { setScheduleAction('copy'); setIsMoveMenuOpen(true); }} className="flex items-center gap-2 px-2.5 py-2 outline-none hover:bg-[hsl(var(--muted))] rounded-lg cursor-pointer">
                <Plus size={14} className="text-[hsl(var(--muted-foreground))]" /> Copy to another day...
              </DropdownMenu.Item>
              {canDelete && (
                <DropdownMenu.Item
                  onSelect={(event) => { event.preventDefault(); setIsDeleteDialogOpen(true); }}
                  aria-label={`Delete ${task.task}`}
                  className="flex items-center gap-2 px-2.5 py-2 outline-none hover:bg-[hsl(5_61%_49%/.1)] hover:text-[hsl(var(--destructive))] rounded-lg cursor-pointer"
                >
                  <Trash2 size={14} /> Delete task
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <Dialog.Root open={isMoveMenuOpen} onOpenChange={setIsMoveMenuOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 backdrop-blur-sm" />
            <Dialog.Content aria-label={scheduleAction === 'copy' ? 'Copy task to another day' : 'Move task'} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[hsl(var(--card))] p-5 rounded-2xl border border-[hsl(var(--border))] shadow-xl z-50 w-full max-w-sm">
              <Dialog.Title className="text-lg font-serif text-[hsl(var(--foreground))] mb-4">{scheduleAction === 'copy' ? 'Copy to another day' : 'Move Task'}</Dialog.Title>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-[hsl(var(--muted-foreground))]">Date</label>
                  <select
                    value={moveDate}
                    onChange={e => setMoveDate(e.target.value)}
                    className="w-full bg-[hsl(var(--background))] border border-[hsl(var(--input))] rounded-lg p-2 text-sm"
                    aria-label="Select move date"
                  >
                    {visibleDates.map(d => (
                      <option key={d} value={d}>{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', weekday: 'short' }).format(new Date(d))}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-2 text-[hsl(var(--muted-foreground))]">Team</label>
                  <div className="space-y-2 max-h-[150px] overflow-y-auto">
                    {workers.map(w => (
                      <label key={w.clerkId} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={moveWorkers.includes(w.clerkId)}
                          onChange={() => toggleWorker(w.clerkId)}
                          className="rounded border-[hsl(var(--border))] text-[hsl(var(--primary))] focus:ring-[hsl(var(--primary))]"
                        />
                        {w.displayName}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button onClick={() => setIsMoveMenuOpen(false)} className="px-3 py-1.5 text-xs font-semibold hover:bg-[hsl(var(--muted))] rounded-lg">Cancel</button>
                <button onClick={doMove} disabled={isSaving} className="px-4 py-1.5 bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-xs font-semibold rounded-lg disabled:opacity-50">
                   {isSaving ? 'Saving...' : scheduleAction === 'copy' ? 'Create copy' : 'Apply Move'}
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
      {canDelete && (
        <AlertDialog.Root open={isDeleteDialogOpen} onOpenChange={(open) => { if (!isDeleting) setIsDeleteDialogOpen(open); }}>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="modal-backdrop fixed inset-0 z-50" />
            <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-2xl">
              <AlertDialog.Title className="font-serif text-2xl text-[hsl(var(--foreground))]">Delete task?</AlertDialog.Title>
              <AlertDialog.Description className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
                This will permanently remove "{task.task}" and its subtasks from the fieldbook. This action cannot be undone.
              </AlertDialog.Description>
              <div className="mt-6 flex justify-end gap-3">
                <AlertDialog.Cancel asChild>
                  <button type="button" disabled={isDeleting} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-50">Cancel</button>
                </AlertDialog.Cancel>
                <AlertDialog.Action asChild>
                  <button
                    type="button"
                    disabled={isDeleting}
                    aria-label={`Confirm delete ${task.task}`}
                    onClick={() => {
                      setIsDeleting(true);
                        void onDelete?.().catch(() => undefined).finally(() => {
                        setIsDeleting(false);
                        setIsDeleteDialogOpen(false);
                      });
                    }}
                    className="rounded-xl bg-[hsl(var(--destructive))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--destructive-foreground))] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                  >
                    {isDeleting ? 'Deleting…' : 'Delete'}
                  </button>
                </AlertDialog.Action>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      )}
    </div>
  );
}

function BoardCell({ 
  dateKey, 
  worker, 
  tasks, 
  onMove, 
  onQuickCreate,
  workers,
  saveTask,
  onEdit,
  onDelete,
  onDragError,
  visibleDates
}: { 
  dateKey: string, 
  worker: Worker | null, 
  tasks: FarmTask[], 
  onMove: (taskId: string, sourceWorkerId: string, sourceDate: string | null, targetDate: string, targetWorker: string) => void;
  onQuickCreate: (date: string, worker: string | null) => void;
  workers: Worker[];
  saveTask: SaveTask;
  onEdit: (taskId: string) => void;
  onDelete: (task: FarmTask) => Promise<void>;
  onDragError: (message: string) => void;
  visibleDates: string[];
}) {
  const workerId = worker ? worker.clerkId : 'unassigned';
  const [isOver, setIsOver] = useState(false);

  return (
    <div 
      className={`p-2 min-h-[90px] h-full transition-colors group relative ${isOver ? 'bg-[hsl(var(--primary)/.05)]' : 'bg-transparent'}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        try {
          const data = e.dataTransfer.getData('application/json');
          if (data) {
            const parsed: unknown = JSON.parse(data);
            if (!parsed || typeof parsed !== 'object' || typeof (parsed as { taskId?: unknown }).taskId !== 'string') {
              onDragError('Could not read the dragged task.');
              return;
            }
            const sourceDate = typeof (parsed as { anchoredDate?: unknown }).anchoredDate === 'string'
              ? (parsed as { anchoredDate: string }).anchoredDate
              : null;
            onMove((parsed as { taskId: string }).taskId, workerId, sourceDate, dateKey, workerId);
          }
        } catch {
          onDragError('Could not read the dragged task.');
        }
      }}
    >
      {tasks.map(t => (
        <BoardTask 
          key={t.id} 
          task={t} 
          workers={workers}
          saveTask={saveTask}
          onEdit={() => onEdit(t.id)}
           onDelete={() => onDelete(t)}
          visibleDates={visibleDates}
           anchoredDate={dateKey}
        />
      ))}
      
      <button 
        aria-label={`Add task for ${dateKey}`}
        onClick={() => onQuickCreate(dateKey, workerId)} 
        className="flex w-full items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border))] py-2 text-[hsl(var(--muted-foreground))] transition-all hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--primary))]"
      >
        <Plus size={14} /> <span className="ml-1 text-[10px] uppercase font-mono tracking-wider">Add</span>
      </button>
    </div>
  );
}

export default function CrewPlanPage() {
  const { data: me, isLoading: meLoading, isError: meError } = useMe();
  const { data: workers = [], isLoading: workersLoading, isError: workersError } = useWorkers(me?.isHarnold === true);
  
  const { tasks, saveTask, removeTask, online, syncing, retrying, pendingCount, failedMutations, conflicts, resolveConflict, retryMutation, discardMutation, syncNow, readyForScope, sourceUrl } = useOfflineFieldbook(true, me?.clerkId ?? null);
  const plannerSyncStatus = {
    online,
    syncing,
    retrying,
    pendingCount,
    failedCount: failedMutations.length,
    conflictCount: conflicts.length,
    sourceUrl,
  };
  const [, setLocation] = useLocation();

  const [startDate, setStartDate] = useState(() => localAucklandDateKey());
  const [mobileView, setMobileView] = useState<'team' | 'mine'>('team');
  const [statusFilter, setStatusFilter] = useState<'open' | 'all'>('all');

  const [compactDialogOpen, setCompactDialogOpen] = useState(false);
  const [compactDialogData, setCompactDialogData] = useState<{ date: string, workerIds: string[] } | null>(null);
  const [boardError, setBoardError] = useState('');
  const activeWorkers = useMemo(() => workers.filter((worker) => worker.status === 'active' || worker.status === 'invited'), [workers]);
  const dates = useMemo(() => Array.from({ length: 30 }, (_, index) => shiftDateKey(startDate, index)), [startDate]);
  const todayKey = localAucklandDateKey();
  const handleMobileRefresh = useCallback(() => {
    setBoardError('');
    return syncNow().catch((cause) => {
      setBoardError(cause instanceof Error ? cause.message : 'Could not refresh the crew agenda.');
    });
  }, [syncNow]);
  const dateHeaders = useMemo(() => {
    const weekdayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' });
    const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', day: 'numeric' });
    const monthFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' });
    return dates.map((date) => {
      const [year, month, day] = date.split('-').map(Number);
      const dateObject = new Date(Date.UTC(year, month - 1, day));
      return {
        date,
        isToday: date === todayKey,
        dayName: weekdayFormatter.format(dateObject),
        dayNumber: dayFormatter.format(dateObject),
        monthName: monthFormatter.format(dateObject),
      };
    });
  }, [dates, todayKey]);
  const tasksByDateAndWorker = useMemo(() => {
    const map: Record<string, FarmTask[]> = {};
    tasks.forEach((task) => {
      if (statusFilter === 'open' && task.done) return;
      const taskDates = taskScheduledDateKeys(task);
      if (!taskDates.length) return;
      const ids = task.assigneeIds?.length ? task.assigneeIds : (task.assigneeId ? [task.assigneeId] : ['unassigned']);
      const normalizedIds = ids.length ? ids.map((id) => id || 'unassigned') : ['unassigned'];

      normalizedIds.forEach((id) => {
        taskDates.forEach((date) => {
          const key = `${date}_${id}`;
          if (!map[key]) map[key] = [];
          if (!map[key].some((item) => item.id === task.id)) map[key].push(task);
        });
      });
    });
    return map;
  }, [statusFilter, tasks]);

  if (meLoading || (me?.isHarnold === true && workersLoading) || (me && !readyForScope)) {
    return (
      <PlannerShell loadSourceQuery={false} syncStatus={plannerSyncStatus}>
        <div className="flex items-center justify-center h-full min-h-[50vh]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[hsl(var(--primary))]"></div>
        </div>
      </PlannerShell>
    );
  }

  if (meError || (me?.isHarnold === true && workersError)) {
    return (
      <PlannerShell loadSourceQuery={false} syncStatus={plannerSyncStatus}>
        <div className="p-8">
          <ErrorState message="Could not load your crew data." onRetry={() => window.location.reload()} />
        </div>
      </PlannerShell>
    );
  }

  const startDateLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(startDate));
  const endDateLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(dates[dates.length - 1]));

  const workerRows = [
    { clerkId: 'unassigned', displayName: 'Unassigned/Open work', status: 'open' },
    ...activeWorkers
  ];

  const handleMove = async (taskId: string, sourceWorkerId: string, sourceDate: string | null, targetDate: string, targetWorkerId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    const newCalendarStart = getNewCalendarStart(task.calendarStart || '', targetDate);
    const existingIds = task.assigneeIds?.length ? task.assigneeIds : task.assigneeId ? [task.assigneeId] : [];
    const existingNames = task.assigneeNames?.length ? task.assigneeNames : task.assigneeName ? [task.assigneeName] : [];
    const preserveTeam = sourceWorkerId === targetWorkerId && existingIds.includes(targetWorkerId);
    const assigneeIds = preserveTeam ? existingIds : targetWorkerId !== 'unassigned' ? [targetWorkerId] : [];
    const assigneeId = assigneeIds[0] || '';
    const assigneeNames = preserveTeam ? existingNames : assigneeIds.map(id => activeWorkers.find(w => w.clerkId === id)?.displayName || '');
    
    try {
      await saveTask(task, {
        task: task.task,
        group: task.group,
        done: task.done,
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
        calendarStart: newCalendarStart,
        scheduledDates: replaceScheduledDate(task, sourceDate ?? calendarStartDayKey(task.calendarStart || ''), targetDate),
        recurrence: task.recurrence,
        repeatWeekly: task.repeatWeekly,
        assigneeId,
        assigneeName: assigneeNames[0] || '',
        assigneeIds,
        assigneeNames
      });
    } catch (cause) {
      setBoardError(cause instanceof Error ? cause.message : 'Could not move the task.');
    }
  };

  const handleQuickCreateClick = (date: string, workerId: string | null) => {
    setCompactDialogData({ date, workerIds: workerId && workerId !== 'unassigned' ? [workerId] : [] });
    setCompactDialogOpen(true);
  };

  const handleDeleteTask = async (task: FarmTask) => {
    setBoardError('');
    try {
      await removeTask(task);
    } catch (cause) {
      setBoardError(cause instanceof Error ? cause.message : 'Could not remove the task.');
    }
  };

  return (
    <PlannerShell loadSourceQuery={false} syncStatus={plannerSyncStatus}>
      <div className="lg:hidden">
        <MobileCrewAgenda
          tasks={tasks}
          workers={activeWorkers}
          currentUserId={me?.clerkId ?? ''}
          canManageTeam={me?.isHarnold === true}
          visibleDateKeys={dates}
          currentStartDate={startDate}
          syncState={!online ? 'offline' : syncing ? 'syncing' : failedMutations.length > 0 ? 'error' : 'synced'}
          pendingCount={pendingCount}
          retryState={retrying ? 'retrying' : failedMutations.length > 0 ? 'failed' : 'idle'}
          currentView={me?.isHarnold ? mobileView : 'mine'}
          currentStatusFilter={statusFilter}
          onViewChange={setMobileView}
          onStatusFilterChange={setStatusFilter}
          onDateChange={setStartDate}
          onRefresh={handleMobileRefresh}
          onAddTask={(dateKey) => handleQuickCreateClick(dateKey, null)}
          onOpenTask={(task) => setLocation(crewPlanTaskEditUrl(task.id))}
          onSaveTask={saveTask}
          failedMutations={failedMutations}
          conflicts={conflicts}
          onRetryMutation={retryMutation}
          onDiscardMutation={discardMutation}
          onResolveConflict={resolveConflict}
          errorMessage={boardError || undefined}
        />
      </div>

      {me?.isHarnold ? (
        <div className="hidden lg:flex flex-col h-[100dvh]">
        <div className="px-8 pt-8 pb-4 shrink-0 border-b border-[hsl(var(--border))] bg-white/50 backdrop-blur-sm z-30 sticky top-0 flex flex-wrap justify-between items-end gap-x-6 gap-y-4">
          <PageHeader 
            eyebrow="Crew Plan" 
            title="30-Day Board" 
            description="Drag to assign work and shift schedules across the team."
          />
          <div className="min-w-[320px] flex-1 self-end">
            <CrewWeatherForecast enabled={me?.isHarnold === true} />
          </div>
          <div className="flex flex-col items-end gap-3 pb-2">
            <SyncNotice syncing={syncing} message={retrying ? `Retrying ${pendingCount} pending change${pendingCount === 1 ? '' : 's'}…` : pendingCount ? `${pendingCount} pending sync` : undefined} />
            <div className="flex items-center gap-4 bg-[hsl(var(--card))] border border-[hsl(var(--border))] p-1.5 rounded-xl shadow-sm">
              <div className="flex rounded-lg bg-[hsl(var(--muted)/.65)] p-0.5" role="group" aria-label="Task status">
                {(['all', 'open'] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setStatusFilter(filter)}
                    aria-pressed={statusFilter === filter}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${statusFilter === filter ? 'bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-sm' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'}`}
                    data-testid={`desktop-crew-status-${filter}`}
                  >
                    {filter === 'all' ? 'All' : 'Open'}
                  </button>
                ))}
              </div>
                <span className="text-xs font-semibold px-2 text-[hsl(var(--muted-foreground))]" aria-live="polite" data-testid="desktop-crew-date-range">
                {startDateLabel} – {endDateLabel}
              </span>
              <div className="flex items-center gap-1 border-l border-[hsl(var(--border))] pl-2">
                <button 
                  onClick={() => setStartDate(shiftDateKey(startDate, -7))}
                  className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] transition-all text-[hsl(var(--foreground))]"
                  aria-label="Previous week"
                >
                  <ArrowLeft size={16} />
                </button>
                <button 
                  onClick={() => setStartDate(localAucklandDateKey())}
                  className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] transition-all text-[hsl(var(--foreground))]"
                  aria-label="Reset to today"
                >
                  <RotateCcw size={16} />
                </button>
                <button 
                  onClick={() => setStartDate(shiftDateKey(startDate, 7))}
                  className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] transition-all text-[hsl(var(--foreground))]"
                  aria-label="Next week"
                >
                  <ArrowRight size={16} />
                </button>
              </div>
              <div className="border-l border-[hsl(var(--border))] pl-2">
                <button 
                  onClick={() => handleQuickCreateClick(localAucklandDateKey(), null)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-sm hover:opacity-90 transition-all"
                >
                  <Plus size={14} /> Add Task
                </button>
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-x-auto overflow-y-auto bg-white/30 backdrop-blur-sm relative" data-testid="crew-plan-grid-scroll">
          {boardError && <p role="alert" className="m-4 rounded-xl bg-[hsl(var(--destructive)/.1)] p-3 text-sm text-[hsl(var(--destructive))]">{boardError}</p>}
          <ConflictNotice conflicts={conflicts} onResolve={(conflict, choice) => void resolveConflict(conflict, choice)} />
          {failedMutations.length > 0 && <section className="m-4 rounded-xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.06)] p-4" aria-labelledby="needs-attention-title"><h2 id="needs-attention-title" className="font-semibold text-[hsl(var(--destructive))]">Changes needing attention</h2><ul className="mt-3 space-y-3">{failedMutations.map((mutation) => <li key={mutation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3"><div><p className="text-sm font-semibold">{mutation.task?.task ?? `Task ${mutation.taskId}`}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{mutation.kind} failed: {failedMutationReason(mutation)}</p></div><div className="flex gap-2"><button type="button" onClick={() => void retryMutation(mutation.id).catch((cause: unknown) => setBoardError(cause instanceof Error ? cause.message : 'Could not retry the change.'))} className="rounded-lg bg-[hsl(var(--primary))] px-3 py-2 text-xs font-semibold text-[hsl(var(--primary-foreground))]">Retry</button><button type="button" onClick={() => void discardMutation(mutation.id).catch((cause: unknown) => setBoardError(cause instanceof Error ? cause.message : 'Could not discard the local change.'))} className="rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-xs font-semibold">Discard local change</button>{mutation.kind !== 'delete' && <button type="button" onClick={() => setLocation(crewPlanTaskEditUrl(mutation.taskId))} className="rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-xs font-semibold">Edit task</button>}</div></li>)}</ul></section>}
          {tasks.filter((task) => !task.done && !calendarStartDayKey(task.calendarStart || '')).length > 0 && <section className="m-4 rounded-xl border border-dashed border-[hsl(var(--border))] p-3"><h2 className="text-sm font-semibold">Unscheduled open work</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">These tasks are unassigned to a day and remain visible until scheduled.</p><div className="mt-3 grid gap-2 md:grid-cols-3">{tasks.filter((task) => !task.done && !calendarStartDayKey(task.calendarStart || '')).map((task) => <BoardTask key={task.id} task={task} workers={activeWorkers} saveTask={saveTask} onEdit={() => setLocation(crewPlanTaskEditUrl(task.id))} onDelete={() => handleDeleteTask(task)} visibleDates={dates} />)}</div></section>}
          <table className="border-collapse min-w-max w-full">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 bg-[hsl(var(--card))] min-w-[200px] border-b border-r border-[hsl(var(--border))] p-3 text-left shadow-[1px_1px_2px_rgba(0,0,0,0.02)]">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Team Member</span>
                </th>
                 {dateHeaders.map(({ date, isToday, dayName, dayNumber, monthName }) => {
                  return (
                    <th key={date} className={`sticky top-0 z-10 min-w-[240px] bg-[hsl(var(--card))] border-b border-r border-[hsl(var(--border))] p-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.02)] ${isToday ? 'bg-[hsl(35_82%_66%/.05)]' : ''}`}>
                      <div className={`flex flex-col ${isToday ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--foreground))]'}`}>
                         <span className="text-sm font-semibold">{dayName} {dayNumber}</span>
                        <span className="text-xs font-normal text-[hsl(var(--muted-foreground))]">{monthName}</span>
                        {isToday && <span className="mt-1 text-[9px] uppercase font-mono bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-1.5 py-0.5 rounded-sm w-max">Today</span>}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {workerRows.map(w => (
                <tr key={w.clerkId} className="group/row">
                  <td className="sticky left-0 z-10 bg-[hsl(var(--card))] min-w-[200px] border-b border-r border-[hsl(var(--border))] p-3 shadow-[1px_0_2px_rgba(0,0,0,0.02)] align-top">
                    <div className="flex flex-col gap-1 mt-1">
                      <span className="font-semibold text-sm truncate text-[hsl(var(--foreground))]">{w.displayName}</span>
                      <span className="text-[10px] w-max bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] px-2 py-0.5 rounded-full uppercase tracking-wider">{w.status}</span>
                    </div>
                  </td>
                  {dates.map(date => {
                    const isToday = date === localAucklandDateKey();
                    return (
                      <td key={date} className={`min-w-[240px] border-b border-r border-[hsl(var(--border))] align-top p-0 ${isToday ? 'bg-[hsl(35_82%_66%/.02)]' : 'bg-transparent'}`}>
                        <BoardCell 
                          dateKey={date}
                          worker={w.clerkId === 'unassigned' ? null : w as Worker}
                          tasks={tasksByDateAndWorker[`${date}_${w.clerkId}`] || []}
                          onMove={handleMove}
                          onQuickCreate={handleQuickCreateClick}
                          workers={activeWorkers}
                          saveTask={saveTask}
                           onEdit={(taskId) => setLocation(crewPlanTaskEditUrl(taskId))}
                           onDelete={handleDeleteTask}
                           onDragError={setBoardError}
                          visibleDates={dates}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CrewTaskSidebar tasks={tasks} onEdit={(taskId) => setLocation(crewPlanTaskEditUrl(taskId))} />
        </div>
        </div>
      ) : (
        <div className="hidden lg:flex min-h-[60vh] flex-col items-center justify-center p-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-[hsl(5_61%_49%/.12)] text-[hsl(var(--destructive))]">
            <Users size={24} />
          </div>
          <h2 className="font-serif text-2xl text-[hsl(var(--foreground))]">Crew Plan Restricted</h2>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">The shared operational board is available to the farm manager. Your phone view shows only work assigned to you.</p>
        </div>
      )}

      {me?.isHarnold && <CompactTaskCreate
        open={compactDialogOpen} 
        onOpenChange={setCompactDialogOpen} 
        workers={activeWorkers} 
        initialDate={compactDialogData?.date}
        initialAssigneeIds={compactDialogData?.workerIds}
        onSave={async (draft) => { await saveTask(undefined, draft); }}
        onContinue={(draft) => {
          const params = new URLSearchParams({ title: draft.task, date: draft.calendarStart ?? '' });
          draft.assigneeIds?.forEach((id, index) => {
            params.append('assigneeId', id);
            params.append('assigneeName', draft.assigneeNames?.[index] ?? '');
          });
          setCompactDialogOpen(false);
          setLocation(`/tasks?${params.toString()}`);
        }}
      />}
    </PlannerShell>
  );
}
