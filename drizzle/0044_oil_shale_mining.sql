ALTER TABLE "chat_messages" DROP CONSTRAINT "chat_messages_kind_check";--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "prioritize_primary_resources" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_kind_check" CHECK ("chat_messages"."kind" in ('player', 'rare_find', 'ultra_rare_find'));--> statement-breakpoint
-- One-time, idempotent data step (#342): Mining attempts now carry "lowYield".
-- Every attempt already stored in a run's bounded history was resolved before
-- low-yield outcomes existed, so none was one. Writing that fact once here keeps
-- the read path free of a permanent "field may be missing" branch. Re-running
-- changes nothing: only attempts without the key are touched.
UPDATE "character_mining_state"
SET "recent_attempts" = (
	SELECT COALESCE(
		jsonb_agg(
			CASE WHEN jsonb_typeof(attempt) = 'object' AND NOT attempt ? 'lowYield'
				THEN attempt || '{"lowYield": false}'::jsonb
				ELSE attempt
			END
			ORDER BY position
		),
		'[]'::jsonb
	)
	FROM jsonb_array_elements("character_mining_state"."recent_attempts") WITH ORDINALITY AS history(attempt, position)
)
WHERE jsonb_typeof("recent_attempts") = 'array'
	AND jsonb_array_length("recent_attempts") > 0
	AND EXISTS (
		SELECT 1
		FROM jsonb_array_elements("recent_attempts") AS stored(attempt)
		WHERE jsonb_typeof(attempt) = 'object' AND NOT attempt ? 'lowYield'
	);
