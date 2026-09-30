ALTER TABLE "character_refining_state" ADD COLUMN "run_outputs_discarded" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "auto_discard_slag" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Auto-discard Slag is one character-wide preference now (#256), shared by
-- Practice Welding and Refining. Carry every existing Practice choice over
-- before the Practice column is dropped; a character with no Practice row never
-- set it and keeps the Off default.
UPDATE "characters" SET "auto_discard_slag" = true FROM "character_practice_welds" WHERE "character_practice_welds"."character_id" = "characters"."id" AND "character_practice_welds"."auto_discard_slag" = true;--> statement-breakpoint
ALTER TABLE "character_practice_welds" DROP COLUMN "auto_discard_slag";
