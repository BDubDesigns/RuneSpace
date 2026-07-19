CREATE TABLE "character_mining_state" (
	"character_id" text PRIMARY KEY NOT NULL,
	"last_stop_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_starter_provisioning" (
	"character_id" text PRIMARY KEY NOT NULL,
	"provisioned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "character_mining_state" ADD CONSTRAINT "character_mining_state_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_starter_provisioning" ADD CONSTRAINT "character_starter_provisioning_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;