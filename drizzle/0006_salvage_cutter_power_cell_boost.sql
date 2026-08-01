-- Issue #24: normalize existing Cutter charge and preserve the new bounded
-- attempt-history fields for records written before Power Cell boosting.
UPDATE "item_instances"
SET "current_charge" = 0
WHERE "item_id" = 'salvage_cutter'
  AND "current_charge" IS NULL;
--> statement-breakpoint
UPDATE "character_mining_state"
SET "recent_attempts" = COALESCE(
  (
    SELECT jsonb_agg(
      "entry" || jsonb_build_object(
        'boosted', false,
        'durationTicks', 10,
        'chargeConsumed', false,
        'remainingCharge', 0
      ) ORDER BY "ordinal"
    )
    FROM jsonb_array_elements("recent_attempts") WITH ORDINALITY AS "history"("entry", "ordinal")
  ),
  '[]'::jsonb
)
WHERE jsonb_typeof("recent_attempts") = 'array';
