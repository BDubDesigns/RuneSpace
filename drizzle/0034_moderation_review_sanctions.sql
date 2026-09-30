CREATE TABLE "moderation_appeals" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sanction_id" text NOT NULL,
	"case_id" text NOT NULL,
	"player_account_id" text NOT NULL,
	"body" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text,
	"decided_at" timestamp with time zone,
	"decided_by_admin_user_id" text,
	"decision_note" text,
	CONSTRAINT "moderation_appeals_sanction_id_unique" UNIQUE("sanction_id"),
	CONSTRAINT "moderation_appeals_body_check" CHECK (char_length("moderation_appeals"."body") between 1 and 1000),
	CONSTRAINT "moderation_appeals_outcome_check" CHECK ("moderation_appeals"."outcome" is null or "moderation_appeals"."outcome" in ('upheld', 'modified', 'reversed')),
	CONSTRAINT "moderation_appeals_decision_paired_check" CHECK (("moderation_appeals"."outcome" is null) = ("moderation_appeals"."decided_at" is null) and ("moderation_appeals"."outcome" is null) = ("moderation_appeals"."decided_by_admin_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "moderation_case_notes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" text NOT NULL,
	"admin_user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_case_notes_body_check" CHECK (char_length("moderation_case_notes"."body") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "moderation_cases" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_number" bigint GENERATED ALWAYS AS IDENTITY (sequence name "moderation_cases_case_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"subject_player_account_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_by" text NOT NULL,
	"opened_by_admin_user_id" text,
	"opening_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_cases_case_number_unique" UNIQUE("case_number"),
	CONSTRAINT "moderation_cases_status_check" CHECK ("moderation_cases"."status" in ('open', 'reviewed', 'actioned', 'dismissed')),
	CONSTRAINT "moderation_cases_opened_by_check" CHECK (("moderation_cases"."opened_by" = 'report' and "moderation_cases"."opened_by_admin_user_id" is null and "moderation_cases"."opening_reason" is null) or ("moderation_cases"."opened_by" = 'operator' and "moderation_cases"."opened_by_admin_user_id" is not null and "moderation_cases"."opening_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "moderation_sanctions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" text NOT NULL,
	"player_account_id" text NOT NULL,
	"kind" text NOT NULL,
	"rule_category" text NOT NULL,
	"duration" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"issued_by_admin_user_id" text NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by_admin_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_sanctions_kind_check" CHECK ("moderation_sanctions"."kind" in ('warning', 'social_restriction', 'suspension')),
	CONSTRAINT "moderation_sanctions_rule_check" CHECK ("moderation_sanctions"."rule_category" in ('identity_hate', 'harassment', 'threats_private_info', 'sexual_content', 'scams_spam', 'moderation_abuse', 'block_or_sanction_evasion', 'offensive_name')),
	CONSTRAINT "moderation_sanctions_duration_check" CHECK (("moderation_sanctions"."kind" = 'warning' and "moderation_sanctions"."duration" is null and "moderation_sanctions"."ends_at" is null) or ("moderation_sanctions"."kind" <> 'warning' and "moderation_sanctions"."duration" in ('24h', '7d', '30d', '90d', '1y', 'permanent') and ("moderation_sanctions"."duration" = 'permanent') = ("moderation_sanctions"."ends_at" is null))),
	CONSTRAINT "moderation_sanctions_reversal_paired_check" CHECK (("moderation_sanctions"."reversed_at" is null) = ("moderation_sanctions"."reversed_by_admin_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "privileged_access_logs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" text NOT NULL,
	"access_kind" text NOT NULL,
	"case_id" text,
	"target_player_account_id" text,
	"target_character_id" text,
	"context" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privileged_access_logs_kind_check" CHECK ("privileged_access_logs"."access_kind" in ('case_queue', 'case_detail', 'retained_public_chat', 'retained_whispers', 'account_moderation_history', 'privileged_access_log'))
);
--> statement-breakpoint
ALTER TABLE "operator_audit_logs" ADD COLUMN "moderation_case_id" text;--> statement-breakpoint
ALTER TABLE "player_reports" ADD COLUMN "case_id" text;--> statement-breakpoint
-- Reports filed before moderation cases existed (#247) join one open case per
-- reported account, so every report is reviewable and case_id can be required.
INSERT INTO "moderation_cases" ("subject_player_account_id", "status", "opened_by", "created_at", "updated_at")
SELECT "reported_player_account_id", 'open', 'report', min("created_at"), max("created_at")
FROM "player_reports"
GROUP BY "reported_player_account_id"
ORDER BY min("created_at");--> statement-breakpoint
UPDATE "player_reports" SET "case_id" = "moderation_cases"."id"
FROM "moderation_cases"
WHERE "moderation_cases"."subject_player_account_id" = "player_reports"."reported_player_account_id";--> statement-breakpoint
ALTER TABLE "player_reports" ALTER COLUMN "case_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_sanction_id_moderation_sanctions_id_fk" FOREIGN KEY ("sanction_id") REFERENCES "public"."moderation_sanctions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_case_id_moderation_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."moderation_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_player_account_id_player_accounts_id_fk" FOREIGN KEY ("player_account_id") REFERENCES "public"."player_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_case_notes" ADD CONSTRAINT "moderation_case_notes_case_id_moderation_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."moderation_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_subject_player_account_id_player_accounts_id_fk" FOREIGN KEY ("subject_player_account_id") REFERENCES "public"."player_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_sanctions" ADD CONSTRAINT "moderation_sanctions_case_id_moderation_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."moderation_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_sanctions" ADD CONSTRAINT "moderation_sanctions_player_account_id_player_accounts_id_fk" FOREIGN KEY ("player_account_id") REFERENCES "public"."player_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privileged_access_logs" ADD CONSTRAINT "privileged_access_logs_case_id_moderation_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."moderation_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privileged_access_logs" ADD CONSTRAINT "privileged_access_logs_target_player_account_id_player_accounts_id_fk" FOREIGN KEY ("target_player_account_id") REFERENCES "public"."player_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privileged_access_logs" ADD CONSTRAINT "privileged_access_logs_target_character_id_characters_id_fk" FOREIGN KEY ("target_character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_appeals_case_idx" ON "moderation_appeals" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "moderation_appeals_pending_idx" ON "moderation_appeals" USING btree ("submitted_at") WHERE "moderation_appeals"."outcome" is null;--> statement-breakpoint
CREATE INDEX "moderation_case_notes_case_created_idx" ON "moderation_case_notes" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_cases_one_active_per_subject_idx" ON "moderation_cases" USING btree ("subject_player_account_id") WHERE "moderation_cases"."status" in ('open', 'reviewed');--> statement-breakpoint
CREATE INDEX "moderation_cases_status_updated_idx" ON "moderation_cases" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "moderation_cases_subject_created_idx" ON "moderation_cases" USING btree ("subject_player_account_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_sanctions_account_kind_idx" ON "moderation_sanctions" USING btree ("player_account_id","kind");--> statement-breakpoint
CREATE INDEX "moderation_sanctions_case_idx" ON "moderation_sanctions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "privileged_access_logs_created_idx" ON "privileged_access_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "privileged_access_logs_case_created_idx" ON "privileged_access_logs" USING btree ("case_id","created_at") WHERE "privileged_access_logs"."case_id" is not null;--> statement-breakpoint
CREATE INDEX "privileged_access_logs_account_created_idx" ON "privileged_access_logs" USING btree ("target_player_account_id","created_at") WHERE "privileged_access_logs"."target_player_account_id" is not null;--> statement-breakpoint
ALTER TABLE "operator_audit_logs" ADD CONSTRAINT "operator_audit_logs_moderation_case_id_moderation_cases_id_fk" FOREIGN KEY ("moderation_case_id") REFERENCES "public"."moderation_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_reports" ADD CONSTRAINT "player_reports_case_id_moderation_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."moderation_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operator_audit_logs_moderation_case_created_idx" ON "operator_audit_logs" USING btree ("moderation_case_id","created_at") WHERE "operator_audit_logs"."moderation_case_id" is not null;--> statement-breakpoint
CREATE INDEX "player_reports_case_created_idx" ON "player_reports" USING btree ("case_id","created_at");