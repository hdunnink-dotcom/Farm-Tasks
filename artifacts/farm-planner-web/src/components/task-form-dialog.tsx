import { useEffect, useState, type FormEvent, useMemo } from 'react';
import { Check, Loader2, Plus, X, Trash2, Paperclip, Camera, FileUp, Crosshair, MapPinned, ExternalLink } from 'lucide-react';
import { useAuth } from '@clerk/react';
import { useGetFarmSettings, useRequestFarmAttachmentUpload, useCompleteFarmAttachmentUpload, useDeleteFarmAttachment, getGetFarmSettingsQueryKey, getListFarmTasksQueryKey, type FarmAttachment, type FarmTask, type TaskInput, type TaskRecurrence, type TaskSubtask } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { FormField } from './farm-planner';
import { monthChoices, monthLabel } from '@/lib/task-month';
import { calendarStartDayKey, isValidAucklandDateKey, normalizeTaskSchedule, taskScheduledDateKeys } from '@/lib/task-calendar';
import { attachmentErrorMessage, MAX_ATTACHMENT_SIZE, uploadFarmAttachment } from '@/lib/farm-attachment-upload';
import { AUTH_DISABLED } from '@/lib/auth-config';
import { FARM_MAP_START_URL } from '@/lib/task-map-links';
import { formatCoordinatePair, parseCoordinatePair } from '@/lib/coordinates';
import { DEFAULT_FARM_GROUPS } from '@/lib/farm-settings-options';
import { ScheduledDatePicker } from './scheduled-date-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

type TaskDraft = TaskInput;

type TaskFormDialogProps = {
  open: boolean;
  task?: FarmTask;
  pending?: boolean;
  error?: string;
  onClose: () => void;
  onSave: (draft: TaskInput, attachments: File[]) => void | Promise<void>;
  workers?: Array<{ clerkId: string; displayName: string; status: string }>;
  canAssign?: boolean;
  initialDraft?: TaskInput;
};

const blankDraft: TaskDraft = {
  group: 'Orchards',
  task: '',
  done: false,
  urgency: 'Medium',
  month: '',
  location: '',
  latitude: null,
  longitude: null,
  locationCapturedAt: null,
  atlasLink: '',
  notes: '',
  link: '',
  subtasks: [],
  calendarStart: '',
  recurrence: 'none' as TaskRecurrence,
  repeatWeekly: false,
  assigneeId: '',
  assigneeName: '',
  assigneeIds: [],
  assigneeNames: [],
  scheduledDates: [],
};

const TASK_RECURRENCES = new Set<TaskRecurrence>([
  'none',
  'weekly',
  'biweekly',
  'every4weeks',
  'monthly',
  'quarterly',
  'yearly',
]);

function taskAssignees(task?: Pick<TaskInput, 'assigneeId' | 'assigneeName' | 'assigneeIds' | 'assigneeNames'>) {
  if (!task) return { ids: [] as string[], names: [] as string[] };
  const ids = task.assigneeIds?.length ? task.assigneeIds : task.assigneeId ? [task.assigneeId] : [];
  const names = task.assigneeNames?.length ? task.assigneeNames : task.assigneeName ? [task.assigneeName] : [];
  return { ids, names };
}

export function TaskFormDialog({ open, task, pending = false, error, onClose, onSave, workers = [], canAssign = false, initialDraft }: TaskFormDialogProps) {
  const [draft, setDraft] = useState<TaskDraft>(blankDraft);
  const [subtasksText, setSubtasksText] = useState('');
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const [visibleAttachments, setVisibleAttachments] = useState<FarmAttachment[]>([]);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState('');
  const [failedAttachmentDeletion, setFailedAttachmentDeletion] = useState<{
    attachment: FarmAttachment;
    detail: string;
  } | null>(null);
  const [locationStatus, setLocationStatus] = useState('');
  const [capturingLocation, setCapturingLocation] = useState(false);
  const [coordinateText, setCoordinateText] = useState('');
  const [calendarError, setCalendarError] = useState('');
  const [linkedDate, setLinkedDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  
  const { isSignedIn } = useAuth();
  const canAttach = AUTH_DISABLED || isSignedIn;
  const queryClient = useQueryClient();
  const requestUpload = useRequestFarmAttachmentUpload();
  const completeUpload = useCompleteFarmAttachmentUpload();
  const deleteAttachment = useDeleteFarmAttachment();
  const [uploadingFiles, setUploadingFiles] = useState<Record<string, { name: string; progress: number }>>({});

  const settingsQuery = useGetFarmSettings({ query: { queryKey: getGetFarmSettingsQueryKey(), enabled: open } });
  const groups = settingsQuery.data?.groups?.length ? settingsQuery.data.groups : DEFAULT_FARM_GROUPS;
  const locations = settingsQuery.data?.locations ?? [];

  useEffect(() => {
    if (open) {
      const next = {
        ...blankDraft,
        group: settingsQuery.data?.defaultGroup ?? blankDraft.group,
        urgency: settingsQuery.data?.defaultUrgency ?? blankDraft.urgency,
        location: settingsQuery.data?.defaultLocation ?? blankDraft.location,
        ...initialDraft,
        ...task,
      };
      next.recurrence = task?.recurrence ?? initialDraft?.recurrence ?? (task?.repeatWeekly || initialDraft?.repeatWeekly ? 'weekly' : 'none');
      next.repeatWeekly = next.recurrence === 'weekly';
      next.scheduledDates = taskScheduledDateKeys(next);
      const assignees = taskAssignees(task ?? initialDraft);
      next.assigneeIds = assignees.ids;
      next.assigneeNames = assignees.names;
      next.assigneeId = assignees.ids[0] ?? '';
      next.assigneeName = assignees.names[0] ?? '';
      setDraft(next);
      setSubtasksText((next.subtasks || []).map((subtask) => subtask.title).join('\n'));
      setUploadingFiles({});
      setStagedFiles([]);
      setAttachmentError('');
      setVisibleAttachments(task?.attachments ?? []);
      setDeletingAttachmentId('');
      setFailedAttachmentDeletion(null);
      setLocationStatus('');
      setCoordinateText(formatCoordinatePair(next.latitude, next.longitude));
      setCapturingLocation(false);
      setCalendarError('');
      setLinkedDate('');
      setSubmitting(false);
      setSubmitError('');
    }
  }, [open, task, initialDraft, settingsQuery.data]);

  if (!open) return null;

  const set = (key: keyof TaskDraft, value: string | boolean | number | null) => setDraft((current) => ({ ...current, [key]: value }));
  const captureCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus('This browser does not provide GPS. Open the farm map to choose the starting area.');
      return;
    }
    setCapturingLocation(true);
    setLocationStatus('Requesting your browser location…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        set('latitude', Number(position.coords.latitude.toFixed(6)));
        set('longitude', Number(position.coords.longitude.toFixed(6)));
        setCoordinateText(formatCoordinatePair(position.coords.latitude, position.coords.longitude));
        set('locationCapturedAt', new Date(position.timestamp).toISOString());
        setLocationStatus('Current GPS position added to this task.');
        setCapturingLocation(false);
      },
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? 'Location permission was not granted. You can still enter coordinates manually or open the farm map.'
          : 'Could not get your current location. Try again near a window or open the farm map.';
        setLocationStatus(message);
        setCapturingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || submitting) return;
    const coordinates = parseCoordinatePair(coordinateText);
    if (!coordinates) {
      setLocationStatus('Enter coordinates like 41°12\'59.40"S 172°54\'26.16"E.');
      return;
    }
    const calendarStart = draft.calendarStart?.trim() ?? '';
    const normalizedCalendarStart = normalizeTaskSchedule(calendarStart);
    if (normalizedCalendarStart === null) {
      setCalendarError('Enter a valid Pacific/Auckland date and optional time.');
      return;
    }
    const primaryDay = normalizedCalendarStart ? calendarStartDayKey(normalizedCalendarStart) : null;
    const scheduledDates = Array.from(new Set([...(draft.scheduledDates ?? []), ...(primaryDay ? [primaryDay] : [])]))
      .filter(isValidAucklandDateKey)
      .sort();
    if (draft.recurrence && draft.recurrence !== 'none' && (!normalizedCalendarStart || scheduledDates.length > 1)) {
      setCalendarError(draft.recurrence === 'weekly'
        ? 'Weekly tasks require one scheduled date and time.'
        : 'Recurring tasks require one scheduled date and time.');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      await onSave({
        ...draft,
        ...coordinates,
        task: draft.task.trim(),
        calendarStart: normalizedCalendarStart,
        scheduledDates,
        recurrence: draft.recurrence ?? 'none',
        repeatWeekly: draft.recurrence === 'weekly',
        subtasks: subtasksText.split('\n').map((item) => item.trim()).filter(Boolean).map((title, index) => ({
          id: `step-${index}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'work'}`,
          title,
          done: draft.subtasks?.find((subtask) => subtask.title === title)?.done ?? false,
        })),
      }, stagedFiles);
    } catch (cause) {
      setSubmitError(attachmentErrorMessage(cause, 'Could not finish saving this task.'));
    } finally {
      setSubmitting(false);
    }
  };
  const handleFileSelection = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;

    const oversized = files.filter((file) => file.size > MAX_ATTACHMENT_SIZE);
    if (oversized.length) {
      setAttachmentError(`${oversized.map((file) => file.name).join(', ')} ${oversized.length === 1 ? 'is' : 'are'} larger than 25 MB.`);
    }
    const accepted = files.filter((file) => file.size > 0 && file.size <= MAX_ATTACHMENT_SIZE);
    if (!accepted.length) return;

    if (!task?.id) {
      setStagedFiles((current) => [...current, ...accepted]);
      setAttachmentError('');
      return;
    }

    setAttachmentError('');
    for (const file of accepted) {
      const fileId = `${Date.now()}-${file.name}`;
      setUploadingFiles(prev => ({ ...prev, [fileId]: { name: file.name, progress: 0 } }));
      try {
        const ready = await uploadFarmAttachment({
          taskId: task.id,
          file,
          requestUpload,
          completeUpload,
          onProgress: (progress) => setUploadingFiles((current) => ({
            ...current,
            [fileId]: { name: file.name, progress },
          })),
        });
        setVisibleAttachments((current) => [...current, ready]);
        queryClient.invalidateQueries({ queryKey: getListFarmTasksQueryKey({ includeDone: true }) });
        queryClient.invalidateQueries({ queryKey: getListFarmTasksQueryKey({ includeDone: false }) });
      } catch (err) {
        setAttachmentError(attachmentErrorMessage(err));
      } finally {
        setUploadingFiles(prev => {
          const next = { ...prev };
          delete next[fileId];
          return next;
        });
      }
    }
  };

  const handleFileDelete = async (attachment: FarmAttachment, confirmRemoval = true) => {
    if (confirmRemoval && !confirm(`Remove ${attachment.name || 'this attachment'}?`)) return;
    setDeletingAttachmentId(attachment.id);
    setFailedAttachmentDeletion((current) => current?.attachment.id === attachment.id ? null : current);
    try {
      await deleteAttachment.mutateAsync({ attachmentId: attachment.id });
      setVisibleAttachments((current) => current.filter((item) => item.id !== attachment.id));
      setFailedAttachmentDeletion(null);
      // The unparameterized key is a prefix for every task-list variant, including
      // account-scoped keys, so one invalidation keeps all relevant caches current.
      void queryClient.invalidateQueries({ queryKey: getListFarmTasksQueryKey() });
    } catch (err) {
      setFailedAttachmentDeletion({
        attachment,
        detail: attachmentErrorMessage(err, 'Check your connection and try again.'),
      });
    } finally {
      setDeletingAttachmentId('');
    }
  };

  // We type task slightly loosely here for attachments since it might be passed as Partial<TaskDraft> 
  const attachments = visibleAttachments;
  const monthOptions = monthChoices([draft.month ?? '']);
  const assignableWorkers = workers.filter((worker) => worker.status === 'active' || worker.status === 'invited');
  const assignmentOptions = [
    ...assignableWorkers,
    ...(draft.assigneeIds ?? []).flatMap((id, index) => assignableWorkers.some((worker) => worker.clerkId === id)
      ? []
      : [{ clerkId: id, displayName: draft.assigneeNames?.[index] ?? id, status: 'assigned' }]),
  ];

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-end justify-center p-0 md:items-center md:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="task-dialog-title" className="max-h-[94dvh] w-full overflow-y-auto rounded-t-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl md:max-w-2xl md:rounded-[1.75rem]">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(42_45%_97%/.95)] px-5 py-4 backdrop-blur-md md:px-7">
          <div><p className="font-mono text-[10px] uppercase tracking-[.17em] text-[hsl(var(--muted-foreground))]">{task?.id ? 'Edit task' : 'New task'}</p><h2 id="task-dialog-title" className="mt-1 font-serif text-2xl text-[hsl(var(--foreground))]">{task?.id ? 'Update task' : 'Add a task'}</h2></div>
          <button type="button" onClick={onClose} data-testid="button-close-task-dialog" aria-label="Close task form" className="rounded-full p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"><X size={19} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5 px-5 py-6 md:px-7 md:py-7">
          <FormField label="Task name">
            <input required autoFocus value={draft.task} onChange={(event) => set('task', event.target.value)} data-testid="input-task-name" placeholder="e.g. Mulch the young pear row" className="field-input text-base" />
          </FormField>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Work group">
                <select value={draft.group} onChange={(event) => set('group', event.target.value)} data-testid="select-task-group" className="field-input">
                  {groups.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
            </FormField>
            <FormField label="Priority">
              <select value={draft.urgency} onChange={(event) => set('urgency', event.target.value)} data-testid="select-task-urgency" className="field-input"><option value="Urgent">Urgent</option><option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option></select>
            </FormField>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
             <FormField label="Schedule date & time" hint="Pacific/Auckland">
                <ScheduledDatePicker value={draft.calendarStart ?? ''} onChange={(value) => {
                  setDraft((current) => {
                    const priorPrimaryDay = calendarStartDayKey(current.calendarStart ?? '');
                    return {
                      ...current,
                      calendarStart: value,
                      // scheduledDates contains the canonical primary day as well as
                      // linked days. Replacing the primary must not retain its old
                      // day as an implicit linked day.
                      scheduledDates: (current.scheduledDates ?? []).filter((date) => date !== priorPrimaryDay),
                    };
                  });
                  setCalendarError('');
                }} />
               <div className="mt-3 border-t border-[hsl(var(--border))] pt-3">
                 <p className="text-xs font-semibold text-[hsl(var(--foreground))]">Add linked days</p>
                 <p className="mt-1 text-[11px] leading-4 text-[hsl(var(--muted-foreground))]">One task can appear on several days and shares its completion state.</p>
                 <div className="mt-2 flex gap-2">
                   <input type="date" value={linkedDate} onChange={(event) => setLinkedDate(event.target.value)} aria-label="Linked task date" className="field-input min-w-0 flex-1 py-2 text-sm" />
                   <button type="button" onClick={() => {
                     if (!isValidAucklandDateKey(linkedDate)) return;
                     setDraft((current) => ({ ...current, scheduledDates: Array.from(new Set([...(current.scheduledDates ?? []), linkedDate])).sort() }));
                     setLinkedDate('');
                   }} className="rounded-lg border border-[hsl(var(--border))] px-3 text-xs font-semibold hover:bg-[hsl(var(--muted))]">Add day</button>
                 </div>
                 {(draft.scheduledDates ?? []).length > 0 && <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Linked scheduled days">
                   {draft.scheduledDates!.map((date) => <li key={date} className="inline-flex items-center gap-1 rounded-md bg-[hsl(var(--primary)/.1)] px-2 py-1 text-[11px] text-[hsl(var(--primary))]">
                     {date}<button type="button" onClick={() => setDraft((current) => ({ ...current, scheduledDates: (current.scheduledDates ?? []).filter((item) => item !== date) }))} aria-label={`Remove ${date}`} className="rounded p-0.5 hover:bg-[hsl(var(--primary)/.16)]"><X size={12} /></button>
                   </li>)}
                 </ul>}
               </div>
              {calendarError && <p className="mt-1 text-xs text-[hsl(var(--destructive))]">{calendarError}</p>}
            </FormField>
            <FormField label="Repeat">
               <Select
                 value={draft.recurrence ?? (draft.repeatWeekly ? 'weekly' : 'none')}
                 disabled={task?.source === 'Google Calendar'}
                  onValueChange={(value) => {
                    if (!TASK_RECURRENCES.has(value as TaskRecurrence)) return;
                    set('recurrence', value as TaskRecurrence);
                    setCalendarError('');
                  }}
               >
                 <SelectTrigger
                   data-testid="select-task-recurrence"
                   aria-label="Repeat"
                   className="field-input h-auto min-h-[2.95rem]"
                 >
                   <SelectValue />
                 </SelectTrigger>
                 <SelectContent position="popper">
                   <SelectItem value="none">Does not repeat</SelectItem>
                   <SelectItem value="weekly">Every week</SelectItem>
                   <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                   <SelectItem value="every4weeks">Every 4 weeks</SelectItem>
                   <SelectItem value="monthly">Every month</SelectItem>
                   <SelectItem value="quarterly">Every 3 months</SelectItem>
                   <SelectItem value="yearly">Every year</SelectItem>
                 </SelectContent>
               </Select>
               {task?.source === 'Google Calendar' && <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">Imported calendar tasks cannot become manual recurring routines.</p>}
            </FormField>
          </div>
           {canAssign ? (
             <fieldset className="rounded-xl border border-[hsl(var(--border))] p-4" data-testid="task-assignee-fieldset">
               <legend className="px-1 font-mono text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Assigned team</legend>
               <p id="task-team-hint" className="mb-3 text-[11px] text-[hsl(var(--muted-foreground))]">Choose everyone responsible for this task. Unassigned work is not visible to workers.</p>
               <div className="grid gap-2 sm:grid-cols-2" aria-describedby="task-team-hint">
                 {assignmentOptions.map((worker) => {
                   const checked = (draft.assigneeIds ?? []).includes(worker.clerkId);
                   return (
                     <label key={worker.clerkId} className="flex min-h-11 items-center gap-3 rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-sm">
                       <input
                         type="checkbox"
                         checked={checked}
                         onChange={(event) => setDraft((current) => {
                           const currentIds = current.assigneeIds ?? [];
                           const nextIds = event.target.checked
                             ? [...currentIds, worker.clerkId]
                             : currentIds.filter((id) => id !== worker.clerkId);
                           const currentNamesById = new Map(currentIds.map((id, index) => [id, current.assigneeNames?.[index] ?? '']));
                           const nextNames = nextIds.map((id) => assignmentOptions.find((item) => item.clerkId === id)?.displayName
                             ?? currentNamesById.get(id)
                             ?? (id === current.assigneeId ? current.assigneeName : '')
                           ).filter((name): name is string => Boolean(name));
                           return {
                             ...current,
                             assigneeIds: nextIds,
                             assigneeNames: nextNames,
                             assigneeId: nextIds[0] ?? '',
                             assigneeName: nextNames[0] ?? '',
                           };
                         })}
                         data-testid={`checkbox-task-assignee-${worker.clerkId}`}
                       />
                       <span>{worker.displayName}{worker.status === 'invited' ? ' (Invited)' : ''}</span>
                     </label>
                   );
                 })}
               </div>
               {assignmentOptions.length === 0 && <p className="text-sm text-[hsl(var(--muted-foreground))]">No active or invited team members are available.</p>}
             </fieldset>
           ) : (
             <div>
               <p className="mb-2 font-mono text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Assigned team</p>
               <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.28)] px-3 py-3 text-sm" data-testid="readonly-task-assignees">
                 {(draft.assigneeNames ?? []).length ? draft.assigneeNames!.join(', ') : 'Unassigned'}
               </div>
               <p className="mt-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">Only Harnold can change the assigned team.</p>
             </div>
           )}
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="When">
              <select value={draft.month} onChange={(event) => set('month', event.target.value)} data-testid="input-task-month" className="field-input">
                <option value="">No month selected</option>
                {monthOptions.map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}
                {draft.month && !monthOptions.includes(draft.month) && <option value={draft.month}>{draft.month}</option>}
              </select>
            </FormField>
             <FormField label="Where"><><input list="farm-locations" value={draft.location} onChange={(event) => set('location', event.target.value)} data-testid="input-task-location" placeholder="North orchard" className="field-input" /><datalist id="farm-locations">{locations.map((location) => <option key={location} value={location} />)}</datalist></></FormField>
          </div>
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.28)] p-4">
            <p className="font-mono text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Field pin</p>
            <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Add coordinates from a phone-captured pin or map. The block name above remains separate.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={captureCurrentLocation} disabled={capturingLocation || pending} data-testid="button-capture-task-location" className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-3 py-2.5 text-xs font-semibold text-[hsl(var(--primary-foreground))] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60">
                <Crosshair size={14} className={capturingLocation ? 'animate-pulse' : ''} />{capturingLocation ? 'Finding location…' : typeof draft.latitude === 'number' && typeof draft.longitude === 'number' ? 'Update current location' : 'Use current location'}
              </button>
              <a href={FARM_MAP_START_URL} target="_blank" rel="noreferrer" data-testid="link-open-farm-map" className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2.5 text-xs font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--secondary))]">
                <MapPinned size={14} /> Open farm map <ExternalLink size={12} />
              </a>
            </div>
            {locationStatus && <p className="mt-2 text-xs leading-5 text-[hsl(var(--primary))]" role="status">{locationStatus}</p>}
             <div className="mt-3"><FormField label="Coordinates" hint="Use degrees, minutes, seconds: 41°12'59.40&quot;S 172°54'26.16&quot;E."><input value={coordinateText} onChange={(event) => setCoordinateText(event.target.value)} data-testid="input-task-coordinates" placeholder={'41°12\'59.40"S 172°54\'26.16"E'} className="field-input" /></FormField></div>
            <div className="mt-3"><FormField label="Atlas shared map link" hint="Optional. Paste a shared Atlas link to make it available from this task."><input type="url" value={draft.atlasLink ?? ''} onChange={(event) => set('atlasLink', event.target.value)} data-testid="input-task-atlas-link" placeholder="https://…" className="field-input" /></FormField></div>
          </div>
          <FormField label="Notes" hint="Add the context someone needs when they pick this up."><textarea value={draft.notes} onChange={(event) => set('notes', event.target.value)} data-testid="textarea-task-notes" rows={3} placeholder="Tools, conditions, or a useful reminder…" className="field-input min-h-24 resize-y" /></FormField>
          <FormField label="Steps" hint="One step per line."><textarea value={subtasksText} onChange={(event) => setSubtasksText(event.target.value)} data-testid="textarea-task-subtasks" rows={3} placeholder="Check soil moisture&#10;Stage wheelbarrow" className="field-input min-h-24 resize-y" /></FormField>
          <FormField label="Reference link"><input type="url" value={draft.link} onChange={(event) => set('link', event.target.value)} data-testid="input-task-link" placeholder="https://…" className="field-input" /></FormField>
          
           <FormField label="Attachments" hint={task?.id ? (AUTH_DISABLED ? 'Photos and files can be added while no-login testing is enabled.' : 'Photos and files stay private to approved farm members.') : 'Choose attachments now; they will upload after this task is saved.'}>
             <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.5)] p-4">
               {attachments.length > 0 && (
                 <ul className="mb-4 space-y-2">
                   {attachments.map(att => (
                     <li key={att.id} className="flex items-center justify-between gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2 pl-3">
                       <a href={att.downloadUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 truncate text-sm hover:underline">
                         <Paperclip size={14} className="text-[hsl(var(--muted-foreground))]" />
                         <span className="truncate">{att.name}</span>
                       </a>
                        <button type="button" onClick={() => handleFileDelete(att)} disabled={deletingAttachmentId === att.id} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--destructive))] disabled:opacity-50" aria-label={deletingAttachmentId === att.id ? `Removing ${att.name}` : `Remove ${att.name}`}>
                          {deletingAttachmentId === att.id ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                        </button>
                     </li>
                   ))}
                 </ul>
               )}
                {failedAttachmentDeletion && (
                  <div className="mb-4 rounded-lg border border-[hsl(var(--destructive)/.25)] bg-[hsl(5_61%_49%/.09)] px-3 py-3 text-sm text-[hsl(var(--destructive))]" role="alert">
                    <p className="leading-5">
                      Could not remove <span className="font-semibold">{failedAttachmentDeletion.attachment.name || 'this attachment'}</span>. {failedAttachmentDeletion.detail}
                    </p>
                    <button
                      type="button"
                      onClick={() => handleFileDelete(failedAttachmentDeletion.attachment, false)}
                      disabled={deletingAttachmentId === failedAttachmentDeletion.attachment.id}
                      className="mt-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[hsl(var(--destructive)/.35)] bg-[hsl(var(--card))] px-4 py-2 text-sm font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-50"
                    >
                      {deletingAttachmentId === failedAttachmentDeletion.attachment.id && <Loader2 size={16} className="animate-spin" />}
                      {deletingAttachmentId === failedAttachmentDeletion.attachment.id ? 'Retrying…' : 'Retry'}
                    </button>
                  </div>
                )}
               {stagedFiles.length > 0 && (
                 <ul className="mb-4 space-y-2" aria-label="Attachments waiting for task save">
                   {stagedFiles.map((file, index) => (
                     <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-[hsl(var(--border))] px-3 py-2 text-sm">
                       <span className="flex min-w-0 items-center gap-2 truncate"><Paperclip size={14} className="shrink-0 text-[hsl(var(--muted-foreground))]" /><span className="truncate">{file.name}</span></span>
                       <button type="button" onClick={() => setStagedFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="shrink-0 p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]" aria-label={`Remove ${file.name}`}><X size={14} /></button>
                     </li>
                   ))}
                 </ul>
               )}
               {Object.values(uploadingFiles).map((upload) => (
                 <div key={upload.name} className="mb-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2" role="status">
                   <div className="flex items-center justify-between gap-3 text-xs"><span className="flex min-w-0 items-center gap-2 truncate"><Loader2 size={14} className="shrink-0 animate-spin" /><span className="truncate">{upload.name}</span></span><span>{upload.progress}%</span></div>
                   <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className="h-full rounded-full bg-[hsl(var(--primary))] transition-[width]" style={{ width: `${upload.progress}%` }} /></div>
                 </div>
               ))}
               {attachmentError && <p className="mb-3 rounded-lg bg-[hsl(5_61%_49%/.09)] px-3 py-2 text-xs text-[hsl(var(--destructive))]" role="alert">{attachmentError}</p>}
                {canAttach ? (
                 <div className="grid gap-2 sm:grid-cols-3">
                   <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-3 py-4 text-center text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]">
                     <Camera size={16} /> Take photo
                     <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileSelection} />
                   </label>
                   <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-3 py-4 text-center text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]">
                     <Camera size={16} /> Choose photo
                     <input type="file" accept="image/*" multiple className="hidden" onChange={handleFileSelection} />
                   </label>
                   <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-3 py-4 text-center text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]">
                     <FileUp size={16} /> Choose file
                     <input type="file" multiple className="hidden" onChange={handleFileSelection} />
                   </label>
                 </div>
               ) : (
                 <div className="text-center text-sm text-[hsl(var(--muted-foreground))]">Sign in to attach files to this task.</div>
               )}
             </div>
           </FormField>

          {(error || submitError) && <p className="rounded-xl bg-[hsl(5_61%_49%/.09)] px-3 py-2.5 text-xs text-[hsl(var(--destructive))]" data-testid="status-form-error">{submitError || error}</p>}
          <div className="flex flex-col-reverse gap-3 border-t border-[hsl(var(--border))] pt-5 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} data-testid="button-cancel-task" className="rounded-xl px-4 py-2.5 text-sm font-semibold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]">Cancel</button>
            <button type="submit" disabled={pending || submitting || !draft.task.trim()} data-testid="button-save-task" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-5 py-2.5 text-sm font-semibold text-[hsl(var(--primary-foreground))] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60">{pending || submitting ? <Loader2 size={15} className="animate-spin" /> : task?.id ? <Check size={15} /> : <Plus size={15} />}{pending || submitting ? 'Saving…' : task?.id ? 'Save changes' : 'Add to the board'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
