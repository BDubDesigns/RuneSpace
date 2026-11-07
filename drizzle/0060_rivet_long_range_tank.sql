ALTER TABLE "character_ships" DROP CONSTRAINT "character_ships_fuel_in_tank";--> statement-breakpoint
ALTER TABLE "character_ships" ADD COLUMN "tank_capacity_fuel_units" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE "character_ships" ADD CONSTRAINT "character_ships_tank_capacity" CHECK ("character_ships"."tank_capacity_fuel_units" IN (300, 750));--> statement-breakpoint
ALTER TABLE "character_ships" ADD CONSTRAINT "character_ships_fuel_in_tank" CHECK ("character_ships"."fuel_units" >= 0 AND "character_ships"."fuel_units" <= "character_ships"."tank_capacity_fuel_units");