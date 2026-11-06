CREATE TABLE "character_theatre_buffs" (
	"character_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"remaining_charges" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "character_theatre_buffs_pk" PRIMARY KEY("character_id","skill_id"),
	CONSTRAINT "character_theatre_buffs_remaining_not_negative" CHECK ("character_theatre_buffs"."remaining_charges" >= 0)
);
--> statement-breakpoint
CREATE TABLE "character_theatre_latest_tickets" (
	"character_id" text PRIMARY KEY NOT NULL,
	"receipt_id" text NOT NULL,
	"film_id" text NOT NULL,
	"showtime_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_theatre_receipts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" text NOT NULL,
	"film_id" text NOT NULL,
	"showtime_id" text NOT NULL,
	"screen_id" text NOT NULL,
	"showing_id" text NOT NULL,
	"tier_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"credits_paid" integer NOT NULL,
	"tier_capacity" integer NOT NULL,
	"charges_before" integer NOT NULL,
	"charges_after" integer NOT NULL,
	"purchased_at" timestamp with time zone NOT NULL,
	CONSTRAINT "character_theatre_receipts_purchase_shape" CHECK ("character_theatre_receipts"."credits_paid" > 0 AND "character_theatre_receipts"."tier_capacity" > 0 AND "character_theatre_receipts"."charges_before" >= 0 AND "character_theatre_receipts"."charges_after" >= "character_theatre_receipts"."charges_before" AND "character_theatre_receipts"."charges_after" >= "character_theatre_receipts"."tier_capacity")
);
--> statement-breakpoint
ALTER TABLE "character_theatre_buffs" ADD CONSTRAINT "character_theatre_buffs_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_theatre_latest_tickets" ADD CONSTRAINT "character_theatre_latest_tickets_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_theatre_latest_tickets" ADD CONSTRAINT "character_theatre_latest_tickets_receipt_id_character_theatre_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."character_theatre_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_theatre_receipts" ADD CONSTRAINT "character_theatre_receipts_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "character_theatre_receipts_character_film_showtime_uq" ON "character_theatre_receipts" USING btree ("character_id","film_id","showtime_id");--> statement-breakpoint
CREATE INDEX "character_theatre_receipts_character_id_idx" ON "character_theatre_receipts" USING btree ("character_id");