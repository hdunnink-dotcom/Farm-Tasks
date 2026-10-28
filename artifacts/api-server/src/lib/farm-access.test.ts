import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getUser: vi.fn(),
  migrateAssignee: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ conditions }),
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: state.getUser } },
  getAuth: () => ({ userId: "user_worker_1" }),
}));

vi.mock("@workspace/db", () => ({
  db: { select: state.select, update: state.update },
  farmMembers: { clerkId: "clerk_id", role: "role", status: "status" },
}));

vi.mock("./farm-sheet", () => ({
  migrateSheetTaskAssignee: state.migrateAssignee,
}));

describe("farm access invitation linking", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("FARM_AUTH_DISABLED", "false");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FARM_MASTER_CLERK_USER_ID", "");
    state.getUser.mockReset();
    state.migrateAssignee.mockReset();
    state.select.mockReset();
    state.update.mockReset();
  });

  it("links and activates an invited worker using their verified primary email", async () => {
    const invited = {
      clerkId: "pending:invite-1",
      email: "Worker@Example.com",
      displayName: "Field worker",
      role: "worker",
      status: "invited",
    };
    const linked = { ...invited, clerkId: "user_worker_1", status: "active" };

    state.getUser.mockResolvedValue({
      primaryEmailAddressId: "email-1",
      emailAddresses: [
        { id: "email-1", emailAddress: "worker@example.com", verification: { status: "verified" } },
      ],
    });
    state.select
      .mockReturnValueOnce({
        from: () => ({ where: () => Promise.resolve([]) }),
      })
      .mockReturnValueOnce({
        from: () => ({ where: () => Promise.resolve([invited]) }),
      })
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([{ clerkId: "owner-1", role: "master", status: "active" }]) }) }),
      });
    state.update.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([linked]),
        }),
      }),
    });

    const { currentMember } = await import("./farm-access");
    await expect(currentMember({} as never)).resolves.toEqual(linked);
    expect(state.getUser).toHaveBeenCalledWith("user_worker_1");
    expect(state.migrateAssignee).toHaveBeenCalledWith("pending:invite-1", "user_worker_1", "Field worker");
    expect(state.update).toHaveBeenCalledOnce();
  });

  it("leaves the invitation pending when assignment migration fails", async () => {
    const invited = {
      clerkId: "pending:invite-1", email: "worker@example.com", displayName: "Field worker", role: "worker", status: "invited",
    };
    state.getUser.mockResolvedValue({
      primaryEmailAddressId: "email-1",
      emailAddresses: [{ id: "email-1", emailAddress: "worker@example.com", verification: { status: "verified" } }],
    });
    state.select
      .mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve([]) }) })
      .mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve([invited]) }) });
    state.migrateAssignee.mockRejectedValue(new Error("Sheets unavailable"));

    const { currentMember } = await import("./farm-access");
    await expect(currentMember({} as never)).rejects.toThrow("Sheets unavailable");
    expect(state.update).not.toHaveBeenCalled();
  });

  it("does not link an account when the matching email is unverified", async () => {
    state.getUser.mockResolvedValue({
      primaryEmailAddressId: "email-1",
      emailAddresses: [
        { id: "email-1", emailAddress: "worker@example.com", verification: { status: "unverified" } },
      ],
    });
    state.select
      .mockReturnValueOnce({
        from: () => ({ where: () => Promise.resolve([]) }),
      })
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([{ clerkId: "owner-1" }]) }) }),
      });

    const { currentMember } = await import("./farm-access");
    await expect(currentMember({} as never)).resolves.toBeNull();
    expect(state.update).not.toHaveBeenCalled();
  });

  it("does not activate an invitation that was revoked after the invitation lookup", async () => {
    const invited = {
      clerkId: "pending:invite-1",
      email: "worker@example.com",
      displayName: "Field worker",
      role: "worker",
      status: "invited",
    };
    state.getUser.mockResolvedValue({
      primaryEmailAddressId: "email-1",
      emailAddresses: [
        { id: "email-1", emailAddress: "worker@example.com", verification: { status: "verified" } },
      ],
    });
    state.select
      .mockReturnValueOnce({
        from: () => ({ where: () => Promise.resolve([]) }),
      })
      .mockReturnValueOnce({
        from: () => ({ where: () => Promise.resolve([invited]) }),
      })
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([{ clerkId: "owner-1" }]) }) }),
      });
    state.update.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
    });

    const { currentMember } = await import("./farm-access");
    await expect(currentMember({} as never)).resolves.toBeNull();
    expect(state.update).toHaveBeenCalledOnce();
  });

  it("promotes the first active account when no farm owner exists", async () => {
    const existing = {
      clerkId: "user_worker_1",
      email: "owner@example.com",
      displayName: "Farm owner",
      role: "worker",
      status: "active",
    };
    const promoted = { ...existing, role: "master" };
    state.select
      .mockReturnValueOnce({
        from: () => ({ where: () => Promise.resolve([existing]) }),
      })
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
      });
    state.update.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([promoted]),
        }),
      }),
    });

    const { currentMember } = await import("./farm-access");
    await expect(currentMember({} as never)).resolves.toEqual(promoted);
    expect(state.update).toHaveBeenCalledOnce();
  });

  it("does not bootstrap an arbitrary active account as owner in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const existing = {
      clerkId: "user_worker_1",
      email: "worker@example.com",
      displayName: "Field worker",
      role: "worker",
      status: "active",
    };
    state.select.mockReturnValueOnce({
      from: () => ({ where: () => Promise.resolve([existing]) }),
    });

    const { currentMember } = await import("./farm-access");
    await expect(currentMember({} as never)).resolves.toEqual(existing);
    expect(state.update).not.toHaveBeenCalled();
  });

  it("promotes only the configured owner account", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FARM_MASTER_CLERK_USER_ID", "user_worker_1");
    const existing = {
      clerkId: "user_worker_1",
      email: "owner@example.com",
      displayName: "Farm owner",
      role: "worker",
      status: "active",
    };
    const promoted = { ...existing, role: "master" };
    state.select
      .mockReturnValueOnce({
        from: () => ({ where: () => Promise.resolve([existing]) }),
      });
    state.update.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([promoted]),
        }),
      }),
    });

    const { currentMember, isHarnold } = await import("./farm-access");
    const member = await currentMember({} as never);
    expect(member).toEqual(promoted);
    // currentMember bootstraps before /me and review routes expose Harnold.
    expect(isHarnold(member)).toBe(true);
    expect(state.update).toHaveBeenCalledOnce();
  });

  it("does not treat a different stored master as owner when one is configured", async () => {
    vi.stubEnv("FARM_MASTER_CLERK_USER_ID", "configured-owner");
    const { isMaster } = await import("./farm-access");

    expect(isMaster({
      clerkId: "later-account",
      role: "master",
      status: "active",
    } as never)).toBe(false);
  });
});