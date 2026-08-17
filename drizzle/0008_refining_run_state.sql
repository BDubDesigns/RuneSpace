-- Issue #81: Refining run state
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
