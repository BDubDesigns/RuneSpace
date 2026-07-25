-- Issue #40: persistent character location + server-authoritative timed travel.
-- - Every character owns one authoritative current location, defaulting to the
--   Crash Site (backfilled for existing rows and used by new provisioning).
-- - Travel is a blocking one-active-action journey persisted in its own table;
--   the current location remains the origin until arrival commits.

ALTER TABLE "characters"
  ADD COLUMN "current_location_id" text DEFAULT 'crash_site' NOT NULL;

CREATE TABLE "character_travel_state" (
  "character_id" text PRIMARY KEY,
  "origin_location_id" text NOT NULL,
  "destination_location_id" text NOT NULL,
  "started_at" timestamptz NOT NULL,
  CONSTRAINT "character_travel_state_character_id_fkey"
    FOREIGN KEY ("character_id") REFERENCES "characters" ("id") ON DELETE restrict,
  CONSTRAINT "character_travel_state_distinct_ends"
    CHECK ("origin_location_id" <> "destination_location_id")
);
