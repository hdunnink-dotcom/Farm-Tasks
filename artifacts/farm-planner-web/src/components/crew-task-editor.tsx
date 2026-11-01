import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListFarmTasksQueryKey,
  useCompleteFarmAttachmentUpload,
  useRequestFarmAttachmentUpload,
  type FarmTask,
  type TaskInput,
} from '@workspace/api-client-react';
import { TaskFormDialog } from './task-form-dialog';
import { uploadFarmAttachment } from '@/lib/farm-attachment-upload';

type CrewTaskEditorProps = {
  /** The task to edit, or undefined to add a new one from initialDraft. */
  task?: FarmTask;
  initialDraft?: TaskInput;
  online: boolean;
  workers: Array<{ clerkId: string; displayName: string; status: string }>;
  canAssign: boolean;
  saveTask: (task: FarmTask | undefined, data: TaskInput) => Promise<FarmTask>;
  ensureTaskSynced: (taskId: string) => Promise<unknown>;
  onDone: () => void;
  onClose: () => void;
};

/** The full task form, opened over the Crew plan so saving returns to the board. */
export function CrewTaskEditor({ task, initialDraft, online, workers, canAssign, saveTask, ensureTaskSynced, onDone, onClose }: CrewTaskEditorProps) {
  const queryClient = useQueryClient();
  const requestUpload = useRequestFarmAttachmentUpload();
  const completeUpload = useCompleteFarmAttachmentUpload();
  // A new task is created once; pressing Save again after a failed photo
  // upload only retries the upload.
  const stagedCreatedTask = useRef<FarmTask | null>(null);

  const save = async (draft: TaskInput, attachments: File[] = []) => {
    if (task?.id) {
      await saveTask(task, draft);
      onDone();
      return;
    }
    const created = stagedCreatedTask.current ?? await saveTask(undefined, draft);
    stagedCreatedTask.current = created;
    if (attachments.length) {
      if (!online) throw new Error('The task is saved offline. Reconnect and press Save again to upload the photo.');
      await ensureTaskSynced(created.id);
      for (const file of attachments) {
        await uploadFarmAttachment({ taskId: created.id, file, requestUpload, completeUpload });
      }
      void queryClient.invalidateQueries({ queryKey: getListFarmTasksQueryKey({ includeDone: true }) });
    }
    stagedCreatedTask.current = null;
    onDone();
  };

  return (
    <TaskFormDialog
      open
      task={task}
      initialDraft={initialDraft}
      onClose={() => { stagedCreatedTask.current = null; onClose(); }}
      onSave={save}
      workers={workers}
      canAssign={canAssign}
    />
  );
}
