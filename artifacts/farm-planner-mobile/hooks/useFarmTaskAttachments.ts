import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  customFetch,
  getListFarmTasksQueryKey,
  useCompleteFarmAttachmentUpload,
  useDeleteFarmAttachment,
  useRequestFarmAttachmentUpload,
  type FarmAttachment,
} from '@workspace/api-client-react';
import * as Linking from 'expo-linking';
import type { LocalAttachment } from '@/components/AttachmentPicker';
import { attachmentErrorMessage, uploadMobileFarmAttachment } from '@/lib/farm-attachment-upload';

export type AttachmentUploadStatus = {
  taskId: string;
  currentName: string;
  currentProgress: number;
  completed: number;
  total: number;
};

export function useFarmTaskAttachments() {
  const queryClient = useQueryClient();
  const requestUpload = useRequestFarmAttachmentUpload();
  const completeUpload = useCompleteFarmAttachmentUpload();
  const deleteAttachment = useDeleteFarmAttachment();
  const [uploadStatus, setUploadStatus] = useState<AttachmentUploadStatus | null>(null);

  const upload = async (taskId: string, files: LocalAttachment[]) => {
    if (!files.length) return { failed: [] as string[], uploaded: [] as FarmAttachment[] };
    const uploaded: FarmAttachment[] = [];
    const failed: string[] = [];
    setUploadStatus({ taskId, currentName: files[0].name, currentProgress: 0, completed: 0, total: files.length });

    for (const [index, file] of files.entries()) {
      setUploadStatus({ taskId, currentName: file.name, currentProgress: 0, completed: index, total: files.length });
      try {
        const ready = await uploadMobileFarmAttachment({
          taskId,
          file,
          requestUpload,
          completeUpload,
          onProgress: (currentProgress) => setUploadStatus((current) => current ? { ...current, currentName: file.name, currentProgress } : current),
        });
        uploaded.push(ready);
      } catch (error) {
        failed.push(`${file.name}: ${attachmentErrorMessage(error)}`);
      }
      setUploadStatus({ taskId, currentName: file.name, currentProgress: 100, completed: index + 1, total: files.length });
    }

    setUploadStatus(null);
    await queryClient.invalidateQueries({ queryKey: getListFarmTasksQueryKey() });
    return { failed, uploaded };
  };

  const remove = async (attachmentId: string) => {
    await deleteAttachment.mutateAsync({ attachmentId });
    await queryClient.invalidateQueries({ queryKey: getListFarmTasksQueryKey() });
  };

  const open = async (attachmentId: string) => {
    const response = await customFetch<{ url: string }>(`/api/attachments/${attachmentId}/open-url`);
    if (!response.url) throw new Error('The attachment could not be opened.');
    await Linking.openURL(response.url);
  };

  return { upload, remove, open, uploadStatus, deleting: deleteAttachment.isPending };
}