export const CANONICAL_TASK_CATEGORIES = [
  "Orchards",
  "Planting",
  "Gullies",
  "Repair",
  "Trapping",
  "Admin",
  "Yurts",
  "Meat",
  "Pommeu",
] as const;

export type TaskCategory = string;

const aliases = new Map<string, TaskCategory>([
  ["orchard", "Orchards"],
  ["orchards", "Orchards"],
  ["orchard management", "Orchards"],
  ["plant", "Planting"],
  ["planting", "Planting"],
  ["pasture management", "Planting"],
  ["gully", "Gullies"],
  ["gullies", "Gullies"],
  ["maintenance", "Repair"],
  ["property maintenance", "Repair"],
  ["repairs", "Repair"],
  ["repair", "Repair"],
  ["trap", "Trapping"],
  ["pest control", "Trapping"],
  ["trapping", "Trapping"],
  ["administration", "Admin"],
  ["compliance", "Admin"],
  ["classroom bookings", "Admin"],
  ["wwoofers", "Admin"],
  ["farm work", "Admin"],
  ["admin", "Admin"],
  ["yurt", "Yurts"],
  ["yurts", "Yurts"],
  ["meat", "Meat"],
  ["pommeau", "Pommeu"],
  ["pommeu", "Pommeu"],
]);

export function canonicalTaskCategory(value: unknown): TaskCategory | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/\s+/g, " ");
  return aliases.get(key) ?? null;
}

/** Canonical aliases are normalized while configured or legacy custom groups are preserved. */
export function normalizeTaskCategory(value: unknown): TaskCategory {
  return canonicalTaskCategory(value) ?? "Admin";
}

export function normalizeConfiguredTaskCategory(value: unknown): TaskCategory {
  return canonicalTaskCategory(value) ?? (typeof value === "string" && value.trim() ? value.trim() : "Admin");
}