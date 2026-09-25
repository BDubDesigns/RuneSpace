CREATE TABLE "runespace_access_state" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"public_gameplay_open" boolean DEFAULT false NOT NULL,
	"soft_alpha_launch_target_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_admin_user_id" text,
	CONSTRAINT "runespace_access_state_singleton_check" CHECK ("runespace_access_state"."id" = 1)
);
--> statement-breakpoint
-- Issue #223: the singleton is seeded CLOSED with the locked Soft Alpha target
-- (2026-10-27 09:00 America/Los_Angeles). Applying this migration can never
-- open public gameplay; only an audited operator command flips the switch.
INSERT INTO "runespace_access_state" ("id", "public_gameplay_open", "soft_alpha_launch_target_at")
VALUES (1, false, '2026-10-27T16:00:00Z')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "operator_audit_logs" ALTER COLUMN "character_id" DROP NOT NULL;--> statement-breakpoint
-- Every pre-#223 audit row is a character-scoped row: add the explicit target
-- kind nullable, backfill it, then require it (no default, so every future
-- writer must state its target kind).
ALTER TABLE "operator_audit_logs" ADD COLUMN "target_kind" text;--> statement-breakpoint
UPDATE "operator_audit_logs" SET "target_kind" = 'character' WHERE "target_kind" IS NULL;--> statement-breakpoint
ALTER TABLE "operator_audit_logs" ALTER COLUMN "target_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "operator_audit_logs" ADD COLUMN "player_account_id" text;--> statement-breakpoint
ALTER TABLE "player_accounts" ADD COLUMN "early_access_granted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "player_accounts" ADD COLUMN "early_access_granted_by_admin_user_id" text;--> statement-breakpoint
ALTER TABLE "operator_audit_logs" ADD CONSTRAINT "operator_audit_logs_player_account_id_player_accounts_id_fk" FOREIGN KEY ("player_account_id") REFERENCES "public"."player_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operator_audit_logs_player_account_created_idx" ON "operator_audit_logs" USING btree ("player_account_id","created_at");--> statement-breakpoint
CREATE INDEX "operator_audit_logs_system_created_idx" ON "operator_audit_logs" USING btree ("created_at") WHERE "operator_audit_logs"."target_kind" = 'system';--> statement-breakpoint
ALTER TABLE "operator_audit_logs" ADD CONSTRAINT "operator_audit_logs_target_kind_check" CHECK ("operator_audit_logs"."target_kind" in ('character', 'player_account', 'system'));--> statement-breakpoint
ALTER TABLE "operator_audit_logs" ADD CONSTRAINT "operator_audit_logs_target_shape_check" CHECK (("operator_audit_logs"."target_kind" = 'character' and "operator_audit_logs"."character_id" is not null and "operator_audit_logs"."player_account_id" is null) or ("operator_audit_logs"."target_kind" = 'player_account' and "operator_audit_logs"."player_account_id" is not null and "operator_audit_logs"."character_id" is null) or ("operator_audit_logs"."target_kind" = 'system' and "operator_audit_logs"."character_id" is null and "operator_audit_logs"."player_account_id" is null));--> statement-breakpoint
ALTER TABLE "player_accounts" ADD CONSTRAINT "player_accounts_early_access_paired_check" CHECK (("player_accounts"."early_access_granted_at" is null) = ("player_accounts"."early_access_granted_by_admin_user_id" is null));
