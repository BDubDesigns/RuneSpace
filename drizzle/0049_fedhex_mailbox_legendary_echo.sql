CREATE TABLE "fedhex_parcels" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" text NOT NULL,
	"message_type" text NOT NULL,
	"source_key" text NOT NULL,
	"sender_kind" text NOT NULL,
	"sender_id" text NOT NULL,
	"sender_display_name" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"attachment_item_id" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_item_instance_id" text,
	CONSTRAINT "fedhex_parcels_claim_consistent" CHECK (("fedhex_parcels"."claimed_at" IS NULL) = ("fedhex_parcels"."claimed_item_instance_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "chat_messages" DROP CONSTRAINT "chat_messages_kind_check";--> statement-breakpoint
ALTER TABLE "echo_reading_notices" ADD COLUMN "reward_mailed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fedhex_parcels" ADD CONSTRAINT "fedhex_parcels_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fedhex_parcels_character_source_unique" ON "fedhex_parcels" USING btree ("character_id","source_key");--> statement-breakpoint
CREATE INDEX "fedhex_parcels_pending_idx" ON "fedhex_parcels" USING btree ("character_id","received_at") WHERE "fedhex_parcels"."claimed_at" IS NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_kind_check" CHECK ("chat_messages"."kind" in ('player', 'rare_find', 'ultra_rare_find', 'legendary_find'));