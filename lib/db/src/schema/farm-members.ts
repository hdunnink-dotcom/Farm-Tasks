import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const farmMembers = pgTable("farm_members", {
  clerkId: text("clerk_id").primaryKey(),
  email: text("email").notNull().default(""),
  displayName: text("display_name").notNull().default(""),
  invitationId: text("invitation_id"),
  role: text("role").notNull().default("worker"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [index("farm_members_status_idx").on(table.status)]);

export type FarmMember = typeof farmMembers.$inferSelect;