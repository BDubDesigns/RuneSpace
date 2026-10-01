CREATE TABLE "player_trade_audits" (
	"trade_id" text PRIMARY KEY NOT NULL,
	"committed_at" timestamp with time zone NOT NULL,
	"location_id" text NOT NULL,
	"requester_player_account_id" text NOT NULL,
	"requester_character_id" text NOT NULL,
	"recipient_player_account_id" text NOT NULL,
	"recipient_character_id" text NOT NULL,
	"requester_credits" integer NOT NULL,
	"recipient_credits" integer NOT NULL,
	"requester_stacks" jsonb NOT NULL,
	"recipient_stacks" jsonb NOT NULL,
	"requester_items" jsonb NOT NULL,
	"recipient_items" jsonb NOT NULL,
	CONSTRAINT "player_trade_audits_credits_check" CHECK ("player_trade_audits"."requester_credits" >= 0 and "player_trade_audits"."recipient_credits" >= 0),
	CONSTRAINT "player_trade_audits_offers_shape_check" CHECK (jsonb_typeof("player_trade_audits"."requester_stacks") = 'array' and jsonb_typeof("player_trade_audits"."recipient_stacks") = 'array' and jsonb_typeof("player_trade_audits"."requester_items") = 'array' and jsonb_typeof("player_trade_audits"."recipient_items") = 'array'),
	CONSTRAINT "player_trade_audits_distinct_characters_check" CHECK ("player_trade_audits"."requester_character_id" <> "player_trade_audits"."recipient_character_id")
);
--> statement-breakpoint
CREATE TABLE "player_trade_offer_items" (
	"session_id" text NOT NULL,
	"character_id" text NOT NULL,
	"item_instance_id" text NOT NULL,
	CONSTRAINT "player_trade_offer_items_pk" PRIMARY KEY("session_id","item_instance_id")
);
--> statement-breakpoint
CREATE TABLE "player_trade_offer_stacks" (
	"session_id" text NOT NULL,
	"character_id" text NOT NULL,
	"item_id" text NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "player_trade_offer_stacks_pk" PRIMARY KEY("session_id","character_id","item_id"),
	CONSTRAINT "player_trade_offer_stacks_quantity_check" CHECK ("player_trade_offer_stacks"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "player_trade_sessions" DROP CONSTRAINT "player_trade_sessions_status_check";--> statement-breakpoint
ALTER TABLE "player_trade_sessions" ADD COLUMN "offer_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_trade_sessions" ADD COLUMN "requester_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_trade_sessions" ADD COLUMN "recipient_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_trade_sessions" ADD COLUMN "requester_ready" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "player_trade_sessions" ADD COLUMN "recipient_ready" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "player_trade_sessions" ADD COLUMN "requester_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "player_trade_sessions" ADD COLUMN "recipient_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "player_trade_audits" ADD CONSTRAINT "player_trade_audits_trade_id_player_trade_sessions_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."player_trade_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trade_audits" ADD CONSTRAINT "player_trade_audits_requester_player_account_id_player_accounts_id_fk" FOREIGN KEY ("requester_player_account_id") REFERENCES "public"."player_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trade_audits" ADD CONSTRAINT "player_trade_audits_requester_character_id_characters_id_fk" FOREIGN KEY ("requester_character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trade_audits" ADD CONSTRAINT "player_trade_audits_recipient_player_account_id_player_accounts_id_fk" FOREIGN KEY ("recipient_player_account_id") REFERENCES "public"."player_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trade_audits" ADD CONSTRAINT "player_trade_audits_recipient_character_id_characters_id_fk" FOREIGN KEY ("recipient_character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trade_offer_items" ADD CONSTRAINT "player_trade_offer_items_session_id_player_trade_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."player_trade_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trade_offer_items" ADD CONSTRAINT "player_trade_offer_items_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trade_offer_stacks" ADD CONSTRAINT "player_trade_offer_stacks_session_id_player_trade_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."player_trade_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trade_offer_stacks" ADD CONSTRAINT "player_trade_offer_stacks_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_trade_audits_requester_account_idx" ON "player_trade_audits" USING btree ("requester_player_account_id","committed_at");--> statement-breakpoint
CREATE INDEX "player_trade_audits_recipient_account_idx" ON "player_trade_audits" USING btree ("recipient_player_account_id","committed_at");--> statement-breakpoint
CREATE INDEX "player_trade_audits_requester_character_idx" ON "player_trade_audits" USING btree ("requester_character_id","committed_at");--> statement-breakpoint
CREATE INDEX "player_trade_audits_recipient_character_idx" ON "player_trade_audits" USING btree ("recipient_character_id","committed_at");--> statement-breakpoint
ALTER TABLE "player_trade_sessions" ADD CONSTRAINT "player_trade_sessions_offer_version_check" CHECK ("player_trade_sessions"."offer_version" >= 1);--> statement-breakpoint
ALTER TABLE "player_trade_sessions" ADD CONSTRAINT "player_trade_sessions_credits_check" CHECK ("player_trade_sessions"."requester_credits" >= 0 and "player_trade_sessions"."recipient_credits" >= 0);--> statement-breakpoint
ALTER TABLE "player_trade_sessions" ADD CONSTRAINT "player_trade_sessions_confirm_check" CHECK (not ("player_trade_sessions"."requester_confirmed" or "player_trade_sessions"."recipient_confirmed") or ("player_trade_sessions"."requester_ready" and "player_trade_sessions"."recipient_ready"));--> statement-breakpoint
ALTER TABLE "player_trade_sessions" ADD CONSTRAINT "player_trade_sessions_completed_check" CHECK ("player_trade_sessions"."status" <> 'completed' or ("player_trade_sessions"."requester_confirmed" and "player_trade_sessions"."recipient_confirmed" and "player_trade_sessions"."ended_by_character_id" is null));--> statement-breakpoint
ALTER TABLE "player_trade_sessions" ADD CONSTRAINT "player_trade_sessions_status_check" CHECK ("player_trade_sessions"."status" in ('active', 'canceled', 'expired', 'completed'));