CREATE TABLE "character_mission_progress" (
	"character_id" text NOT NULL,
	"mission_id" text NOT NULL,
	"progress_key" text NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_mission_progress_pk" PRIMARY KEY("character_id","mission_id","progress_key"),
	CONSTRAINT "character_mission_progress_non_negative" CHECK ("character_mission_progress"."progress" >= 0)
);
--> statement-breakpoint
ALTER TABLE "character_mission_progress" ADD CONSTRAINT "character_mission_progress_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_mission_progress" ADD CONSTRAINT "character_mission_progress_mission_fk" FOREIGN KEY ("character_id","mission_id") REFERENCES "public"."character_missions"("character_id","mission_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_mission_progress_character_mission_idx" ON "character_mission_progress" USING btree ("character_id","mission_id");--> statement-breakpoint
INSERT INTO "character_mission_progress" ("character_id", "mission_id", "progress_key", "progress")
SELECT "character_id", "mission_id", 'mining-attempts', 0
FROM "character_missions"
WHERE "mission_id" = 'cut_your_teeth'
  AND "accepted_at" IS NOT NULL
  AND "completed_at" IS NULL
ON CONFLICT ("character_id", "mission_id", "progress_key") DO NOTHING;
