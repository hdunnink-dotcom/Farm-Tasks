import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getPlan: vi.fn(),
  isMaster: vi.fn(),
  listTasks: vi.fn(),
  requireMember: vi.fn(),
}));

vi.mock("../lib/farm-access", () => ({
  isMaster: state.isMaster,
  requireMember: state.requireMember,
}));
vi.mock("../lib/farm-sheet", () => ({ listSheetTasks: state.listTasks }));
vi.mock("../lib/daily-plan", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/daily-plan")>();
  return {
    ...original,
    getTodaysDailyPlan: state.getPlan,
    getDailyPlanSettings: vi.fn(),
    refreshDailyPlan: vi.fn(),
    updateDailyPlanSettings: vi.fn(),
  };
});

import router from "./daily-plan";

const plan = {
  id: 1,
  planDate: "2026-08-28",
  timezone: "Pacific/Auckland",
  status: "ready",
  groups: [{
    name: "Orchards",
    items: [
      { taskId: "worker-task", title: "Visible work", category: "Orchards", urgency: "High", month: "2026-08", reason: "today", rank: 0 },
      { taskId: "owner-task", title: "Owner private work", category: "Orchards", urgency: "Urgent", month: "2026-08", reason: "overdue", rank: 1 },
    ],
  }],
  taskCount: 2,
  generatedBy: "claude",
  error: "",
  startedAt: "2026-08-28T00:00:00.000Z",
  generatedAt: "2026-08-28T00:00:01.000Z",
  updatedAt: "2026-08-28T00:00:01.000Z",
};

async function request(): Promise<{ status: number; body: typeof plan }> {
  const app = express();
  app.use(router);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP port.");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/daily-plan/today`);
    return { status: response.status, body: await response.json() as typeof plan };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe("daily-plan visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.getPlan.mockResolvedValue(plan);
    state.listTasks.mockResolvedValue([
      { id: "worker-task", assigneeId: "worker-1" },
      { id: "owner-task", assigneeId: "owner-1" },
    ]);
  });

  it("removes every unassigned title and ID from a worker response", async () => {
    state.requireMember.mockResolvedValue({ clerkId: "worker-1", role: "worker", status: "active" });
    state.isMaster.mockReturnValue(false);

    const response = await request();

    expect(response.status).toBe(200);
    expect(response.body.taskCount).toBe(1);
    expect(response.body.groups[0]?.items.map((item) => item.taskId)).toEqual(["worker-task"]);
    expect(JSON.stringify(response.body)).not.toContain("Owner private work");
  });

  it("returns the complete plan to the active owner", async () => {
    state.requireMember.mockResolvedValue({ clerkId: "owner-1", role: "master", status: "active" });
    state.isMaster.mockReturnValue(true);

    const response = await request();

    expect(response.status).toBe(200);
    expect(response.body.taskCount).toBe(2);
    expect(state.listTasks).not.toHaveBeenCalled();
  });
});