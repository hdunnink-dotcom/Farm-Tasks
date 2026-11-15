import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appendCompletion: vi.fn(),
  createTask: vi.fn(),
  listTasks: vi.fn(),
  requireMember: vi.fn(),
  tasks: [] as Array<Record<string, unknown>>,
  updateTask: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: { select: vi.fn() }, farmMembers: {} }));
vi.mock("@clerk/express", () => ({ getAuth: vi.fn() }));
vi.mock("../lib/farm-access", () => ({
  isHarnold: vi.fn(() => true),
  isMaster: vi.fn(() => true),
  requireMember: state.requireMember,
}));
vi.mock("../lib/farm-attachments", () => ({ listReadyAttachments: vi.fn(async () => new Map()) }));
vi.mock("../lib/farm-sheet", () => ({
  appendCompletionRecord: state.appendCompletion,
  createSheetTask: state.createTask,
  deleteSheetTask: vi.fn(),
  farmSheetSource: "Google Sheets",
  farmSheetSourceUrl: "https://docs.google.com/spreadsheets/d/test-sheet/edit",
  findSheetTask: vi.fn(),
  listSheetTasks: state.listTasks,
  listCompletionRecords: vi.fn(async () => []),
  updateSheetTask: state.updateTask,
}));
vi.mock("../lib/daily-plan", () => ({ queueDailyPlanRefresh: vi.fn() }));
vi.mock("../lib/task-repository", () => ({ readMutationReceipt: vi.fn(), writeMutationReceipt: vi.fn() }));

import router from "./tasks";

// Monday 16 Nov 2026, 4 pm in Auckland.
const TICKED_AT = "2026-11-16T03:00:00.000Z";

function sheetTask(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "task", group: "Orchards", task: "Task", done: false, urgency: "Medium", month: "", location: "",
    latitude: null, longitude: null, locationCapturedAt: "", atlasLink: "", notes: "", link: "", subtasks: [],
    attachmentIds: [], source: "Manual", calendarEventId: "", calendarRecurringEventId: "", calendarStart: "",
    calendarUpdated: "", updatedAt: "2026-09-01T00:00:00.000Z", assigneeId: "", assigneeName: "",
    recurrence: "none", repeatWeekly: false, reviewStatus: "approved",
    ...overrides,
  };
}

async function patch(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error: vi.fn(), warn: vi.fn() } as unknown as typeof req.log;
    next();
  });
  app.use(router);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP port.");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe("ticks from phones on the older app", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.requireMember.mockResolvedValue({ clerkId: "harnold", displayName: "Harnold", role: "owner", status: "active" });
    state.listTasks.mockImplementation(async () => state.tasks);
    state.appendCompletion.mockImplementation(async (record) => record);
    state.createTask.mockImplementation(async (input: Record<string, unknown>) => {
      state.tasks.push(input);
      return input;
    });
    state.updateTask.mockImplementation(async (taskId: string, changes: Record<string, unknown>) => {
      const current = state.tasks.find((item) => item.id === taskId);
      if (!current) return undefined;
      const defined = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
      const updated = { ...current, ...defined, updatedAt: TICKED_AT };
      state.tasks = state.tasks.map((item) => item.id === taskId ? updated : item);
      return updated;
    });
  });

  it("completes an overdue weekly routine and continues it after today", async () => {
    state.tasks = [sheetTask({
      id: "check-traps", task: "Check traps", recurrence: "weekly", repeatWeekly: true,
      // Monday 7 Sep, 8:30 am in Auckland.
      calendarStart: "2026-09-06T20:30:00.000Z", scheduledDates: ["2026-09-07"],
    })];

    const response = await patch("/tasks/check-traps", {
      task: "Check traps", done: true, scheduledDates: [], baseUpdatedAt: "2026-09-01T00:00:00.000Z",
    });

    expect(response.status).toBe(200);
    expect(state.updateTask).toHaveBeenCalledWith("check-traps", expect.not.objectContaining({ scheduledDates: [] }), undefined);
    expect(state.tasks[0]).toEqual(expect.objectContaining({ done: true, calendarStart: "2026-09-06T20:30:00.000Z" }));
    expect(state.createTask).toHaveBeenCalledTimes(1);
    expect(state.createTask).toHaveBeenCalledWith(expect.objectContaining({
      id: "check-traps--weekly-2026-11-23",
      done: false,
      // Still 8:30 am on a Monday, now in daylight time.
      calendarStart: "2026-11-22T19:30:00.000Z",
      scheduledDates: ["2026-11-23"],
    }));
  });

  it("keeps a one-off task's date when it is ticked", async () => {
    state.tasks = [sheetTask({ id: "gravel", task: "Add gravel", calendarStart: "2026-11-12", scheduledDates: ["2026-11-12"] })];

    const response = await patch("/tasks/gravel", { task: "Add gravel", done: true, scheduledDates: [] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ done: true, scheduledDates: ["2026-11-12"] }));
  });

  it("still clears dates when the planner unschedules a task", async () => {
    state.tasks = [sheetTask({ id: "gravel", task: "Add gravel", calendarStart: "2026-11-12", scheduledDates: ["2026-11-12"] })];

    const response = await patch("/tasks/gravel", { task: "Add gravel", calendarStart: "", scheduledDates: [] });

    expect(response.status).toBe(200);
    expect(state.updateTask).toHaveBeenCalledWith("gravel", expect.objectContaining({ calendarStart: "", scheduledDates: [] }), undefined);
  });

  it("does not add a second later occurrence when a done routine is edited again", async () => {
    state.tasks = [
      sheetTask({
        id: "check-traps", task: "Check traps", done: true, recurrence: "weekly", repeatWeekly: true,
        calendarStart: "2026-09-06T20:30:00.000Z", scheduledDates: ["2026-09-07"],
      }),
      sheetTask({
        id: "check-traps--weekly-2026-11-09", task: "Check traps", recurrence: "weekly", repeatWeekly: true,
        calendarStart: "2026-11-08T19:30:00.000Z", scheduledDates: ["2026-11-09"],
      }),
    ];

    const response = await patch("/tasks/check-traps", { task: "Check traps", notes: "Two moths" });

    expect(response.status).toBe(200);
    expect(state.createTask).not.toHaveBeenCalled();
  });
});
