CREATE TABLE "character_merchant_daily_purchases" (
	"character_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"item_id" text NOT NULL,
	"reset_date" date NOT NULL,
	"quantity_purchased" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_merchant_daily_purchases_pk" PRIMARY KEY("character_id","merchant_id","item_id","reset_date"),
	CONSTRAINT "character_merchant_daily_purchases_quantity_positive" CHECK ("character_merchant_daily_purchases"."quantity_purchased" > 0)
);
--> statement-breakpoint
ALTER TABLE "character_merchant_daily_purchases" ADD CONSTRAINT "character_merchant_daily_purchases_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_merchant_daily_purchases_character_id_idx" ON "character_merchant_daily_purchases" USING btree ("character_id");