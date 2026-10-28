import { jsonb, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const farmSettings = pgTable("farm_settings", {
  id: integer("id").primaryKey().default(1),
  groups: jsonb("groups").$type<string[]>().notNull().default([
    "Orchards", "Planting", "Gullies", "Repair", "Trapping", "Admin", "Yurts", "Meat", "Pommeu",
  ]),
  locations: jsonb("locations").$type<string[]>().notNull().default([]),
  defaultGroup: text("default_group").notNull().default("Orchards"),
  defaultUrgency: text("default_urgency").notNull().default("Medium"),
  defaultLocation: text("default_location").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type FarmSettings = typeof farmSettings.$inferSelect;