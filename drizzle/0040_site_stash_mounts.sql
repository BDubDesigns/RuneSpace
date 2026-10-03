CREATE TABLE "site_stash_containers" (
	"character_id" text NOT NULL,
	"location_id" text NOT NULL,
	"item_instance_id" text NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_stash_containers_pk" PRIMARY KEY("character_id","location_id"),
	CONSTRAINT "site_stash_containers_character_instance_unique" UNIQUE("character_id","item_instance_id")
);
--> statement-breakpoint
CREATE TABLE "site_stash_item_instances" (
	"character_id" text NOT NULL,
	"location_id" text NOT NULL,
	"item_instance_id" text NOT NULL,
	"stored_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_stash_item_instances_pk" PRIMARY KEY("character_id","item_instance_id")
);
--> statement-breakpoint
CREATE TABLE "site_stash_stacks" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" text NOT NULL,
	"location_id" text NOT NULL,
	"item_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_stash_stacks_quantity_positive" CHECK ("site_stash_stacks"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "site_stash_containers" ADD CONSTRAINT "site_stash_containers_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_stash_containers" ADD CONSTRAINT "site_stash_containers_owned_instance_fk" FOREIGN KEY ("character_id","item_instance_id") REFERENCES "public"."item_instances"("character_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_stash_item_instances" ADD CONSTRAINT "site_stash_item_instances_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_stash_item_instances" ADD CONSTRAINT "site_stash_item_instances_owned_instance_fk" FOREIGN KEY ("character_id","item_instance_id") REFERENCES "public"."item_instances"("character_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_stash_item_instances" ADD CONSTRAINT "site_stash_item_instances_installed_container_fk" FOREIGN KEY ("character_id","location_id") REFERENCES "public"."site_stash_containers"("character_id","location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_stash_stacks" ADD CONSTRAINT "site_stash_stacks_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_stash_stacks" ADD CONSTRAINT "site_stash_stacks_installed_container_fk" FOREIGN KEY ("character_id","location_id") REFERENCES "public"."site_stash_containers"("character_id","location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_stash_item_instances_character_location_idx" ON "site_stash_item_instances" USING btree ("character_id","location_id");--> statement-breakpoint
CREATE INDEX "site_stash_stacks_character_location_idx" ON "site_stash_stacks" USING btree ("character_id","location_id");