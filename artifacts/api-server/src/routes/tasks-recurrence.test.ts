import { describe, expect, it, vi } from "vitest";
import type { SheetTask } from "../lib/farm-sheet";

const createSheetTask = vi.fn();
vi.mock("../lib/farm-sheet", () => ({
  createSheetTask,
  deleteSheetTask: vi.fn(),
  farmSheetSource: "Google Sheets",
  findSheetTask: vi.fn(),
  listSheetTasks: vi.fn(),
  updateSheetTask: vi.fn(),
}));
vi.mock("../lib/farm-attachments", () => ({ listReadyAttachments: vi.fn(async () => new Map()) }));
vi.mock("../lib/farm-access", () => ({ currentMember: vi.fn(), isMaster: vi.fn(), requireMember: vi.fn() }));
vi.mock("../lib/daily-plan", () => ({ queueDailyPlanRefresh: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: { select: vi.fn() }, farmMembers: {} }));

describe("recurring task completion", () => {
  it("normalizes legacy blank recurrence values before request validation", async () => {
    const { normalizeLegacyTaskBody } = await import("./tasks");

    expect(normalizeLegacyTaskBody({
      task: "Prune shelter belt",
      recurrence: "",
      repeatWeekly: true,
    })).toEqual({
      task: "Prune shelter belt",
      recurrence: "none",
      repeatWeekly: false,
    });
  });

  it.each([
    ["weekly", "2026-09-14", "2026-09-21"],
    ["biweekly", "2026-09-14", "2026-09-28"],
    ["every4weeks", "2026-09-14", "2026-10-12"],
    ["monthly", "2026-01-31", "2026-02-28"],
    ["quarterly", "2026-11-30", "2027-02-28"],
    ["yearly", "2024-02-29", "2025-02-28"],
  ] as const)("advances %s date-only schedules with calendar clamping", async (recurrence, start, expected) => {
    const { nextAucklandOccurrence } = await import("./tasks");
    expect(nextAucklandOccurrence(start, recurrence)).toBe(expected);
  });

  it("preserves Auckland wall-clock time across daylight-saving changes", async () => {
    const { nextAucklandOccurrence } = await import("./tasks");
    expect(nextAucklandOccurrence("2026-09-19T21:30:00.000Z", "weekly"))
      .toBe("2026-09-26T20:30:00.000Z");
  });

  it("recovers a failed follow-up on a stale completion retry without duplicating it", async () => {
    const { ensureNextWeeklyOccurrence } = await import("./tasks");
    const completed: SheetTask = {
      id: "routine-1", task: "Check traps", done: true, recurrence: "weekly", repeatWeekly: true,
      source: "Manual", calendarStart: "2026-04-04T21:30:00.000Z",
      group: "Orchards", urgency: "Medium", month: "", location: "", latitude: null, longitude: null,
      locationCapturedAt: "", atlasLink: "", notes: "", link: "", subtasks: [], attachmentIds: [],
      calendarEventId: "", calendarRecurringEventId: "", calendarUpdated: "", updatedAt: "2026-04-04T22:00:00.000Z",
      assigneeId: "worker-1", assigneeName: "Taylor",
    };
    let failNextWrite = true;
    const created = new Map<string, unknown>();
    createSheetTask.mockImplementation(async (input: { id: string }) => {
      if (failNextWrite) {
        failNextWrite = false;
        throw new Error("Sheets temporarily unavailable");
      }
      if (!created.has(input.id)) created.set(input.id, input);
      return created.get(input.id);
    });
    await expect(ensureNextWeeklyOccurrence(completed)).rejects.toThrow("temporarily");
    await ensureNextWeeklyOccurrence(completed); // stale baseUpdatedAt retry reconciles this state
    await ensureNextWeeklyOccurrence(completed);

    expect(createSheetTask).toHaveBeenCalledTimes(3);
    expect([...created]).toHaveLength(1);
    expect(createSheetTask).toHaveBeenLastCalledWith(expect.objectContaining({
      id: "routine-1--weekly-2026-04-12",
      done: false,
      assigneeId: "worker-1",
      assigneeName: "Taylor",
      // NZST is UTC+12 after the April DST transition; 09:30 stays 09:30.
      calendarStart: "2026-04-11T21:30:00.000Z",
    }));
  });

  it("retains task details and recurrence on the next non-weekly occurrence", async () => {
    const { ensureNextOccurrence } = await import("./tasks");
    createSheetTask.mockResolvedValue({});
    await ensureNextOccurrence({
      id: "routine-quarterly",
      task: "Service pump",
      done: true,
      recurrence: "quarterly",
      repeatWeekly: false,
      source: "Manual",
      calendarStart: "2026-11-30",
      group: "Repair",
      urgency: "High",
      month: "2026-11",
      location: "Pump shed",
      latitude: null,
      longitude: null,
      locationCapturedAt: "",
      atlasLink: "",
      notes: "Bring seals",
      link: "https://example.com/manual",
      subtasks: [{ id: "step-1", title: "Isolate power", done: true }],
      attachmentIds: ["attachment-1"],
      calendarEventId: "",
      calendarRecurringEventId: "",
      calendarUpdated: "",
      updatedAt: "2026-11-30T01:00:00.000Z",
      assigneeId: "worker-1",
      assigneeName: "Taylor",
      assigneeIds: ["worker-1"],
      assigneeNames: ["Taylor"],
    });
    expect(createSheetTask).toHaveBeenCalledWith(expect.objectContaining({
      id: "routine-quarterly--quarterly-2027-02-28",
      calendarStart: "2027-02-28",
      recurrence: "quarterly",
      repeatWeekly: false,
      done: false,
      notes: "Bring seals",
      assigneeIds: ["worker-1"],
      subtasks: [{ id: "step-1", title: "Isolate power", done: true }],
      attachmentIds: [],
    }));
  });
});