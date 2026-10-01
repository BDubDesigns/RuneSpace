CREATE TABLE "player_trade_claims" (
	"character_id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_trade_requests" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_character_id" text NOT NULL,
	"requester_player_account_id" text NOT NULL,
	"recipient_character_id" text NOT NULL,
	"recipient_player_account_id" text NOT NULL,
	"location_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"session_id" text,
	CONSTRAINT "player_trade_requests_status_check" CHECK ("player_trade_requests"."status" in ('pending', 'accepted', 'canceled', 'declined', 'expired', 'invalidated')),
	CONSTRAINT "player_trade_requests_distinct_characters_check" CHECK ("player_trade_requests"."requester_character_id" <> "player_trade_requests"."recipient_character_id"),
	CONSTRAINT "player_trade_requests_resolved_check" CHECK (("player_trade_requests"."status" = 'pending') = ("player_trade_requests"."resolved_at" is null)),
	CONSTRAINT "player_trade_requests_session_check" CHECK (("player_trade_requests"."status" = 'accepted') = ("player_trade_requests"."session_id" is not null)),
	CONSTRAINT "player_trade_requests_expiry_check" CHECK ("player_trade_requests"."expires_at" > "player_trade_requests"."created_at")
);
--> statement-breakpoint
CREATE TABLE "player_trade_sessions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_character_id" text NOT NULL,
	"requester_player_account_id" text NOT NULL,
	"recipient_character_id" text NOT NULL,
	"recipient_player_account_id" text NOT NULL,
	"location_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by_character_id" text,
	CONSTRAINT "player_trade_sessions_status_check" CHECK ("player_trade_sessions"."status" in ('active', 'canceled', 'expired')),
	CONSTRAINT "player_trade_sessions_distinct_characters_check" CHECK ("player_trade_sessions"."requester_character_id" <> "player_trade_sessions"."recipient_character_id"),
	CONSTRAINT "player_trade_sessions_ended_check" CHECK (("player_trade_sessions"."status" = 'active') = ("player_trade_sessions"."ended_at" is null))
);
--> statement-breakpoint
ALTER TABLE "player_trade_claims" ADD CONSTRAINT "player_trade_claims_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trade_claims" ADD CONSTRAINT "player_trade_claims_session_id_player_trade_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."player_trade_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trade_requests" ADD CONSTRAINT "player_trade_requests_requester_character_id_characters_id_fk" FOREIGN KEY ("requester_character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trade_requests" ADD CONSTRAINT "player_trade_requests_requester_player_account_id_player_accounts_id_fk" FOREIGN KEY ("requester_player_account_id") REFERENCES "public"."player_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trade_requests" ADD CONSTRAINT "player_trade_requests_recipient_character_id_characters_id_fk" FOREIGN KEY ("recipient_character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trade_requests" ADD CONSTRAINT "player_trade_requests_recipient_player_account_id_player_accounts_id_fk" FOREIGN KEY ("recipient_player_account_id") REFERENCES "public"."player_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trade_requests" ADD CONSTRAINT "player_trade_requests_session_id_player_trade_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."player_trade_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trade_sessions" ADD CONSTRAINT "player_trade_sessions_requester_character_id_characters_id_fk" FOREIGN KEY ("requester_character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trade_sessions" ADD CONSTRAINT "player_trade_sessions_requester_player_account_id_player_accounts_id_fk" FOREIGN KEY ("requester_player_account_id") REFERENCES "public"."player_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trade_sessions" ADD CONSTRAINT "player_trade_sessions_recipient_character_id_characters_id_fk" FOREIGN KEY ("recipient_character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trade_sessions" ADD CONSTRAINT "player_trade_sessions_recipient_player_account_id_player_accounts_id_fk" FOREIGN KEY ("recipient_player_account_id") REFERENCES "public"."player_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trade_sessions" ADD CONSTRAINT "player_trade_sessions_ended_by_character_id_characters_id_fk" FOREIGN KEY ("ended_by_character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_trade_claims_session_idx" ON "player_trade_claims" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "player_trade_requests_one_pending_per_requester" ON "player_trade_requests" USING btree ("requester_character_id") WHERE "player_trade_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "player_trade_requests_recipient_pending_idx" ON "player_trade_requests" USING btree ("recipient_character_id") WHERE "player_trade_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "player_trade_requests_account_created_idx" ON "player_trade_requests" USING btree ("requester_player_account_id","created_at");--> statement-breakpoint
CREATE INDEX "player_trade_requests_account_pair_created_idx" ON "player_trade_requests" USING btree ("requester_player_account_id","recipient_player_account_id","created_at");--> statement-breakpoint
CREATE INDEX "player_trade_requests_created_idx" ON "player_trade_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "player_trade_sessions_requester_idx" ON "player_trade_sessions" USING btree ("requester_character_id");--> statement-breakpoint
CREATE INDEX "player_trade_sessions_recipient_idx" ON "player_trade_sessions" USING btree ("recipient_character_id");