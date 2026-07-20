ALTER TABLE "character_mining_state"
  ADD COLUMN "run_attempts" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "run_successes" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "run_shale_gained" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "run_xp_gained" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "recent_attempts" jsonb DEFAULT '[]'::jsonb NOT NULL;
