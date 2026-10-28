import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { TaskInput } from '@workspace/api-client-react';
import { localAucklandDateKey } from '@/lib/task-calendar';

export type TaskWorker = { clerkId: string; displayName: string; status: string };

export function compactTaskDraft(title: string, date: string, assigneeIds: string[], workers: TaskWorker[]): TaskInput {
  const assigneeNames = assigneeIds.map((id) => workers.find((worker) => worker.clerkId === id)?.displayName ?? '').filter(Boolean);
  return { task: title.trim(), calendarStart: date, assigneeIds, assigneeNames, assigneeId: assigneeIds[0] ?? '', assigneeName: assigneeNames[0] ?? '', group: 'Orchards', urgency: 'Medium' };
}

export function CompactTaskCreate({ open, onOpenChange, workers, initialDate, initialAssigneeIds = [], onSave, onContinue }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workers: TaskWorker[];
  initialDate?: string;
  initialAssigneeIds?: string[];
  onSave: (draft: TaskInput) => Promise<void>;
  onContinue: (draft: TaskInput) => void;
}) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(localAucklandDateKey());
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const activeWorkers = workers.filter((worker) => worker.status === 'active' || worker.status === 'invited');
  const initialTeamKey = initialAssigneeIds.join(',');
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDate(initialDate ?? localAucklandDateKey());
    setAssigneeIds(initialAssigneeIds);
    setSaving(false);
    setError('');
  }, [open, initialDate, initialTeamKey]);
  const draft = () => compactTaskDraft(title, date, assigneeIds, activeWorkers);
  const continueToEditor = () => {
    if (!title.trim()) { setError('Enter a task title.'); return; }
    onContinue(draft());
  };
  const save = async () => {
    if (!title.trim()) { setError('Enter a task title.'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave(draft());
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the task.');
    } finally {
      setSaving(false);
    }
  };
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm" />
      <Dialog.Content aria-describedby="compact-task-description" className="fixed left-1/2 top-1/2 z-[60] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-xl">
        <Dialog.Title className="font-serif text-lg text-[hsl(var(--foreground))]">Quick add task</Dialog.Title>
        <Dialog.Description id="compact-task-description" className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Set the work, Auckland day, and responsible team.</Dialog.Description>
        <div className="mt-4 space-y-4">
          <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))]">Task title<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background))] p-2 text-sm text-[hsl(var(--foreground))]" /></label>
          <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))]">Auckland date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background))] p-2 text-sm text-[hsl(var(--foreground))]" /></label>
          <fieldset><legend className="mb-2 text-xs font-semibold text-[hsl(var(--muted-foreground))]">Team</legend><div className="max-h-[150px] space-y-2 overflow-y-auto">{activeWorkers.map((worker) => <label key={worker.clerkId} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={assigneeIds.includes(worker.clerkId)} onChange={() => setAssigneeIds((current) => current.includes(worker.clerkId) ? current.filter((id) => id !== worker.clerkId) : [...current, worker.clerkId])} />{worker.displayName}{worker.status === 'invited' ? ' (Invited)' : ''}</label>)}</div></fieldset>
          {error && <p role="alert" className="rounded-lg bg-[hsl(var(--destructive)/.1)] p-2 text-sm text-[hsl(var(--destructive))]">{error}</p>}
        </div>
        <div className="mt-6 flex flex-col gap-2"><button type="button" onClick={save} disabled={saving} className="rounded-lg bg-[hsl(var(--primary))] py-2 text-sm font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button><button type="button" onClick={continueToEditor} disabled={saving} className="rounded-lg border border-[hsl(var(--border))] py-2 text-sm font-semibold">Continue to full editor</button></div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}