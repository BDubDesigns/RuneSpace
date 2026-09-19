ALTER TABLE "character_repair_targets" DROP CONSTRAINT "character_repair_targets_refined_ferrite_non_negative";--> statement-breakpoint
ALTER TABLE "character_repair_targets" DROP CONSTRAINT "character_repair_targets_slag_non_negative";--> statement-breakpoint
ALTER TABLE "character_mining_state" ADD COLUMN "run_items_gained" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "character_refining_state" ADD COLUMN "run_outputs_gained" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "character_refining_state" ADD COLUMN "run_inputs_consumed" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "character_repair_targets" ADD COLUMN "materials" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "character_repair_targets" ADD CONSTRAINT "character_repair_targets_materials_object" CHECK (jsonb_typeof("character_repair_targets"."materials") = 'object');--> statement-breakpoint
-- Issue #209: carry every existing repair contribution and run total into the
-- generic item-keyed representation before the specialized columns are dropped
-- in 0023.
--
-- The old columns each meant exactly one item, so the translation is total and
-- lossless. A zero is written as an ABSENT key rather than an explicit 0,
-- because the domain reads a missing key as "nothing contributed" — that keeps
-- the Crew Stop, whose recipe wants no Slag at all, from carrying a permanent
-- `slag: 0` row its material list would then have to filter out.
--
-- The literal item IDs below are the stable content IDs those columns always
-- held (`game/config/foundations`). This is a one-time backfill, not a runtime
-- dependency: nothing in the schema layer reads game content after it runs.
UPDATE "character_repair_targets"
SET "materials" = (
  CASE WHEN "refined_ferrite_contributed" > 0
    THEN jsonb_build_object('refined_ferrite', "refined_ferrite_contributed")
    ELSE '{}'::jsonb END
  || CASE WHEN "slag_contributed" > 0
    THEN jsonb_build_object('slag', "slag_contributed")
    ELSE '{}'::jsonb END
)
WHERE "refined_ferrite_contributed" > 0 OR "slag_contributed" > 0;--> statement-breakpoint
UPDATE "character_mining_state"
SET "run_items_gained" = jsonb_build_object('ferrite_shale', "run_shale_gained")
WHERE "run_shale_gained" > 0;--> statement-breakpoint
UPDATE "character_refining_state"
SET "run_outputs_gained" = (
  CASE WHEN "run_ferrite_gained" > 0
    THEN jsonb_build_object('refined_ferrite', "run_ferrite_gained")
    ELSE '{}'::jsonb END
  || CASE WHEN "run_slag_gained" > 0
    THEN jsonb_build_object('slag', "run_slag_gained")
    ELSE '{}'::jsonb END
),
"run_inputs_consumed" = (
  CASE WHEN "run_shale_consumed" > 0
    THEN jsonb_build_object('ferrite_shale', "run_shale_consumed")
    ELSE '{}'::jsonb END
)
WHERE "run_ferrite_gained" > 0 OR "run_slag_gained" > 0 OR "run_shale_consumed" > 0;
