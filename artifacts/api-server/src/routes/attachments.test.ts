import { describe, expect, it } from "vitest";
import router from "./attachments";

describe("attachment routes", () => {
  it("registers the Drive upload endpoint exactly once during router setup", () => {
    const stack = (router as unknown as {
      stack: Array<{ route?: { path?: string; methods?: Record<string, boolean> } }>;
    }).stack;
    const uploadRoutes = stack.filter((layer) =>
      layer.route?.path === "/attachments/:attachmentId/upload"
      && layer.route.methods?.put,
    );

    expect(uploadRoutes).toHaveLength(1);
  });
});