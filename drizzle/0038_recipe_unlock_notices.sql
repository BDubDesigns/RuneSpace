CREATE TABLE "recipe_unlock_notices" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "recipe_unlock_notices_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"character_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"previous_level" integer NOT NULL,
	"level" integer NOT NULL,
	"recipe_action_ids" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "recipe_unlock_notices_seq_unique" UNIQUE("seq"),
	CONSTRAINT "recipe_unlock_notices_levels_check" CHECK ("recipe_unlock_notices"."previous_level" >= 1 and "recipe_unlock_notices"."level" > "recipe_unlock_notices"."previous_level"),
	CONSTRAINT "recipe_unlock_notices_recipes_check" CHECK (cardinality("recipe_unlock_notices"."recipe_action_ids") >= 1)
);
--> statement-breakpoint
ALTER TABLE "recipe_unlock_notices" ADD CONSTRAINT "recipe_unlock_notices_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_unlock_notices_character_seq_idx" ON "recipe_unlock_notices" USING btree ("character_id","seq");