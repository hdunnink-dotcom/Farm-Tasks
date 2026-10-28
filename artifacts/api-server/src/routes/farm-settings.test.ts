import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getSettings: vi.fn(),
  isHarnold: vi.fn(),
  isMaster: vi.fn(),
  requireMember: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("../lib/farm-access", () => ({
  isHarnold: state.isHarnold,
  isMaster: state.isMaster,
  requireMember: state.requireMember,
}));

vi.mock("../lib/farm-settings", () => ({
  getFarmSettings: state.getSettings,
  updateFarmSettings: state.updateSettings,
}));

import router from "./farm-settings";

const settings = {
  id: 1,
  groups: ["Orchards", "Gullies"],
  locations: ["North block", "South block"],
  defaultGroup: "Orchards",
  defaultUrgency: "Medium" as const,
  defaultLocation: "North block",
  updatedAt: "2026-08-30T00:00:00.000Z",
};

async function request(
  method: "GET" | "PATCH",
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP port.");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/farm-settings`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe("shared farm settings access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.getSettings.mockResolvedValue(settings);
    state.updateSettings.mockResolvedValue(settings);
  });

  it("lets Harnold load and save the shared task options", async () => {
    state.requireMember.mockResolvedValue({
      clerkId: "harnold",
      role: "master",
      status: "active",
    });
    state.isHarnold.mockReturnValue(true);
    state.isMaster.mockReturnValue(true);

    const loaded = await request("GET");
    expect(loaded.status).toBe(200);
    expect(loaded.body).toEqual({
      ...settings,
      updatedAt: settings.updatedAt,
    });

    const update = {
      groups: ["Orchards", "Repair"],
      locations: ["North block", "Yurt"],
      defaultGroup: "Repair",
      defaultUrgency: "High",
      defaultLocation: "Yurt",
    };
    const saved = await request("PATCH", update);

    expect(saved.status).toBe(200);
    expect(state.updateSettings).toHaveBeenCalledWith(update);
  });

  it("denies a different master account from changing shared settings", async () => {
    state.requireMember.mockResolvedValue({
      clerkId: "another-master",
      role: "master",
      status: "active",
    });
    state.isHarnold.mockReturnValue(false);
    state.isMaster.mockReturnValue(false);

    const response = await request("PATCH", {
      groups: ["Private"],
      defaultGroup: "Private",
    });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Only a farm manager can manage shared farm settings." });
    expect(state.updateSettings).not.toHaveBeenCalled();
  });

  it("lets an invited manager manage shared settings", async () => {
    state.requireMember.mockResolvedValue({
      clerkId: "manager-2",
      role: "manager",
      status: "active",
    });
    state.isHarnold.mockReturnValue(false);
    state.isMaster.mockReturnValue(true);

    const response = await request("PATCH", {
      groups: ["Orchards"],
      defaultGroup: "Orchards",
    });

    expect(response.status).toBe(200);
    expect(state.updateSettings).toHaveBeenCalledOnce();
  });
});