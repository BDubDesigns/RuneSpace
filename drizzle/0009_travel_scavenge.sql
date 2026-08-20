-- Issue #88: one stable optional Scavenge opportunity per ordinary walking leg.
ALTER TABLE "character_travel_state"
  ADD COLUMN "scavenge_opportunity_start_tick" integer NOT NULL DEFAULT 3,
  ADD COLUMN "scavenge_outcome_id" text,
  ADD COLUMN "scavenge_award_quantity" integer NOT NULL DEFAULT 0;

ALTER TABLE "character_travel_state"
  ADD CONSTRAINT "character_travel_state_scavenge_start_tick"
    CHECK ("scavenge_opportunity_start_tick" >= 3 AND "scavenge_opportunity_start_tick" <= 30),
  ADD CONSTRAINT "character_travel_state_scavenge_award_quantity_non_negative"
    CHECK ("scavenge_award_quantity" >= 0);
