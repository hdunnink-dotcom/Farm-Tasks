import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { dailyPlanSettings, dailyPlanSnapshots, db, type DailyPlanGroupRecord } from "@workspace/db";
import { anthropic, claudeFastModel } from "@workspace/integrations-anthropic-ai";
import { listSheetTasks, type SheetTask } from "./farm-sheet";
import { logger } from "./logger";
import { CANONICAL_TASK_CATEGORIES, normalizeTaskCategory } from "./task-categories";

const DEFAULT_TIMEZONE = "Pacific/Auckland";
const urgencyRank: Record<SheetTask["urgency"], number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
const claudePlanSchema = z.object({
  groups: z.array(z.object({
    name: z.enum(CANONICAL_TASK_CATEGORIES),
    taskIds: z.array(z.string()),
  })),
});

export function dateInTimezone(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function localTime(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}

function taskDate(task: SheetTask): string {
  return task.calendarStart.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
}

function relevance(task: SheetTask, today: string): "overdue" | "today" | "current_month" | null {
  if (task.done) return null;
  const date = taskDate(task);
  const month = today.slice(0, 7);
  if (date && date < today) return "overdue";
  if (date === today) return "today";
  if (task.month === month || date.startsWith(month)) return "current_month";
  if (/^\d{4}-\d{2}$/.test(task.month) && task.month < month) return "overdue";
  return null;
}

export function deterministicDailyGroups(tasks: SheetTask[], today: string, maxTasks = 40): DailyPlanGroupRecord[] {
  const reasonRank = { overdue: 0, today: 1, current_month: 2 } as const;
  const relevant = tasks.flatMap((task) => {
    const reason = relevance(task, today);
    return reason ? [{ task, reason }] : [];
  }).sort((a, b) =>
    reasonRank[a.reason] - reasonRank[b.reason]
    || urgencyRank[a.task.urgency] - urgencyRank[b.task.urgency]
    || taskDate(a.task).localeCompare(taskDate(b.task))
    || a.task.task.localeCompare(b.task.task)
    || a.task.id.localeCompare(b.task.id)
  ).slice(0, maxTasks);

  const groups = new Map<string, DailyPlanGroupRecord["items"]>();
  relevant.forEach(({ task, reason }, rank) => {
    const category = normalizeTaskCategory(task.group);
    const items = groups.get(category) ?? [];
    items.push({
      taskId: task.id,
      title: task.task,
      category,
      urgency: task.urgency,
      month: task.month,
      reason,
      rank,
    });
    groups.set(category, items);
  });
  return CANONICAL_TASK_CATEGORIES.flatMap((name) => {
    const items = groups.get(name);
    return items?.length ? [{ name, items }] : [];
  });
}

export function scopeDailyPlanToTaskIds<T extends { groups: DailyPlanGroupRecord[]; taskCount: number }>(
  plan: T,
  allowedTaskIds: ReadonlySet<string>,
): T {
  const groups = plan.groups.flatMap((group) => {
    const items = group.items.filter((item) => allowedTaskIds.has(item.taskId));
    return items.length ? [{ ...group, items }] : [];
  });
  return {
    ...plan,
    groups,
    taskCount: groups.reduce((count, group) => count + group.items.length, 0),
  };
}

async function claudeReorder(groups: DailyPlanGroupRecord[]): Promise<DailyPlanGroupRecord[] | null> {
  const allItems = groups.flatMap((group) => group.items);
  if (!allItems.length) return groups;
  const response = await anthropic.messages.create({
    model: claudeFastModel(),
    max_tokens: 8192,
    system: `Reorder and group the supplied existing farm tasks into the canonical categories: ${CANONICAL_TASK_CATEGORIES.join(", ")}. Return only JSON: {"groups":[{"name":"canonical category","taskIds":["existing-id"]}]}. Include every supplied ID exactly once. Never invent a task or ID.`,
    messages: [{ role: "user", content: JSON.stringify(allItems) }],
  });
  const text = response.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
  const parsed = claudePlanSchema.safeParse(JSON.parse(text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "")));
  if (!parsed.success) return null;
  const requested = parsed.data.groups.flatMap((group) => group.taskIds);
  const expected = allItems.map((item) => item.taskId);
  if (requested.length !== expected.length || new Set(requested).size !== expected.length || requested.some((id) => !expected.includes(id))) return null;
  const byId = new Map(allItems.map((item) => [item.taskId, item]));
  let rank = 0;
  return parsed.data.groups.flatMap((group) => {
    const items = group.taskIds.flatMap((id) => {
      const item = byId.get(id);
      return item ? [{ ...item, category: group.name, rank: rank++ }] : [];
    });
    return items.length ? [{ name: group.name, items }] : [];
  });
}

async function settings() {
  const [existing] = await db.select().from(dailyPlanSettings).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(dailyPlanSettings).values({}).returning();
  if (!created) throw new Error("Could not create daily plan settings.");
  return created;
}

export async function getDailyPlanSettings() {
  return settings();
}

export async function updateDailyPlanSettings(input: { enabled?: boolean; timezone?: string; runAtLocal?: string; maxTasks?: number }) {
  if (input.timezone) dateInTimezone(new Date(), input.timezone);
  const current = await settings();
  const [updated] = await db.update(dailyPlanSettings).set(input).where(eq(dailyPlanSettings.id, current.id)).returning();
  if (!updated) throw new Error("Could not update daily plan settings.");
  return updated;
}

export async function refreshDailyPlan(options: { force?: boolean; actor?: string; now?: Date } = {}) {
  const currentSettings = await settings();
  const now = options.now ?? new Date();
  const planDate = dateInTimezone(now, currentSettings.timezone);
  const [existing] = await db.select().from(dailyPlanSnapshots).where(eq(dailyPlanSnapshots.planDate, planDate)).limit(1);
  if (existing && !options.force) return existing;
  if (existing?.status === "generating") return existing;

  const startedAt = new Date();
  const [locked] = existing
    ? await db.update(dailyPlanSnapshots).set({ status: "generating", error: "", startedAt })
      .where(and(eq(dailyPlanSnapshots.id, existing.id), ne(dailyPlanSnapshots.status, "generating"))).returning()
    : await db.insert(dailyPlanSnapshots).values({
      planDate,
      timezone: currentSettings.timezone,
      status: "generating",
      startedAt,
    }).onConflictDoNothing().returning();
  if (!locked) {
    return (await db.select().from(dailyPlanSnapshots).where(eq(dailyPlanSnapshots.planDate, planDate)).limit(1))[0];
  }

  try {
    const fallback = deterministicDailyGroups(await listSheetTasks(), planDate, currentSettings.maxTasks);
    let groups = fallback;
    let generatedBy = "deterministic";
    try {
      groups = await claudeReorder(fallback) ?? fallback;
      if (groups !== fallback) generatedBy = "claude";
    } catch (error) {
      logger.warn({ err: error, planDate }, "Claude daily-plan ordering failed; using deterministic order");
    }
    const [completed] = await db.update(dailyPlanSnapshots).set({
      status: "ready",
      groups,
      taskCount: groups.reduce((count, group) => count + group.items.length, 0),
      generatedBy,
      generatedAt: new Date(),
      error: "",
    }).where(eq(dailyPlanSnapshots.id, locked.id)).returning();
    await db.update(dailyPlanSettings).set({ lastRunAt: new Date() }).where(eq(dailyPlanSettings.id, currentSettings.id));
    return completed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Daily plan generation failed.";
    const [failed] = await db.update(dailyPlanSnapshots).set({ status: "error", error: message }).where(eq(dailyPlanSnapshots.id, locked.id)).returning();
    throw Object.assign(new Error(message), { snapshot: failed });
  }
}

export async function getTodaysDailyPlan(now = new Date()) {
  const currentSettings = await settings();
  const planDate = dateInTimezone(now, currentSettings.timezone);
  const [snapshot] = await db.select().from(dailyPlanSnapshots).where(eq(dailyPlanSnapshots.planDate, planDate)).limit(1);
  return snapshot ?? refreshDailyPlan({ now, actor: "on-demand" });
}

let queuedRefresh: ReturnType<typeof setTimeout> | null = null;

export function queueDailyPlanRefresh(actor: string): void {
  if (queuedRefresh) clearTimeout(queuedRefresh);
  queuedRefresh = setTimeout(() => {
    queuedRefresh = null;
    void refreshDailyPlan({ force: true, actor }).catch((error) => {
      logger.warn({ err: error, actor }, "Could not refresh daily plan after task change");
    });
  }, 250);
  queuedRefresh.unref();
}

export function startDailyPlanSchedule(): void {
  const tick = async () => {
    const current = await settings();
    if (!current.enabled || localTime(new Date(), current.timezone) !== current.runAtLocal) return;
    await refreshDailyPlan({ actor: "scheduler" });
  };
  void tick().catch((error) => logger.warn({ err: error }, "Initial daily-plan scheduler check failed"));
  setInterval(() => void tick().catch((error) => logger.warn({ err: error }, "Daily-plan scheduler check failed")), 60_000).unref();
}

export const dailyPlanTestables = { dateInTimezone, deterministicDailyGroups, relevance, scopeDailyPlanToTaskIds };
/**
 * One scheduler check, for an external trigger (Cloud Scheduler) when the
 * server is not running all day. Generates today's plan once the configured
 * local run time has passed; refreshDailyPlan is a no-op if today's plan exists.
 */
export async function runScheduledDailyPlanCheck(now = new Date()): Promise<"disabled" | "not-yet" | "ran"> {
  const current = await settings();
  if (!current.enabled) return "disabled";
  if (localTime(now, current.timezone) < current.runAtLocal) return "not-yet";
  await refreshDailyPlan({ now, actor: "scheduler" });
  return "ran";
}
