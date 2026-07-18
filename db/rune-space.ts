import { relations, sql } from "drizzle-orm";
import { pgTable, text, integer, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * RuneSpace ownership tables (single source of truth for account/character
 * domain state).
 *
 * Boundary (see issue #6 and docs/architecture.md):
 * - Better Auth owns identity/sessions (`user`, `session`, `account`,
 *   `verification` in `auth-schema.ts`).
 * - `player_accounts` is the RuneSpace account boundary: exactly ONE per Better
 *   Auth user (unique FK).
 * - `characters` belong to a player account, with exactly THREE slots (1..3)
 *   enforced structurally by a CHECK plus a unique (player_account_id, slot).
 * - Character names are globally unique after normalization; the original display
 *   capitalization is preserved for presentation.
 *
 * Deletion behavior is intentionally RESTRICT: deleting a Better Auth user must
 * NOT silently cascade years of character data. Account deletion is out of scope.
 */

export const SLOT_MIN = 1;
export const SLOT_MAX = 3;

export const playerAccounts = pgTable(
  "player_accounts",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // Stable 1:1 link to the Better Auth user. Unique so repeated
    // initialization (or future login providers) cannot create duplicates.
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("player_accounts_user_id_idx").on(table.userId)],
);

export const characters = pgTable(
  "characters",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    playerAccountId: text("player_account_id")
      .notNull()
      .references(() => playerAccounts.id, { onDelete: "restrict" }),
    // Slot 1..3, structurally bounded and unique per account.
    slot: integer("slot").notNull(),
    // Preserved player-facing name (original capitalization).
    displayName: text("display_name").notNull(),
    // Folded comparison key; globally unique across all accounts.
    normalizedName: text("normalized_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    // Only set when a character is actually entered/played. Null until first play.
    lastPlayedAt: timestamp("last_played_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "characters_slot_range",
      sql`${table.slot} >= ${sql.raw(String(SLOT_MIN))} AND ${table.slot} <= ${sql.raw(String(SLOT_MAX))}`,
    ),
    uniqueIndex("characters_account_slot_unique").on(table.playerAccountId, table.slot),
    uniqueIndex("characters_normalized_name_unique").on(table.normalizedName),
    index("characters_player_account_id_idx").on(table.playerAccountId),
  ],
);

export const playerAccountsRelations = relations(playerAccounts, ({ one, many }) => ({
  user: one(user, {
    fields: [playerAccounts.userId],
    references: [user.id],
  }),
  characters: many(characters),
}));

export const charactersRelations = relations(characters, ({ one }) => ({
  playerAccount: one(playerAccounts, {
    fields: [characters.playerAccountId],
    references: [playerAccounts.id],
  }),
}));

export type PlayerAccount = typeof playerAccounts.$inferSelect;
export type NewPlayerAccount = typeof playerAccounts.$inferInsert;
export type Character = typeof characters.$inferSelect;
export type NewCharacter = typeof characters.$inferInsert;
