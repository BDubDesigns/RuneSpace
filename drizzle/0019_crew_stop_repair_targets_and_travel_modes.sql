-- Issue #172 — one coherent schema change for the Crew Stop side Mission.
--
-- 1. `character_repair_targets` becomes the single generic persistence boundary
--    for every Welding repair. The Crash Site Cargo Hold and Holo Hollow's Crew
--    Stop are the same shape with different recipes, so they share one table
--    instead of each owning a private one.
-- 2. Existing Cargo Hold repair rows are migrated into it verbatim — contributed
--    Refined Ferrite, contributed Slag, Welding progress, and completion state
--    all carry across exactly, so no character loses a repair they finished.
-- 3. The specialized `character_cargo_hold_repair` table is then retired. This is
--    pre-beta: there is no compatibility shim, no dual write, and no fallback
--    read left behind.
-- 4. `character_travel_state` learns how a Journey is being made. Every existing
--    row is a walk, so the column default is correct for all of them and no
--    cohort needs repairing.
-- 5. The Scavenge window becomes nullable and mode-bound: a walk always has one,
--    and a paid ride never does. The CHECK is the durable guarantee that
--    "riding offers nothing to scavenge" cannot be violated by any command.

CREATE TABLE "character_repair_targets" (
	"character_id" text NOT NULL,
	"target_id" text NOT NULL,
	"refined_ferrite_contributed" integer DEFAULT 0 NOT NULL,
	"slag_contributed" integer DEFAULT 0 NOT NULL,
	"welding_progress" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_repair_targets_character_id_target_id_pk" PRIMARY KEY("character_id","target_id"),
	CONSTRAINT "character_repair_targets_refined_ferrite_non_negative" CHECK ("character_repair_targets"."refined_ferrite_contributed" >= 0),
	CONSTRAINT "character_repair_targets_slag_non_negative" CHECK ("character_repair_targets"."slag_contributed" >= 0),
	CONSTRAINT "character_repair_targets_welding_non_negative" CHECK ("character_repair_targets"."welding_progress" >= 0),
	CONSTRAINT "character_repair_targets_completion_requires_progress" CHECK ("character_repair_targets"."completed_at" IS NULL OR "character_repair_targets"."welding_progress" > 0)
);
--> statement-breakpoint
ALTER TABLE "character_cargo_hold_repair" DROP CONSTRAINT "character_cargo_hold_repair_refined_ferrite_range";--> statement-breakpoint
ALTER TABLE "character_cargo_hold_repair" DROP CONSTRAINT "character_cargo_hold_repair_slag_range";--> statement-breakpoint
ALTER TABLE "character_cargo_hold_repair" DROP CONSTRAINT "character_cargo_hold_repair_welding_range";--> statement-breakpoint
ALTER TABLE "character_cargo_hold_repair" DROP CONSTRAINT "character_cargo_hold_repair_progress_requires_materials";--> statement-breakpoint
ALTER TABLE "character_cargo_hold_repair" DROP CONSTRAINT "character_cargo_hold_repair_completion_requires_full_state";--> statement-breakpoint
ALTER TABLE "character_cargo_hold_repair" DROP CONSTRAINT "character_cargo_hold_repair_progress_requires_completion_timestamp";--> statement-breakpoint
ALTER TABLE "character_travel_state" DROP CONSTRAINT "character_travel_state_scavenge_start_tick";--> statement-breakpoint
ALTER TABLE "character_travel_state" ALTER COLUMN "scavenge_opportunity_start_tick" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "character_travel_state" ALTER COLUMN "scavenge_opportunity_start_tick" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "character_travel_state" ADD COLUMN "mode" text DEFAULT 'walk' NOT NULL;--> statement-breakpoint
ALTER TABLE "character_repair_targets" ADD CONSTRAINT "character_repair_targets_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_travel_state" ADD CONSTRAINT "character_travel_state_mode" CHECK ("character_travel_state"."mode" IN ('walk', 'crew_hauler'));--> statement-breakpoint
ALTER TABLE "character_travel_state" ADD CONSTRAINT "character_travel_state_scavenge_window_matches_mode" CHECK (("character_travel_state"."mode" = 'walk' AND "character_travel_state"."scavenge_opportunity_start_tick" IS NOT NULL AND "character_travel_state"."scavenge_opportunity_start_tick" >= 3 AND "character_travel_state"."scavenge_opportunity_start_tick" <= 30) OR ("character_travel_state"."mode" <> 'walk' AND "character_travel_state"."scavenge_opportunity_start_tick" IS NULL));--> statement-breakpoint
ALTER TABLE "character_travel_state" ADD CONSTRAINT "character_travel_state_scavenge_outcome_requires_walk" CHECK ("character_travel_state"."scavenge_outcome_id" IS NULL OR "character_travel_state"."mode" = 'walk');
--> statement-breakpoint
-- Carry every existing Cargo Hold repair into the generic boundary, exactly.
INSERT INTO "character_repair_targets" (
	"character_id",
	"target_id",
	"refined_ferrite_contributed",
	"slag_contributed",
	"welding_progress",
	"completed_at",
	"updated_at"
)
SELECT
	"character_id",
	'cargo_hold',
	"refined_ferrite_contributed",
	"slag_contributed",
	"welding_progress",
	"completed_at",
	"updated_at"
FROM "character_cargo_hold_repair"
ON CONFLICT ("character_id", "target_id") DO NOTHING;--> statement-breakpoint
-- The specialized table has no remaining reader.
DROP TABLE "character_cargo_hold_repair" CASCADE;
