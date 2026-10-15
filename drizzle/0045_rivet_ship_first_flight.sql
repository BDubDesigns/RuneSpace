CREATE TABLE "character_ships" (
	"character_id" text PRIMARY KEY NOT NULL,
	"berth_location_id" text DEFAULT 'crash_site' NOT NULL,
	"fuel_units" integer DEFAULT 0 NOT NULL,
	"flight_route_id" text,
	"flight_origin_location_id" text,
	"flight_destination_location_id" text,
	"flight_started_at" timestamp with time zone,
	"flight_arrives_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_ships_fuel_in_tank" CHECK ("character_ships"."fuel_units" >= 0 AND "character_ships"."fuel_units" <= 300),
	CONSTRAINT "character_ships_flight_all_or_nothing" CHECK (("character_ships"."flight_route_id" IS NULL AND "character_ships"."flight_origin_location_id" IS NULL AND "character_ships"."flight_destination_location_id" IS NULL AND "character_ships"."flight_started_at" IS NULL AND "character_ships"."flight_arrives_at" IS NULL) OR ("character_ships"."flight_route_id" IS NOT NULL AND "character_ships"."flight_origin_location_id" IS NOT NULL AND "character_ships"."flight_destination_location_id" IS NOT NULL AND "character_ships"."flight_started_at" IS NOT NULL AND "character_ships"."flight_arrives_at" IS NOT NULL AND "character_ships"."flight_arrives_at" > "character_ships"."flight_started_at" AND "character_ships"."flight_origin_location_id" <> "character_ships"."flight_destination_location_id"))
);
--> statement-breakpoint
CREATE TABLE "ship_arrival_notices" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" text NOT NULL,
	"route_id" text NOT NULL,
	"destination_location_id" text NOT NULL,
	"completed_mission_id" text,
	"arrived_at" timestamp with time zone NOT NULL,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "character_ships" ADD CONSTRAINT "character_ships_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ship_arrival_notices" ADD CONSTRAINT "ship_arrival_notices_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ship_arrival_notices_character_route_arrival_unique" ON "ship_arrival_notices" USING btree ("character_id","route_id","arrived_at");--> statement-breakpoint
CREATE INDEX "ship_arrival_notices_character_id_idx" ON "ship_arrival_notices" USING btree ("character_id");