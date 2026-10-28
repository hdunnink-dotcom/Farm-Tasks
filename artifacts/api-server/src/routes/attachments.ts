import { randomUUID } from "crypto";
import { Readable } from "stream";
import { getAuth } from "@clerk/express";
import {
  CompleteFarmAttachmentUploadParams,
  CompleteFarmAttachmentUploadResponse,
  DeleteFarmAttachmentParams,
  GetFarmAttachmentContentParams,
  RequestFarmAttachmentUploadBody,
  RequestFarmAttachmentUploadResponse,
} from "@workspace/api-zod";
import express, { Router, type IRouter } from "express";
import {
  completeFarmAttachment,
  attachDriveFile,
  createFarmAttachment,
  deleteFarmAttachment,
  getFarmAttachment,
  toAttachmentView,
} from "../lib/farm-attachments";
import { createPrivateDownloadUrl, getPrivateObject } from "../lib/object-storage";
import { downloadDriveAttachment, uploadDriveAttachment } from "../lib/google-drive-storage";
import { authDisabled, currentMember, isMaster } from "../lib/farm-access";
import { listSheetTasks } from "../lib/farm-sheet";

const router: IRouter = Router();
const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;
const driveUploadBody = express.raw({ type: "*/*", limit: MAX_ATTACHMENT_SIZE });

function userId(req: Parameters<typeof getAuth>[0]): string | null {
  return getAuth(req).userId ?? (authDisabled ? "test-master" : null);
}

function absoluteApiUrl(req: Parameters<typeof getAuth>[0], path: string): string {
  return `${req.protocol}://${req.get("host")}${path}`;
}

router.post("/attachments/upload-url", async (req, res): Promise<void> => {
  const ownerId = userId(req);
  const member = await currentMember(req);
  const body = RequestFarmAttachmentUploadBody.safeParse(req.body);
  if (!ownerId || !member) {
    res.status(401).json({ error: "Sign in to add protected attachments." });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: "Choose a file with valid details." });
    return;
  }
  if (!isMaster(member)) {
    const task = (await listSheetTasks()).find((item) => item.id === body.data.taskId);
    if (!task || !(task.assigneeIds?.includes(member.clerkId) || task.assigneeId === member.clerkId)) { res.status(403).json({ error: "You can only attach files to your assigned tasks." }); return; }
  }
  if (body.data.size > MAX_ATTACHMENT_SIZE) {
    res.status(400).json({ error: "Choose a file smaller than 25 MB with valid file details." });
    return;
  }
  try {
    const { record, uploadUrl } = await createFarmAttachment({
      id: `att-${randomUUID()}`,
      taskId: body.data.taskId,
      ownerId,
      name: body.data.name.slice(0, 180),
      contentType: body.data.contentType,
      size: Math.floor(body.data.size),
    });
    res.status(201).json(RequestFarmAttachmentUploadResponse.parse({
      attachment: toAttachmentView(record),
      uploadUrl: absoluteApiUrl(req, uploadUrl),
    }));
  } catch (error) {
    req.log.error({ err: error }, "Could not create protected attachment upload");
    res.status(502).json({ error: "Could not prepare that attachment upload." });
  }
});

router.put("/attachments/:attachmentId/upload", driveUploadBody, async (req, res): Promise<void> => {
  const ownerId = userId(req);
  const member = await currentMember(req);
  const params = CompleteFarmAttachmentUploadParams.safeParse(req.params);
  if (!ownerId || !member) { res.status(401).json({ error: "Sign in to upload protected attachments." }); return; }
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const record = await getFarmAttachment(params.data.attachmentId);
  if (!record || record.ownerId !== ownerId || record.storageProvider !== "google_drive") {
    res.status(404).json({ error: "Attachment upload not found." });
    return;
  }
  if (!isMaster(member)) {
    const task = (await listSheetTasks()).find((item) => item.id === record.taskId);
    if (!task || !(task.assigneeIds?.includes(member.clerkId) || task.assigneeId === member.clerkId)) {
      res.status(403).json({ error: "You can only upload files to your assigned tasks." });
      return;
    }
  }
  const content = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
  if (!content.length || content.length > MAX_ATTACHMENT_SIZE) {
    res.status(400).json({ error: "Choose a file smaller than 25 MB." });
    return;
  }
  try {
    const uploaded = await uploadDriveAttachment({
      name: record.name,
      contentType: record.contentType,
      content,
    });
    await attachDriveFile(record.id, ownerId, uploaded.fileId);
    res.sendStatus(200);
  } catch (error) {
    req.log.error({ err: error }, "Could not upload attachment to Google Drive");
    res.status(502).json({ error: "Could not store that attachment in Google Drive." });
  }
});

router.post("/attachments/:attachmentId/complete", async (req, res): Promise<void> => {
  const ownerId = userId(req);
  const member = await currentMember(req);
  const params = CompleteFarmAttachmentUploadParams.safeParse(req.params);
  if (!ownerId || !member) {
    res.status(401).json({ error: "Sign in to finish an attachment upload." });
    return;
  }
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const record = await completeFarmAttachment(params.data.attachmentId, ownerId);
  if (!record) {
    res.status(404).json({ error: "Attachment not found." });
    return;
  }
  res.json(CompleteFarmAttachmentUploadResponse.parse(toAttachmentView(record)));
});

router.get("/attachments/:attachmentId/content", async (req, res): Promise<void> => {
  const ownerId = userId(req);
  const member = await currentMember(req);
  const params = GetFarmAttachmentContentParams.safeParse(req.params);
  if (!ownerId || !member) {
    res.status(401).json({ error: "Sign in to view protected attachments." });
    return;
  }
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const record = await getFarmAttachment(params.data.attachmentId);
    if (!record || record.status !== "ready") {
      res.status(404).json({ error: "Attachment not found." });
      return;
    }
    if (!isMaster(member)) {
      const task = (await listSheetTasks()).find((item) => item.id === record.taskId);
      if (!task || !(task.assigneeIds?.includes(member.clerkId) || task.assigneeId === member.clerkId)) { res.status(403).json({ error: "You cannot view this attachment." }); return; }
    }
    if (record.storageProvider === "google_drive" && record.driveFileId) {
      const driveResponse = await downloadDriveAttachment(record.driveFileId);
      res.setHeader("content-type", driveResponse.headers.get("content-type") || record.contentType);
      res.setHeader("content-length", driveResponse.headers.get("content-length") || String(record.size));
      res.setHeader("cache-control", "private, max-age=300");
      res.setHeader("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(record.name)}`);
      if (driveResponse.body) Readable.fromWeb(driveResponse.body).pipe(res);
      else res.end();
      return;
    }
    const file = await getPrivateObject(record.objectPath);
    const [metadata] = await file.getMetadata();
    res.setHeader("content-type", (metadata.contentType as string) || record.contentType);
    res.setHeader("content-length", String(metadata.size ?? record.size));
    res.setHeader("cache-control", "private, max-age=300");
    res.setHeader("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(record.name)}`);
    Readable.fromWeb(file.createReadStream() as unknown as ReadableStream<Uint8Array>).pipe(res);
  } catch (error) {
    req.log.error({ err: error }, "Could not stream protected attachment");
    res.status(502).json({ error: "Could not open this attachment." });
  }
});

router.get("/attachments/:attachmentId/open-url", async (req, res): Promise<void> => {
  const ownerId = userId(req);
  const member = await currentMember(req);
  const params = GetFarmAttachmentContentParams.safeParse(req.params);
  if (!ownerId || !member) {
    res.status(401).json({ error: "Sign in to view protected attachments." });
    return;
  }
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const record = await getFarmAttachment(params.data.attachmentId);
    if (!record || record.status !== "ready") {
      res.status(404).json({ error: "Attachment not found." });
      return;
    }
    if (!isMaster(member)) {
      const task = (await listSheetTasks()).find((item) => item.id === record.taskId);
      if (!task || !(task.assigneeIds?.includes(member.clerkId) || task.assigneeId === member.clerkId)) {
        res.status(403).json({ error: "You cannot view this attachment." });
        return;
      }
    }
    if (record.storageProvider === "google_drive") {
      res.json({ url: absoluteApiUrl(req, `/api/attachments/${record.id}/content`) });
    } else {
      res.json({ url: await createPrivateDownloadUrl(record.objectPath) });
    }
  } catch (error) {
    req.log.error({ err: error }, "Could not create protected attachment download URL");
    res.status(502).json({ error: "Could not open this attachment." });
  }
});

router.delete("/attachments/:attachmentId", async (req, res): Promise<void> => {
  const ownerId = userId(req);
  const member = await currentMember(req);
  const params = DeleteFarmAttachmentParams.safeParse(req.params);
  if (!ownerId || !member) {
    res.status(401).json({ error: "Sign in to remove attachments." });
    return;
  }
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!isMaster(member)) {
    const record = await getFarmAttachment(params.data.attachmentId);
    const task = record ? (await listSheetTasks()).find((item) => item.id === record.taskId) : null;
    if (!task || !(task.assigneeIds?.includes(member.clerkId) || task.assigneeId === member.clerkId)) { res.status(403).json({ error: "You cannot remove this attachment." }); return; }
  }
  const deleted = await deleteFarmAttachment(
    params.data.attachmentId,
    isMaster(member) ? undefined : ownerId,
  );
  if (!deleted) {
    res.status(404).json({ error: "Attachment not found." });
    return;
  }
  res.sendStatus(204);
});

export default router;