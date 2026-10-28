import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export type FarmTaskSubtask = { id: string; title: string; done: boolean };

/** PostgreSQL is the source of truth; Sheets is only a projection/export. */
export const farmTasks = pgTable("farm_tasks", {
  id: text("id").primaryKey(),
  group: text("group").notNull().default("Admin"),
  task: text("task").notNull(),
  done: boolean("done").notNull().default(false),
  urgency: text("urgency").notNull().default("Medium"),
  month: text("month").notNull().default(""),
  location: text("location").notNull().default(""),
  latitude: text("latitude"),
  longitude: text("longitude"),
  locationCapturedAt: text("location_captured_at").notNull().default(""),
  atlasLink: text("atlas_link").notNull().default(""),
  notes: text("notes").notNull().default(""),
  link: text("link").notNull().default(""),
  subtasks: jsonb("subtasks").$type<FarmTaskSubtask[]>().notNull().default([]),
  attachmentIds: jsonb("attachment_ids").$type<string[]>().notNull().default([]),
  source: text("source").notNull().default("Manual"),
  calendarEventId: text("calendar_event_id").notNull().default(""),
  calendarRecurringEventId: text("calendar_recurring_event_id").notNull().default(""),
  calendarStart: text("calendar_start").notNull().default(""),
  scheduledDates: jsonb("scheduled_dates").$type<string[]>().notNull().default([]),
  calendarUpdated: text("calendar_updated").notNull().default(""),
  assigneeId: text("assignee_id").notNull().default(""),
  assigneeName: text("assignee_name").notNull().default(""),
  assigneeIds: jsonb("assignee_ids").$type<string[]>().notNull().default([]),
  assigneeNames: jsonb("assignee_names").$type<string[]>().notNull().default([]),
  recurrence: text("recurrence").notNull().default("none"),
  repeatWeekly: boolean("repeat_weekly").notNull().default(false),
  reviewStatus: text("review_status").notNull().default("approved"),
  submittedById: text("submitted_by_id").notNull().default(""),
  submittedByName: text("submitted_by_name").notNull().default(""),
  reviewNote: text("review_note").notNull().default(""),
  reviewedAt: text("reviewed_at").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("farm_tasks_scheduled_dates_idx").using("gin", table.scheduledDates),
  index("farm_tasks_source_idx").on(table.source),
  uniqueIndex("farm_tasks_calendar_identity_idx").on(table.calendarEventId).where(sql`${table.calendarEventId} <> ''`),
]);

export const farmTaskCompletionEvents = pgTable("farm_task_completion_events", {
  eventId: text("event_id").primaryKey(),
  taskId: text("task_id").notNull(),
  taskTitle: text("task_title").notNull(),
  scheduledDate: text("scheduled_date").notNull().default(""),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
  completedById: text("completed_by_id").notNull().default(""),
  completedByName: text("completed_by_name").notNull().default(""),
  group: text("group").notNull().default(""),
  location: text("location").notNull().default(""),
  source: text("source").notNull().default("Manual"),
  recurrence: text("recurrence").notNull().default("none"),
  assigneeIds: jsonb("assignee_ids").$type<string[]>().notNull().default([]),
  assigneeNames: jsonb("assignee_names").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("farm_task_completion_task_idx").on(table.taskId)]);

export const farmTaskMutationReceipts = pgTable("farm_task_mutation_receipts", {
  operationId: text("operation_id").notNull(),
  memberId: text("member_id").notNull(),
  operationKind: text("operation_kind").notNull(),
  taskId: text("task_id").notNull(),
  response: jsonb("response").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("farm_task_mutation_receipt_key").on(table.operationId, table.memberId, table.operationKind, table.taskId)]);

export const farmTaskSheetOutbox = pgTable("farm_task_sheet_outbox", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  operation: text("operation").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error").notNull().default(""),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
}, (table) => [
  index("farm_task_sheet_outbox_status_idx").on(table.status, table.nextAttemptAt),
  index("farm_task_sheet_outbox_task_order_idx").on(table.taskId, table.createdAt, table.id),
]);

export const farmTaskStorageState = pgTable("farm_task_storage_state", {
  key: text("key").primaryKey(),
  version: text("version").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type FarmTask = typeof farmTasks.$inferSelect;
export type FarmTaskCompletionEvent = typeof farmTaskCompletionEvents.$inferSelect;