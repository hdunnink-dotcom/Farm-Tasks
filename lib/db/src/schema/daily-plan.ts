import { boolean, date, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type DailyPlanItemRecord = {
  taskId: string;
  title: string;
  category: string;
  urgency: string;
  month: string;
  reason: "overdue" | "today" | "current_month";
  rank: number;
};

export type DailyPlanGroupRecord = {
  name: string;
  items: DailyPlanItemRecord[];
};

export const dailyPlanSnapshots = pgTable("daily_plan_snapshots", {
  id: serial("id").primaryKey(),
  planDate: date("plan_date", { mode: "string" }).notNull(),
  timezone: text("timezone").notNull(),
  status: text("status").notNull().default("generating"),
  groups: jsonb("groups").$type<DailyPlanGroupRecord[]>().notNull().default([]),
  taskCount: integer("task_count").notNull().default(0),
  generatedBy: text("generated_by").notNull().default("deterministic"),
  error: text("error").notNull().default(""),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  generatedAt: timestamp("generated_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [uniqueIndex("daily_plan_snapshots_date_idx").on(table.planDate)]);

export const dailyPlanSettings = pgTable("daily_plan_settings", {
  id: serial("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  timezone: text("timezone").notNull().default("Pacific/Auckland"),
  runAtLocal: text("run_at_local").notNull().default("06:00"),
  maxTasks: integer("max_tasks").notNull().default(40),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDailyPlanSnapshotSchema = createInsertSchema(dailyPlanSnapshots).omit({ id: true, updatedAt: true });
export const insertDailyPlanSettingsSchema = createInsertSchema(dailyPlanSettings).omit({ id: true, updatedAt: true });
export type DailyPlanSnapshot = typeof dailyPlanSnapshots.$inferSelect;
export type DailyPlanSetting = typeof dailyPlanSettings.$inferSelect;
export type InsertDailyPlanSnapshot = z.infer<typeof insertDailyPlanSnapshotSchema>;
export type InsertDailyPlanSettings = z.infer<typeof insertDailyPlanSettingsSchema>;