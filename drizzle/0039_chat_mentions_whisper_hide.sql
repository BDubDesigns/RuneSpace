CREATE TABLE "chat_message_mentions" (
	"message_id" text NOT NULL,
	"mentioned_character_id" text NOT NULL,
	"mentioned_player_account_id" text NOT NULL,
	"mentioned_character_name" text NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "chat_message_mentions_message_id_mentioned_character_id_pk" PRIMARY KEY("message_id","mentioned_character_id")
);
--> statement-breakpoint
ALTER TABLE "whisper_participants" ADD COLUMN "hidden_through_seq" bigint;--> statement-breakpoint
ALTER TABLE "chat_message_mentions" ADD CONSTRAINT "chat_message_mentions_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_mentions" ADD CONSTRAINT "chat_message_mentions_mentioned_character_id_characters_id_fk" FOREIGN KEY ("mentioned_character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_mentions" ADD CONSTRAINT "chat_message_mentions_mentioned_player_account_id_player_accounts_id_fk" FOREIGN KEY ("mentioned_player_account_id") REFERENCES "public"."player_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_message_mentions_unread_idx" ON "chat_message_mentions" USING btree ("mentioned_character_id") WHERE "chat_message_mentions"."read_at" is null;