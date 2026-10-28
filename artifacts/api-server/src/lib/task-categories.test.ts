import { describe, expect, it } from "vitest";
import { CANONICAL_TASK_CATEGORIES, canonicalTaskCategory, normalizeTaskCategory } from "./task-categories";

describe("task categories", () => {
  it("publishes only the canonical category vocabulary", () => {
    expect(CANONICAL_TASK_CATEGORIES).toEqual([
      "Orchards", "Planting", "Gullies", "Repair", "Trapping", "Admin", "Yurts", "Meat", "Pommeu",
    ]);
  });

  it("safely normalizes legacy spelling and groups", () => {
    expect(normalizeTaskCategory(" Orchard Management ")).toBe("Orchards");
    expect(normalizeTaskCategory("Property maintenance")).toBe("Repair");
    expect(normalizeTaskCategory("Pommeau")).toBe("Pommeu");
    expect(normalizeTaskCategory("unknown legacy group")).toBe("Admin");
    expect(canonicalTaskCategory("unknown legacy group")).toBeNull();
  });
});