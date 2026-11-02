ALTER TABLE "character_travel_state" ADD COLUMN "route_location_ids" text[];--> statement-breakpoint
ALTER TABLE "character_travel_state" ADD CONSTRAINT "character_travel_state_route_requires_walk" CHECK ("character_travel_state"."route_location_ids" IS NULL OR ("character_travel_state"."mode" = 'walk' AND cardinality("character_travel_state"."route_location_ids") >= 2));
