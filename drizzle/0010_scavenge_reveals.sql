-- Issue #88 clarification: keep committed Scavenge reveals available through
-- Travel arrival, reload, and reconciliation until presentation acknowledgment.
CREATE TABLE "character_scavenge_reveals" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "character_id" text NOT NULL REFERENCES "characters"("id") ON DELETE restrict,
  "outcome_id" text NOT NULL,
  "award_quantity" integer DEFAULT 0 NOT NULL,
  "claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "character_scavenge_reveals_award_quantity_non_negative"
    CHECK ("award_quantity" >= 0)
);

CREATE INDEX "character_scavenge_reveals_character_id_claimed_at_idx"
  ON "character_scavenge_reveals" ("character_id", "claimed_at");
