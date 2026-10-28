import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const state = vi.hoisted(() => ({
  credential: null as Record<string, unknown> | null,
  inserts: [] as unknown[],
  updates: [] as unknown[],
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ conditions }),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  isNull: (column: unknown) => ({ column }),
}));

vi.mock("@workspace/db", () => ({
  assistantOAuthCredentials: {
    id: "id",
    tokenHash: "token_hash",
    usedAt: "used_at",
    revokedAt: "revoked_at",
  },
  db: {
    select: state.select,
    insert: state.insert,
    update: state.update,
  },
}));

function configureDatabase() {
  state.select.mockReturnValue({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(state.credential ? [state.credential] : []),
      }),
    }),
  });
  state.insert.mockReturnValue({
    values: async (values: unknown) => {
      state.inserts.push(values);
    },
  });
  state.update.mockReturnValue({
    set: (values: unknown) => {
      state.updates.push(values);
      return {
        where: () => ({
          returning: async () => [{ id: 1 }],
        }),
      };
    },
  });
}

function createPkcePair(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

describe("Claude connector OAuth credentials", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("FARM_OAUTH_CLIENT_SECRET", "test-registration-secret");
    state.credential = null;
    state.inserts = [];
    state.updates = [];
    state.select.mockReset();
    state.insert.mockReset();
    state.update.mockReset();
    configureDatabase();
  });

  it("binds a dynamically registered client to its exact redirect URI", async () => {
    const {
      createRegisteredClientId,
      isRegisteredRedirectUri,
    } = await import("./claude-connector-oauth");
    const clientId = createRegisteredClientId([
      "https://claude.ai/api/mcp/auth_callback",
      "https://claude.ai/api/mcp/second_callback",
    ]);

    expect(clientId).toBeTruthy();
    expect(isRegisteredRedirectUri(
      clientId!,
      "https://claude.ai/api/mcp/auth_callback",
    )).toBe(true);
    expect(isRegisteredRedirectUri(
      clientId!,
      "https://claude.ai/api/mcp/auth_callback/",
    )).toBe(false);
    expect(isRegisteredRedirectUri(
      clientId!,
      "https://attacker.example/callback",
    )).toBe(false);
  });

  it("rejects tampered dynamic client registration data", async () => {
    const {
      createRegisteredClientId,
      isRegisteredRedirectUri,
    } = await import("./claude-connector-oauth");
    const clientId = createRegisteredClientId(["https://claude.ai/callback"])!;
    const tampered = `${clientId.slice(0, -1)}${clientId.endsWith("a") ? "b" : "a"}`;

    expect(isRegisteredRedirectUri(tampered, "https://claude.ai/callback")).toBe(false);
  });

  it("keeps the legacy published Claude client id compatible", async () => {
    const {
      isRegisteredRedirectUri,
      LEGACY_CLAUDE_CLIENT_ID,
    } = await import("./claude-connector-oauth");

    expect(isRegisteredRedirectUri(
      LEGACY_CLAUDE_CLIENT_ID,
      "https://claude.ai/api/mcp/auth_callback",
    )).toBe(true);
    expect(isRegisteredRedirectUri(
      LEGACY_CLAUDE_CLIENT_ID,
      "https://attacker.example/callback",
    )).toBe(false);
  });

  it("exchanges a valid S256 authorization code once and creates short-lived access plus refresh tokens", async () => {
    const verifier = "v".repeat(48);
    state.credential = {
      id: 12,
      clerkId: "owner-1",
      tokenType: "authorization_code",
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      clientId: "farm-planner-claude",
      redirectUri: "https://claude.example/callback",
      codeChallenge: createPkcePair(verifier),
    };

    const { exchangeAuthorizationCode } = await import("./claude-connector-oauth");
    const result = await exchangeAuthorizationCode({
      code: "authorization-code",
      codeVerifier: verifier,
      clientId: "farm-planner-claude",
      redirectUri: "https://claude.example/callback",
    });

    expect(result?.expiresIn).toBe(3600);
    expect(result?.accessToken).toBeTruthy();
    expect(result?.refreshToken).toBeTruthy();
    expect(result?.accessToken).not.toBe(result?.refreshToken);
    expect(state.updates).toEqual([{ usedAt: expect.any(Date) }]);
    expect(state.inserts).toHaveLength(1);
  });

  it("rejects a code with the wrong PKCE verifier before it can be consumed", async () => {
    state.credential = {
      id: 12,
      clerkId: "owner-1",
      tokenType: "authorization_code",
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      clientId: "farm-planner-claude",
      redirectUri: "https://claude.example/callback",
      codeChallenge: createPkcePair("a".repeat(48)),
    };

    const { exchangeAuthorizationCode } = await import("./claude-connector-oauth");
    await expect(exchangeAuthorizationCode({
      code: "authorization-code",
      codeVerifier: "b".repeat(48),
      clientId: "farm-planner-claude",
      redirectUri: "https://claude.example/callback",
    })).resolves.toBeNull();
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it("rotates a refresh token and prevents the original record from being reused", async () => {
    state.credential = {
      id: 99,
      clerkId: "owner-1",
      tokenType: "refresh_token",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      clientId: "farm-planner-claude",
      redirectUri: "https://claude.example/callback",
    };

    const { rotateRefreshToken } = await import("./claude-connector-oauth");
    const result = await rotateRefreshToken({
      refreshToken: "refresh-token",
      clientId: "farm-planner-claude",
    });

    expect(result?.expiresIn).toBe(3600);
    expect(state.updates).toEqual([{ revokedAt: expect.any(Date), usedAt: expect.any(Date) }]);
    expect(state.inserts).toHaveLength(1);
  });
});