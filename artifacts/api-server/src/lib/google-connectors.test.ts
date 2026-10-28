import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, googleConnection: {} }));

describe("google connectors", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_TOKEN_ENCRYPTION_KEY", "unit-test-key");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client-id.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "client-secret");
  });

  it("encrypts refresh tokens so they round-trip but are not stored in plain text", async () => {
    const { encryptSecret, decryptSecret } = await import("./google-connectors");
    const sealed = encryptSecret("1//refresh-token");
    expect(sealed).not.toContain("refresh-token");
    expect(decryptSecret(sealed)).toBe("1//refresh-token");
  });

  it("rejects a tampered or foreign connect state", async () => {
    const { createConnectState, verifyConnectState } = await import("./google-connectors");
    const state = createConnectState("user_123");
    expect(verifyConnectState(state)).toEqual({ clerkId: "user_123" });
    expect(verifyConnectState(`${state}x`)).toBeNull();
    expect(verifyConnectState("abc.def")).toBeNull();
  });

  it("asks Google for offline access to Sheets, Calendar, Drive and Gmail", async () => {
    const { googleAuthUrl } = await import("./google-connectors");
    const url = new URL(googleAuthUrl({
      redirectUri: "https://example.run.app/api/google/oauth/callback",
      state: "s",
      loginHint: "harnold@hirshberginstitute.com",
    }));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("login_hint")).toBe("harnold@hirshberginstitute.com");
    const scope = url.searchParams.get("scope") ?? "";
    for (const part of ["spreadsheets", "calendar.readonly", "auth/drive", "gmail.readonly"]) expect(scope).toContain(part);
  });
});
