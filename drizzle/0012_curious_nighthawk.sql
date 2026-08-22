CREATE TABLE "cargo_hold_item_instances" (
	"character_id" text NOT NULL,
	"item_instance_id" text NOT NULL,
	"stored_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cargo_hold_item_instances_pk" PRIMARY KEY("character_id","item_instance_id")
);
--> statement-breakpoint
CREATE TABLE "cargo_hold_stacks" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" text NOT NULL,
	"item_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cargo_hold_stacks_quantity_positive" CHECK ("cargo_hold_stacks"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "character_cargo_hold_repair" (
	"character_id" text PRIMARY KEY NOT NULL,
	"refined_ferrite_contributed" integer DEFAULT 0 NOT NULL,
	"slag_contributed" integer DEFAULT 0 NOT NULL,
	"welding_progress" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_cargo_hold_repair_refined_ferrite_range" CHECK ("character_cargo_hold_repair"."refined_ferrite_contributed" >= 0 AND "character_cargo_hold_repair"."refined_ferrite_contributed" <= 15),
	CONSTRAINT "character_cargo_hold_repair_slag_range" CHECK ("character_cargo_hold_repair"."slag_contributed" >= 0 AND "character_cargo_hold_repair"."slag_contributed" <= 6),
	CONSTRAINT "character_cargo_hold_repair_welding_range" CHECK ("character_cargo_hold_repair"."welding_progress" >= 0 AND "character_cargo_hold_repair"."welding_progress" <= 12),
	CONSTRAINT "character_cargo_hold_repair_progress_requires_materials" CHECK ("character_cargo_hold_repair"."welding_progress" = 0 OR ("character_cargo_hold_repair"."refined_ferrite_contributed" = 15 AND "character_cargo_hold_repair"."slag_contributed" = 6)),
	CONSTRAINT "character_cargo_hold_repair_completion_requires_full_state" CHECK ("character_cargo_hold_repair"."completed_at" IS NULL OR ("character_cargo_hold_repair"."refined_ferrite_contributed" = 15 AND "character_cargo_hold_repair"."slag_contributed" = 6 AND "character_cargo_hold_repair"."welding_progress" = 12))
);
--> statement-breakpoint
ALTER TABLE "cargo_hold_item_instances" ADD CONSTRAINT "cargo_hold_item_instances_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_hold_item_instances" ADD CONSTRAINT "cargo_hold_item_instances_owned_instance_fk" FOREIGN KEY ("character_id","item_instance_id") REFERENCES "public"."item_instances"("character_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_hold_stacks" ADD CONSTRAINT "cargo_hold_stacks_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_cargo_hold_repair" ADD CONSTRAINT "character_cargo_hold_repair_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cargo_hold_item_instances_character_id_idx" ON "cargo_hold_item_instances" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "cargo_hold_stacks_character_id_idx" ON "cargo_hold_stacks" USING btree ("character_id");