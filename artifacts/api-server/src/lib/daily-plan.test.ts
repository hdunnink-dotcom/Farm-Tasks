import { describe, expect, it, vi } from "vitest";
import type { DailyPlanGroupRecord } from "@workspace/db";

vi.mock("@workspace/db", () => ({
  db: {},
  dailyPlanSettings: {},
  dailyPlanSnapshots: {},
}));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: { messages: { create: vi.fn() } }, claudeModel: () => "claude-test-model", claudeFastModel: () => "claude-test-fast-model" }));
vi.mock("./farm-sheet", () => ({ listSheetTasks: vi.fn() }));
vi.mock("./logger", () => ({ logger: { warn: vi.fn() } }));

const task = (input: Record<string, unknown>) => ({
  id: "task", group: "Orchard", task: "Work", done: false, urgency: "Medium",
  month: "", location: "", latitude: null, longitude: null, locationCapturedAt: "",
  atlasLink: "", notes: "", link: "", subtasks: [], attachmentIds: [], source: "Manual",
  calendarEventId: "", calendarRecurringEventId: "", calendarStart: "", calendarUpdated: "",
  updatedAt: "2026-04-01T00:00:00Z", assigneeId: "", assigneeName: "", ...input,
});

describe("daily plan fallback", () => {
  it("uses the configured timezone for calendar dates", async () => {
    const { dailyPlanTestables } = await import("./daily-plan");
    expect(dailyPlanTestables.dateInTimezone(new Date("2026-01-01T11:30:00Z"), "Pacific/Auckland")).toBe("2026-01-02");
  });

  it("includes unfinished overdue, today, and current-month tasks with real IDs", async () => {
    const { dailyPlanTestables } = await import("./daily-plan");
    const groups = dailyPlanTestables.deterministicDailyGroups([
      task({ id: "overdue-id", month: "2026-03", urgency: "Low" }),
      task({ id: "today-id", calendarStart: "2026-04-15T08:00:00+12:00", urgency: "Urgent" }),
      task({ id: "month-id", month: "2026-04", group: "Property maintenance", urgency: "High" }),
      task({ id: "done-id", month: "2026-04", done: true }),
      task({ id: "future-id", month: "2026-05" }),
    ] as never, "2026-04-15");
    const items = groups.flatMap((group) => group.items);
    expect(items.map((item) => item.taskId)).toEqual(["overdue-id", "today-id", "month-id"]);
    expect(items.map((item) => item.reason)).toEqual(["overdue", "today", "current_month"]);
    expect(groups.find((group) => group.name === "Repair")?.items[0]?.taskId).toBe("month-id");
  });

  it("is deterministic when urgency and dates match", async () => {
    const { dailyPlanTestables } = await import("./daily-plan");
    const groups = dailyPlanTestables.deterministicDailyGroups([
      task({ id: "b", task: "Same", month: "2026-04" }),
      task({ id: "a", task: "Same", month: "2026-04" }),
    ] as never, "2026-04-15");
    expect(groups.flatMap((group) => group.items).map((item) => item.taskId)).toEqual(["a", "b"]);
  });

  it("removes hidden task titles and IDs from a member-scoped plan", async () => {
    const { dailyPlanTestables } = await import("./daily-plan");
    const plan = {
      id: 1,
      taskCount: 2,
      groups: [{
        name: "Orchards",
        items: [
          { taskId: "assigned", title: "Visible", category: "Orchards", urgency: "High", month: "2026-04", reason: "today", rank: 0 },
          { taskId: "private", title: "Owner only", category: "Orchards", urgency: "Urgent", month: "2026-04", reason: "overdue", rank: 1 },
        ],
      }] as DailyPlanGroupRecord[],
    };
    const scoped = dailyPlanTestables.scopeDailyPlanToTaskIds(plan, new Set(["assigned"]));
    expect(scoped.taskCount).toBe(1);
    expect(scoped.groups.flatMap((group) => group.items).map((item) => item.taskId)).toEqual(["assigned"]);
    expect(JSON.stringify(scoped)).not.toContain("Owner only");
  });
});