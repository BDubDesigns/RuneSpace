CREATE TABLE "character_practice_welds" (
	"character_id" text PRIMARY KEY NOT NULL,
	"sections_completed" integer DEFAULT 0 NOT NULL,
	"cycle_active" boolean DEFAULT false NOT NULL,
	"auto_discard_slag" boolean DEFAULT false NOT NULL,
	"clean_pass_first_section" integer,
	"clean_pass_first_outcome" text,
	"clean_pass_second_section" integer,
	"clean_pass_second_outcome" text,
	"last_stop_reason" text,
	"run_welds" integer DEFAULT 0 NOT NULL,
	"run_scrap_consumed" integer DEFAULT 0 NOT NULL,
	"run_slag_kept" integer DEFAULT 0 NOT NULL,
	"run_slag_discarded" integer DEFAULT 0 NOT NULL,
	"run_xp_gained" integer DEFAULT 0 NOT NULL,
	"recent_welds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_practice_welds_sections_non_negative" CHECK ("character_practice_welds"."sections_completed" >= 0),
	CONSTRAINT "character_practice_welds_run_welds_non_negative" CHECK ("character_practice_welds"."run_welds" >= 0),
	CONSTRAINT "character_practice_welds_sections_require_active_cycle" CHECK ("character_practice_welds"."cycle_active" OR "character_practice_welds"."sections_completed" = 0)
);
--> statement-breakpoint
ALTER TABLE "character_repair_targets" ADD COLUMN "clean_pass_first_section" integer;--> statement-breakpoint
ALTER TABLE "character_repair_targets" ADD COLUMN "clean_pass_first_outcome" text;--> statement-breakpoint
ALTER TABLE "character_repair_targets" ADD COLUMN "clean_pass_second_section" integer;--> statement-breakpoint
ALTER TABLE "character_repair_targets" ADD COLUMN "clean_pass_second_outcome" text;--> statement-breakpoint
ALTER TABLE "character_practice_welds" ADD CONSTRAINT "character_practice_welds_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;