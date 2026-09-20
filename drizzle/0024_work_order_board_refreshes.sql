CREATE TABLE "character_work_order_board_refreshes" (
	"character_id" text NOT NULL,
	"reset_date" date NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_work_order_board_refreshes_pk" PRIMARY KEY("character_id","reset_date")
);
--> statement-breakpoint
ALTER TABLE "character_work_order_board_refreshes" ADD CONSTRAINT "character_work_order_board_refreshes_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_work_order_board_refreshes_character_id_idx" ON "character_work_order_board_refreshes" USING btree ("character_id");