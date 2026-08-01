CREATE TABLE "character_power_cell_daily_claims" (
	"character_id" text NOT NULL,
	"reward_source_id" text NOT NULL,
	"reset_date" date NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_power_cell_daily_claims_pk" PRIMARY KEY("character_id","reward_source_id","reset_date")
);
--> statement-breakpoint
ALTER TABLE "character_power_cell_daily_claims" ADD CONSTRAINT "character_power_cell_daily_claims_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "character_power_cell_daily_claims_character_id_idx" ON "character_power_cell_daily_claims" USING btree ("character_id");
