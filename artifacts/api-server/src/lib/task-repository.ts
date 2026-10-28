import { and, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, farmAttachments, farmTaskCompletionEvents, farmTaskMutationReceipts, farmTaskSheetOutbox, farmTaskStorageState, farmTasks } from "@workspace/db";
import type { SheetTask, CompletionRecord } from "./farm-sheet";

type TaskInput = Partial<Omit<SheetTask, "updatedAt">> & Pick<SheetTask, "task">;

function rowToTask(row: typeof farmTasks.$inferSelect): SheetTask {
  return {
    id: row.id, group: row.group, task: row.task, done: row.done, urgency: row.urgency as SheetTask["urgency"],
    month: row.month, location: row.location, latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude), locationCapturedAt: row.locationCapturedAt,
    atlasLink: row.atlasLink, notes: row.notes, link: row.link, subtasks: row.subtasks ?? [], attachmentIds: row.attachmentIds ?? [],
    source: row.source as SheetTask["source"], calendarEventId: row.calendarEventId, calendarRecurringEventId: row.calendarRecurringEventId,
    calendarStart: row.calendarStart, scheduledDates: row.scheduledDates ?? [], calendarUpdated: row.calendarUpdated,
    updatedAt: row.updatedAt.toISOString(), assigneeId: row.assigneeId, assigneeName: row.assigneeName,
    assigneeIds: row.assigneeIds ?? [], assigneeNames: row.assigneeNames ?? [], recurrence: row.recurrence as SheetTask["recurrence"],
    repeatWeekly: row.repeatWeekly, reviewStatus: row.reviewStatus as SheetTask["reviewStatus"], submittedById: row.submittedById,
    submittedByName: row.submittedByName, reviewNote: row.reviewNote, reviewedAt: row.reviewedAt,
  };
}

function values(input: TaskInput, id: string, current?: SheetTask) {
  const merged = { ...current, ...input };
  const ids = merged.assigneeIds ?? (merged.assigneeId ? [merged.assigneeId] : []);
  const names = merged.assigneeNames ?? (merged.assigneeName ? [merged.assigneeName] : []);
  return {
    id, group: merged.group ?? "Admin", task: merged.task.trim(), done: merged.done ?? false, urgency: merged.urgency ?? "Medium",
    month: merged.month ?? "", location: merged.location ?? "", latitude: merged.latitude === null || merged.latitude === undefined ? null : String(merged.latitude),
    longitude: merged.longitude === null || merged.longitude === undefined ? null : String(merged.longitude),
    locationCapturedAt: merged.locationCapturedAt ?? "", atlasLink: merged.atlasLink ?? "", notes: merged.notes ?? "", link: merged.link ?? "",
    subtasks: merged.subtasks ?? [], attachmentIds: merged.attachmentIds ?? [], source: merged.source ?? "Manual",
    calendarEventId: merged.calendarEventId ?? "", calendarRecurringEventId: merged.calendarRecurringEventId ?? "", calendarStart: merged.calendarStart ?? "",
    scheduledDates: merged.scheduledDates ?? [], calendarUpdated: merged.calendarUpdated ?? "", assigneeId: ids[0] ?? "", assigneeName: names[0] ?? "",
    assigneeIds: ids, assigneeNames: names, recurrence: merged.recurrence ?? "none", repeatWeekly: merged.repeatWeekly ?? false,
    reviewStatus: merged.reviewStatus ?? "approved", submittedById: merged.submittedById ?? "", submittedByName: merged.submittedByName ?? "",
    reviewNote: merged.reviewNote ?? "", reviewedAt: merged.reviewedAt ?? "", updatedAt: new Date(),
  };
}

function outbox(transaction: any, taskId: string, operation: string, payload: unknown) {
  return transaction.insert(farmTaskSheetOutbox).values({
    id: `${operation}:${taskId}:${Date.now()}:${Math.random().toString(36).slice(2)}`, taskId, operation, payload,
  }).onConflictDoNothing();
}

export async function listAuthoritativeTasks(): Promise<SheetTask[]> {
  return (await db.select().from(farmTasks)).map(rowToTask);
}
/** One-time, lock-coordinated cutover from the legacy Sheet projection. */
export async function importLegacySheetData(loadTasks: () => Promise<SheetTask[]>, loadCompletions: () => Promise<CompletionRecord[]>): Promise<{ tasks: number; completions: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('farm-authority-initial-import'))`);
    const [state] = await tx.select().from(farmTaskStorageState).where(eq(farmTaskStorageState.key, "sheet-import")).limit(1);
    if (state?.version === "1") return { tasks: 0, completions: 0 };
    const tasks = await loadTasks();
    const completions = await loadCompletions();
    for (const task of tasks) {
      const imported = values(task, task.id);
      const timestamp = new Date(task.updatedAt);
      // A deployment may have written authoritative rows before the durable
      // cutover marker existed. Preserve those rows and import only missing
      // legacy IDs so the marker upgrade is resumable and non-destructive.
      await tx.insert(farmTasks)
        .values({ ...imported, updatedAt: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp })
        .onConflictDoNothing();
    }
    for (const record of completions) await tx.insert(farmTaskCompletionEvents).values({
      eventId: record.eventId, taskId: record.taskId, taskTitle: record.taskTitle, scheduledDate: record.scheduledDate,
      completedAt: new Date(record.completedAt), completedById: record.completedById, completedByName: record.completedByName,
      group: record.group, location: record.location, source: record.source, recurrence: record.recurrence,
      assigneeIds: record.assigneeIds, assigneeNames: record.assigneeNames,
    }).onConflictDoNothing();
    await tx.insert(farmTaskStorageState).values({ key: "sheet-import", version: "1", completedAt: new Date() })
      .onConflictDoUpdate({ target: farmTaskStorageState.key, set: { version: "1", completedAt: new Date() } });
    return { tasks: tasks.length, completions: completions.length };
  });
}
export async function findAuthoritativeTask(id: string): Promise<SheetTask | undefined> {
  const [row] = await db.select().from(farmTasks).where(eq(farmTasks.id, id)).limit(1);
  return row && rowToTask(row);
}
export async function createAuthoritativeTask(input: TaskInput): Promise<SheetTask> {
  const id = input.id ?? `farm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${id}))`);
    const [existing] = await tx.select().from(farmTasks).where(eq(farmTasks.id, id)).limit(1);
    if (existing) return rowToTask(existing);
    const [row] = await tx.insert(farmTasks).values(values(input, id)).returning();
    if (!row) throw new Error("Could not create task.");
    await outbox(tx, id, "upsert", rowToTask(row));
    return rowToTask(row);
  });
}
export async function updateAuthoritativeTask(
  id: string,
  input: Partial<Omit<SheetTask, "id" | "updatedAt">>,
  receipt?: { operationId: string; memberId: string },
): Promise<SheetTask | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${id}))`);
    const [currentRow] = await tx.select().from(farmTasks).where(eq(farmTasks.id, id)).limit(1);
    if (!currentRow) return null;
    const current = rowToTask(currentRow);
    const [row] = await tx.update(farmTasks).set(values(input as TaskInput, id, current)).where(eq(farmTasks.id, id)).returning();
    if (!row) return null;
    await outbox(tx, id, "upsert", rowToTask(row));
    if (receipt) {
      await tx.insert(farmTaskMutationReceipts).values({
        operationId: receipt.operationId,
        memberId: receipt.memberId,
        operationKind: "update",
        taskId: id,
        response: rowToTask(row),
      }).onConflictDoNothing();
    }
    return rowToTask(row);
  });
}

export async function migrateAuthoritativeTaskAssignee(
  pendingAssigneeIds: string[],
  clerkId: string,
  displayName: string,
): Promise<void> {
  const pending = new Set(pendingAssigneeIds);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('farm-task-assignee-migration'))`);
    const rows = await tx.select().from(farmTasks);
    for (const row of rows) {
      const task = rowToTask(row);
      const currentIds = task.assigneeIds ?? (task.assigneeId ? [task.assigneeId] : []);
      if (!currentIds.some((id) => pending.has(id))) continue;
      const currentNames = task.assigneeNames ?? (task.assigneeName ? [task.assigneeName] : []);
      const assignments = currentIds.reduce<Array<{ id: string; name: string }>>((result, id, index) => {
        const migrated = pending.has(id)
          ? { id: clerkId, name: displayName }
          : { id, name: currentNames[index] ?? "" };
        if (!result.some((item) => item.id === migrated.id)) result.push(migrated);
        return result;
      }, []);
      const [updated] = await tx.update(farmTasks).set({
        assigneeId: assignments[0]?.id ?? "",
        assigneeName: assignments[0]?.name ?? "",
        assigneeIds: assignments.map(({ id }) => id),
        assigneeNames: assignments.map(({ name }) => name),
        updatedAt: new Date(),
      }).where(eq(farmTasks.id, task.id)).returning();
      if (updated) await outbox(tx, task.id, "upsert", rowToTask(updated));
    }
    // Attachments uploaded under the member's previous login stay theirs.
    await tx.update(farmAttachments).set({ ownerId: clerkId }).where(inArray(farmAttachments.ownerId, [...pending]));
  });
}
export async function deleteAuthoritativeTask(
  id: string,
  receipt?: { operationId: string; memberId: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${id}))`);
    const deleted = await tx.delete(farmTasks).where(eq(farmTasks.id, id)).returning({ id: farmTasks.id });
    if (!deleted.length) return false;
    await outbox(tx, id, "delete", { id });
    if (receipt) {
      await tx.insert(farmTaskMutationReceipts).values({
        operationId: receipt.operationId,
        memberId: receipt.memberId,
        operationKind: "delete",
        taskId: id,
        response: { deleted: true },
      }).onConflictDoNothing();
    }
    return true;
  });
}
export async function appendAuthoritativeCompletion(record: CompletionRecord): Promise<CompletionRecord> {
  return db.transaction(async (tx) => {
   const [inserted] = await tx.insert(farmTaskCompletionEvents).values({
    eventId: record.eventId, taskId: record.taskId, taskTitle: record.taskTitle, scheduledDate: record.scheduledDate,
    completedAt: new Date(record.completedAt), completedById: record.completedById, completedByName: record.completedByName,
    group: record.group, location: record.location, source: record.source, recurrence: record.recurrence,
    assigneeIds: record.assigneeIds, assigneeNames: record.assigneeNames,
   }).onConflictDoNothing().returning({ eventId: farmTaskCompletionEvents.eventId });
   if (inserted) await outbox(tx, record.taskId, "completion", record);
   return record;
  });
}
export async function listAuthoritativeCompletions(): Promise<CompletionRecord[]> {
  return (await db.select().from(farmTaskCompletionEvents)).map((row) => ({
    eventId: row.eventId, taskId: row.taskId, taskTitle: row.taskTitle, scheduledDate: row.scheduledDate,
    completedAt: row.completedAt.toISOString(), completedById: row.completedById, completedByName: row.completedByName,
    group: row.group, location: row.location, source: row.source as CompletionRecord["source"], recurrence: row.recurrence as CompletionRecord["recurrence"],
    assigneeIds: row.assigneeIds ?? [], assigneeNames: row.assigneeNames ?? [],
  }));
}
export async function readMutationReceipt(operationId: string, memberId = "", operationKind = "", taskId = "") {
  const [receipt] = await db.select().from(farmTaskMutationReceipts).where(and(
    eq(farmTaskMutationReceipts.operationId, operationId), eq(farmTaskMutationReceipts.memberId, memberId),
    eq(farmTaskMutationReceipts.operationKind, operationKind), eq(farmTaskMutationReceipts.taskId, taskId),
  )).limit(1);
  return receipt?.response;
}
export async function writeMutationReceipt(operationId: string, taskId: string, response: unknown, memberId = "", operationKind = "update") {
  await db.insert(farmTaskMutationReceipts).values({ operationId, taskId, response, memberId, operationKind }).onConflictDoNothing();
}
export async function claimSheetOutboxBatch(limit = 25) {
  return db.transaction(async (tx) => {
    const owner = randomUUID();
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + 10 * 60_000);
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    // Claim only the oldest unfinished operation for each task. The row lock
    // prevents another API instance from claiming the same export, while an
    // active/undue oldest operation blocks newer operations for that task.
    await tx.execute(sql`
      with first_per_task as (
        select distinct on (task_id) id
        from farm_task_sheet_outbox
        where status <> 'done'
        order by task_id, created_at, id
      ),
      candidates as (
        select queued.id
        from farm_task_sheet_outbox queued
        inner join first_per_task first on first.id = queued.id
        where (
          queued.status = 'pending'
          and queued.next_attempt_at <= ${now}
        ) or (
          queued.status = 'processing'
          and queued.lease_expires_at <= ${now}
        )
        order by queued.created_at, queued.id
        limit ${safeLimit}
        for update of queued skip locked
      )
      update farm_task_sheet_outbox queued
      set status = 'processing',
          attempts = queued.attempts + 1,
          lease_owner = ${owner},
          lease_expires_at = ${leaseExpiresAt},
          next_attempt_at = ${leaseExpiresAt}
      from candidates
      where queued.id = candidates.id
    `);
    const rows = await tx.select().from(farmTaskSheetOutbox)
      .where(and(
        eq(farmTaskSheetOutbox.leaseOwner, owner),
        eq(farmTaskSheetOutbox.status, "processing"),
      ));
    return { rows, owner };
  });
}
export async function finishSheetOutbox(id: string, owner: string, error?: string) {
  const [row] = await db.select({ attempts: farmTaskSheetOutbox.attempts }).from(farmTaskSheetOutbox).where(eq(farmTaskSheetOutbox.id, id)).limit(1);
  const attempts = row?.attempts ?? 1;
  await db.update(farmTaskSheetOutbox).set({
    status: error ? "pending" : "done", lastError: error ?? "",
    nextAttemptAt: new Date(Date.now() + Math.min(30 * 60_000, 1_000 * 2 ** Math.min(attempts, 10))),
    leaseOwner: null,
    leaseExpiresAt: null,
    ...(error ? {} : { processedAt: new Date() }),
  }).where(and(eq(farmTaskSheetOutbox.id, id), eq(farmTaskSheetOutbox.leaseOwner, owner)));
}