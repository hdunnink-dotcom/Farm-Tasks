import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appendCompletion: vi.fn(),
  completions: [] as Array<Record<string, unknown>>,
  createTask: vi.fn(),
  isHarnold: vi.fn(),
  isMaster: vi.fn(),
  listAttachments: vi.fn(),
  listCompletions: vi.fn(),
  listTasks: vi.fn(),
  requireMember: vi.fn(),
  tasks: [] as Array<Record<string, unknown>>,
  updateTask: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn() },
  farmMembers: {},
}));

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(),
}));

vi.mock("../lib/farm-access", () => ({
  isHarnold: state.isHarnold,
  isMaster: state.isMaster,
  requireMember: state.requireMember,
}));

vi.mock("../lib/farm-attachments", () => ({
  listReadyAttachments: state.listAttachments,
}));

vi.mock("../lib/farm-sheet", () => ({
  appendCompletionRecord: state.appendCompletion,
  createSheetTask: state.createTask,
  deleteSheetTask: vi.fn(),
  farmSheetSource: "Google Sheets",
  farmSheetSourceUrl: "https://docs.google.com/spreadsheets/d/test-sheet/edit",
  findSheetTask: vi.fn(),
  listSheetTasks: state.listTasks,
  listCompletionRecords: state.listCompletions,
  updateSheetTask: state.updateTask,
}));

vi.mock("../lib/daily-plan", () => ({
  queueDailyPlanRefresh: vi.fn(),
}));

vi.mock("../lib/task-repository", () => ({
  readMutationReceipt: vi.fn(),
  writeMutationReceipt: vi.fn(),
}));

import router from "./tasks";

function task(
  id: string,
  workerId: string,
  reviewStatus: "approved" | "pending" | "rejected",
  title: string,
): Record<string, unknown> {
  return {
    id,
    group: "Orchards",
    task: title,
    done: false,
    urgency: "Medium",
    month: "2026-08",
    location: "",
    latitude: null,
    longitude: null,
    locationCapturedAt: "",
    atlasLink: "",
    notes: "",
    link: "",
    subtasks: [],
    attachmentIds: [],
    source: "Manual",
    calendarEventId: "",
    calendarRecurringEventId: "",
    calendarStart: "",
    calendarUpdated: "",
    updatedAt: "2026-08-30T00:00:00.000Z",
    assigneeId: workerId,
    assigneeName: workerId === "jason" ? "Jason" : "Tom",
    repeatWeekly: false,
    reviewStatus,
    submittedById: workerId,
    submittedByName: workerId === "jason" ? "Jason" : "Tom",
    ...(reviewStatus === "rejected"
      ? { reviewNote: "Add a photo of the repaired gate." }
      : {}),
  };
}

async function request(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
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
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const responseBody = await response.text();
    try {
      return { status: response.status, body: JSON.parse(responseBody) as Record<string, unknown> };
    } catch {
      throw new Error(`Expected JSON from ${method} ${path}, received ${response.status}: ${responseBody}`);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe("worker task visibility and review access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.tasks = [
      task("pending-jason", "jason", "pending", "Repair Jason's gate"),
      task("pending-tom", "tom", "pending", "Check Tom's trees"),
      task("rejected-jason", "jason", "rejected", "Revisit Jason's fence"),
    ];
    state.listTasks.mockImplementation(async () => state.tasks);
    state.listAttachments.mockResolvedValue(new Map());
    state.listCompletions.mockImplementation(async () => state.completions);
    state.isMaster.mockReturnValue(false);
    state.isHarnold.mockReturnValue(false);
    state.appendCompletion.mockImplementation(async (record) => record);
    state.updateTask.mockImplementation(async (taskId: string, changes: Record<string, unknown>) => {
      const current = state.tasks.find((item) => item.id === taskId);
      if (!current) return undefined;
      const definedChanges = Object.fromEntries(
        Object.entries(changes).filter(([, value]) => value !== undefined),
      );
      const updated = { ...current, ...definedChanges };
      state.tasks = state.tasks.map((item) => item.id === taskId ? updated : item);
      return updated;
    });
  });

  it("lets workers submit tasks and only see their own pending or rejected submissions", async () => {
    const submitted = task("submitted-jason", "jason", "pending", "Submit a new repair");
    state.requireMember.mockResolvedValue({
      clerkId: "jason",
      displayName: "Jason",
      role: "worker",
      status: "active",
    });
    state.createTask.mockImplementation(async (input: Record<string, unknown>) => {
      state.tasks.push(submitted);
      return submitted;
    });

    const created = await request("POST", "/tasks", { task: "Submit a new repair" });

    expect(created.status).toBe(201);
    expect(state.createTask).toHaveBeenCalledWith(expect.objectContaining({
      task: "Submit a new repair",
      assigneeId: "jason",
      assigneeName: "Jason",
      reviewStatus: "pending",
      submittedById: "jason",
      submittedByName: "Jason",
      done: false,
    }));

    const jasonTasks = await request("GET", "/tasks");
    expect(jasonTasks.status).toBe(200);
    expect(jasonTasks.body.sourceUrl).toBe("https://docs.google.com/spreadsheets/d/test-sheet/edit");
    expect((jasonTasks.body.tasks as Array<{ id: string }>).map((item) => item.id))
      .toEqual(["pending-jason", "rejected-jason", "submitted-jason"]);

    state.requireMember.mockResolvedValue({
      clerkId: "tom",
      displayName: "Tom",
      role: "worker",
      status: "active",
    });
    const tomTasks = await request("GET", "/tasks");
    expect((tomTasks.body.tasks as Array<{ id: string }>).map((item) => item.id))
      .toEqual(["pending-tom"]);
  });

  it("lets every assigned worker see an approved shared task", async () => {
    state.tasks = [{
      ...task("shared", "jason", "approved", "Move irrigation"),
      assigneeIds: ["jason", "tom"],
      assigneeNames: ["Jason", "Tom"],
    }];
    state.requireMember.mockResolvedValue({
      clerkId: "tom",
      displayName: "Tom",
      role: "worker",
      status: "active",
    });

    const listed = await request("GET", "/tasks");
    expect((listed.body.tasks as Array<{ id: string }>).map(({ id }) => id)).toEqual(["shared"]);

    state.requireMember.mockResolvedValue({
      clerkId: "third-worker",
      displayName: "Third worker",
      role: "worker",
      status: "active",
    });
    const hidden = await request("GET", "/tasks");
    expect(hidden.body.tasks).toEqual([]);

  });

  it("keeps Tom and Jason isolated and allows completion only for the assigned worker", async () => {
    state.tasks = [
      {
        ...task("tom-week", "tom", "approved", "Tom's weekly orchard route"),
        assigneeIds: ["tom"],
        assigneeNames: ["Tom"],
        urgency: "Urgent",
        calendarStart: "2026-09-02",
      },
      {
        ...task("jason-week", "jason", "approved", "Jason's weekly orchard route"),
        assigneeIds: ["jason"],
        assigneeNames: ["Jason"],
        urgency: "High",
        calendarStart: "2026-09-02",
      },
    ];

    state.requireMember.mockResolvedValue({
      clerkId: "tom",
      displayName: "Tom",
      role: "worker",
      status: "active",
    });
    const tomTasks = await request("GET", "/tasks");
    expect((tomTasks.body.tasks as Array<{ id: string }>).map(({ id }) => id)).toEqual(["tom-week"]);

    const completed = await request("PATCH", "/tasks/tom-week", {
      task: "Tom's weekly orchard route",
      done: true,
    });
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({ id: "tom-week", done: true });

    const crossWorkerUpdate = await request("PATCH", "/tasks/jason-week", {
      task: "Jason's weekly orchard route",
      done: true,
    });
    expect(crossWorkerUpdate.status).toBe(403);
    expect(crossWorkerUpdate.body).toEqual({
      error: "Workers can only update tasks assigned to them or awaiting their review.",
    });
    expect(state.updateTask).toHaveBeenCalledTimes(1);

    state.requireMember.mockResolvedValue({
      clerkId: "jason",
      displayName: "Jason",
      role: "worker",
      status: "active",
    });
    const jasonTasks = await request("GET", "/tasks");
    expect((jasonTasks.body.tasks as Array<{ id: string }>).map(({ id }) => id)).toEqual(["jason-week"]);
    expect((jasonTasks.body.tasks as Array<{ id: string; done: boolean }>)[0].done).toBe(false);
  });

  it("records one stable completion intent and repairs it on a stale offline retry", async () => {
    state.tasks = [{
      ...task("weekly-route", "tom", "approved", "Inspect weekly route"),
      calendarStart: "2026-09-03",
      recurrence: "none",
      updatedAt: "2026-09-03T00:00:00.000Z",
    }];
    state.requireMember.mockResolvedValue({
      clerkId: "tom",
      displayName: "Tom",
      role: "worker",
      status: "active",
    });
    state.updateTask.mockImplementation(async (_taskId: string, changes: Record<string, unknown>) => {
      const definedChanges = Object.fromEntries(
        Object.entries(changes).filter(([, value]) => value !== undefined),
      );
      const updated = { ...state.tasks[0], ...definedChanges, updatedAt: "2026-09-03T02:30:00.000Z" };
      state.tasks = [updated];
      return updated;
    });
    state.createTask.mockImplementation(async (input: Record<string, unknown>) => input);

    const body = {
      task: "Inspect weekly route",
      done: true,
      baseUpdatedAt: "2026-09-03T00:00:00.000Z",
      clientOperationId: "offline-op-42",
    };
    expect((await request("PATCH", "/tasks/weekly-route", body)).status).toBe(200);
    expect((await request("PATCH", "/tasks/weekly-route", body)).status).toBe(200);
    expect(state.appendCompletion).toHaveBeenCalledTimes(2);
    expect(state.appendCompletion).toHaveBeenNthCalledWith(1, expect.objectContaining({
      eventId: "completion:offline-op-42",
      taskId: "weekly-route",
      completedById: "tom",
      scheduledDate: "2026-09-03",
    }));
  });

  it("returns a month-scoped completion overview without exposing another worker's data", async () => {
    state.tasks = [
      { ...task("tom-open", "tom", "approved", "Tom open"), calendarStart: "2026-09-01" },
      { ...task("jason-open", "jason", "approved", "Jason open"), calendarStart: "2026-09-02" },
    ];
    state.completions = [
      {
        eventId: "completion:tom",
        taskId: "tom-done",
        taskTitle: "Tom done",
        scheduledDate: "2026-09-01",
        completedAt: "2026-09-03T10:00:00+12:00",
        completedById: "tom",
        completedByName: "Tom",
        group: "Orchards",
        location: "North",
        source: "Manual",
        recurrence: "none",
        assigneeIds: ["tom"],
        assigneeNames: ["Tom"],
      },
      {
        eventId: "completion:jason",
        taskId: "jason-done",
        taskTitle: "Jason done",
        scheduledDate: "2026-09-02",
        completedAt: "2026-09-03T11:00:00+12:00",
        completedById: "jason",
        completedByName: "Jason",
        group: "Repairs",
        location: "South",
        source: "Manual",
        recurrence: "none",
        assigneeIds: ["jason"],
        assigneeNames: ["Jason"],
      },
    ];
    state.requireMember.mockResolvedValue({
      clerkId: "tom",
      displayName: "Tom",
      role: "worker",
      status: "active",
    });

    const response = await request("GET", "/tasks/monthly-summary?month=2026-09");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ month: "2026-09", scheduled: 1, completed: 1, outstanding: 1 });
    expect((response.body.completions as Array<{ completedById: string }>).map(({ completedById }) => completedById))
      .toEqual(["tom"]);
  });

  it("lets Harnold approve or reject pending tasks, requiring a rejection note", async () => {
    state.requireMember.mockResolvedValue({
      clerkId: "harnold",
      displayName: "Harnold",
      role: "master",
      status: "active",
    });
    state.isHarnold.mockReturnValue(true);
    state.isMaster.mockReturnValue(true);

    const pending = await request("GET", "/tasks/pending");
    expect(pending.status).toBe(200);
    expect(pending.body.pendingCount).toBe(2);
    expect((pending.body.tasks as Array<{ id: string }>).map((item) => item.id))
      .toEqual(["pending-jason", "pending-tom"]);

    const approved = await request("POST", "/tasks/pending-jason/approve");
    expect(approved.status).toBe(200);
    expect(approved.body.reviewStatus).toBe("approved");
    expect(state.updateTask).toHaveBeenCalledWith("pending-jason", expect.objectContaining({
      reviewStatus: "approved",
      reviewNote: "",
    }));

    const updateCountBeforeMissingNote = state.updateTask.mock.calls.length;
    const missingNote = await request("POST", "/tasks/pending-tom/reject", { reviewNote: "   " });
    expect(missingNote.status).toBe(400);
    expect(missingNote.body).toEqual({ error: "Add a short reason when rejecting a task." });
    expect(state.updateTask).toHaveBeenCalledTimes(updateCountBeforeMissingNote);

    const rejected = await request("POST", "/tasks/pending-tom/reject", {
      reviewNote: "Please include the affected tree row.",
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.reviewStatus).toBe("rejected");
    expect(rejected.body.reviewNote).toBe("Please include the affected tree row.");
    expect(state.updateTask).toHaveBeenCalledWith("pending-tom", expect.objectContaining({
      reviewStatus: "rejected",
      reviewNote: "Please include the affected tree row.",
    }));
  });

  it("denies a worker from reviewing submissions", async () => {
    state.requireMember.mockResolvedValue({
      clerkId: "worker-1",
      displayName: "Field worker",
      role: "worker",
      status: "active",
    });
    state.isMaster.mockReturnValue(false);
    state.isHarnold.mockReturnValue(false);

    const pending = await request("GET", "/tasks/pending");
    const approve = await request("POST", "/tasks/pending-jason/approve");
    const reject = await request("POST", "/tasks/pending-tom/reject", { reviewNote: "Not ready." });

    for (const response of [pending, approve, reject]) {
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: "Only a farm manager can review worker submissions." });
    }
    expect(state.listTasks).not.toHaveBeenCalled();
    expect(state.updateTask).not.toHaveBeenCalled();
  });
});