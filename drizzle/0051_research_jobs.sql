CREATE TABLE "character_research_assignments" (
	"character_id" text PRIMARY KEY NOT NULL,
	"id" text DEFAULT gen_random_uuid() NOT NULL,
	"job_id" text NOT NULL,
	"item_instance_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"recorded_at" timestamp with time zone,
	"sampled_location_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "character_research_assignments_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "character_research_jobs" (
	"character_id" text NOT NULL,
	"job_id" text NOT NULL,
	"completions" integer DEFAULT 0 NOT NULL,
	"last_completed_at" timestamp with time zone,
	"arrival_acknowledged_at" timestamp with time zone,
	CONSTRAINT "character_research_jobs_character_job_pk" PRIMARY KEY("character_id","job_id"),
	CONSTRAINT "character_research_jobs_completions_non_negative" CHECK ("character_research_jobs"."completions" >= 0 AND ("character_research_jobs"."completions" = 0) = ("character_research_jobs"."last_completed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "character_research_assignments" ADD CONSTRAINT "character_research_assignments_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_research_assignments" ADD CONSTRAINT "character_research_assignments_item_instance_id_item_instances_id_fk" FOREIGN KEY ("item_instance_id") REFERENCES "public"."item_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_research_jobs" ADD CONSTRAINT "character_research_jobs_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;