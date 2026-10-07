CREATE TABLE "character_mission_unpins" (
	"character_id" text NOT NULL,
	"mission_id" text NOT NULL,
	"unpinned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_mission_unpins_pk" PRIMARY KEY("character_id","mission_id")
);
--> statement-breakpoint
ALTER TABLE "character_mission_unpins" ADD CONSTRAINT "character_mission_unpins_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_mission_unpins" ADD CONSTRAINT "character_mission_unpins_mission_fk" FOREIGN KEY ("character_id","mission_id") REFERENCES "public"."character_missions"("character_id","mission_id") ON DELETE cascade ON UPDATE no action;