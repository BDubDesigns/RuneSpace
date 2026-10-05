ALTER TABLE "chat_messages" ALTER COLUMN "sender_player_account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ALTER COLUMN "sender_character_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ALTER COLUMN "sender_character_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "kind" text DEFAULT 'player' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_kind_check" CHECK ("chat_messages"."kind" in ('player', 'rare_find'));--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_check" CHECK (("chat_messages"."kind" = 'player') = ("chat_messages"."sender_player_account_id" is not null and "chat_messages"."sender_character_id" is not null and "chat_messages"."sender_character_name" is not null)
        and ("chat_messages"."kind" = 'player' or ("chat_messages"."sender_player_account_id" is null and "chat_messages"."sender_character_id" is null and "chat_messages"."sender_character_name" is null and "chat_messages"."channel" = 'general')));--> statement-breakpoint
-- One-time, idempotent data step (#308): Mining attempts now carry
-- "secondaryFinds". Every attempt already stored in a run's bounded history was
-- resolved before Secondary Finds existed, so it found none. Writing that fact
-- once here keeps the read path free of a permanent "field may be missing"
-- branch. Re-running changes nothing: only attempts without the key are touched.
UPDATE "character_mining_state"
SET "recent_attempts" = (
	SELECT COALESCE(
		jsonb_agg(
			CASE WHEN jsonb_typeof(attempt) = 'object' AND NOT attempt ? 'secondaryFinds'
				THEN attempt || '{"secondaryFinds": []}'::jsonb
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
		WHERE jsonb_typeof(attempt) = 'object' AND NOT attempt ? 'secondaryFinds'
	);
