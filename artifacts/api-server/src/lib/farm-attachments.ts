import { and, eq, inArray } from "drizzle-orm";
import { db, farmAttachments, type FarmAttachmentRecord } from "@workspace/db";
import { deletePrivateObject } from "./object-storage";
import { deleteDriveAttachment } from "./google-drive-storage";

export type FarmAttachmentView = {
  id: string;
  taskId: string;
  name: string;
  contentType: string;
  size: number;
  downloadUrl: string;
};

export function toAttachmentView(record: FarmAttachmentRecord): FarmAttachmentView {
  return {
    id: record.id,
    taskId: record.taskId,
    name: record.name,
    contentType: record.contentType,
    size: record.size,
    downloadUrl: `/api/attachments/${record.id}/content`,
  };
}

export async function createFarmAttachment(input: {
  id: string;
  taskId: string;
  ownerId: string;
  name: string;
  contentType: string;
  size: number;
}): Promise<{ record: FarmAttachmentRecord; uploadUrl: string }> {
  const upload = { objectPath: `/drive/pending/${input.id}`, uploadUrl: `/api/attachments/${input.id}/upload` };
  const [record] = await db.insert(farmAttachments).values({
    ...input,
    objectPath: upload.objectPath,
    storageProvider: "google_drive",
    status: "pending",
  }).returning();
  return { record, uploadUrl: upload.uploadUrl };
}

export async function attachDriveFile(id: string, ownerId: string, driveFileId: string): Promise<FarmAttachmentRecord | null> {
  const [record] = await db.update(farmAttachments)
    .set({ driveFileId, status: "ready" })
    .where(and(eq(farmAttachments.id, id), eq(farmAttachments.ownerId, ownerId)))
    .returning();
  return record ?? null;
}

export async function completeFarmAttachment(id: string, ownerId: string): Promise<FarmAttachmentRecord | null> {
  const [record] = await db.update(farmAttachments)
    .set({ status: "ready" })
    .where(and(eq(farmAttachments.id, id), eq(farmAttachments.ownerId, ownerId)))
    .returning();
  return record ?? null;
}

export async function getFarmAttachment(id: string): Promise<FarmAttachmentRecord | null> {
  const [record] = await db.select().from(farmAttachments).where(eq(farmAttachments.id, id));
  return record ?? null;
}

export async function canAccessAttachment(id: string, clerkId: string, master: boolean): Promise<boolean> {
  const [record] = await db.select().from(farmAttachments).where(eq(farmAttachments.id, id));
  return Boolean(record && (master || record.ownerId === clerkId));
}

export async function listReadyAttachments(taskIds: string[]): Promise<Map<string, FarmAttachmentView[]>> {
  const records = taskIds.length
    ? await db.select().from(farmAttachments).where(and(inArray(farmAttachments.taskId, taskIds), eq(farmAttachments.status, "ready")))
    : [];
  return records.reduce((map, record) => {
    const existing = map.get(record.taskId) ?? [];
    existing.push(toAttachmentView(record));
    map.set(record.taskId, existing);
    return map;
  }, new Map<string, FarmAttachmentView[]>());
}

export async function deleteFarmAttachment(id: string, ownerId?: string): Promise<boolean> {
  const [record] = await db.delete(farmAttachments)
    .where(ownerId ? and(eq(farmAttachments.id, id), eq(farmAttachments.ownerId, ownerId)) : eq(farmAttachments.id, id))
    .returning();
  if (!record) return false;
  try {
    if (record.storageProvider === "google_drive" && record.driveFileId) {
      await deleteDriveAttachment(record.driveFileId);
    } else {
      await deletePrivateObject(record.objectPath);
    }
  } catch {
    // The metadata is already gone; a stale object is inaccessible and can expire safely.
  }
  return true;
}