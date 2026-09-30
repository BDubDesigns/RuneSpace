CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "chat_messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"channel" text NOT NULL,
	"sender_player_account_id" text NOT NULL,
	"sender_character_id" text NOT NULL,
	"sender_character_name" text NOT NULL,
	"body" text NOT NULL,
	"promoted_price_credits" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_messages_seq_unique" UNIQUE("seq"),
	CONSTRAINT "chat_messages_channel_check" CHECK ("chat_messages"."channel" in ('general', 'trade')),
	CONSTRAINT "chat_messages_body_length_check" CHECK (char_length("chat_messages"."body") between 1 and 280),
	CONSTRAINT "chat_messages_promoted_check" CHECK ("chat_messages"."promoted_price_credits" is null or ("chat_messages"."promoted_price_credits" > 0 and "chat_messages"."channel" = 'trade'))
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_player_account_id_player_accounts_id_fk" FOREIGN KEY ("sender_player_account_id") REFERENCES "public"."player_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_character_id_characters_id_fk" FOREIGN KEY ("sender_character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_channel_seq_idx" ON "chat_messages" USING btree ("channel","seq");--> statement-breakpoint
CREATE INDEX "chat_messages_promoted_seq_idx" ON "chat_messages" USING btree ("seq") WHERE "chat_messages"."promoted_price_credits" is not null;--> statement-breakpoint
CREATE INDEX "chat_messages_sender_account_created_idx" ON "chat_messages" USING btree ("sender_player_account_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_created_idx" ON "chat_messages" USING btree ("created_at");