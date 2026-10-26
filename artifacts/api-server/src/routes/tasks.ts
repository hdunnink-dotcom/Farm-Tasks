import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateFarmTaskBody,
  CreateFarmTaskResponse,
  DeleteFarmTaskParams,
  GetFarmMonthlySummaryQueryParams,
  GetFarmMonthlySummaryResponse,
  GetFarmTaskSummaryResponse,
  ListFarmTasksQueryParams,
  ListFarmTasksResponse,
  UpdateFarmTaskBody,
  UpdateFarmTaskParams,
  UpdateFarmTaskResponse,
} from "@workspace/api-zod";
import {
  appendCompletionRecord,
  createSheetTask,
  deleteSheetTask,
  farmSheetSource,
  farmSheetSourceUrl,
  findSheetTask,
  listSheetTasks,
  listCompletionRecords,
  updateSheetTask,
  type TaskRecurrence,
} from "../lib/farm-sheet";
import type { SheetTask } from "../lib/farm-sheet";
import { CalendarWritebackError, writeBackToCalendar, type CalendarChange } from "../lib/calendar-writeback";
import { listReadyAttachments } from "../lib/farm-attachments";
import { currentMember, isMaster, requireMember } from "../lib/farm-access";
import { normalizeSheetTaskInput } from "../lib/task-input-normalization";
import { getAuth } from "@clerk/express";
import { db, farmMembers } from "@workspace/db";
import { queueDailyPlanRefresh } from "../lib/daily-plan";
import { readMutationReceipt, writeMutationReceipt } from "../lib/task-repository";

const AUCKLAND_TIME_ZONE = "Pacific/Auckland";

/**
 * Older planner builds persisted an empty recurrence string for one-off tasks.
 * Accept that legacy wire value so queued offline edits can still be recovered.
 */
export function normalizeLegacyTaskBody(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const body = value as Record<string, unknown>;
  return body.recurrence === ""
    ? { ...body, recurrence: "none", repeatWeekly: false }
    : value;
}

const AUCKLAND_FORMATTER_OPTIONS = {
  timeZone: AUCKLAND_TIME_ZONE,
  year: "numeric" as const,
  month: "2-digit" as const,
  day: "2-digit" as const,
  hour: "2-digit" as const,
  minute: "2-digit" as const,
  second: "2-digit" as const,
  hourCycle: "h23" as const,
};

type AucklandParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function formatAucklandParts(date: Date): AucklandParts {
  return new Intl.DateTimeFormat("en-CA", AUCKLAND_FORMATTER_OPTIONS).formatToParts(date).reduce<Record<string, number>>((result, part) => {
    if (part.type !== "literal") result[part.type] = Number(part.value);
    return result;
  }, {}) as AucklandParts;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addCalendarUnits(parts: AucklandParts, recurrence: TaskRecurrence): AucklandParts {
  const days = recurrence === "weekly" ? 7 : recurrence === "biweekly" ? 14 : recurrence === "every4weeks" ? 28 : 0;
  if (days) {
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
    return { ...parts, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }
  const months = recurrence === "monthly" ? 1 : recurrence === "quarterly" ? 3 : recurrence === "yearly" ? 12 : 0;
  if (!months) return parts;
  const totalMonths = parts.year * 12 + parts.month - 1 + months;
  const year = Math.floor(totalMonths / 12);
  const month = totalMonths % 12 + 1;
  return { ...parts, year, month, day: Math.min(parts.day, daysInMonth(year, month)) };
}

function resolveAucklandWallTime(parts: AucklandParts): string {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let instant = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = formatAucklandParts(new Date(instant));
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const correction = desired - actualAsUtc;
    instant += correction;
    if (correction === 0) break;
  }
  return new Date(instant).toISOString();
}

function aucklandDateKey(calendarStart: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(calendarStart)) return calendarStart;
  const date = new Date(calendarStart);
  if (Number.isNaN(date.getTime())) return calendarStart.slice(0, 10);
  const parts = formatAucklandParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function taskScheduledDates(task: Pick<SheetTask, "calendarStart" | "scheduledDates">): string[] {
  if (task.scheduledDates) return [...new Set(task.scheduledDates)].sort();
  return task.calendarStart ? [aucklandDateKey(task.calendarStart)] : [];
}

function aucklandTimestamp(value: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return value;
  const parts = formatAucklandParts(instant);
  const wallClockAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const offsetMinutes = Math.round((wallClockAsUtc - instant.getTime()) / 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}${sign}${String(Math.floor(absoluteOffset / 60)).padStart(2, "0")}:${String(absoluteOffset % 60).padStart(2, "0")}`;
}

function completionRecord(task: SheetTask, member: { clerkId: string; displayName: string }, clientOperationId?: string) {
  return {
    eventId: clientOperationId
      ? `completion:${clientOperationId}`
      : `completion:${task.id}:${task.updatedAt}`,
    taskId: task.id,
    taskTitle: task.task,
    scheduledDate: task.calendarStart ? aucklandDateKey(task.calendarStart) : "",
    completedAt: aucklandTimestamp(task.updatedAt),
    completedById: member.clerkId,
    completedByName: member.displayName,
    group: task.group,
    location: task.location,
    source: task.source,
    recurrence: task.recurrence ?? (task.repeatWeekly ? "weekly" : "none"),
    assigneeIds: task.assigneeIds ?? (task.assigneeId ? [task.assigneeId] : []),
    assigneeNames: task.assigneeNames ?? (task.assigneeName ? [task.assigneeName] : []),
  };
}

/** Advances one manual occurrence in Auckland wall-clock time. */
export function nextAucklandOccurrence(calendarStart: string, recurrence: TaskRecurrence): string {
  if (recurrence === "none") return calendarStart;
  if (/^\d{4}-\d{2}-\d{2}$/.test(calendarStart)) {
    const [year, month, day] = calendarStart.split("-").map(Number);
    const next = addCalendarUnits({ year, month, day, hour: 0, minute: 0, second: 0 }, recurrence);
    return `${next.year}-${String(next.month).padStart(2, "0")}-${String(next.day).padStart(2, "0")}`;
  }
  const original = new Date(calendarStart);
  if (Number.isNaN(original.getTime())) return calendarStart;
  return resolveAucklandWallTime(addCalendarUnits(formatAucklandParts(original), recurrence));
}

/** Legacy alias retained for callers and tests that specifically advance weekly routines. */
export function nextAucklandWeek(calendarStart: string): string {
  return nextAucklandOccurrence(calendarStart, "weekly");
}

/** Sheet-only recovery for a completed routine whose follow-up write failed. */
export async function ensureNextOccurrence(task: SheetTask): Promise<void> {
  const recurrence = task.recurrence ?? (task.repeatWeekly ? "weekly" : "none");
  if (task.source !== "Manual" || recurrence === "none" || !task.done || !task.calendarStart || (task.reviewStatus && task.reviewStatus !== "approved")) return;
  const calendarStart = nextAucklandOccurrence(task.calendarStart, recurrence);
  const seriesId = task.id.replace(/--(?:weekly|biweekly|every4weeks|monthly|quarterly|yearly)-\d{4}-\d{2}-\d{2}$/, "");
  const id = `${seriesId}--${recurrence}-${aucklandDateKey(calendarStart)}`;
  const { updatedAt: _updatedAt, ...nextOccurrence } = task;
  await createSheetTask({
    ...nextOccurrence,
    id,
    done: false,
    calendarStart,
    scheduledDates: [aucklandDateKey(calendarStart)],
    recurrence,
    repeatWeekly: recurrence === "weekly",
    attachmentIds: [],
  });
}

/** @deprecated Use ensureNextOccurrence. */
export async function ensureNextWeeklyOccurrence(task: SheetTask): Promise<void> {
  return ensureNextOccurrence(task);
}

async function withAttachments<T extends Awaited<ReturnType<typeof listSheetTasks>>[number]>(tasks: T[]) {
  const attachments = await listReadyAttachments(tasks.map((task) => task.id));
  return tasks.map((task) => ({
    ...task,
    scheduledDates: taskScheduledDates(task),
    assigneeIds: task.assigneeIds ?? (task.assigneeId ? [task.assigneeId] : []),
    assigneeNames: task.assigneeNames ?? (task.assigneeName ? [task.assigneeName] : []),
    reviewedAt: task.reviewedAt?.trim() || undefined,
    attachments: attachments.get(task.id) ?? [],
  }));
}

const router: IRouter = Router();

function taskAssignedTo(task: { assigneeIds?: string[]; assigneeId?: string }, memberId: string): boolean {
  return task.assigneeIds?.includes(memberId) === true || task.assigneeId === memberId;
}


function sameStart(a: string, b: string): boolean {
  if (!a || !b) return a === b;
  if (a.includes("T") !== b.includes("T")) return false;
  return a.includes("T") ? Date.parse(a) === Date.parse(b) : a.slice(0, 10) === b.slice(0, 10);
}

/** What an edit changes on a calendar-imported task's source event. */
function calendarChangeFor(existing: SheetTask, input: Partial<SheetTask>): CalendarChange | { error: string } {
  const change: CalendarChange = {};
  if (input.calendarStart !== undefined || input.scheduledDates !== undefined) {
    const target = input.calendarStart || input.scheduledDates?.[0] || "";
    if (!target) return { error: "Calendar tasks always need a date. Delete the event in Google Calendar to remove it." };
    if (!sameStart(target, existing.calendarStart)) change.start = target;
  }
  if (input.task !== undefined && input.task.trim() !== existing.task.trim()) change.task = input.task;
  if (input.notes !== undefined && input.notes.trim() !== existing.notes.trim()) change.notes = input.notes;
  if (input.location !== undefined && input.location.trim() !== existing.location.trim()) change.location = input.location;
  return change;
}

async function authorizedAssignments(input: {
  assigneeIds?: string[];
  assigneeNames?: string[];
  assigneeId?: string;
  assigneeName?: string;
}): Promise<{ assigneeIds: string[]; assigneeNames: string[]; assigneeId: string; assigneeName: string } | null | undefined> {
  const requested = input.assigneeIds ?? (input.assigneeId !== undefined ? [input.assigneeId] : undefined);
  if (requested === undefined) return undefined;
  const ids = [...new Set(requested.map((id) => id.trim()).filter(Boolean))];
  const members = await db.select().from(farmMembers);
  const resolved = ids.map((id) => {
    const member = members.find((candidate) =>
      (candidate.status === "active" || candidate.status === "invited")
      && (candidate.clerkId === id || (candidate.status === "invited" && candidate.invitationId === id)),
    );
    return member ? { id, name: member.displayName } : null;
  });
  if (resolved.some((item) => item === null)) return null;
  const assignments = resolved.filter((item): item is { id: string; name: string } => item !== null);
  return {
    assigneeIds: assignments.map(({ id }) => id),
    assigneeNames: assignments.map(({ name }) => name),
    assigneeId: assignments[0]?.id ?? "",
    assigneeName: assignments[0]?.name ?? "",
  };
}

/**
 * Some imported calendar task IDs contain percent codes themselves (for
 * example "ics-https%3A%2F%2F..."). The web client puts IDs into the URL
 * without escaping, so Express decodes them into a different string. When the
 * decoded ID does not exist but the raw path segment does, use the raw one.
 */
function rawTaskIdSegment(originalUrl: string): string | undefined {
  return /\/tasks\/([^/?#]+)/.exec(originalUrl)?.[1];
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

router.param("taskId", async (req, _res, next, value: string) => {
  try {
    const raw = rawTaskIdSegment(req.originalUrl);
    // Only IDs that arrived with escape codes need resolving.
    if (raw && raw !== value && !(await findSheetTask(value))) {
      if (await findSheetTask(raw)) {
        req.params.taskId = raw;
      } else {
        // Proxies may normalise parts of the escaping (Google's front end turns
        // %40 into @), so compare fully decoded forms as a last resort.
        const match = (await listSheetTasks()).find((task) => task.id !== value && safeDecode(task.id) === value);
        if (match) req.params.taskId = match.id;
      }
    }
    next();
  } catch (error) {
    next(error);
  }
});

router.get("/tasks", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
  const query = ListFarmTasksQueryParams.safeParse(req.query);
  if (!query.success) {
    req.log.warn({ errors: query.error.message }, "Invalid task query");
    res.status(400).json({ error: query.error.message });
    return;
  }

  try {
    const tasks = await listSheetTasks();
    const visible = isMaster(member) ? tasks : tasks.filter((task) =>
      (task.reviewStatus === "approved" && taskAssignedTo(task, member.clerkId))
      || (task.reviewStatus !== "approved" && task.submittedById === member.clerkId),
    );
    const filtered = query.data.includeDone === false ? visible.filter((task) => !task.done) : visible;
    res.set("Cache-Control", "no-store");
    res.json(ListFarmTasksResponse.parse({
      tasks: await withAttachments(filtered),
      source: farmSheetSource,
      sourceUrl: farmSheetSourceUrl,
    }));
  } catch (error) {
    req.log.error({ err: error }, "Could not read Google Sheets tasks");
    res.status(502).json({ error: "Could not read the connected Google Sheet." });
  }
});

router.post("/tasks", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
  const ownerCreated = isMaster(member);
  const body = CreateFarmTaskBody.safeParse(normalizeLegacyTaskBody(req.body));
  if (!body.success) {
    req.log.warn({ errors: body.error.message }, "Invalid task creation");
    res.status(400).json({ error: body.error.message });
    return;
  }

  try {
    if (body.data.clientTaskId) {
      const receipt = await readMutationReceipt(`create:${body.data.clientTaskId}`, member.clerkId, "create", body.data.clientTaskId);
      if (receipt) {
        res.status(201).json(CreateFarmTaskResponse.parse(receipt));
        return;
      }
    }
    const sheetInput = normalizeSheetTaskInput(body.data);
    if (sheetInput.scheduledDates && sheetInput.scheduledDates.length > 1 && sheetInput.recurrence && sheetInput.recurrence !== "none") {
      res.status(400).json({ error: "Recurring tasks cannot use linked scheduled dates." });
      return;
    }
    const assignments = ownerCreated ? await authorizedAssignments(body.data) : undefined;
    if (assignments === null) {
      res.status(400).json({ error: "Every assignee must be a current or invited farm team member." });
      return;
    }
    if (sheetInput.recurrence && sheetInput.recurrence !== "none" && !sheetInput.calendarStart) {
      res.status(400).json({ error: sheetInput.recurrence === "weekly"
        ? "Weekly tasks require a scheduled calendar start."
        : "Recurring tasks require a scheduled calendar start." });
      return;
    }
    const existing = body.data.clientTaskId ? await findSheetTask(body.data.clientTaskId) : undefined;
    if (existing) {
       if (!ownerCreated && existing.submittedById !== member.clerkId && !taskAssignedTo(existing, member.clerkId)) {
        res.status(403).json({ error: "This task belongs to another farm member." });
        return;
      }
      res.status(200).json(CreateFarmTaskResponse.parse((await withAttachments([existing]))[0]));
      return;
    }
    const task = await createSheetTask({
      ...sheetInput,
      ...(assignments ?? {}),
      id: body.data.clientTaskId,
      ...(ownerCreated
        ? { reviewStatus: "approved" as const }
        : {
          done: false,
          assigneeId: member.clerkId,
          assigneeName: member.displayName,
          assigneeIds: [member.clerkId],
          assigneeNames: [member.displayName],
          reviewStatus: "pending" as const,
          submittedById: member.clerkId,
          submittedByName: member.displayName,
        }),
    });
    queueDailyPlanRefresh(`task-create:${member.clerkId}`);
     const response = CreateFarmTaskResponse.parse((await withAttachments([task]))[0]);
     if (body.data.clientTaskId) {
       await writeMutationReceipt(`create:${body.data.clientTaskId}`, task.id, response, member.clerkId, "create");
     }
     res.status(201).json(response);
  } catch (error) {
    if (
      error instanceof Error
      && (
        error.message.includes("Calendar start")
        || error.message.includes("Scheduled dates")
        || error.message.includes("at most")
        || error.message.includes("Weekly tasks")
        || error.message.includes("Recurring tasks")
      )
    ) {
      res.status(400).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Could not create Google Sheets task");
    res.status(502).json({ error: "Could not save this task to the connected Google Sheet." });
  }
});

router.patch("/tasks/:taskId", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
  const params = UpdateFarmTaskParams.safeParse(req.params);
  const body = UpdateFarmTaskBody.safeParse(normalizeLegacyTaskBody(req.body));
  if (!params.success || !body.success) {
    const error = !params.success
      ? params.error.message
      : body.error?.message ?? "Invalid task update.";
    req.log.warn({ errors: error }, "Invalid task update");
    res.status(400).json({ error });
    return;
  }

  try {
    if (body.data.clientOperationId) {
      const receipt = await readMutationReceipt(body.data.clientOperationId, member.clerkId, "update", params.data.taskId);
      if (receipt) {
        const committed = await findSheetTask(params.data.taskId);
        if (!committed) {
          res.status(404).json({ error: "Task not found." });
          return;
        }
        if (body.data.done === true && committed.done) {
          await appendCompletionRecord(completionRecord(committed, member, body.data.clientOperationId));
          await ensureNextOccurrence(committed);
        }
        res.json(UpdateFarmTaskResponse.parse((await withAttachments([committed]))[0]));
        return;
      }
    }
    if (!isMaster(member)) {
      const existing = (await listSheetTasks()).find((item) => item.id === params.data.taskId);
      if (!existing) { res.status(404).json({ error: "Task not found in the connected Google Sheet." }); return; }
      if (existing.submittedById === member.clerkId && existing.reviewStatus === "rejected") {
        res.status(403).json({ error: "Rejected submissions cannot be edited. Submit a new task instead." });
        return;
      }
      const canUpdate = existing.reviewStatus === "approved"
        ? taskAssignedTo(existing, member.clerkId)
        : taskAssignedTo(existing, member.clerkId) || existing.submittedById === member.clerkId;
      if (!canUpdate) {
        res.status(403).json({ error: "Workers can only update tasks assigned to them or awaiting their review." }); return;
      }
    }
    const existing = (await listSheetTasks()).find((item) => item.id === params.data.taskId);
    if (!existing) { res.status(404).json({ error: "Task not found in the connected Google Sheet." }); return; }
    const requestedRecurrence = body.data.recurrence ?? (
      body.data.repeatWeekly === true ? "weekly" : "none"
    );
    if (existing.source === "Google Calendar" && requestedRecurrence !== "none") {
      res.status(400).json({ error: "Imported calendar tasks cannot be made into manual recurrence routines." });
      return;
    }
    const sheetInput = normalizeSheetTaskInput(body.data);
    const assignments = isMaster(member) ? await authorizedAssignments(body.data) : undefined;
    if (assignments === null) {
      res.status(400).json({ error: "Every assignee must be a current or invited farm team member." });
      return;
    }
    const effectiveRecurrence = sheetInput.recurrence ?? existing.recurrence ?? (existing.repeatWeekly ? "weekly" : "none");
    const effectiveCalendarStart = sheetInput.calendarStart ?? existing.calendarStart;
    if (effectiveRecurrence !== "none" && !effectiveCalendarStart) {
      res.status(400).json({ error: effectiveRecurrence === "weekly"
        ? "Weekly tasks require a scheduled calendar start."
        : "Recurring tasks require a scheduled calendar start." });
      return;
    }
    const effectiveScheduledDates = sheetInput.scheduledDates ?? taskScheduledDates(existing);
    if (effectiveScheduledDates.length > 1 && (existing.source === "Google Calendar" || effectiveRecurrence !== "none")) {
      res.status(400).json({ error: existing.source === "Google Calendar"
        ? "Imported calendar tasks cannot use linked scheduled dates."
        : "Recurring tasks cannot use linked scheduled dates." });
      return;
    }
    if (body.data.baseUpdatedAt && new Date(existing.updatedAt).getTime() !== new Date(body.data.baseUpdatedAt).getTime()) {
      // A stale retry may be the completion whose first response failed after
      // persisting Done. Reconcile only that idempotent completion intent; all
      // other stale edits retain normal optimistic-concurrency protection.
      const completionOnly = Object.keys(body.data).every((key) =>
        ["task", "done", "baseUpdatedAt", "clientOperationId", "clientTaskId"].includes(key),
      ) && body.data.task === existing.task;
      if (completionOnly && body.data.done === true && existing.done) {
        await appendCompletionRecord(completionRecord(existing, member, body.data.clientOperationId));
        await ensureNextOccurrence(existing);
        res.json(UpdateFarmTaskResponse.parse((await withAttachments([existing]))[0]));
        return;
      }
      res.status(409).json({ error: "This task changed on the server.", currentTask: await withAttachments([existing]).then((items) => items[0]) });
      return;
    }
    const input = isMaster(member)
      ? { ...sheetInput, ...(assignments ?? {}) }
      : {
        task: body.data.task,
        done: body.data.done,
        subtasks: body.data.subtasks,
        notes: body.data.notes,
        reviewStatus: existing.reviewStatus === "pending" ? "pending" as const : existing.reviewStatus,
      };
    if (isMaster(member) && existing.source === "Google Calendar") {
      // Changes to an imported calendar task are written to its Google
      // Calendar event first, so the calendar sync keeps them.
      const change = calendarChangeFor(existing, sheetInput as Partial<SheetTask>);
      if ("error" in change) {
        res.status(400).json({ error: change.error });
        return;
      }
      if (Object.keys(change).length) {
        try {
          Object.assign(input, await writeBackToCalendar(existing, change));
        } catch (error) {
          if (error instanceof CalendarWritebackError) {
            res.status(error.status === 403 ? 403 : 400).json({ error: error.message });
            return;
          }
          throw error;
        }
      }
    }
    const task = await updateSheetTask(
      params.data.taskId,
      input,
      body.data.clientOperationId
        ? { operationId: body.data.clientOperationId, memberId: member.clerkId }
        : undefined,
    );
    if (!task) {
      res.status(404).json({ error: "Task not found in the connected Google Sheet." });
      return;
    }
    if (!existing.done && task.done) {
      await appendCompletionRecord(completionRecord(task, member, body.data.clientOperationId));
    }
    // A Sheet row is one occurrence. Completing a recurring manual row creates
    // exactly one deterministic next occurrence, so historical completions
    // remain visible and retries/list refreshes cannot synthesize duplicates.
    // This deliberately also runs when a retry sees the task already done:
    // the prior PATCH may have persisted completion before Sheets rejected the
    // follow-up write. createSheetTask's stable-ID lock makes it safe under
    // concurrent duplicate completion requests.
    await ensureNextOccurrence(task);
    queueDailyPlanRefresh(`task-update:${member.clerkId}`);
     const response = UpdateFarmTaskResponse.parse((await withAttachments([task]))[0]);
     if (body.data.clientOperationId) {
       await writeMutationReceipt(body.data.clientOperationId, task.id, response, member.clerkId, "update");
     }
     res.json(response);
  } catch (error) {
    if (
      error instanceof Error
      && (
        error.message.includes("Calendar start")
        || error.message.includes("Scheduled dates")
        || error.message.includes("at most")
        || error.message.includes("Weekly tasks")
        || error.message.includes("Recurring tasks")
      )
    ) {
      res.status(400).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Could not update Google Sheets task");
    res.status(502).json({ error: "Could not update this task in the connected Google Sheet." });
  }
});

router.get("/tasks/pending", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
   if (!isMaster(member)) {
     res.status(403).json({ error: "Only a farm manager can review worker submissions." });
    return;
  }
  try {
    const tasks = (await listSheetTasks()).filter((task) => task.reviewStatus === "pending");
    res.set("Cache-Control", "no-store");
    res.json({ tasks: await withAttachments(tasks), pendingCount: tasks.length });
  } catch (error) {
    req.log.error({ err: error }, "Could not read pending worker tasks");
    res.status(502).json({ error: "Could not read pending worker submissions." });
  }
});

async function reviewTask(
  req: Request,
  res: Response,
  status: "approved" | "rejected",
): Promise<void> {
  const member = await requireMember(req, res);
  if (!member) return;
   if (!isMaster(member)) {
     res.status(403).json({ error: "Only a farm manager can review worker submissions." });
    return;
  }
  const taskId = typeof req.params.taskId === "string" ? req.params.taskId : "";
  const current = (await listSheetTasks()).find((task) => task.id === taskId);
  if (!current) { res.status(404).json({ error: "Pending task not found." }); return; }
  if (current.reviewStatus !== "pending") {
    res.status(409).json({ error: "This submission has already been reviewed." });
    return;
  }
  const note = typeof req.body?.reviewNote === "string" ? req.body.reviewNote.trim().slice(0, 500) : "";
  if (status === "rejected" && !note) {
    res.status(400).json({ error: "Add a short reason when rejecting a task." });
    return;
  }
  try {
    const updated = await updateSheetTask(taskId, {
      reviewStatus: status,
      reviewNote: note,
      reviewedAt: new Date().toISOString(),
    });
    if (!updated) { res.status(404).json({ error: "Pending task not found." }); return; }
    queueDailyPlanRefresh(`task-review:${member.clerkId}`);
    res.json(UpdateFarmTaskResponse.parse((await withAttachments([updated]))[0]));
  } catch (error) {
    req.log.error({ err: error, taskId, status }, "Could not review worker task");
    res.status(502).json({ error: "Could not save the task review." });
  }
}

router.post("/tasks/:taskId/approve", async (req, res): Promise<void> => reviewTask(req, res, "approved"));
router.post("/tasks/:taskId/reject", async (req, res): Promise<void> => reviewTask(req, res, "rejected"));

router.delete("/tasks/:taskId", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
  if (!isMaster(member)) { res.status(403).json({ error: "Only the farm owner can delete tasks." }); return; }
  const params = DeleteFarmTaskParams.safeParse(req.params);
  if (!params.success) {
    req.log.warn({ errors: params.error.message }, "Invalid task deletion");
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const operationId = req.get("Idempotency-Key")?.trim().slice(0, 200) ?? "";
    if (operationId) {
      const receipt = await readMutationReceipt(operationId, member.clerkId, "delete", params.data.taskId);
      if (receipt) {
        res.sendStatus(204);
        return;
      }
    }
    const deleted = await deleteSheetTask(
      params.data.taskId,
      operationId ? { operationId, memberId: member.clerkId } : undefined,
    );
    if (!deleted) {
      res.status(404).json({ error: "Task not found in the connected Google Sheet." });
      return;
    }
    queueDailyPlanRefresh(`task-delete:${member.clerkId}`);
    res.sendStatus(204);
  } catch (error) {
    req.log.error({ err: error }, "Could not delete Google Sheets task");
    res.status(502).json({ error: "Could not delete this task from the connected Google Sheet." });
  }
});

router.get("/tasks/summary", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
  try {
    const allTasks = await listSheetTasks();
    const tasks = isMaster(member) ? allTasks : allTasks.filter((task) => taskAssignedTo(task, member.clerkId));
    const now = new Date();
    const currentMonth = new Intl.DateTimeFormat("en-US", { month: "long" }).format(now).toLowerCase();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const summary = {
      total: tasks.length,
      open: tasks.filter((task) => !task.done).length,
      done: tasks.filter((task) => task.done).length,
      highPriority: tasks.filter((task) => !task.done && (task.urgency === "Urgent" || task.urgency === "High")).length,
      dueThisMonth: tasks.filter((task) => !task.done && (task.month.toLowerCase().includes(currentMonth) || task.month === currentMonthKey)).length,
      workerProgress: isMaster(member) ? (await db.select().from(farmMembers)).filter((worker) => worker.role === "worker").map((worker) => {
        const workerIds = [worker.clerkId, worker.invitationId].filter((id): id is string => Boolean(id));
        const assigned = allTasks.filter((task) => workerIds.some((id) => taskAssignedTo(task, id)));
        return { workerId: worker.clerkId, workerName: worker.displayName, total: assigned.length, done: assigned.filter((task) => task.done).length };
      }) : [],
    };
    res.set("Cache-Control", "no-store");
    res.json(GetFarmTaskSummaryResponse.parse(summary));
  } catch (error) {
    req.log.error({ err: error }, "Could not summarize Google Sheets tasks");
    res.status(502).json({ error: "Could not read the connected Google Sheet." });
  }
});

router.get("/tasks/monthly-summary", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
  const query = GetFarmMonthlySummaryQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Choose a valid calendar month in YYYY-MM format." });
    return;
  }
  try {
    const [allTasks, allCompletions] = await Promise.all([
      listSheetTasks(),
      listCompletionRecords(),
    ]);
    const canSeeTask = (task: SheetTask) =>
      isMaster(member) || taskAssignedTo(task, member.clerkId);
    const canSeeCompletion = (record: Awaited<ReturnType<typeof listCompletionRecords>>[number]) =>
      isMaster(member)
      || record.completedById === member.clerkId
      || record.assigneeIds.includes(member.clerkId);
    const visibleTasks = allTasks.filter((task) =>
      task.reviewStatus === "approved" && canSeeTask(task));
    const visibleCompletions = allCompletions.filter(canSeeCompletion);
    const month = query.data.month;
    const scheduledTasks = visibleTasks.filter((task) =>
      taskScheduledDates(task).some((date) => date.startsWith(month))
      || (!task.calendarStart && task.month === month));
    const completions = visibleCompletions.filter((record) =>
      aucklandDateKey(record.completedAt).startsWith(month));
    const completedTaskIds = new Set(visibleCompletions.map(({ taskId }) => taskId));
    const today = aucklandDateKey(new Date().toISOString());
    const outstandingTasks = scheduledTasks.filter(({ done }) => !done);
    const dueKey = (task: SheetTask) =>
      taskScheduledDates(task)[0] ?? (task.calendarStart ? aucklandDateKey(task.calendarStart) : `${task.month}-31`);
    const countBy = <T>(items: T[], keyFor: (item: T) => string) =>
      [...items.reduce((counts, item) => {
        const key = keyFor(item).trim() || "Not specified";
        counts.set(key, (counts.get(key) ?? 0) + 1);
        return counts;
      }, new Map<string, number>())]
        .map(([name, completed]) => ({ name, completed }))
        .sort((left, right) => right.completed - left.completed || left.name.localeCompare(right.name));
    const workerCounts = new Map<string, { workerId: string; workerName: string; completed: number }>();
    for (const record of completions) {
      const workerId = record.completedById || record.completedByName;
      const current = workerCounts.get(workerId);
      if (current) current.completed += 1;
      else workerCounts.set(workerId, {
        workerId: record.completedById,
        workerName: record.completedByName || "Unknown worker",
        completed: 1,
      });
    }
    const summary = {
      month,
      scheduled: scheduledTasks.length,
      completed: completions.length,
      completionRate: scheduledTasks.length ? Math.min(1, completions.length / scheduledTasks.length) : 0,
      outstanding: outstandingTasks.length,
      overdue: outstandingTasks.filter((task) => dueKey(task) < today).length,
      completionDateUnknown: scheduledTasks.filter((task) => task.done && !completedTaskIds.has(task.id)).length,
      workers: [...workerCounts.values()].sort((left, right) =>
        right.completed - left.completed || left.workerName.localeCompare(right.workerName)),
      groups: countBy(completions, ({ group }) => group),
      locations: countBy(completions, ({ location }) => location),
      completions,
    };
    res.set("Cache-Control", "no-store");
    res.json(GetFarmMonthlySummaryResponse.parse(summary));
  } catch (error) {
    req.log.error({ err: error }, "Could not summarize monthly Google Sheets completions");
    res.status(502).json({ error: "Could not read completion history from the connected Google Sheet." });
  }
});

export default router;