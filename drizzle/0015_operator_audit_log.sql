CREATE TABLE "operator_audit_logs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" text NOT NULL,
	"character_id" text NOT NULL,
	"operation" text NOT NULL,
	"target_identity" text,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operator_audit_logs" ADD CONSTRAINT "operator_audit_logs_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operator_audit_logs_character_created_idx" ON "operator_audit_logs" USING btree ("character_id","created_at");