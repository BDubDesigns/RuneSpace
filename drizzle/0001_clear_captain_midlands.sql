CREATE TABLE "active_actions" (
	"character_id" text PRIMARY KEY NOT NULL,
	"action_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"resolved_through_at" timestamp with time zone NOT NULL,
	CONSTRAINT "active_actions_cursor_after_start" CHECK ("active_actions"."resolved_through_at" >= "active_actions"."started_at")
);
--> statement-breakpoint
CREATE TABLE "character_skill_xp" (
	"character_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"total_xp" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_skill_xp_total_non_negative" CHECK ("character_skill_xp"."total_xp" >= 0)
);
--> statement-breakpoint
CREATE TABLE "equipped_items" (
	"character_id" text NOT NULL,
	"assignment_kind" text NOT NULL,
	"suit_slot_id" text NOT NULL,
	"item_instance_id" text NOT NULL,
	"equipped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipped_items_assignment_kind_valid" CHECK ("equipped_items"."assignment_kind" IN ('gear', 'container'))
);
--> statement-breakpoint
CREATE TABLE "inventory_stacks" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" text NOT NULL,
	"item_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_stacks_quantity_positive" CHECK ("inventory_stacks"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "item_instances" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" text NOT NULL,
	"item_id" text NOT NULL,
	"current_charge" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_instances_character_id_id_unique" UNIQUE("character_id","id"),
	CONSTRAINT "item_instances_current_charge_non_negative" CHECK ("item_instances"."current_charge" IS NULL OR "item_instances"."current_charge" >= 0)
);
--> statement-breakpoint
ALTER TABLE "active_actions" ADD CONSTRAINT "active_actions_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_skill_xp" ADD CONSTRAINT "character_skill_xp_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipped_items" ADD CONSTRAINT "equipped_items_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipped_items" ADD CONSTRAINT "equipped_items_owned_instance_fk" FOREIGN KEY ("character_id","item_instance_id") REFERENCES "public"."item_instances"("character_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stacks" ADD CONSTRAINT "inventory_stacks_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_instances" ADD CONSTRAINT "item_instances_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "character_skill_xp_character_skill_unique" ON "character_skill_xp" USING btree ("character_id","skill_id");--> statement-breakpoint
CREATE INDEX "character_skill_xp_character_id_idx" ON "character_skill_xp" USING btree ("character_id");--> statement-breakpoint
CREATE UNIQUE INDEX "equipped_items_character_slot_unique" ON "equipped_items" USING btree ("character_id","assignment_kind","suit_slot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "equipped_items_character_instance_unique" ON "equipped_items" USING btree ("character_id","item_instance_id");--> statement-breakpoint
CREATE INDEX "inventory_stacks_character_id_idx" ON "inventory_stacks" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "item_instances_character_id_idx" ON "item_instances" USING btree ("character_id");