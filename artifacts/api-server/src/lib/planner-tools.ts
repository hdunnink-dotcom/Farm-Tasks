import { randomUUID } from "node:crypto";
import { db, farmMembers } from "@workspace/db";
import { INTERNAL_AUTH_HEADER, internalMemberToken } from "./internal-auth";

/**
 * Full planner tools for the Claude connector. Every change goes through the
 * app's own /api/tasks endpoints (in-process loopback), so it follows exactly
 * the same rules as an edit in the planner: validation, assignment checks,
 * completion history, recurring next occurrences, Sheet sync and daily plan.
 */

type Json = Record<string, unknown>;
type ToolResult = { text: string; isError?: boolean };

const DATE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Auckland date, YYYY-MM-DD" };
const RECURRENCE = ["none", "weekly", "biweekly", "every4weeks", "monthly", "quarterly", "yearly"];
const URGENCY = ["Urgent", "High", "Medium", "Low"];

const taskFields = {
  task: { type: "string", description: "Short task title" },
  group: { type: "string", description: "Category, e.g. Orchards, Planting, Gullies, Repair, Trapping, Admin, Yurts, Meat" },
  urgency: { type: "string", enum: URGENCY },
  notes: { type: "string", description: "Instructions, rates, safety notes" },
  location: { type: "string", description: "Block or paddock" },
  dates: { type: "array", items: DATE, description: "Day(s) to do it. One date, or several linked days for multi-day work. Empty array unschedules." },
  time: { type: "string", pattern: "^\\d{2}:\\d{2}$", description: "Optional start time HH:MM (Auckland) on the first date" },
  assignees: { type: "array", items: { type: "string" }, description: "Team member names (or ids from farm_list_team). Empty array unassigns." },
  recurrence: { type: "string", enum: RECURRENCE, description: "Repeat after completion. Needs exactly one date." },
  steps: { type: "array", items: { type: "string" }, description: "Checklist steps (replaces existing steps)" },
};

export const plannerTools = [
  {
    name: "farm_list_team",
    description: "List farm team members who can be assigned tasks (name, id, role, status).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "farm_list_tasks",
    description: "Find tasks in the Farm Planner. Filter by date range (scheduled day), group, assignee, text, or unscheduled only. Returns task ids for updating.",
    inputSchema: {
      type: "object",
      properties: {
        from: DATE, to: DATE,
        group: { type: "string" },
        assignee: { type: "string", description: "Team member name or id" },
        search: { type: "string", description: "Text in title or notes" },
        unscheduledOnly: { type: "boolean" },
        includeDone: { type: "boolean", description: "Default false" },
        limit: { type: "integer", minimum: 1, maximum: 300, description: "Default 80" },
      },
    },
  },
  {
    name: "farm_get_task",
    description: "Get one task with full notes and steps.",
    inputSchema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"] },
  },
  {
    name: "farm_create_task",
    description: "Add a task to the Farm Planner, optionally scheduled on day(s) and assigned to people. It appears in the planner straight away (no approval step).",
    inputSchema: {
      type: "object",
      properties: { ...taskFields, requestId: { type: "string", description: "Stable unique id so a retry does not create a duplicate" } },
      required: ["task"],
    },
  },
  {
    name: "farm_update_task",
    description: "Change a task: reschedule (dates/time), assign people, rename, change urgency, notes, steps or recurrence, or mark done/undone. Only send the fields to change. Tasks imported from Google Calendar take their date from the calendar; move those in Google Calendar instead.",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" }, ...taskFields, done: { type: "boolean" } },
      required: ["taskId"],
    },
  },
  {
    name: "farm_complete_task",
    description: "Mark a task done (records it in completion history; recurring tasks create their next occurrence). Set done=false to reopen.",
    inputSchema: { type: "object", properties: { taskId: { type: "string" }, done: { type: "boolean" } }, required: ["taskId"] },
  },
  {
    name: "farm_delete_task",
    description: "Permanently delete a task. Confirm with the user before calling.",
    inputSchema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"] },
  },
];

export const plannerToolNames = new Set(plannerTools.map((tool) => tool.name));

// ---------------------------------------------------------------------------

async function api(clerkId: string, method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const port = process.env.PORT ?? "8080";
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method,
    headers: {
      [INTERNAL_AUTH_HEADER]: internalMemberToken(clerkId),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function findTask(clerkId: string, taskId: string): Promise<any | undefined> {
  const list = await api(clerkId, "GET", "/tasks");
  return (list.data?.tasks ?? []).find((item: any) => item.id === taskId);
}

function taskPath(taskId: string): string {
  return `/tasks/${encodeURIComponent(taskId)}`;
}

/** Auckland wall-clock date + time to a UTC instant. */
export function aucklandInstant(date: string, time: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  const offsetAt = (instant: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: "Pacific/Auckland", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)) - instant;
  };
  let instant = guess - offsetAt(guess);
  instant = guess - offsetAt(instant);
  return new Date(instant).toISOString();
}

type Member = { clerkId: string; displayName: string; email: string; role: string; status: string };

async function team(): Promise<Member[]> {
  const rows = await db.select().from(farmMembers);
  return rows.filter((row) => row.status === "active" || row.status === "invited");
}

function resolveAssignees(requested: string[], members: Member[]): { ids: string[] } | { error: string } {
  const ids: string[] = [];
  for (const raw of requested) {
    const value = raw.trim().toLowerCase();
    const matches = members.filter((member) =>
      member.clerkId.toLowerCase() === value
      || member.displayName.trim().toLowerCase() === value
      || member.email.trim().toLowerCase() === value
      || member.displayName.trim().toLowerCase().split(/\s+/)[0] === value);
    if (matches.length !== 1) {
      const names = members.map((member) => member.displayName).join(", ");
      return { error: matches.length ? `"${raw}" matches more than one person (${matches.map((m) => m.displayName).join(", ")}).` : `No team member called "${raw}". Team: ${names}.` };
    }
    ids.push(matches[0]!.clerkId);
  }
  return { ids: [...new Set(ids)] };
}

function scheduleFields(args: Json): Json | { error: string } {
  if (args.dates === undefined) {
    if (args.time !== undefined) return { error: "Send dates together with time." };
    return {};
  }
  const dates = [...new Set((args.dates as string[]).map((date) => date.trim()))].sort();
  if (!dates.length) return { calendarStart: "", scheduledDates: [] };
  const time = typeof args.time === "string" && args.time ? args.time : "";
  return { calendarStart: time ? aucklandInstant(dates[0]!, time) : dates[0], scheduledDates: dates, month: dates[0]!.slice(0, 7) };
}

async function taskBody(args: Json, existingSteps?: Array<{ id: string; title: string; done: boolean }>): Promise<Json | { error: string }> {
  const body: Json = {};
  for (const field of ["task", "group", "urgency", "notes", "location", "recurrence", "done"]) {
    if (args[field] !== undefined) body[field] = args[field];
  }
  if (body.recurrence !== undefined) body.repeatWeekly = body.recurrence === "weekly";
  const schedule = scheduleFields(args);
  if ("error" in schedule) return schedule;
  Object.assign(body, schedule);
  if (args.assignees !== undefined) {
    const resolved = resolveAssignees(args.assignees as string[], await team());
    if ("error" in resolved) return resolved;
    body.assigneeIds = resolved.ids;
  }
  if (args.steps !== undefined) {
    body.subtasks = (args.steps as string[]).map((title, index) => ({
      id: `step-${index}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "work"}`,
      title,
      done: existingSteps?.find((step) => step.title === title)?.done ?? false,
    }));
  }
  return body;
}

function summarise(task: any, full = false): Json {
  const dates: string[] = task.scheduledDates?.length ? task.scheduledDates : task.calendarStart ? [String(task.calendarStart).slice(0, 10)] : [];
  const hasTime = typeof task.calendarStart === "string" && task.calendarStart.includes("T");
  return {
    id: task.id,
    task: task.task,
    group: task.group,
    urgency: task.urgency,
    done: task.done,
    dates,
    ...(hasTime ? { startsAt: new Date(task.calendarStart).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", dateStyle: "medium", timeStyle: "short" }) } : {}),
    assignees: task.assigneeNames?.length ? task.assigneeNames : task.assigneeName ? [task.assigneeName] : [],
    source: task.source,
    ...(task.recurrence && task.recurrence !== "none" ? { recurrence: task.recurrence } : {}),
    ...(task.location ? { location: task.location } : {}),
    ...(task.reviewStatus && task.reviewStatus !== "approved" ? { reviewStatus: task.reviewStatus } : {}),
    notes: full ? task.notes : String(task.notes ?? "").slice(0, 160),
    ...(full ? { steps: (task.subtasks ?? []).map((step: any) => `${step.done ? "[x]" : "[ ]"} ${step.title}`), updatedAt: task.updatedAt } : {}),
  };
}

function failure(result: { status: number; data: any }): ToolResult {
  const message = typeof result.data === "object" && result.data?.error ? result.data.error : `Request failed (${result.status}).`;
  return { isError: true, text: message };
}

export async function callPlannerTool(clerkId: string, name: string, rawArgs: unknown): Promise<ToolResult> {
  const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Json;
  switch (name) {
    case "farm_list_team": {
      const members = await team();
      return { text: JSON.stringify(members.map((m) => ({ id: m.clerkId, name: m.displayName, role: m.role, status: m.status }))) };
    }
    case "farm_list_tasks": {
      const result = await api(clerkId, "GET", "/tasks");
      if (result.status !== 200) return failure(result);
      let tasks: any[] = result.data.tasks ?? [];
      const includeDone = args.includeDone === true;
      if (!includeDone) tasks = tasks.filter((task) => !task.done);
      const datesOf = (task: any): string[] => task.scheduledDates?.length ? task.scheduledDates : task.calendarStart ? [String(task.calendarStart).slice(0, 10)] : [];
      if (args.unscheduledOnly) tasks = tasks.filter((task) => !datesOf(task).length);
      if (typeof args.from === "string") tasks = tasks.filter((task) => datesOf(task).some((date) => date >= (args.from as string)));
      if (typeof args.to === "string") tasks = tasks.filter((task) => datesOf(task).some((date) => date <= (args.to as string) && (typeof args.from !== "string" || date >= (args.from as string))));
      if (typeof args.group === "string") tasks = tasks.filter((task) => String(task.group).toLowerCase() === (args.group as string).toLowerCase());
      if (typeof args.search === "string") {
        const needle = (args.search as string).toLowerCase();
        tasks = tasks.filter((task) => `${task.task} ${task.notes}`.toLowerCase().includes(needle));
      }
      if (typeof args.assignee === "string") {
        const resolved = resolveAssignees([args.assignee as string], await team());
        if ("error" in resolved) return { isError: true, text: resolved.error };
        tasks = tasks.filter((task) => (task.assigneeIds ?? [task.assigneeId]).includes(resolved.ids[0]));
      }
      tasks.sort((a, b) => (datesOf(a)[0] ?? "9999").localeCompare(datesOf(b)[0] ?? "9999"));
      const limit = typeof args.limit === "number" ? Math.min(300, Math.max(1, args.limit)) : 80;
      return { text: JSON.stringify({ total: tasks.length, shown: Math.min(limit, tasks.length), tasks: tasks.slice(0, limit).map((task) => summarise(task)) }) };
    }
    case "farm_get_task": {
      const task = typeof args.taskId === "string" ? await findTask(clerkId, args.taskId) : undefined;
      return task ? { text: JSON.stringify(summarise(task, true)) } : { isError: true, text: "Task not found." };
    }
    case "farm_create_task": {
      if (typeof args.task !== "string" || !args.task.trim()) return { isError: true, text: "A task title is required." };
      const body = await taskBody(args);
      if ("error" in body) return { isError: true, text: body.error as string };
      body.clientTaskId = typeof args.requestId === "string" && args.requestId ? `claude-${args.requestId}`.slice(0, 120) : `claude-${randomUUID()}`;
      const result = await api(clerkId, "POST", "/tasks", body);
      if (result.status !== 201 && result.status !== 200) return failure(result);
      return { text: JSON.stringify({ created: summarise(result.data) }) };
    }
    case "farm_update_task": {
      if (typeof args.taskId !== "string") return { isError: true, text: "taskId is required." };
      const existing = await findTask(clerkId, args.taskId);
      if (!existing) return { isError: true, text: "Task not found." };
      // Moving a timed task keeps its start time unless a new time is given.
      if (Array.isArray(args.dates) && args.dates.length && args.time === undefined && String(existing.calendarStart ?? "").includes("T")) {
        args.time = new Intl.DateTimeFormat("en-GB", { timeZone: "Pacific/Auckland", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(existing.calendarStart));
      }
      const body = await taskBody(args, existing.subtasks);
      if ("error" in body) return { isError: true, text: body.error as string };
      if (!Object.keys(body).length) return { isError: true, text: "Nothing to change." };
      body.task ??= existing.task;
      body.clientOperationId = `claude-${randomUUID()}`;
      const result = await api(clerkId, "PATCH", taskPath(args.taskId), body);
      if (result.status !== 200) return failure(result);
      return { text: JSON.stringify({ updated: summarise(result.data) }) };
    }
    case "farm_complete_task": {
      if (typeof args.taskId !== "string") return { isError: true, text: "taskId is required." };
      const existing = await findTask(clerkId, args.taskId);
      if (!existing) return { isError: true, text: "Task not found." };
      const result = await api(clerkId, "PATCH", taskPath(args.taskId), { task: existing.task, done: args.done !== false, clientOperationId: `claude-${randomUUID()}` });
      if (result.status !== 200) return failure(result);
      return { text: JSON.stringify({ updated: summarise(result.data) }) };
    }
    case "farm_delete_task": {
      if (typeof args.taskId !== "string") return { isError: true, text: "taskId is required." };
      const result = await api(clerkId, "DELETE", taskPath(args.taskId));
      if (result.status !== 204 && result.status !== 200) return failure(result);
      return { text: JSON.stringify({ deleted: args.taskId }) };
    }
    default:
      return { isError: true, text: `Unknown tool ${name}.` };
  }
}
