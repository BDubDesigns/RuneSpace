import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Database schema (single source of truth for persistence shapes).
 *
 * This is the foundation migration only. No gameplay tables (inventory, XP,
 * quests, travel, ships, etc.) are defined here yet — those belong to later
 * issues and must be designed server-authoritatively, not speculatively.
 *
 * `schemaMeta` exists so the database has at least one real table for a smoke
 * health check without inventing game systems. It is intentionally trivial.
 */

export const schemaMeta = pgTable("schema_meta", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SchemaMeta = typeof schemaMeta.$inferSelect;
export type NewSchemaMeta = typeof schemaMeta.$inferInsert;
