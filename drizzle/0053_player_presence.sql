CREATE TABLE "player_presence" (
	"player_account_id" text PRIMARY KEY NOT NULL,
	"last_check_in_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_presence" ADD CONSTRAINT "player_presence_player_account_id_player_accounts_id_fk" FOREIGN KEY ("player_account_id") REFERENCES "public"."player_accounts"("id") ON DELETE cascade ON UPDATE no action;