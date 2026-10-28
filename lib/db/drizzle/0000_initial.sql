CREATE TABLE "farm_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"object_path" text NOT NULL,
	"storage_provider" text DEFAULT 'app_storage' NOT NULL,
	"drive_file_id" text,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "farm_attachments_object_path_unique" UNIQUE("object_path"),
	CONSTRAINT "farm_attachments_drive_file_id_unique" UNIQUE("drive_file_id")
);
--> statement-breakpoint
CREATE TABLE "farm_members" (
	"clerk_id" text PRIMARY KEY NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"invitation_id" text,
	"role" text DEFAULT 'worker' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_approval_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"match_type" text NOT NULL,
	"match_value" text NOT NULL,
	"scope_description" text NOT NULL,
	"task_template" jsonb DEFAULT '{"title":"","groupName":"","urgency":"Medium","dueDate":null,"notes":""}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"proposal_task_id" integer,
	"action" text NOT NULL,
	"actor_id" text NOT NULL,
	"rule_id" integer,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_oauth_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_type" text NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text DEFAULT '' NOT NULL,
	"code_challenge" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_oauth_credentials_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "assistant_proposal_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"proposal_id" integer NOT NULL,
	"title" text NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"due_date" date,
	"urgency" text DEFAULT 'Medium' NOT NULL,
	"group_name" text DEFAULT 'Farm work' NOT NULL,
	"proposed_category" text,
	"notes" text DEFAULT '' NOT NULL,
	"source_link" text DEFAULT '' NOT NULL,
	"source_type" text DEFAULT '' NOT NULL,
	"source_id" text DEFAULT '' NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_task_id" text,
	"matched_rule_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requester_id" text,
	"requester_name" text DEFAULT '' NOT NULL,
	"source_fingerprint" text NOT NULL,
	"source_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_proposals_source_fingerprint_unique" UNIQUE("source_fingerprint")
);
--> statement-breakpoint
CREATE TABLE "assistant_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"lookahead_days" integer DEFAULT 45 NOT NULL,
	"playbook" text DEFAULT '' NOT NULL,
	"last_scan_at" timestamp with time zone,
	"last_error" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_source_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"recurring_id" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"source_url" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone,
	"fingerprint" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_source_items_fingerprint_unique" UNIQUE("fingerprint")
);
--> statement-breakpoint
CREATE TABLE "daily_plan_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"timezone" text DEFAULT 'Pacific/Auckland' NOT NULL,
	"run_at_local" text DEFAULT '06:00' NOT NULL,
	"max_tasks" integer DEFAULT 40 NOT NULL,
	"last_run_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_plan_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_date" date NOT NULL,
	"timezone" text NOT NULL,
	"status" text DEFAULT 'generating' NOT NULL,
	"groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"task_count" integer DEFAULT 0 NOT NULL,
	"generated_by" text DEFAULT 'deterministic' NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "farm_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"groups" jsonb DEFAULT '["Orchards","Planting","Gullies","Repair","Trapping","Admin","Yurts","Meat","Pommeu"]'::jsonb NOT NULL,
	"locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_group" text DEFAULT 'Orchards' NOT NULL,
	"default_urgency" text DEFAULT 'Medium' NOT NULL,
	"default_location" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "farm_task_completion_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"task_title" text NOT NULL,
	"scheduled_date" text DEFAULT '' NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"completed_by_id" text DEFAULT '' NOT NULL,
	"completed_by_name" text DEFAULT '' NOT NULL,
	"group" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'Manual' NOT NULL,
	"recurrence" text DEFAULT 'none' NOT NULL,
	"assignee_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assignee_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "farm_task_mutation_receipts" (
	"operation_id" text NOT NULL,
	"member_id" text NOT NULL,
	"operation_kind" text NOT NULL,
	"task_id" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "farm_task_sheet_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"operation" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text DEFAULT '' NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "farm_task_storage_state" (
	"key" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "farm_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"group" text DEFAULT 'Admin' NOT NULL,
	"task" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"urgency" text DEFAULT 'Medium' NOT NULL,
	"month" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"latitude" text,
	"longitude" text,
	"location_captured_at" text DEFAULT '' NOT NULL,
	"atlas_link" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"link" text DEFAULT '' NOT NULL,
	"subtasks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attachment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'Manual' NOT NULL,
	"calendar_event_id" text DEFAULT '' NOT NULL,
	"calendar_recurring_event_id" text DEFAULT '' NOT NULL,
	"calendar_start" text DEFAULT '' NOT NULL,
	"scheduled_dates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"calendar_updated" text DEFAULT '' NOT NULL,
	"assignee_id" text DEFAULT '' NOT NULL,
	"assignee_name" text DEFAULT '' NOT NULL,
	"assignee_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assignee_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recurrence" text DEFAULT 'none' NOT NULL,
	"repeat_weekly" boolean DEFAULT false NOT NULL,
	"review_status" text DEFAULT 'approved' NOT NULL,
	"submitted_by_id" text DEFAULT '' NOT NULL,
	"submitted_by_name" text DEFAULT '' NOT NULL,
	"review_note" text DEFAULT '' NOT NULL,
	"reviewed_at" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_connection" (
	"id" integer PRIMARY KEY NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"scopes" text DEFAULT '' NOT NULL,
	"connected_by_clerk_id" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_audit_events" ADD CONSTRAINT "assistant_audit_events_proposal_task_id_assistant_proposal_tasks_id_fk" FOREIGN KEY ("proposal_task_id") REFERENCES "public"."assistant_proposal_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_proposal_tasks" ADD CONSTRAINT "assistant_proposal_tasks_proposal_id_assistant_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."assistant_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "farm_attachments_task_id_idx" ON "farm_attachments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "farm_attachments_owner_id_idx" ON "farm_attachments" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "farm_members_status_idx" ON "farm_members" USING btree ("status");--> statement-breakpoint
CREATE INDEX "assistant_approval_rules_active_idx" ON "assistant_approval_rules" USING btree ("active");--> statement-breakpoint
CREATE INDEX "assistant_audit_events_task_idx" ON "assistant_audit_events" USING btree ("proposal_task_id");--> statement-breakpoint
CREATE INDEX "assistant_oauth_credentials_member_idx" ON "assistant_oauth_credentials" USING btree ("clerk_id");--> statement-breakpoint
CREATE INDEX "assistant_oauth_credentials_expiry_idx" ON "assistant_oauth_credentials" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "assistant_proposal_tasks_proposal_idx" ON "assistant_proposal_tasks" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "assistant_proposal_tasks_status_idx" ON "assistant_proposal_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "assistant_proposals_status_idx" ON "assistant_proposals" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_source_items_source_idx" ON "assistant_source_items" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "assistant_source_items_starts_idx" ON "assistant_source_items" USING btree ("starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_plan_snapshots_date_idx" ON "daily_plan_snapshots" USING btree ("plan_date");--> statement-breakpoint
CREATE INDEX "farm_task_completion_task_idx" ON "farm_task_completion_events" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "farm_task_mutation_receipt_key" ON "farm_task_mutation_receipts" USING btree ("operation_id","member_id","operation_kind","task_id");--> statement-breakpoint
CREATE INDEX "farm_task_sheet_outbox_status_idx" ON "farm_task_sheet_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "farm_task_sheet_outbox_task_order_idx" ON "farm_task_sheet_outbox" USING btree ("task_id","created_at","id");--> statement-breakpoint
CREATE INDEX "farm_tasks_scheduled_dates_idx" ON "farm_tasks" USING gin ("scheduled_dates");--> statement-breakpoint
CREATE INDEX "farm_tasks_source_idx" ON "farm_tasks" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX "farm_tasks_calendar_identity_idx" ON "farm_tasks" USING btree ("calendar_event_id") WHERE "farm_tasks"."calendar_event_id" <> '';