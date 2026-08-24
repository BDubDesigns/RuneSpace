CREATE TABLE "character_missions" (
	"character_id" text NOT NULL,
	"mission_id" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "character_missions_character_mission_pk" PRIMARY KEY("character_id","mission_id"),
	CONSTRAINT "character_missions_completion_requires_acceptance" CHECK ("character_missions"."completed_at" IS NULL OR "character_missions"."accepted_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "character_missions" ADD CONSTRAINT "character_missions_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_missions_character_id_idx" ON "character_missions" USING btree ("character_id");