CREATE TABLE "player_block_events" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"blocker_player_account_id" text NOT NULL,
	"blocked_player_account_id" text NOT NULL,
	"blocker_character_id" text NOT NULL,
	"blocked_character_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_block_events_kind_check" CHECK ("player_block_events"."kind" in ('block', 'unblock'))
);
--> statement-breakpoint
CREATE TABLE "player_blocks" (
	"blocker_player_account_id" text NOT NULL,
	"blocked_player_account_id" text NOT NULL,
	"blocker_character_id" text NOT NULL,
	"blocked_character_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_blocks_blocker_player_account_id_blocked_player_account_id_pk" PRIMARY KEY("blocker_player_account_id","blocked_player_account_id"),
	CONSTRAINT "player_blocks_distinct_accounts_check" CHECK ("player_blocks"."blocker_player_account_id" <> "player_blocks"."blocked_player_account_id")
);
--> statement-breakpoint
CREATE TABLE "player_reports" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"reporter_player_account_id" text NOT NULL,
	"reporter_character_id" text NOT NULL,
	"reported_player_account_id" text NOT NULL,
	"reported_character_id" text NOT NULL,
	"reported_character_name" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"message_id" text,
	"channel" text,
	"conversation_id" text,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_reports_kind_check" CHECK ("player_reports"."kind" in ('message', 'player')),
	CONSTRAINT "player_reports_reason_check" CHECK ("player_reports"."reason" in ('harassment_hate', 'threats', 'spam_scam', 'sexual_inappropriate', 'offensive_name_profile', 'other')),
	CONSTRAINT "player_reports_message_check" CHECK (("player_reports"."kind" = 'message') = ("player_reports"."message_id" is not null and "player_reports"."channel" is not null and "player_reports"."evidence" is not null)),
	CONSTRAINT "player_reports_conversation_check" CHECK (("player_reports"."channel" = 'whisper') = ("player_reports"."conversation_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "whisper_conversations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whisper_conversations_participant_key_unique" UNIQUE("participant_key")
);
--> statement-breakpoint
CREATE TABLE "whisper_participants" (
	"conversation_id" text NOT NULL,
	"character_id" text NOT NULL,
	"player_account_id" text NOT NULL,
	"last_read_seq" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "whisper_participants_conversation_id_character_id_pk" PRIMARY KEY("conversation_id","character_id")
);
--> statement-breakpoint
ALTER TABLE "chat_messages" DROP CONSTRAINT "chat_messages_channel_check";--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "player_block_events" ADD CONSTRAINT "player_block_events_blocker_player_account_id_player_accounts_id_fk" FOREIGN KEY ("blocker_player_account_id") REFERENCES "public"."player_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_block_events" ADD CONSTRAINT "player_block_events_blocked_player_account_id_player_accounts_id_fk" FOREIGN KEY ("blocked_player_account_id") REFERENCES "public"."player_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_block_events" ADD CONSTRAINT "player_block_events_blocker_character_id_characters_id_fk" FOREIGN KEY ("blocker_character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_block_events" ADD CONSTRAINT "player_block_events_blocked_character_id_characters_id_fk" FOREIGN KEY ("blocked_character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_blocks" ADD CONSTRAINT "player_blocks_blocker_player_account_id_player_accounts_id_fk" FOREIGN KEY ("blocker_player_account_id") REFERENCES "public"."player_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_blocks" ADD CONSTRAINT "player_blocks_blocked_player_account_id_player_accounts_id_fk" FOREIGN KEY ("blocked_player_account_id") REFERENCES "public"."player_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_blocks" ADD CONSTRAINT "player_blocks_blocker_character_id_characters_id_fk" FOREIGN KEY ("blocker_character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_blocks" ADD CONSTRAINT "player_blocks_blocked_character_id_characters_id_fk" FOREIGN KEY ("blocked_character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_reports" ADD CONSTRAINT "player_reports_reporter_player_account_id_player_accounts_id_fk" FOREIGN KEY ("reporter_player_account_id") REFERENCES "public"."player_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_reports" ADD CONSTRAINT "player_reports_reporter_character_id_characters_id_fk" FOREIGN KEY ("reporter_character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_reports" ADD CONSTRAINT "player_reports_reported_player_account_id_player_accounts_id_fk" FOREIGN KEY ("reported_player_account_id") REFERENCES "public"."player_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_reports" ADD CONSTRAINT "player_reports_reported_character_id_characters_id_fk" FOREIGN KEY ("reported_character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_reports" ADD CONSTRAINT "player_reports_conversation_id_whisper_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."whisper_conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whisper_participants" ADD CONSTRAINT "whisper_participants_conversation_id_whisper_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."whisper_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whisper_participants" ADD CONSTRAINT "whisper_participants_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whisper_participants" ADD CONSTRAINT "whisper_participants_player_account_id_player_accounts_id_fk" FOREIGN KEY ("player_account_id") REFERENCES "public"."player_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_block_events_blocked_created_idx" ON "player_block_events" USING btree ("blocked_player_account_id","created_at");--> statement-breakpoint
CREATE INDEX "player_block_events_blocker_created_idx" ON "player_block_events" USING btree ("blocker_player_account_id","created_at");--> statement-breakpoint
CREATE INDEX "player_blocks_blocked_idx" ON "player_blocks" USING btree ("blocked_player_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "player_reports_reporter_message_idx" ON "player_reports" USING btree ("reporter_player_account_id","message_id") WHERE "player_reports"."message_id" is not null;--> statement-breakpoint
CREATE INDEX "player_reports_reported_created_idx" ON "player_reports" USING btree ("reported_player_account_id","created_at");--> statement-breakpoint
CREATE INDEX "whisper_participants_character_idx" ON "whisper_participants" USING btree ("character_id");--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_whisper_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."whisper_conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_conversation_seq_idx" ON "chat_messages" USING btree ("conversation_id","seq") WHERE "chat_messages"."conversation_id" is not null;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_check" CHECK (("chat_messages"."channel" = 'whisper') = ("chat_messages"."conversation_id" is not null));--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_channel_check" CHECK ("chat_messages"."channel" in ('general', 'trade', 'whisper'));