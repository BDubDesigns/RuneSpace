CREATE TABLE "player_portrait_unlocks" (
	"player_account_id" text NOT NULL,
	"portrait_id" text NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "player_portrait_unlocks_account_portrait_pk" PRIMARY KEY("player_account_id","portrait_id")
);
--> statement-breakpoint
ALTER TABLE "player_portrait_unlocks" ADD CONSTRAINT "player_portrait_unlocks_player_account_id_player_accounts_id_fk" FOREIGN KEY ("player_account_id") REFERENCES "public"."player_accounts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "player_portrait_unlocks_account_idx" ON "player_portrait_unlocks" USING btree ("player_account_id");
