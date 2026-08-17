-- Issue #81: Refining run state + legacy metallurgy XP migration
-- No production refining rows are expected yet; migrate any legacy metallurgy XP to refining idempotently.

CREATE TABLE "character_refining_state" (
  "character_id" text PRIMARY KEY REFERENCES "characters"("id") ON DELETE restrict,
  "last_stop_reason" text,
  "run_attempts" integer DEFAULT 0 NOT NULL,
  "run_successes" integer DEFAULT 0 NOT NULL,
  "run_ferrite_gained" integer DEFAULT 0 NOT NULL,
  "run_slag_gained" integer DEFAULT 0 NOT NULL,
  "run_shale_consumed" integer DEFAULT 0 NOT NULL,
  "run_xp_gained" integer DEFAULT 0 NOT NULL,
  "recent_attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Migrate any legacy 'metallurgy' skill XP rows to 'refining' without duplication or loss.
INSERT INTO "character_skill_xp" ("character_id", "skill_id", "total_xp")
SELECT "character_id", 'refining', "total_xp"
FROM "character_skill_xp" WHERE "skill_id" = 'metallurgy'
ON CONFLICT ("character_id", "skill_id") DO UPDATE SET "total_xp" = GREATEST("character_skill_xp"."total_xp", EXCLUDED."total_xp"), "updated_at" = now();
--> statement-breakpoint
DELETE FROM "character_skill_xp" WHERE "skill_id" = 'metallurgy';
