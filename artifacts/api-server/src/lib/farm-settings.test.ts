import { describe, expect, it } from "vitest";
import { resolveDefaultLocation } from "./farm-settings";

describe("farm settings defaults", () => {
  it("preserves an explicit no-default location selection", () => {
    expect(resolveDefaultLocation(["North block", "South block"], "")).toBe("");
  });

  it("falls back when the selected location was removed", () => {
    expect(resolveDefaultLocation(["North block"], "South block")).toBe("North block");
  });
});