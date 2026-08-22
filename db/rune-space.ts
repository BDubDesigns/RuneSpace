import { relations, sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
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

/** Permanent player-account ownership of explicitly unlockable portraits. */
export const playerPortraitUnlocks = pgTable(
  "player_portrait_unlocks",
  {
    playerAccountId: text("player_account_id")
      .notNull()
      .references(() => playerAccounts.id, { onDelete: "restrict" }),
    // Stable catalog identity only: asset paths, labels, and blobs never enter
    // persistence. Availability remains authoritative catalog metadata.
    portraitId: text("portrait_id").notNull(),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }).notNull().defaultNow(),
    // Stable grant origin. The server boundary currently accepts only
    // `operator`; future approved gameplay sources can reuse this relation.
    source: text("source").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.playerAccountId, table.portraitId],
      name: "player_portrait_unlocks_account_portrait_pk",
    }),
    index("player_portrait_unlocks_account_idx").on(table.playerAccountId),
  ],
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
    // Authoritative persistent current location. Every character resolves from
    // the typed location registry; new characters default to the Crash Site
    // through the authoritative provisioning path and the migration backfill.
    currentLocationId: text("current_location_id").notNull().default("crash_site"),
    // Deliberate player-selected portrait (issue #65). Stores only the stable
    // catalog portrait ID (game/content/portrait-catalog); never paths, URLs,
    // labels, or blobs. Nullable by design: legacy characters may remain null
    // and resolve to the neutral system placeholder until their owner chooses
    // one. Availability is the shared catalog-plus-account-entitlement rule,
    // validated server-side on every write; there is no database FK because
    // portraits are content, not rows.
    portraitId: text("portrait_id"),
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
  portraitUnlocks: many(playerPortraitUnlocks),
}));

export const playerPortraitUnlocksRelations = relations(playerPortraitUnlocks, ({ one }) => ({
  playerAccount: one(playerAccounts, {
    fields: [playerPortraitUnlocks.playerAccountId],
    references: [playerAccounts.id],
  }),
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
    // Salvage Cutter Power Cell charge is the only current mutable gameplay
    // state for this slice; uncharged Cutter rows use zero (legacy null is
    // normalized at the server boundary).
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

/**
 * Durable travel state for the one active Travel action. The character's
 * `current_location_id` remains the authoritative origin until arrival commits;
 * this row owns the destination for that journey. It exists only while the
 * character is in transit and is cleared on arrival.
 *
 * `active_actions.started_at` is the sole authoritative Travel start time.
 * `active_actions.resolved_through_at` is the durable action cursor.
 * This table stores route-specific durable state plus the one optional Scavenge
 * window and its committed outcome for the active walking leg.
 */
export const characterTravelState = pgTable(
  "character_travel_state",
  {
    characterId: text("character_id")
      .primaryKey()
      .references(() => characters.id, { onDelete: "restrict" }),
    originLocationId: text("origin_location_id").notNull(),
    destinationLocationId: text("destination_location_id").notNull(),
    // One stable optional Scavenge window belongs to this ordinary walking leg.
    // The outcome fields stay null until an authoritative claim commits.
    scavengeOpportunityStartTick: integer("scavenge_opportunity_start_tick").notNull().default(3),
    scavengeOutcomeId: text("scavenge_outcome_id"),
    scavengeAwardQuantity: integer("scavenge_award_quantity").notNull().default(0),
  },
  (table) => [
    check(
      "character_travel_state_distinct_ends",
      sql`${table.originLocationId} <> ${table.destinationLocationId}`,
    ),
    check(
      "character_travel_state_scavenge_start_tick",
      sql`${table.scavengeOpportunityStartTick} >= 3 AND ${table.scavengeOpportunityStartTick} <= 30`,
    ),
    check(
      "character_travel_state_scavenge_award_quantity_non_negative",
      sql`${table.scavengeAwardQuantity} >= 0`,
    ),
  ],
);

/**
 * Narrow presentation state for committed Scavenge rewards that have not yet
 * been acknowledged. This is intentionally not a generic reward queue:
 * Scavenge owns the row shape and the player may dismiss it without changing
 * gameplay state.
 */
export const characterScavengeReveals = pgTable(
  "character_scavenge_reveals",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    outcomeId: text("outcome_id").notNull(),
    awardQuantity: integer("award_quantity").notNull().default(0),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "character_scavenge_reveals_award_quantity_non_negative",
      sql`${table.awardQuantity} >= 0`,
    ),
    index("character_scavenge_reveals_character_id_claimed_at_idx").on(
      table.characterId,
      table.claimedAt,
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

/** Issue #81 — bounded refining run state, mirroring mining (one row per character, latest ten attempts). */
export const characterRefiningState = pgTable("character_refining_state", {
  characterId: text("character_id")
    .primaryKey()
    .references(() => characters.id, { onDelete: "restrict" }),
  lastStopReason: text("last_stop_reason"),
  runAttempts: integer("run_attempts").notNull().default(0),
  runSuccesses: integer("run_successes").notNull().default(0),
  runFerriteGained: integer("run_ferrite_gained").notNull().default(0),
  runSlagGained: integer("run_slag_gained").notNull().default(0),
  runShaleConsumed: integer("run_shale_consumed").notNull().default(0),
  runXpGained: integer("run_xp_gained").notNull().default(0),
  /** Latest ten immutable server-resolved refining attempt summaries for the current run. */
  recentAttempts: jsonb("recent_attempts").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Issue #89 — the character-scoped Crash Site Cargo Hold repair state. */
export const characterCargoHoldRepair = pgTable(
  "character_cargo_hold_repair",
  {
    characterId: text("character_id")
      .primaryKey()
      .references(() => characters.id, { onDelete: "restrict" }),
    refinedFerriteContributed: integer("refined_ferrite_contributed").notNull().default(0),
    slagContributed: integer("slag_contributed").notNull().default(0),
    weldingProgress: integer("welding_progress").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "character_cargo_hold_repair_refined_ferrite_range",
      sql`${table.refinedFerriteContributed} >= 0 AND ${table.refinedFerriteContributed} <= 15`,
    ),
    check(
      "character_cargo_hold_repair_slag_range",
      sql`${table.slagContributed} >= 0 AND ${table.slagContributed} <= 6`,
    ),
    check(
      "character_cargo_hold_repair_welding_range",
      sql`${table.weldingProgress} >= 0 AND ${table.weldingProgress} <= 12`,
    ),
    check(
      "character_cargo_hold_repair_progress_requires_materials",
      sql`${table.weldingProgress} = 0 OR (${table.refinedFerriteContributed} = 15 AND ${table.slagContributed} = 6)`,
    ),
    check(
      "character_cargo_hold_repair_completion_requires_full_state",
      sql`${table.completedAt} IS NULL OR (${table.refinedFerriteContributed} = 15 AND ${table.slagContributed} = 6 AND ${table.weldingProgress} = 12)`,
    ),
  ],
);

/** Fungible occupied Cargo Hold slots; stack limits remain content-owned. */
export const cargoHoldStacks = pgTable(
  "cargo_hold_stacks",
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
    check("cargo_hold_stacks_quantity_positive", sql`${table.quantity} > 0`),
    index("cargo_hold_stacks_character_id_idx").on(table.characterId),
  ],
);

/**
 * A Cargo Hold unique item keeps its original item_instances row and mutable
 * state. This relation is the storage assignment, not a copy of the item.
 */
export const cargoHoldItemInstances = pgTable(
  "cargo_hold_item_instances",
  {
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    itemInstanceId: text("item_instance_id").notNull(),
    storedAt: timestamp("stored_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.characterId, table.itemInstanceId],
      name: "cargo_hold_item_instances_pk",
    }),
    foreignKey({
      columns: [table.characterId, table.itemInstanceId],
      foreignColumns: [itemInstances.characterId, itemInstances.id],
      name: "cargo_hold_item_instances_owned_instance_fk",
    }).onDelete("restrict"),
    index("cargo_hold_item_instances_character_id_idx").on(table.characterId),
  ],
);

/**
 * Immutable per-character Power Annex eligibility records. Eligibility is
 * derived by looking up the current Pacific calendar date; nothing is cleared
 * at midnight by a background process.
 */
export const characterPowerCellDailyClaims = pgTable(
  "character_power_cell_daily_claims",
  {
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    rewardSourceId: text("reward_source_id").notNull(),
    resetDate: date("reset_date", { mode: "string" }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.characterId, table.rewardSourceId, table.resetDate],
      name: "character_power_cell_daily_claims_pk",
    }),
    index("character_power_cell_daily_claims_character_id_idx").on(table.characterId),
  ],
);

export type PlayerAccount = typeof playerAccounts.$inferSelect;
export type NewPlayerAccount = typeof playerAccounts.$inferInsert;
export type PlayerPortraitUnlock = typeof playerPortraitUnlocks.$inferSelect;
export type NewPlayerPortraitUnlock = typeof playerPortraitUnlocks.$inferInsert;
export type Character = typeof characters.$inferSelect;
export type NewCharacter = typeof characters.$inferInsert;
export type CharacterSkillXp = typeof characterSkillXp.$inferSelect;
export type InventoryStack = typeof inventoryStacks.$inferSelect;
export type ItemInstance = typeof itemInstances.$inferSelect;
export type EquippedItem = typeof equippedItems.$inferSelect;
export type ActiveAction = typeof activeActions.$inferSelect;
export type CharacterTravelState = typeof characterTravelState.$inferSelect;
export type CharacterScavengeReveal = typeof characterScavengeReveals.$inferSelect;
export type CharacterPowerCellDailyClaim = typeof characterPowerCellDailyClaims.$inferSelect;
export type CharacterCargoHoldRepair = typeof characterCargoHoldRepair.$inferSelect;
export type CargoHoldStack = typeof cargoHoldStacks.$inferSelect;
export type CargoHoldItemInstance = typeof cargoHoldItemInstances.$inferSelect;
