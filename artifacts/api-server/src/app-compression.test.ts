import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const staticDir = mkdtempSync(path.join(tmpdir(), "farm-web-"));
writeFileSync(path.join(staticDir, "index.html"), `<!doctype html><title>Farm</title>${"<p>Fieldbook</p>".repeat(400)}`);
vi.stubEnv("STATIC_DIR", staticDir);
vi.stubEnv("CLERK_PUBLISHABLE_KEY", "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k");
vi.stubEnv("CLERK_SECRET_KEY", "sk_test_placeholder");

let server: import("node:http").Server;
let base = "";

beforeAll(async () => {
  const { default: app } = await import("./app");
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
});

describe("response compression", () => {
  it("gzips the web app for browsers that accept it", async () => {
    const response = await fetch(`${base}/`, { headers: { "Accept-Encoding": "gzip" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(await response.text()).toContain("Fieldbook");
  });
});
