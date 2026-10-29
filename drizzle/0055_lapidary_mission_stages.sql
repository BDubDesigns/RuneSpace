CREATE TABLE "character_lapidary_state" (
	"character_id" text PRIMARY KEY NOT NULL,
	"run_selected_cycles" integer DEFAULT 1,
	"run_cycles" integer DEFAULT 0 NOT NULL,
	"run_inputs_consumed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_outputs_gained" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_xp_gained" integer DEFAULT 0 NOT NULL,
	"recent_cycles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"finish_current" boolean DEFAULT false NOT NULL,
	"last_stop_reason" text,
	"authorization_stage_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_lapidary_state_run_selected_cycles_positive" CHECK ("character_lapidary_state"."run_selected_cycles" >= 1),
	CONSTRAINT "character_lapidary_state_run_counts_non_negative" CHECK ("character_lapidary_state"."run_cycles" >= 0 AND "character_lapidary_state"."run_xp_gained" >= 0)
);
--> statement-breakpoint
ALTER TABLE "character_missions" ADD COLUMN "completed_stage_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "character_runeworking_state" ADD COLUMN "authorization_stage_id" text;--> statement-breakpoint
ALTER TABLE "character_lapidary_state" ADD CONSTRAINT "character_lapidary_state_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- Existing characters get the new skill once at migration, never a login repair.
INSERT INTO character_skill_xp (character_id, skill_id, total_xp)
SELECT id, 'lapidary', 0 FROM characters
ON CONFLICT (character_id, skill_id) DO NOTHING;
