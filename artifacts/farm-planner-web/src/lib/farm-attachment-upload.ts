import type { AttachmentUploadInput, FarmAttachment } from '@workspace/api-client-react';

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

export function attachmentErrorMessage(error: unknown, fallback = 'Could not upload that attachment.') {
  if (error instanceof Error && error.message) return error.message.replace(/^HTTP \d+[^:]*:\s*/, '');
  return fallback;
}

function putFile(url: string, file: File, onProgress?: (progress: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.timeout = 120_000;
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`The storage service rejected the upload (${request.status}).`));
      }
    };
    request.onerror = () => reject(new Error('The upload could not reach storage. Check your connection and try again.'));
    request.onabort = () => reject(new Error('Upload cancelled.'));
    request.ontimeout = () => reject(new Error('The photo upload took too long. Check your connection and try again.'));
    request.send(file);
  });
}

function browserUploadUrl(url: string): string {
  // The API returns an absolute URL for native clients. In the web preview,
  // keep only the path so the request stays on Replit's proxied origin rather
  // than trying to reach the API's internal localhost port.
  const parsed = new URL(url, window.location.href);
  return `${parsed.pathname}${parsed.search}`;
}

export async function uploadFarmAttachment({
  taskId,
  file,
  requestUpload,
  completeUpload,
  onProgress,
}: {
  taskId: string;
  file: File;
  requestUpload: RequestUploadMutation;
  completeUpload: CompleteUploadMutation;
  onProgress?: (progress: number) => void;
}) {
  if (!file.size || file.size > MAX_ATTACHMENT_SIZE) {
    throw new Error('Choose a file smaller than 25 MB.');
  }

  const input: AttachmentUploadInput = {
    taskId,
    name: file.name,
    size: file.size,
    contentType: file.type || 'application/octet-stream',
  };
  const { uploadUrl, attachment } = await requestUpload.mutateAsync({ data: input });
  await putFile(browserUploadUrl(uploadUrl), file, onProgress);
  return completeUpload.mutateAsync({ attachmentId: attachment.id });
}