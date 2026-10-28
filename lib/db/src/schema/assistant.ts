import { boolean, date, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { farmMembers } from "./farm-members";

export const assistantSourceItems = pgTable("assistant_source_items", {
  id: serial("id").primaryKey(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  recurringId: text("recurring_id").notNull().default(""),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  sourceUrl: text("source_url").notNull().default(""),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  fingerprint: text("fingerprint").notNull().unique(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("assistant_source_items_source_idx").on(table.sourceType, table.sourceId),
  index("assistant_source_items_starts_idx").on(table.startsAt),
]);

export const assistantProposals = pgTable("assistant_proposals", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  status: text("status").notNull().default("pending"),
  requesterId: text("requester_id"),
  requesterName: text("requester_name").notNull().default(""),
  sourceFingerprint: text("source_fingerprint").notNull().unique(),
  sourceItems: jsonb("source_items").$type<Array<{
    sourceType: string;
    sourceId: string;
    title: string;
    sourceUrl: string;
    recurringId?: string;
    mailbox?: string;
    originLabel?: string;
    calendarId?: string;
    calendarName?: string;
    originalSender?: string;
    forwardedBy?: string;
  }>>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [index("assistant_proposals_status_idx").on(table.status)]);

export const assistantProposalTasks = pgTable("assistant_proposal_tasks", {
  id: serial("id").primaryKey(),
  proposalId: integer("proposal_id").notNull().references(() => assistantProposals.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  rationale: text("rationale").notNull().default(""),
  dueDate: date("due_date", { mode: "string" }),
  urgency: text("urgency").notNull().default("Medium"),
  groupName: text("group_name").notNull().default("Farm work"),
  proposedCategory: text("proposed_category"),
  notes: text("notes").notNull().default(""),
  sourceLink: text("source_link").notNull().default(""),
  sourceType: text("source_type").notNull().default(""),
  sourceId: text("source_id").notNull().default(""),
  confidence: integer("confidence").notNull().default(0),
  assumptions: jsonb("assumptions").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("pending"),
  approvedTaskId: text("approved_task_id"),
  matchedRuleId: integer("matched_rule_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("assistant_proposal_tasks_proposal_idx").on(table.proposalId),
  index("assistant_proposal_tasks_status_idx").on(table.status),
]);

export const assistantApprovalRules = pgTable("assistant_approval_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  matchType: text("match_type").notNull(),
  matchValue: text("match_value").notNull(),
  scopeDescription: text("scope_description").notNull(),
  taskTemplate: jsonb("task_template").$type<{ title: string; groupName: string; urgency: string; dueDate: string | null; notes: string }>().notNull().default({ title: "", groupName: "", urgency: "Medium", dueDate: null, notes: "" }),
  active: boolean("active").notNull().default(true),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [index("assistant_approval_rules_active_idx").on(table.active)]);

export const assistantAuditEvents = pgTable("assistant_audit_events", {
  id: serial("id").primaryKey(),
  proposalTaskId: integer("proposal_task_id").references(() => assistantProposalTasks.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  actorId: text("actor_id").notNull(),
  ruleId: integer("rule_id"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("assistant_audit_events_task_idx").on(table.proposalTaskId)]);

export const assistantSettings = pgTable("assistant_settings", {
  id: serial("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  lookaheadDays: integer("lookahead_days").notNull().default(45),
  playbook: text("playbook").notNull().default(""),
  lastScanAt: timestamp("last_scan_at", { withTimezone: true }),
  lastError: text("last_error").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const assistantOAuthCredentials = pgTable("assistant_oauth_credentials", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  tokenType: text("token_type").notNull(),
  clientId: text("client_id").notNull(),
  redirectUri: text("redirect_uri").notNull().default(""),
  codeChallenge: text("code_challenge").notNull().default(""),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("assistant_oauth_credentials_member_idx").on(table.clerkId),
  index("assistant_oauth_credentials_expiry_idx").on(table.expiresAt),
]);

export const insertAssistantProposalSchema = createInsertSchema(assistantProposals).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAssistantProposalTaskSchema = createInsertSchema(assistantProposalTasks).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAssistantApprovalRuleSchema = createInsertSchema(assistantApprovalRules).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAssistantAuditEventSchema = createInsertSchema(assistantAuditEvents).omit({ id: true, createdAt: true });
export const insertAssistantSettingsSchema = createInsertSchema(assistantSettings).omit({ id: true, updatedAt: true });

export type AssistantSourceItem = typeof assistantSourceItems.$inferSelect;
export type AssistantProposal = typeof assistantProposals.$inferSelect;
export type AssistantProposalTask = typeof assistantProposalTasks.$inferSelect;
export type AssistantApprovalRule = typeof assistantApprovalRules.$inferSelect;
export type AssistantAuditEvent = typeof assistantAuditEvents.$inferSelect;
export type AssistantSettings = typeof assistantSettings.$inferSelect;
export type AssistantOAuthCredential = typeof assistantOAuthCredentials.$inferSelect;
export type InsertAssistantProposal = z.infer<typeof insertAssistantProposalSchema>;
export type InsertAssistantProposalTask = z.infer<typeof insertAssistantProposalTaskSchema>;
export type InsertAssistantApprovalRule = z.infer<typeof insertAssistantApprovalRuleSchema>;
export type InsertAssistantAuditEvent = z.infer<typeof insertAssistantAuditEventSchema>;
export type InsertAssistantSettings = z.infer<typeof insertAssistantSettingsSchema>;