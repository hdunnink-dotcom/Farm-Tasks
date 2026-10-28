import { eq } from "drizzle-orm";
import { db, farmSettings } from "@workspace/db";

export const DEFAULT_FARM_GROUPS = [
  "Orchards", "Planting", "Gullies", "Repair", "Trapping", "Admin", "Yurts", "Meat", "Pommeu",
];

export type FarmSettingsValue = {
  id: number;
  groups: string[];
  locations: string[];
  defaultGroup: string;
  defaultUrgency: "Urgent" | "High" | "Medium" | "Low";
  defaultLocation: string;
  updatedAt: string;
};

function normalizeList(values: unknown, fallback: string[]): string[] {
  if (!Array.isArray(values)) return fallback;
  return Array.from(new Set(values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean)));
}

export function resolveDefaultLocation(locations: string[], requested: string): string {
  const value = requested.trim();
  if (!value) return "";
  return locations.includes(value) ? value : locations[0] ?? "";
}

function toSettings(row: typeof farmSettings.$inferSelect): FarmSettingsValue {
  const groups = normalizeList(row.groups, DEFAULT_FARM_GROUPS);
  return {
    id: row.id,
    groups: groups.length ? groups : DEFAULT_FARM_GROUPS,
    locations: normalizeList(row.locations, []),
    defaultGroup: groups.includes(row.defaultGroup) ? row.defaultGroup : groups[0]!,
    defaultUrgency: row.defaultUrgency === "Urgent" || row.defaultUrgency === "High" || row.defaultUrgency === "Low"
      ? row.defaultUrgency
      : "Medium",
    defaultLocation: row.defaultLocation.trim(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getFarmSettings(): Promise<FarmSettingsValue> {
  const [existing] = await db.select().from(farmSettings).where(eq(farmSettings.id, 1));
  if (existing) return toSettings(existing);
  const [created] = await db.insert(farmSettings).values({ id: 1 }).returning();
  if (!created) throw new Error("Could not initialize farm settings.");
  return toSettings(created);
}

export async function updateFarmSettings(input: {
  groups?: string[];
  locations?: string[];
  defaultGroup?: string;
  defaultUrgency?: "Urgent" | "High" | "Medium" | "Low";
  defaultLocation?: string;
}): Promise<FarmSettingsValue> {
  const current = await getFarmSettings();
  const groups = normalizeList(input.groups, current.groups);
  const locations = normalizeList(input.locations, current.locations);
  const defaultGroup = input.defaultGroup ?? current.defaultGroup;
  if (!groups.includes(defaultGroup)) throw new Error("The default group must be one of the saved groups.");
  const requestedDefaultLocation = input.defaultLocation?.trim() ?? current.defaultLocation;
  const defaultLocation = resolveDefaultLocation(locations, requestedDefaultLocation);
  const [updated] = await db.insert(farmSettings).values({
    id: 1,
    groups,
    locations,
    defaultGroup,
    defaultUrgency: input.defaultUrgency ?? current.defaultUrgency,
    defaultLocation,
  }).onConflictDoUpdate({
    target: farmSettings.id,
    set: {
      groups,
      locations,
      defaultGroup,
      defaultUrgency: input.defaultUrgency ?? current.defaultUrgency,
      defaultLocation,
      updatedAt: new Date(),
    },
  }).returning();
  if (!updated) throw new Error("Could not save farm settings.");
  return toSettings(updated);
}