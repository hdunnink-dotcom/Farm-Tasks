import { type AttachmentUploadInput, type FarmAttachment } from '@workspace/api-client-react';
import type { LocalAttachment } from '@/components/AttachmentPicker';

export const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;

type RequestUploadMutation = {
  mutateAsync: (variables: { data: AttachmentUploadInput }) => Promise<{
    uploadUrl: string;
    attachment: FarmAttachment;
  }>;
};

type CompleteUploadMutation = {
  mutateAsync: (variables: { attachmentId: string }) => Promise<FarmAttachment>;
};

export function attachmentErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message.replace(/^HTTP \d+[^:]*:\s*/, '') : 'Could not upload that attachment.';
}

export async function uploadMobileFarmAttachment({
  taskId,
  file,
  requestUpload,
  completeUpload,
  onProgress,
}: {
  taskId: string;
  file: LocalAttachment;
  requestUpload: RequestUploadMutation;
  completeUpload: CompleteUploadMutation;
  onProgress?: (progress: number) => void;
}) {
  onProgress?.(10);
  const localResponse = await fetch(file.uri);
  if (!localResponse.ok) throw new Error('The selected file could not be read from the device.');
  const body = await localResponse.blob();
  const size = file.size || body.size;
  if (!size || size > MAX_ATTACHMENT_SIZE) throw new Error(`${file.name} must be smaller than 25 MB.`);

  const input: AttachmentUploadInput = {
    taskId,
    name: file.name,
    size,
    contentType: file.contentType || body.type || 'application/octet-stream',
  };
  const { uploadUrl, attachment } = await requestUpload.mutateAsync({ data: input });
  onProgress?.(35);
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': input.contentType },
    body,
  });
  if (!uploadResponse.ok) throw new Error(`Storage rejected ${file.name} (${uploadResponse.status}).`);
  onProgress?.(80);
  const ready = await completeUpload.mutateAsync({ attachmentId: attachment.id });
  onProgress?.(100);
  return ready;
}