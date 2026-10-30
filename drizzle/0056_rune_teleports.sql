CREATE TABLE "character_rune_teleports" (
	"character_id" text NOT NULL,
	"intent_id" text NOT NULL,
	"item_id" text NOT NULL,
	"origin_location_id" text NOT NULL,
	"destination_location_id" text NOT NULL,
	"teleported_at" timestamp with time zone NOT NULL,
	"arrival_acknowledged_at" timestamp with time zone,
	CONSTRAINT "character_rune_teleports_character_intent_pk" PRIMARY KEY("character_id","intent_id")
);
--> statement-breakpoint
ALTER TABLE "character_rune_teleports" ADD CONSTRAINT "character_rune_teleports_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;