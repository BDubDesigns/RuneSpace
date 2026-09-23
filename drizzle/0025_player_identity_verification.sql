CREATE TABLE "account_abuse_events" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"ip_bucket" text NOT NULL,
	"email_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_abuse_events_kind_check" CHECK ("account_abuse_events"."kind" in ('signup_attempt', 'verification_resend', 'verification_dispatch'))
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "display_username" text;--> statement-breakpoint
CREATE INDEX "account_abuse_events_kind_ip_created_idx" ON "account_abuse_events" USING btree ("kind","ip_bucket","created_at");--> statement-breakpoint
CREATE INDEX "account_abuse_events_kind_email_created_idx" ON "account_abuse_events" USING btree ("kind","email_key","created_at");--> statement-breakpoint
CREATE INDEX "account_abuse_events_created_idx" ON "account_abuse_events" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_username_unique" UNIQUE("username");