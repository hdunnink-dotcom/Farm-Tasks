import { GoogleConnectors } from "./google-connectors";

const DRIVE_FOLDER_NAME = "Farm Planner Attachments";
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

let folderIdPromise: Promise<string> | undefined;

function driveRequest(path: string, options?: {
  method?: string;
  headers?: Record<string, string>;
  body?: RequestInit["body"];
}): Promise<Response> {
  const connectors = new GoogleConnectors();
  return connectors.proxy("google-drive", path, options);
}

async function getFolderId(): Promise<string> {
  const configured = process.env.FARM_DRIVE_ATTACHMENT_FOLDER_ID;
  if (configured) return configured;
  if (!folderIdPromise) {
    folderIdPromise = (async () => {
      const query = encodeURIComponent(`name = '${DRIVE_FOLDER_NAME}' and mimeType = '${DRIVE_FOLDER_MIME}' and trashed = false`);
      const response = await driveRequest(`/drive/v3/files?q=${query}&pageSize=10&fields=files(id,name)`);
      if (!response.ok) throw new Error(`Google Drive folder lookup failed (${response.status}).`);
      const body = (await response.json()) as { files?: Array<{ id?: string }> };
      const existing = body.files?.find((file) => file.id)?.id;
      if (existing) return existing;

      const created = await driveRequest("/drive/v3/files?fields=id", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: DRIVE_FOLDER_MIME }),
      });
      if (!created.ok) throw new Error(`Google Drive folder creation failed (${created.status}).`);
      const createdBody = (await created.json()) as { id?: string };
      if (!createdBody.id) throw new Error("Google Drive did not return the attachment folder ID.");
      return createdBody.id;
    })();
  }
  return folderIdPromise;
}

function multipartBody(metadata: unknown, content: Buffer, contentType: string): { body: Buffer; contentType: string } {
  const boundary = `farm-planner-${crypto.randomUUID()}`;
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([prefix, content, suffix]), contentType: `multipart/related; boundary=${boundary}` };
}

export async function uploadDriveAttachment(input: {
  name: string;
  contentType: string;
  content: Buffer;
}): Promise<{ fileId: string }> {
  const folderId = await getFolderId();
  const multipart = multipartBody({ name: input.name, parents: [folderId] }, input.content, input.contentType);
  const response = await driveRequest("/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: {
      "content-type": multipart.contentType,
      "content-length": String(multipart.body.length),
    },
    body: multipart.body,
  });
  if (!response.ok) throw new Error(`Google Drive upload failed (${response.status}).`);
  const body = (await response.json()) as { id?: string };
  if (!body.id) throw new Error("Google Drive did not return the uploaded file ID.");
  return { fileId: body.id };
}

export async function downloadDriveAttachment(fileId: string): Promise<Response> {
  const response = await driveRequest(`/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { method: "GET" });
  if (!response.ok) throw new Error(`Google Drive download failed (${response.status}).`);
  return response;
}

export async function deleteDriveAttachment(fileId: string): Promise<void> {
  const response = await driveRequest(`/drive/v3/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new Error(`Google Drive deletion failed (${response.status}).`);
}