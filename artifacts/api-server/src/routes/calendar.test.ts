import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getStatus: vi.fn(() => ({
    state: "idle",
    lastSyncAt: "",
    lastError: "",
    sources: [{
      name: "Orchard Managment",
      available: false,
      message: "Calendar access has not been verified yet.",
    }],
  })),
  isMaster: vi.fn(),
  requireMember: vi.fn(),
  sync: vi.fn(() => Promise.resolve({
    created: 0,
    updated: 0,
    skipped: 0,
    cancelled: 0,
    errors: 0,
    syncedAt: new Date(0).toISOString(),
    calendars: [],
  })),
}));

vi.mock("../lib/farm-access", () => ({
  isMaster: state.isMaster,
  requireMember: state.requireMember,
}));

vi.mock("../lib/orchard-calendar", () => ({
  getOrchardCalendarStatus: state.getStatus,
  syncOrchardCalendar: state.sync,
}));

import router from "./calendar";

async function request(method: "GET" | "POST"): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(router);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP port.");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/calendar/orchard/sync`, { method });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe("orchard calendar sync access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps calendar sync status manager-only", async () => {
    state.requireMember.mockResolvedValue({ role: "worker", status: "active" });
    state.isMaster.mockReturnValue(false);

    const response = await request("GET");

    expect(response.status).toBe(403);
    expect(state.getStatus).not.toHaveBeenCalled();
  });

  it("rejects inactive members from sync status", async () => {
    state.requireMember.mockResolvedValue({ role: "worker", status: "revoked" });

    const response = await request("GET");

    expect(response.status).toBe(403);
    expect(state.getStatus).not.toHaveBeenCalled();
  });

  it("requires an active owner to start synchronization", async () => {
    state.requireMember.mockResolvedValue({ role: "worker", status: "active" });
    state.isMaster.mockReturnValue(false);

    const workerResponse = await request("POST");

    expect(workerResponse.status).toBe(403);
    expect(state.sync).not.toHaveBeenCalled();

    state.requireMember.mockResolvedValue({ role: "master", status: "active" });
    state.isMaster.mockReturnValue(true);
    const ownerResponse = await request("POST");

    expect(ownerResponse.status).toBe(200);
    expect(state.sync).toHaveBeenCalledOnce();
  });
});