import { relations, sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
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

/** Total skill XP is persisted; levels remain a domain-derived value. */
export const characterSkillXp = pgTable(
  "character_skill_xp",
  {
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    skillId: text("skill_id").notNull(),
    totalXp: bigint("total_xp", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("character_skill_xp_total_non_negative", sql`${table.totalXp} >= 0`),
    uniqueIndex("character_skill_xp_character_skill_unique").on(table.characterId, table.skillId),
    index("character_skill_xp_character_id_idx").on(table.characterId),
  ],
);

/** Fungible carried items. Each row represents exactly one occupied inventory slot. */
export const inventoryStacks = pgTable(
  "inventory_stacks",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    itemId: text("item_id").notNull(),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("inventory_stacks_quantity_positive", sql`${table.quantity} > 0`),
    index("inventory_stacks_character_id_idx").on(table.characterId),
  ],
);

/**
 * Non-stackable items retain mutable instance state only. Their shared item
 * facts belong to typed content definitions, never these rows.
 */
export const itemInstances = pgTable(
  "item_instances",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    itemId: text("item_id").notNull(),
    currentCharge: integer("current_charge"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "item_instances_current_charge_non_negative",
      sql`${table.currentCharge} IS NULL OR ${table.currentCharge} >= 0`,
    ),
    unique("item_instances_character_id_id_unique").on(table.characterId, table.id),
    index("item_instances_character_id_idx").on(table.characterId),
  ],
);

/**
 * A unique instance can be equipped in one suit slot. Container-versus-gear
 * classification comes from its future typed item definition, so no duplicate
 * mutable item facts are stored here.
 */
export const equippedItems = pgTable(
  "equipped_items",
  {
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    // This assignment namespace keeps container slots distinct from gear slots.
    // Future content verifies that an item's equipment class matches this value.
    assignmentKind: text("assignment_kind").notNull(),
    suitSlotId: text("suit_slot_id").notNull(),
    itemInstanceId: text("item_instance_id").notNull(),
    equippedAt: timestamp("equipped_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.characterId, table.itemInstanceId],
      foreignColumns: [itemInstances.characterId, itemInstances.id],
      name: "equipped_items_owned_instance_fk",
    }).onDelete("restrict"),
    check(
      "equipped_items_assignment_kind_valid",
      sql`${table.assignmentKind} IN ('gear', 'container')`,
    ),
    uniqueIndex("equipped_items_character_slot_unique").on(
      table.characterId,
      table.assignmentKind,
      table.suitSlotId,
    ),
    uniqueIndex("equipped_items_character_instance_unique").on(
      table.characterId,
      table.itemInstanceId,
    ),
  ],
);

/** One row per character structurally enforces the one-active-action rule. */
export const activeActions = pgTable(
  "active_actions",
  {
    characterId: text("character_id")
      .primaryKey()
      .references(() => characters.id, { onDelete: "restrict" }),
    actionId: text("action_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    resolvedThroughAt: timestamp("resolved_through_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "active_actions_cursor_after_start",
      sql`${table.resolvedThroughAt} >= ${table.startedAt}`,
    ),
  ],
);

/** Durable idempotency marker for the one-time Issue #18 starter loadout. */
export const characterStarterProvisioning = pgTable("character_starter_provisioning", {
  characterId: text("character_id")
    .primaryKey()
    .references(() => characters.id, { onDelete: "restrict" }),
  provisionedAt: timestamp("provisioned_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A bounded player-facing stop status, not an attempt history. */
export const characterMiningState = pgTable("character_mining_state", {
  characterId: text("character_id")
    .primaryKey()
    .references(() => characters.id, { onDelete: "restrict" }),
  lastStopReason: text("last_stop_reason"),
  runAttempts: integer("run_attempts").notNull().default(0),
  runSuccesses: integer("run_successes").notNull().default(0),
  runShaleGained: integer("run_shale_gained").notNull().default(0),
  runXpGained: integer("run_xp_gained").notNull().default(0),
  /** Latest ten immutable server-resolved attempt summaries for the current run. */
  recentAttempts: jsonb("recent_attempts").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlayerAccount = typeof playerAccounts.$inferSelect;
export type NewPlayerAccount = typeof playerAccounts.$inferInsert;
export type Character = typeof characters.$inferSelect;
export type NewCharacter = typeof characters.$inferInsert;
export type CharacterSkillXp = typeof characterSkillXp.$inferSelect;
export type InventoryStack = typeof inventoryStacks.$inferSelect;
export type ItemInstance = typeof itemInstances.$inferSelect;
export type EquippedItem = typeof equippedItems.$inferSelect;
export type ActiveAction = typeof activeActions.$inferSelect;
