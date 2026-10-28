import { beforeEach, describe, expect, it, vi } from "vitest";
import { publicOrigin } from "./public-origin";

describe("public origin", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FARM_PUBLIC_ORIGIN", "");
    vi.stubEnv("REPLIT_DOMAINS", "");
    vi.stubEnv("REPLIT_INTERNAL_APP_DOMAIN", "");
    vi.stubEnv("REPLIT_DEV_DOMAIN", "");
  });

  it("uses the configured canonical origin instead of forwarded host headers", () => {
    vi.stubEnv("FARM_PUBLIC_ORIGIN", "https://planner.example/app");
    const req = {
      protocol: "https",
      header: (name: string) => name === "x-forwarded-host" ? "attacker.example" : undefined,
      get: () => "attacker.example",
    };

    expect(publicOrigin(req as never)).toBe("https://planner.example");
  });

  it("uses the configured Replit deployment domain as an HTTPS origin", () => {
    vi.stubEnv("REPLIT_DOMAINS", "farm-tasks.replit.app, farm.example");

    expect(publicOrigin({} as never)).toBe("https://farm-tasks.replit.app");
  });

  it("does not trust a request host in production without a canonical origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    const req = {
      protocol: "https",
      header: () => "attacker.example",
      get: () => "attacker.example",
    };

    expect(() => publicOrigin(req as never)).toThrow("canonical public origin");
  });
});