CREATE TABLE "character_work_order_postings" (
	"character_id" text NOT NULL,
	"slot_index" integer NOT NULL,
	"work_order_id" text NOT NULL,
	"accepted_at" timestamp with time zone,
	"sections_completed" integer DEFAULT 0 NOT NULL,
	"clean_pass" jsonb,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_work_order_postings_pk" PRIMARY KEY("character_id","slot_index"),
	CONSTRAINT "character_work_order_postings_slot_non_negative" CHECK ("character_work_order_postings"."slot_index" >= 0),
	CONSTRAINT "character_work_order_postings_sections_non_negative" CHECK ("character_work_order_postings"."sections_completed" >= 0),
	CONSTRAINT "character_work_order_postings_progress_requires_acceptance" CHECK ("character_work_order_postings"."accepted_at" IS NOT NULL OR ("character_work_order_postings"."sections_completed" = 0 AND "character_work_order_postings"."clean_pass" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "character_practice_welds" ADD COLUMN "clean_pass" jsonb;--> statement-breakpoint
ALTER TABLE "character_practice_welds" ADD COLUMN "finish_current_weld" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "character_repair_targets" ADD COLUMN "clean_pass" jsonb;--> statement-breakpoint
ALTER TABLE "character_work_order_postings" ADD CONSTRAINT "character_work_order_postings_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "character_work_order_postings_one_active_idx" ON "character_work_order_postings" USING btree ("character_id") WHERE "character_work_order_postings"."accepted_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "character_work_order_postings_distinct_jobs_idx" ON "character_work_order_postings" USING btree ("character_id","work_order_id");--> statement-breakpoint
-- Issue #207: carry every existing Clean Pass roll into the generalized array
-- representation before the fixed-pair columns are dropped.
--
-- The old model rolled both sections together, so a non-null first section is
-- exactly "this work unit has rolled"; a null one stays null and the unit rolls
-- under the new cadence when Welding next starts on it. Outcomes are preserved
-- verbatim, including the durable miss that Stop and Travel write, so a partial
-- weld a player walks back to cannot resurrect a window they already spent.
--
-- Every position the old roll could produce (max section 8) still leaves the
-- authored two ordinary sections behind it on all three current work units
-- (10-section Practice welds, the 12-increment Cargo Hold, the 10-increment
-- Crew Stop), so no migrated roll can complete its work unit.
UPDATE "character_practice_welds"
SET "clean_pass" = jsonb_build_array(
	jsonb_build_object('section', "clean_pass_first_section", 'outcome', "clean_pass_first_outcome"),
	jsonb_build_object('section', "clean_pass_second_section", 'outcome', "clean_pass_second_outcome")
)
WHERE "clean_pass_first_section" IS NOT NULL AND "clean_pass_second_section" IS NOT NULL;--> statement-breakpoint
UPDATE "character_repair_targets"
SET "clean_pass" = jsonb_build_array(
	jsonb_build_object('section', "clean_pass_first_section", 'outcome', "clean_pass_first_outcome"),
	jsonb_build_object('section', "clean_pass_second_section", 'outcome', "clean_pass_second_outcome")
)
WHERE "clean_pass_first_section" IS NOT NULL AND "clean_pass_second_section" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "character_practice_welds" DROP COLUMN "clean_pass_first_section";--> statement-breakpoint
ALTER TABLE "character_practice_welds" DROP COLUMN "clean_pass_first_outcome";--> statement-breakpoint
ALTER TABLE "character_practice_welds" DROP COLUMN "clean_pass_second_section";--> statement-breakpoint
ALTER TABLE "character_practice_welds" DROP COLUMN "clean_pass_second_outcome";--> statement-breakpoint
ALTER TABLE "character_repair_targets" DROP COLUMN "clean_pass_first_section";--> statement-breakpoint
ALTER TABLE "character_repair_targets" DROP COLUMN "clean_pass_first_outcome";--> statement-breakpoint
ALTER TABLE "character_repair_targets" DROP COLUMN "clean_pass_second_section";--> statement-breakpoint
ALTER TABLE "character_repair_targets" DROP COLUMN "clean_pass_second_outcome";
