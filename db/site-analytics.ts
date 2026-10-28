import { check, date, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Daily aggregate visit counts by referral source (issue #425).
 *
 * One row per UTC day and sanitized label set, holding nothing but a count of
 * public page loads. There is no event, visitor, session, device, address,
 * User-Agent, raw Referer, or URL anywhere in this table, and nothing here can
 * be joined to an account. The label columns are NOT NULL with `''` meaning
 * "not set", so the composite primary key is also the race-safe conflict target
 * for `INSERT ... ON CONFLICT DO UPDATE SET visits = visits + 1`.
 *
 * Retention (25 months) is enforced by `pruneReferralCounts`. The persistence
 * and its privacy rules live in `server/referral-counts.ts`; the contract is in
 * `docs/analytics.md`.
 */
export const referralDailyCounts = pgTable(
  "referral_daily_counts",
  {
    day: date("day", { mode: "string" }).notNull(),
    sourceGroup: text("source_group").notNull(),
    utmSource: text("utm_source").notNull().default(""),
    utmMedium: text("utm_medium").notNull().default(""),
    utmCampaign: text("utm_campaign").notNull().default(""),
    routeCategory: text("route_category").notNull(),
    visits: integer("visits").notNull().default(0),
  },
  (table) => [
    primaryKey({
      name: "referral_daily_counts_pk",
      columns: [
        table.day,
        table.sourceGroup,
        table.utmSource,
        table.utmMedium,
        table.utmCampaign,
        table.routeCategory,
      ],
    }),
    check("referral_daily_counts_visits_nonnegative", sql`${table.visits} >= 0`),
    check(
      "referral_daily_counts_label_length",
      sql`char_length(${table.sourceGroup}) <= 32 and char_length(${table.utmSource}) <= 64 and char_length(${table.utmMedium}) <= 64 and char_length(${table.utmCampaign}) <= 64 and char_length(${table.routeCategory}) <= 32`,
    ),
  ],
);
