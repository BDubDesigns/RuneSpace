DROP INDEX "equipped_items_character_slot_unique";--> statement-breakpoint
ALTER TABLE "equipped_items" ADD COLUMN "assignment_kind" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "equipped_items_character_slot_unique" ON "equipped_items" USING btree ("character_id","assignment_kind","suit_slot_id");--> statement-breakpoint
ALTER TABLE "equipped_items" ADD CONSTRAINT "equipped_items_assignment_kind_valid" CHECK ("equipped_items"."assignment_kind" IN ('gear', 'container'));