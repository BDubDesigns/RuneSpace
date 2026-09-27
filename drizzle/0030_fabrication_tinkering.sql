-- Tier-1 Fabrication and Tinkering (#232). Two new per-character rows, created
-- lazily on first use, so no existing character needs a backfill: a character
-- with no row has never used the station and is in its correct initial state.
CREATE TABLE "character_fabrication_state" (
	"character_id" text PRIMARY KEY NOT NULL,
	"manual_override_enabled" boolean DEFAULT false NOT NULL,
	"run_selected_batches" integer DEFAULT 1,
	"run_batches" integer DEFAULT 0 NOT NULL,
	"run_successes" integer DEFAULT 0 NOT NULL,
	"run_busts" integer DEFAULT 0 NOT NULL,
	"run_inputs_consumed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_outputs_gained" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_xp_gained" integer DEFAULT 0 NOT NULL,
	"recent_workpieces" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"finish_current" boolean DEFAULT false NOT NULL,
	"last_stop_reason" text,
	"override_load" smallint,
	"override_trend" text,
	"override_safe_pushes" smallint DEFAULT 0 NOT NULL,
	"override_exact_pushes" smallint DEFAULT 0 NOT NULL,
	"override_locked" boolean DEFAULT false NOT NULL,
	"override_last_push" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_fabrication_state_run_selected_batches_positive" CHECK ("character_fabrication_state"."run_selected_batches" >= 1),
	CONSTRAINT "character_fabrication_state_run_counts_non_negative" CHECK ("character_fabrication_state"."run_batches" >= 0 AND "character_fabrication_state"."run_successes" >= 0 AND "character_fabrication_state"."run_busts" >= 0 AND "character_fabrication_state"."run_xp_gained" >= 0),
	CONSTRAINT "character_fabrication_state_override_trend_valid" CHECK ("character_fabrication_state"."override_trend" IS NULL OR "character_fabrication_state"."override_trend" IN ('higher', 'lower')),
	CONSTRAINT "character_fabrication_state_override_complete" CHECK (("character_fabrication_state"."override_load" IS NULL) = ("character_fabrication_state"."override_trend" IS NULL)),
	CONSTRAINT "character_fabrication_state_override_pushes_non_negative" CHECK ("character_fabrication_state"."override_safe_pushes" >= 0 AND "character_fabrication_state"."override_exact_pushes" >= 0),
	CONSTRAINT "character_fabrication_state_override_requires_machine" CHECK ("character_fabrication_state"."override_load" IS NOT NULL OR ("character_fabrication_state"."override_safe_pushes" = 0 AND "character_fabrication_state"."override_exact_pushes" = 0 AND NOT "character_fabrication_state"."override_locked" AND "character_fabrication_state"."override_last_push" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "character_tinkering_state" (
	"character_id" text PRIMARY KEY NOT NULL,
	"auto_discard_scrap" boolean DEFAULT false NOT NULL,
	"cycle_action_id" text,
	"cycle_ticks_completed" integer DEFAULT 0 NOT NULL,
	"finish_current" boolean DEFAULT false NOT NULL,
	"last_stop_reason" text,
	"run_selected_batches" integer DEFAULT 1,
	"run_batches" integer DEFAULT 0 NOT NULL,
	"run_items_consumed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_scrap_kept" integer DEFAULT 0 NOT NULL,
	"run_scrap_discarded" integer DEFAULT 0 NOT NULL,
	"run_xp_gained" integer DEFAULT 0 NOT NULL,
	"recent_batches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_tinkering_state_run_selected_batches_positive" CHECK ("character_tinkering_state"."run_selected_batches" >= 1),
	CONSTRAINT "character_tinkering_state_run_counts_non_negative" CHECK ("character_tinkering_state"."run_batches" >= 0 AND "character_tinkering_state"."run_scrap_kept" >= 0 AND "character_tinkering_state"."run_scrap_discarded" >= 0 AND "character_tinkering_state"."run_xp_gained" >= 0),
	CONSTRAINT "character_tinkering_state_ticks_non_negative" CHECK ("character_tinkering_state"."cycle_ticks_completed" >= 0),
	CONSTRAINT "character_tinkering_state_ticks_require_cycle" CHECK ("character_tinkering_state"."cycle_action_id" IS NOT NULL OR "character_tinkering_state"."cycle_ticks_completed" = 0)
);
--> statement-breakpoint
ALTER TABLE "character_fabrication_state" ADD CONSTRAINT "character_fabrication_state_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_tinkering_state" ADD CONSTRAINT "character_tinkering_state_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;