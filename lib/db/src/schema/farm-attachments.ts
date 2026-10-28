import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const farmAttachments = pgTable(
  "farm_attachments",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    ownerId: text("owner_id").notNull(),
    objectPath: text("object_path").notNull().unique(),
    storageProvider: text("storage_provider").notNull().default("app_storage"),
    driveFileId: text("drive_file_id").unique(),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("farm_attachments_task_id_idx").on(table.taskId),
    index("farm_attachments_owner_id_idx").on(table.ownerId),
  ],
);

export const insertFarmAttachmentSchema = createInsertSchema(farmAttachments).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertFarmAttachment = z.infer<typeof insertFarmAttachmentSchema>;
export type FarmAttachmentRecord = typeof farmAttachments.$inferSelect;