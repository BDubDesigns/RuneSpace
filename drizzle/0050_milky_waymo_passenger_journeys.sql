CREATE TABLE "character_passenger_journeys" (
	"character_id" text PRIMARY KEY NOT NULL,
	"route_id" text NOT NULL,
	"origin_location_id" text NOT NULL,
	"destination_location_id" text NOT NULL,
	"fare_credits" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"arrives_at" timestamp with time zone NOT NULL,
	"landed_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "character_passenger_journeys_schedule" CHECK ("character_passenger_journeys"."arrives_at" > "character_passenger_journeys"."started_at" AND "character_passenger_journeys"."origin_location_id" <> "character_passenger_journeys"."destination_location_id" AND "character_passenger_journeys"."fare_credits" > 0),
	CONSTRAINT "character_passenger_journeys_ack_after_landing" CHECK ("character_passenger_journeys"."acknowledged_at" IS NULL OR "character_passenger_journeys"."landed_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "character_passenger_journeys" ADD CONSTRAINT "character_passenger_journeys_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;