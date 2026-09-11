-- Issue #159: character-scoped Credits for the first merchant economy.
-- - Every character owns exactly one authoritative balance.
-- - The approved starting balance is the same ten Credits for new characters
--   and for existing pre-beta characters, so the column default backfills every
--   existing row in this one statement. No cohort-specific repair script is
--   needed: there is no cohort, only one uniform value.
-- - The CHECK is the durable guarantee that no command can ever commit a
--   negative balance, independent of application-level validation.
ALTER TABLE "characters" ADD COLUMN "credits" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_credits_non_negative" CHECK ("characters"."credits" >= 0);