CREATE TABLE "character_runeworking_state" (
	"character_id" text PRIMARY KEY NOT NULL,
	"run_selected_cycles" integer DEFAULT 1,
	"run_cycles" integer DEFAULT 0 NOT NULL,
	"run_inputs_consumed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_outputs_gained" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_xp_gained" integer DEFAULT 0 NOT NULL,
	"recent_cycles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"finish_current" boolean DEFAULT false NOT NULL,
	"last_stop_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_runeworking_state_run_selected_cycles_positive" CHECK ("character_runeworking_state"."run_selected_cycles" >= 1),
	CONSTRAINT "character_runeworking_state_run_counts_non_negative" CHECK ("character_runeworking_state"."run_cycles" >= 0 AND "character_runeworking_state"."run_xp_gained" >= 0)
);
--> statement-breakpoint
ALTER TABLE "character_runeworking_state" ADD CONSTRAINT "character_runeworking_state_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;