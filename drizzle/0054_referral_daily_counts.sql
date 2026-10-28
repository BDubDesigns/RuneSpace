CREATE TABLE "referral_daily_counts" (
	"day" date NOT NULL,
	"source_group" text NOT NULL,
	"utm_source" text DEFAULT '' NOT NULL,
	"utm_medium" text DEFAULT '' NOT NULL,
	"utm_campaign" text DEFAULT '' NOT NULL,
	"route_category" text NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "referral_daily_counts_pk" PRIMARY KEY("day","source_group","utm_source","utm_medium","utm_campaign","route_category"),
	CONSTRAINT "referral_daily_counts_visits_nonnegative" CHECK ("referral_daily_counts"."visits" >= 0),
	CONSTRAINT "referral_daily_counts_label_length" CHECK (char_length("referral_daily_counts"."source_group") <= 32 and char_length("referral_daily_counts"."utm_source") <= 64 and char_length("referral_daily_counts"."utm_medium") <= 64 and char_length("referral_daily_counts"."utm_campaign") <= 64 and char_length("referral_daily_counts"."route_category") <= 32)
);
