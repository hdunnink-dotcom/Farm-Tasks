import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
  authUserId: "user_worker_1" as string | null,
  clerkCreate: vi.fn(),
  clerkRevoke: vi.fn(),
  clerkGetUser: vi.fn(),
  currentMember: vi.fn(),
  insert: vi.fn(),
  isMaster: vi.fn(),
  migrateAssignee: vi.fn(),
  publicOrigin: vi.fn(() => "https://farm-tasks.replit.app"),
  requireMember: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: state.and,
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.authUserId }),
  clerkClient: {
    users: { getUser: state.clerkGetUser },
    invitations: {
      createInvitation: state.clerkCreate,
      revokeInvitation: state.clerkRevoke,
    },
  },
}));

vi.mock("@workspace/db", () => ({
  db: { insert: state.insert, select: state.select, update: state.update },
  farmMembers: { clerkId: "clerk_id", role: "role", status: "status" },
}));

vi.mock("../lib/farm-access", () => ({
  currentMember: state.currentMember,
  isMaster: state.isMaster,
  requireMember: state.requireMember,
}));

vi.mock("../lib/farm-sheet", () => ({
  migrateSheetTaskAssignee: state.migrateAssignee,
}));

vi.mock("../lib/public-origin", () => ({
  publicOrigin: state.publicOrigin,
}));

import router from "./team";

async function postRevoke(memberId: string): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP port.");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/team/${memberId}/revoke`, { method: "POST" });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function patchMember(memberId: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP port.");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/team/${memberId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function getTeam(): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP port.");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/team`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function getMe(): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(router);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP port.");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/me`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function postResend(memberId: string): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(router);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP port.");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/team/${memberId}/resend`, { method: "POST" });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function postInvite(body: unknown): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP port.");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/team/invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe("GET /me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.authUserId = "user_worker_1";
  });

  it("explains when a signed-in account is not linked to an invitation", async () => {
    state.currentMember.mockResolvedValue(null);

    const response = await getMe();

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      code: "farm_membership_pending",
      error: expect.stringContaining("invited email"),
    });
  });

  it("returns a retryable response when invitation linking fails", async () => {
    state.currentMember.mockRejectedValue(new Error("Sheets unavailable"));

    const response = await getMe();

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      code: "farm_membership_link_failed",
      error: expect.stringContaining("try again"),
    });
  });
});

describe("POST /team/:memberId/resend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.requireMember.mockResolvedValue({ role: "master", status: "active" });
    state.isMaster.mockReturnValue(true);
  });

  it("retires the previous ticket before sending a fresh invitation", async () => {
    const worker = {
      clerkId: "pending:invite-1",
      email: "worker@example.com",
      displayName: "Field worker",
      invitationId: "inv_old",
      role: "worker",
      status: "invited",
    };
    state.select.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([worker]) }),
    });
    state.clerkRevoke.mockResolvedValue({});
    state.clerkCreate.mockResolvedValue({ id: "inv_new" });
    state.update.mockReturnValue({
      set: () => ({ where: () => Promise.resolve() }),
    });

    const response = await postResend(worker.clerkId);

    expect(response.status).toBe(200);
    expect(state.clerkRevoke).toHaveBeenCalledWith("inv_old");
    expect(state.clerkCreate).toHaveBeenCalledAfter(state.clerkRevoke);
    expect(state.clerkCreate).toHaveBeenCalledWith(expect.objectContaining({
      redirectUrl: "https://farm-tasks.replit.app/sign-up",
    }));
    expect(response.body).toEqual({ invitationSent: true, invitationId: "inv_new" });
  });

  it("uses the canonical public origin for the new invitation redirect", async () => {
    vi.stubEnv("FARM_PUBLIC_ORIGIN", "https://planner.example/app");
    state.publicOrigin.mockReturnValue("https://planner.example");
    const worker = {
      clerkId: "pending:invite-1",
      email: "worker@example.com",
      displayName: "Field worker",
      invitationId: "inv_old",
      role: "worker",
      status: "invited",
    };
    state.select.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([worker]) }),
    });
    state.clerkRevoke.mockResolvedValue({});
    state.clerkCreate.mockResolvedValue({ id: "inv_new" });
    state.update.mockReturnValue({
      set: () => ({ where: () => Promise.resolve() }),
    });

    const response = await postResend(worker.clerkId);

    expect(response.status).toBe(200);
    expect(state.clerkCreate).toHaveBeenCalledWith(expect.objectContaining({
      redirectUrl: "https://planner.example/sign-up",
    }));
  });
});

describe("POST /team/invite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("FARM_PUBLIC_ORIGIN", "");
    state.requireMember.mockResolvedValue({ role: "master", status: "active" });
    state.isMaster.mockReturnValue(true);
  });

  it("creates invitations with the canonical public sign-up URL", async () => {
    vi.stubEnv("FARM_PUBLIC_ORIGIN", "https://planner.example/app");
    state.publicOrigin.mockReturnValue("https://planner.example");
    state.clerkCreate.mockResolvedValue({ id: "inv_new" });
    state.insert.mockReturnValue({
      values: () => ({
        returning: () => Promise.resolve([{
          clerkId: "pending:invite-1",
          email: "worker@example.com",
          displayName: "Field worker",
          invitationId: "inv_new",
          role: "worker",
          status: "invited",
        }]),
      }),
    });

    const response = await postInvite({ email: "manager@example.com", displayName: "Second manager", role: "manager" });

    expect(response.status).toBe(201);
    expect(state.clerkCreate).toHaveBeenCalledWith(expect.objectContaining({
      redirectUrl: "https://planner.example/sign-up",
      publicMetadata: expect.objectContaining({ farmRole: "manager" }),
    }));
  });
});

describe("POST /team/:memberId/revoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects workers before changing a pending invitation", async () => {
    state.requireMember.mockResolvedValue({ role: "worker", status: "active" });
    state.isMaster.mockReturnValue(false);

    const response = await postRevoke("pending:invite-1");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Only the farm owner can revoke worker invitations." });
    expect(state.update).not.toHaveBeenCalled();
  });

  it("does not revoke active records", async () => {
    state.requireMember.mockResolvedValue({ role: "master", status: "active" });
    state.isMaster.mockReturnValue(true);
    state.update.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
    });

    const response = await postRevoke("worker-active-1");

    expect(response.status).toBe(404);
    expect(state.and).toHaveBeenCalledWith(
      { column: "clerk_id", value: "worker-active-1" },
      { column: "status", value: "invited" },
    );
    expect(state.clerkRevoke).not.toHaveBeenCalled();
  });

  it("keeps farm access revoked if Clerk invitation cancellation fails", async () => {
    const revoked = {
      clerkId: "pending:invite-1",
      email: "worker@example.com",
      displayName: "Field worker",
      invitationId: "inv_123",
      role: "worker",
      status: "revoked",
    };
    state.requireMember.mockResolvedValue({ role: "master", status: "active" });
    state.isMaster.mockReturnValue(true);
    state.update.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([revoked]),
        }),
      }),
    });
    state.clerkRevoke.mockRejectedValue(new Error("Clerk is unavailable"));

    const response = await postRevoke("pending:invite-1");

    expect(state.clerkRevoke).toHaveBeenCalledWith("inv_123");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      member: revoked,
      invitationRevoked: false,
      warning: expect.stringContaining("Farm access was revoked"),
    });
  });
});

describe("PATCH /team/:memberId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps a worker pending when assignment migration fails", async () => {
    state.requireMember.mockResolvedValue({ role: "master", status: "active" });
    state.isMaster.mockReturnValue(true);
    state.select.mockReturnValue({
      from: () => ({
        where: () => Promise.resolve([{
          clerkId: "pending:invite-1",
          email: "worker@example.com",
          displayName: "Field worker",
          role: "worker",
          status: "invited",
        }]),
      }),
    });
    state.clerkGetUser.mockResolvedValue({
      primaryEmailAddressId: "email-1",
      emailAddresses: [{ id: "email-1", emailAddress: "worker@example.com", verification: { status: "verified" } }],
    });
    state.migrateAssignee.mockRejectedValue(new Error("Sheets unavailable"));

    const response = await patchMember("pending:invite-1", { clerkId: "user_worker_1" });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      error: "Could not migrate this worker's task assignments. The invitation remains pending.",
    });
    expect(state.migrateAssignee).toHaveBeenCalledWith("pending:invite-1", "user_worker_1", "Field worker");
    expect(state.update).not.toHaveBeenCalled();
  });

  it("lets the farm owner update an active worker display name", async () => {
    state.requireMember.mockResolvedValue({ role: "master", status: "active" });
    state.isMaster.mockReturnValue(true);
    const updated = {
      clerkId: "worker-1",
      email: "worker@example.com",
      displayName: "Jason",
      role: "worker",
      status: "active",
    };
    state.update.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([updated]),
        }),
      }),
    });

    const response = await patchMember("worker-1", { displayName: "Jason" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(updated);
    expect(state.update).toHaveBeenCalledOnce();
  });

  it("denies a worker from changing a display name", async () => {
    state.requireMember.mockResolvedValue({ role: "worker", status: "active" });
    state.isMaster.mockReturnValue(false);

    const response = await patchMember("worker-1", { displayName: "Impersonated owner" });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Only the farm owner can manage workers." });
    expect(state.update).not.toHaveBeenCalled();
  });
});

describe("GET /team", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets the farm owner load worker display names", async () => {
    const workers = [{
      clerkId: "worker-1",
      email: "worker@example.com",
      displayName: "Jason",
      role: "worker",
      status: "active",
    }];
    state.requireMember.mockResolvedValue({ role: "master", status: "active" });
    state.isMaster.mockReturnValue(true);
    state.select.mockReturnValue({
      from: () => Promise.resolve(workers),
    });

    const response = await getTeam();

    expect(response.status).toBe(200);
    expect(response.body).toEqual(workers);
  });

  it("does not expose worker display names to a worker", async () => {
    state.requireMember.mockResolvedValue({ role: "worker", status: "active" });
    state.isMaster.mockReturnValue(false);

    const response = await getTeam();

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Only the farm owner can manage workers." });
    expect(state.select).not.toHaveBeenCalled();
  });
});
