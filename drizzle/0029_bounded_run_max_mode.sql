-- Max as a durable run mode (#229). NULL in either selected column means Max:
-- run until the activity's ordinary rules refuse the next attempt or weld. A
-- number is still a bounded run. The existing ">= 1" checks already pass NULL.
-- Every existing row keeps its numeric selection; nothing is backfilled.
ALTER TABLE "character_practice_welds" ALTER COLUMN "run_selected_welds" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "character_refining_state" ALTER COLUMN "run_selected_attempts" DROP NOT NULL;