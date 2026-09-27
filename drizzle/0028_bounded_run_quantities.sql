ALTER TABLE "character_practice_welds" ADD COLUMN "run_selected_welds" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "character_refining_state" ADD COLUMN "run_selected_attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "character_practice_welds" ADD CONSTRAINT "character_practice_welds_run_selected_welds_positive" CHECK ("character_practice_welds"."run_selected_welds" >= 1);--> statement-breakpoint
ALTER TABLE "character_refining_state" ADD CONSTRAINT "character_refining_state_run_selected_attempts_positive" CHECK ("character_refining_state"."run_selected_attempts" >= 1);--> statement-breakpoint
-- Existing rows (#229): a run from before bounded runs selected nothing, so it
-- records the run it actually made. A completed or stopped run then reads
-- "N of N" rather than "N of 1". A Practice run with a paid weld on the bench
-- keeps that weld: it finishes, and the run ends there, spending no more Scrap.
-- A Refining run still active at deploy ends at its next resolution.
UPDATE "character_refining_state" SET "run_selected_attempts" = GREATEST("run_attempts", 1);--> statement-breakpoint
UPDATE "character_practice_welds" SET "run_selected_welds" = GREATEST("run_welds" + CASE WHEN "cycle_active" THEN 1 ELSE 0 END, 1);
