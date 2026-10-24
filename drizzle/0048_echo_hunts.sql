CREATE TABLE "character_echo_hunts" (
	"character_id" text NOT NULL,
	"planet_id" text NOT NULL,
	"tier" text NOT NULL,
	"target_location_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_reading_location_id" text,
	"last_reading_east_west" text,
	"last_reading_north_south" text,
	"last_reading_at" timestamp with time zone,
	CONSTRAINT "character_echo_hunts_character_id_planet_id_tier_pk" PRIMARY KEY("character_id","planet_id","tier"),
	CONSTRAINT "character_echo_hunts_last_reading_directions" CHECK (("character_echo_hunts"."last_reading_east_west" IS NULL OR "character_echo_hunts"."last_reading_east_west" IN ('east', 'west', 'aligned')) AND ("character_echo_hunts"."last_reading_north_south" IS NULL OR "character_echo_hunts"."last_reading_north_south" IN ('north', 'south', 'aligned')))
);
--> statement-breakpoint
CREATE TABLE "echo_reading_notices" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" text NOT NULL,
	"outcome" text NOT NULL,
	"planet_id" text NOT NULL,
	"source_location_id" text NOT NULL,
	"east_west" text,
	"north_south" text,
	"reward_item_id" text,
	"reward_kept" boolean,
	"xp_awarded" integer DEFAULT 0 NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "echo_reading_notices_outcome" CHECK ("echo_reading_notices"."outcome" IN ('wrong', 'found'))
);
--> statement-breakpoint
ALTER TABLE "character_echo_hunts" ADD CONSTRAINT "character_echo_hunts_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echo_reading_notices" ADD CONSTRAINT "echo_reading_notices_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "echo_reading_notices_character_read_at_unique" ON "echo_reading_notices" USING btree ("character_id","read_at");