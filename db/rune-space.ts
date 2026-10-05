import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
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

/**
 * The starting Credit balance written by the column default and the issue #159
 * migration backfill.
 *
 * The authoritative game rule lives in game/config/balance (`credits`); this
 * layer deliberately imports no game content, so the value is mirrored here
 * exactly the way `current_location_id` mirrors the starting location. A unit
 * test asserts the two never drift apart.
 */
export const STARTING_CREDITS = 10;

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
    // Issue #156 — the account-level news read-through boundary. Null means
    // "never acknowledged" (every pre-existing account's true state; no
    // backfill needed). Always set to the newest published Update's
    // `publishedAt` instant at the moment of acknowledgement, never the
    // wall-clock time, so a delayed request can never mark a not-yet-published
    // Update as read. This is intentionally the only unread-news state: no
    // per-Update row, no per-character row.
    newsReadThroughAt: timestamp("news_read_through_at", { withTimezone: true }),
    // Issue #223 — the CURRENT account-level Early Access grant. Both columns
    // null = no Early Access; both present = Early Access active (grant sets
    // both, revoke clears both). There is intentionally no boolean, expiry, or
    // per-character row; grant/revoke history lives only in the append-only
    // operator audit. `granted_by` is the opaque Better Auth admin user id (no
    // FK, exactly like `operator_audit_logs.admin_user_id`).
    earlyAccessGrantedAt: timestamp("early_access_granted_at", { withTimezone: true }),
    earlyAccessGrantedByAdminUserId: text("early_access_granted_by_admin_user_id"),
  },
  (table) => [
    index("player_accounts_user_id_idx").on(table.userId),
    check(
      "player_accounts_early_access_paired_check",
      sql`(${table.earlyAccessGrantedAt} is null) = (${table.earlyAccessGrantedByAdminUserId} is null)`,
    ),
  ],
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
    // Server-authoritative character-scoped currency (issue #159). Every
    // character owns one balance; new characters and the migration backfill
    // both start at the approved ten Credits. The database refuses a negative
    // balance outright, so an arithmetic mistake cannot quietly mint debt.
    credits: integer("credits").notNull().default(STARTING_CREDITS),
    // The character-wide Auto-discard Slag preference (issue #256). Practice
    // Welding and Refining both read this one value, and either surface's
    // toggle writes it, so it lives with the character rather than with any
    // one activity's state. Default Off; read when an activity resolves, so a
    // change applies to work that resolves after it.
    autoDiscardSlag: boolean("auto_discard_slag").notNull().default(false),
    // Walking Scavenge suppression (issue #312). Set when the player turns back
    // from a walking Journey, so cancelling cannot be used to reroll the random
    // Scavenge window; cleared only when a walking Journey arrives. A Crew Hauler
    // ride neither sets nor clears it. It lives with the character, not the
    // travel row, because it must outlive the Journey that set it.
    scavengeSuppressed: boolean("scavenge_suppressed").notNull().default(false),
  },
  (table) => [
    check(
      "characters_slot_range",
      sql`${table.slot} >= ${sql.raw(String(SLOT_MIN))} AND ${table.slot} <= ${sql.raw(String(SLOT_MAX))}`,
    ),
    check("characters_credits_non_negative", sql`${table.credits} >= 0`),
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
    /**
     * How this Journey is being made (#172). `walk` is ordinary free adjacent
     * travel; `crew_hauler` is the authored paid Holo Hollow <-> The Jag route,
     * which is deliberately NOT map adjacency. The mode owns the Journey's
     * duration and its Scavenge eligibility.
     */
    mode: text("mode").notNull().default("walk"),
    // One stable optional Scavenge window belongs to an ordinary walking leg.
    // A paid ride has no Scavenge opportunity at all, so the column is NULL
    // there rather than carrying an unused window nobody may claim. A walk begun
    // while `characters.scavenge_suppressed` is set (#312) also has no window:
    // NULL on a walk means "Scavenge suppressed for this Journey".
    // The outcome fields stay null until an authoritative claim commits.
    scavengeOpportunityStartTick: integer("scavenge_opportunity_start_tick"),
    scavengeOutcomeId: text("scavenge_outcome_id"),
    scavengeAwardQuantity: integer("scavenge_award_quantity").notNull().default(0),
  },
  (table) => [
    check(
      "character_travel_state_distinct_ends",
      sql`${table.originLocationId} <> ${table.destinationLocationId}`,
    ),
    check("character_travel_state_mode", sql`${table.mode} IN ('walk', 'crew_hauler')`),
    // The structural invariant behind "riding offers nothing to scavenge": a
    // walk has either an authored window or none (suppressed, #312), and no
    // other mode ever has one.
    check(
      "character_travel_state_scavenge_window_matches_mode",
      sql`(${table.mode} = 'walk' AND (${table.scavengeOpportunityStartTick} IS NULL OR (${table.scavengeOpportunityStartTick} >= 3 AND ${table.scavengeOpportunityStartTick} <= 30))) OR (${table.mode} <> 'walk' AND ${table.scavengeOpportunityStartTick} IS NULL)`,
    ),
    // Only a walk can ever have claimed a Scavenge outcome.
    check(
      "character_travel_state_scavenge_outcome_requires_walk",
      sql`${table.scavengeOutcomeId} IS NULL OR ${table.mode} = 'walk'`,
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

/** Character-scoped authored mission acceptance/completion timestamps. */
export const characterMissions = pgTable(
  "character_missions",
  {
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    missionId: text("mission_id").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.characterId, table.missionId],
      name: "character_missions_character_mission_pk",
    }),
    check(
      "character_missions_completion_requires_acceptance",
      sql`${table.completedAt} IS NULL OR ${table.acceptedAt} IS NOT NULL`,
    ),
    index("character_missions_character_id_idx").on(table.characterId),
  ],
);

/** Durable progress for authored tracked-activity mission requirements. */
export const characterMissionProgress = pgTable(
  "character_mission_progress",
  {
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    missionId: text("mission_id").notNull(),
    progressKey: text("progress_key").notNull(),
    progress: integer("progress").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.characterId, table.missionId, table.progressKey],
      name: "character_mission_progress_pk",
    }),
    foreignKey({
      columns: [table.characterId, table.missionId],
      foreignColumns: [characterMissions.characterId, characterMissions.missionId],
      name: "character_mission_progress_mission_fk",
    }).onDelete("cascade"),
    check("character_mission_progress_non_negative", sql`${table.progress} >= 0`),
    index("character_mission_progress_character_mission_idx").on(
      table.characterId,
      table.missionId,
    ),
  ],
);

/** A bounded player-facing stop status, not an attempt history. */
export const characterMiningState = pgTable("character_mining_state", {
  characterId: text("character_id")
    .primaryKey()
    .references(() => characters.id, { onDelete: "restrict" }),
  lastStopReason: text("last_stop_reason"),
  runAttempts: integer("run_attempts").notNull().default(0),
  runSuccesses: integer("run_successes").notNull().default(0),
  /**
   * What this run has produced, as `{ itemId: quantity }` (#209).
   *
   * Replaced `run_shale_gained`: Mining is source-driven now, so a run at Deep
   * Jag produces Galvanite and a single Ferrite-shaped counter could not say
   * so. A map rather than a second column keeps a third source free.
   */
  runItemsGained: jsonb("run_items_gained").notNull().default({}),
  runXpGained: integer("run_xp_gained").notNull().default(0),
  /** Latest ten immutable server-resolved attempt summaries for the current run. */
  recentAttempts: jsonb("recent_attempts").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Issue #81 — bounded refining run state, mirroring mining (one row per character, latest ten attempts). */
export const characterRefiningState = pgTable(
  "character_refining_state",
  {
    characterId: text("character_id")
      .primaryKey()
      .references(() => characters.id, { onDelete: "restrict" }),
    lastStopReason: text("last_stop_reason"),
    /**
     * The run's selection (#229): how many recipe batches the player chose to
     * ATTEMPT, or NULL for Max — run until the ordinary preflight refuses the
     * next attempt. `run_attempts` already counts attempts in the current run,
     * failures included, so the two together are the whole bounded-run state —
     * remaining is the difference, never stored.
     */
    runSelectedAttempts: integer("run_selected_attempts").default(1),
    runAttempts: integer("run_attempts").notNull().default(0),
    runSuccesses: integer("run_successes").notNull().default(0),
    /**
     * This run's totals, as `{ itemId: quantity }` maps (#209). Replaced the
     * three Ferrite-specific counters: with three authored recipes, what a run
     * consumed and produced depends on the recipe, and a Galvaferrite failure
     * returns an input rather than producing Slag.
     */
    runOutputsGained: jsonb("run_outputs_gained").notNull().default({}),
    runInputsConsumed: jsonb("run_inputs_consumed").notNull().default({}),
    /**
     * Byproduct Slag this run produced but did not carry (#256), as an
     * `{ itemId: quantity }` map: thrown away by Auto-discard Slag or for want
     * of room. Kept apart from `run_outputs_gained`, which is only what was
     * actually added to carried inventory.
     */
    runOutputsDiscarded: jsonb("run_outputs_discarded").notNull().default({}),
    runXpGained: integer("run_xp_gained").notNull().default(0),
    /** Latest ten immutable server-resolved refining attempt summaries for the current run. */
    recentAttempts: jsonb("recent_attempts").notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "character_refining_state_run_selected_attempts_positive",
      sql`${table.runSelectedAttempts} >= 1`,
    ),
  ],
);

/**
 * Issue #172 — the generic character-scoped repair-target state.
 *
 * One row per (character, repair target). This replaced the specialized
 * `character_cargo_hold_repair` table so the Crash Site Cargo Hold and Holo
 * Hollow's Crew Stop share one authoritative persistence boundary instead of
 * each owning a private one. `target_id` is a content ID from
 * `game/config/foundations` (REPAIR_TARGET_IDS).
 *
 * Per-target recipes (how much material, how many Welding increments) are
 * balance, not schema: this layer imports no game content, so the bounds here
 * are only the structural ones that hold for every target. The exact recipe
 * caps are enforced by the domain, which clamps every contribution and every
 * Welding increment against the target's authoritative spec.
 */
export const characterRepairTargets = pgTable(
  "character_repair_targets",
  {
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    targetId: text("target_id").notNull(),
    /**
     * Contributed material, as `{ itemId: quantity }` (#209).
     *
     * Replaced the `refined_ferrite_contributed` / `slag_contributed` pair.
     * Deep Jag's brace wants Refined Ferrite and Power Cells, and adding a
     * `power_cells_contributed` column would have meant a new column for every
     * future recipe. A map on the same row also keeps a contribution a single
     * atomic row update, which is what makes a retried or concurrent
     * contribution unable to double-remove carried items.
     *
     * This layer still imports no game content: the recipe's caps are enforced
     * by the domain, which clamps every contribution against the target's
     * authoritative spec.
     */
    materials: jsonb("materials").notNull().default({}),
    weldingProgress: integer("welding_progress").notNull().default(0),
    /**
     * Clean Pass (#190, generalized by #207). A repair is ONE Welding work
     * unit, so its opportunity sections are rolled once, when Welding first
     * starts on it, and never rerolled by Stop or Resume.
     *
     * `[{ section, outcome }]` in rolled order; SQL `NULL` means the unit has
     * not rolled yet, which is what makes the roll exactly-once. A null
     * `outcome` on a rolled section is not a miss by itself — a section the
     * work has already passed reads as missed from the progress above. The
     * outcome exists for the one case progress cannot express: an open window
     * closed by Stop or Travel.
     *
     * An array rather than the original fixed column pair, because the number
     * of opportunities is now a function of the work unit's own length and a
     * 19-section Work Order gets three of them.
     */
    cleanPass: jsonb("clean_pass"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.characterId, table.targetId] }),
    // Structural only, as the two integer columns were. PostgreSQL forbids a
    // subquery in a CHECK, so per-value non-negativity cannot be expressed here
    // the way `>= 0` was on a plain column; the domain clamps every
    // contribution against the target's authoritative recipe, and
    // `tests/integration/deep-jag.test.ts` covers the bound directly.
    check(
      "character_repair_targets_materials_object",
      sql`jsonb_typeof(${table.materials}) = 'object'`,
    ),
    check("character_repair_targets_welding_non_negative", sql`${table.weldingProgress} >= 0`),
    // A completed repair always has resolved Welding work behind it. The exact
    // increment count is the target's own recipe and is enforced in the domain.
    check(
      "character_repair_targets_completion_requires_progress",
      sql`${table.completedAt} IS NULL OR ${table.weldingProgress} > 0`,
    ),
  ],
);

/**
 * Issue #190 — repeatable Practice Welding state, one row per character.
 *
 * Practice is deliberately NOT modelled as a repair target: a repair target is
 * one finite physical job that permanently completes, while Practice repeats
 * forever. This row therefore carries only Practice-owned facts — the partial
 * weld the player has already paid two Scrap for, that weld's Clean Pass roll,
 * and the bounded `This Run` totals that mirror Mining and Refining. (The Slag
 * preference is character-wide since #256 and lives on `characters`.)
 *
 * Nothing here duplicates an unlock: whether Practice is available at all is
 * derived from the accepted 10,000 Hours Mission, not from this table. A
 * character who has never practised simply has no row.
 */
export const characterPracticeWelds = pgTable(
  "character_practice_welds",
  {
    characterId: text("character_id")
      .primaryKey()
      .references(() => characters.id, { onDelete: "restrict" }),
    /** Whole sections resolved for the weld currently in progress. */
    sectionsCompleted: integer("sections_completed").notNull().default(0),
    /** The current weld's two Scrap are already spent; Resume continues it free. */
    cycleActive: boolean("cycle_active").notNull().default(false),
    /** This weld's Clean Pass roll; see `characterRepairTargets.cleanPass`. */
    cleanPass: jsonb("clean_pass"),
    /**
     * "Stop After Current Weld" (#207): the player asked for the weld they
     * have already paid for to finish and the run to end there, rather than
     * rolling straight into another weld and spending two more Scrap.
     *
     * Durable because the weld it applies to resolves lazily — the intent has
     * to survive the player closing the game just as much as the partial weld
     * does. Cleared by the resolution that honours it, and by any fresh Start.
     */
    finishCurrentWeld: boolean("finish_current_weld").notNull().default(false),
    lastStopReason: text("last_stop_reason"),
    /**
     * The run's selection (#229): how many complete welds the player chose, or
     * NULL for Max — run until the Scrap cannot pay for another. A resumed
     * partial weld is the run's first. `run_welds` counts the welds this run
     * has completed, so remaining is the difference.
     */
    runSelectedWelds: integer("run_selected_welds").default(1),
    runWelds: integer("run_welds").notNull().default(0),
    runScrapConsumed: integer("run_scrap_consumed").notNull().default(0),
    runSlagKept: integer("run_slag_kept").notNull().default(0),
    runSlagDiscarded: integer("run_slag_discarded").notNull().default(0),
    runXpGained: integer("run_xp_gained").notNull().default(0),
    /** Latest ten immutable server-resolved weld summaries for the current run. */
    recentWelds: jsonb("recent_welds").notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("character_practice_welds_sections_non_negative", sql`${table.sectionsCompleted} >= 0`),
    check("character_practice_welds_run_welds_non_negative", sql`${table.runWelds} >= 0`),
    check(
      "character_practice_welds_run_selected_welds_positive",
      sql`${table.runSelectedWelds} >= 1`,
    ),
    // A weld that is not in progress cannot hold partial sections: the pair is
    // written together by one resolution, so a split state is corruption.
    check(
      "character_practice_welds_sections_require_active_cycle",
      sql`${table.cycleActive} OR ${table.sectionsCompleted} = 0`,
    ),
  ],
);

/**
 * Issue #232 — the Fabrication Station, one row per character.
 *
 * The workpiece on the machine is identified without a payload of its own:
 * its recipe is the active action's ID (one action per authored recipe, the
 * rule Refining already follows), its start is that action's durable cursor,
 * and its reserved inputs are that recipe's input set, still sitting in the
 * real `inventory_stacks` rows. Nothing about carried items is cloned here.
 *
 * This row carries only what those cannot: the run's selection and totals,
 * the player's Finish Current intent, the station's Manual Override toggle,
 * and the current workpiece's machine state once Override is enabled on it —
 * persisted so a reload, a retried request, or a disconnect observes the same
 * Load rather than a reroll. `override_load` IS NULL means the workpiece on the
 * machine is an ordinary 1.00× workpiece.
 *
 * A character who has never fabricated simply has no row.
 */
export const characterFabricationState = pgTable(
  "character_fabrication_state",
  {
    characterId: text("character_id")
      .primaryKey()
      .references(() => characters.id, { onDelete: "restrict" }),
    /** The station's Manual Override toggle, read as each new workpiece begins. */
    manualOverrideEnabled: boolean("manual_override_enabled").notNull().default(false),
    /**
     * The run's selection (#229): a number of recipe batches, or NULL for Max
     * — keep starting workpieces while one can begin. `run_batches` counts the
     * run's resolved workpieces (busts included), so remaining is the
     * difference.
     */
    runSelectedBatches: integer("run_selected_batches").default(1),
    runBatches: integer("run_batches").notNull().default(0),
    runSuccesses: integer("run_successes").notNull().default(0),
    runBusts: integer("run_busts").notNull().default(0),
    /** This run's totals, as `{ itemId: quantity }` maps. */
    runInputsConsumed: jsonb("run_inputs_consumed").notNull().default({}),
    runOutputsGained: jsonb("run_outputs_gained").notNull().default({}),
    runXpGained: integer("run_xp_gained").notNull().default(0),
    /** Latest ten immutable server-resolved workpiece summaries for the current run. */
    recentWorkpieces: jsonb("recent_workpieces").notNull().default([]),
    /**
     * Stop, for a run of several workpieces, means Finish Current: the
     * workpiece on the machine resolves normally and no next one begins. There
     * is no cancel. Cleared by the resolution that honours it and by Start.
     */
    finishCurrent: boolean("finish_current").notNull().default(false),
    lastStopReason: text("last_stop_reason"),
    /** The Override machine on the current workpiece; NULL when it has none. */
    overrideLoad: smallint("override_load"),
    overrideTrend: text("override_trend"),
    overrideSafePushes: smallint("override_safe_pushes").notNull().default(0),
    overrideExactPushes: smallint("override_exact_pushes").notNull().default(0),
    overrideLocked: boolean("override_locked").notNull().default(false),
    /** The current workpiece's last push, `{ feed, load, outcome }`, for the live panel. */
    overrideLastPush: jsonb("override_last_push"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "character_fabrication_state_run_selected_batches_positive",
      sql`${table.runSelectedBatches} >= 1`,
    ),
    check(
      "character_fabrication_state_run_counts_non_negative",
      sql`${table.runBatches} >= 0 AND ${table.runSuccesses} >= 0 AND ${table.runBusts} >= 0 AND ${table.runXpGained} >= 0`,
    ),
    check(
      "character_fabrication_state_override_trend_valid",
      sql`${table.overrideTrend} IS NULL OR ${table.overrideTrend} IN ('higher', 'lower')`,
    ),
    // Structural only: the machine's dial and push limit are balance, enforced
    // by the domain. What schema can say is that an Override machine is whole —
    // a Load always has a Trend — and that no push state exists without one.
    check(
      "character_fabrication_state_override_complete",
      sql`(${table.overrideLoad} IS NULL) = (${table.overrideTrend} IS NULL)`,
    ),
    check(
      "character_fabrication_state_override_pushes_non_negative",
      sql`${table.overrideSafePushes} >= 0 AND ${table.overrideExactPushes} >= 0`,
    ),
    check(
      "character_fabrication_state_override_requires_machine",
      sql`${table.overrideLoad} IS NOT NULL OR (${table.overrideSafePushes} = 0 AND ${table.overrideExactPushes} = 0 AND NOT ${table.overrideLocked} AND ${table.overrideLastPush} IS NULL)`,
    ),
  ],
);

/**
 * Issue #232 — Tinkering, one row per character.
 *
 * Tinkering follows Practice Welding's cycle model rather than Fabrication's
 * reservation: starting a cycle commits — destroys — its complete batch at
 * once, so `cycle_action_id` names a cycle whose batch is already gone, and
 * Resume continues it without committing another. Ordinary Stop preserves it;
 * Finish Current completes it and ends the run.
 */
export const characterTinkeringState = pgTable(
  "character_tinkering_state",
  {
    characterId: text("character_id")
      .primaryKey()
      .references(() => characters.id, { onDelete: "restrict" }),
    /** Persistent per-character preference, default off, read at each cycle. */
    autoDiscardScrap: boolean("auto_discard_scrap").notNull().default(false),
    /** The committed cycle's Tinkering target action, or NULL when none is committed. */
    cycleActionId: text("cycle_action_id"),
    /** Whole ticks already worked on the committed cycle. */
    cycleTicksCompleted: integer("cycle_ticks_completed").notNull().default(0),
    /** "Finish current item": complete the committed cycle, then commit no other. */
    finishCurrent: boolean("finish_current").notNull().default(false),
    lastStopReason: text("last_stop_reason"),
    /** The run's selection (#229): a number of batches, or NULL for Max. */
    runSelectedBatches: integer("run_selected_batches").default(1),
    runBatches: integer("run_batches").notNull().default(0),
    runItemsConsumed: jsonb("run_items_consumed").notNull().default({}),
    runScrapKept: integer("run_scrap_kept").notNull().default(0),
    runScrapDiscarded: integer("run_scrap_discarded").notNull().default(0),
    runXpGained: integer("run_xp_gained").notNull().default(0),
    /** Latest ten immutable server-resolved batch summaries for the current run. */
    recentBatches: jsonb("recent_batches").notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "character_tinkering_state_run_selected_batches_positive",
      sql`${table.runSelectedBatches} >= 1`,
    ),
    check(
      "character_tinkering_state_run_counts_non_negative",
      sql`${table.runBatches} >= 0 AND ${table.runScrapKept} >= 0 AND ${table.runScrapDiscarded} >= 0 AND ${table.runXpGained} >= 0`,
    ),
    check("character_tinkering_state_ticks_non_negative", sql`${table.cycleTicksCompleted} >= 0`),
    // Worked ticks belong to a committed cycle; with no cycle there is nothing
    // to have worked on.
    check(
      "character_tinkering_state_ticks_require_cycle",
      sql`${table.cycleActionId} IS NOT NULL OR ${table.cycleTicksCompleted} = 0`,
    ),
  ],
);

/**
 * Issue #207 — the durable Work Orders board, one row per posted slot.
 *
 * The board is persistent rather than re-rolled on render, refresh, or login,
 * so a posting is a real row the player can walk away from and come back to.
 * Accepting one does not move it: `accepted_at` marks that same row In
 * Progress, which is why there is no second "active Work Order" table to keep
 * in agreement with this one. Completion replaces the row's job in place, which
 * is exactly the authored rule that only the completed slot refills.
 *
 * `sections_completed` and `clean_pass` are the accepted job's durable Welding
 * progress, carried here for the same reason a repair target carries its own:
 * the work unit owns its state, and `active_actions` stays payload-free.
 *
 * An untouched board is simply three absent rows; the board is seeded on the
 * first authoritative touch after 10,001 Hours is accepted, so nothing needs
 * backfilling and a locked character can never observe a half-seeded board.
 */
export const characterWorkOrderPostings = pgTable(
  "character_work_order_postings",
  {
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    /** Which of the board's posted slots this row is, stable across refills. */
    slotIndex: integer("slot_index").notNull(),
    /** The authored Work Order currently posted in this slot. */
    workOrderId: text("work_order_id").notNull(),
    /**
     * Set when the player accepted this posting and its materials were
     * committed. Non-null is the single authoritative definition of "there is
     * an active Work Order", enforced to at most one per character by the
     * partial unique index below.
     */
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    /** Whole Welding sections resolved for the accepted job. */
    sectionsCompleted: integer("sections_completed").notNull().default(0),
    cleanPass: jsonb("clean_pass"),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.characterId, table.slotIndex],
      name: "character_work_order_postings_pk",
    }),
    // One active Work Order per character, enforced by the database rather than
    // by every command remembering to check. A refill or a concurrent second
    // acceptance cannot create a second active job.
    uniqueIndex("character_work_order_postings_one_active_idx")
      .on(table.characterId)
      .where(sql`${table.acceptedAt} IS NOT NULL`),
    // The board never posts the same job twice at once.
    uniqueIndex("character_work_order_postings_distinct_jobs_idx").on(
      table.characterId,
      table.workOrderId,
    ),
    check("character_work_order_postings_slot_non_negative", sql`${table.slotIndex} >= 0`),
    check(
      "character_work_order_postings_sections_non_negative",
      sql`${table.sectionsCompleted} >= 0`,
    ),
    // Progress belongs to an accepted job. An unaccepted posting is a listing,
    // not a piece of work, so a split state is corruption.
    check(
      "character_work_order_postings_progress_requires_acceptance",
      sql`${table.acceptedAt} IS NOT NULL OR (${table.sectionsCompleted} = 0 AND ${table.cleanPass} IS NULL)`,
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
 * The ordinary container installed in a character's site stash mount (#284).
 *
 * One row per (character, location). The mount itself is not a row: it is
 * "built" exactly when that location's repair target is complete. The installed
 * item keeps its original item_instances row; this relation is the location
 * assignment, so the instance is owned but neither carried nor equipped.
 * `item_instance_id` is unique per character, so one instance can serve at most
 * one stash. Swapping a container is an UPDATE of this row, never a delete, so
 * the stored contents below stay attached to the same mount.
 */
export const siteStashContainers = pgTable(
  "site_stash_containers",
  {
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    locationId: text("location_id").notNull(),
    itemInstanceId: text("item_instance_id").notNull(),
    installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.characterId, table.locationId],
      name: "site_stash_containers_pk",
    }),
    unique("site_stash_containers_character_instance_unique").on(
      table.characterId,
      table.itemInstanceId,
    ),
    foreignKey({
      columns: [table.characterId, table.itemInstanceId],
      foreignColumns: [itemInstances.characterId, itemInstances.id],
      name: "site_stash_containers_owned_instance_fk",
    }).onDelete("restrict"),
  ],
);

/**
 * Fungible occupied stash slots at one site. Each row is one slot; stack limits
 * stay content-owned. The composite foreign key to the installed container
 * means a stash cannot hold anything without a container, and the container row
 * cannot be deleted while anything is still stored (#284).
 */
export const siteStashStacks = pgTable(
  "site_stash_stacks",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    locationId: text("location_id").notNull(),
    itemId: text("item_id").notNull(),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("site_stash_stacks_quantity_positive", sql`${table.quantity} > 0`),
    foreignKey({
      columns: [table.characterId, table.locationId],
      foreignColumns: [siteStashContainers.characterId, siteStashContainers.locationId],
      name: "site_stash_stacks_installed_container_fk",
    }).onDelete("restrict"),
    index("site_stash_stacks_character_location_idx").on(table.characterId, table.locationId),
  ],
);

/**
 * A unique item stored in a site stash keeps its original item_instances row
 * and mutable state; this relation is only the storage assignment.
 */
export const siteStashItemInstances = pgTable(
  "site_stash_item_instances",
  {
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    locationId: text("location_id").notNull(),
    itemInstanceId: text("item_instance_id").notNull(),
    storedAt: timestamp("stored_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.characterId, table.itemInstanceId],
      name: "site_stash_item_instances_pk",
    }),
    foreignKey({
      columns: [table.characterId, table.itemInstanceId],
      foreignColumns: [itemInstances.characterId, itemInstances.id],
      name: "site_stash_item_instances_owned_instance_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.characterId, table.locationId],
      foreignColumns: [siteStashContainers.characterId, siteStashContainers.locationId],
      name: "site_stash_item_instances_installed_container_fk",
    }).onDelete("restrict"),
    index("site_stash_item_instances_character_location_idx").on(
      table.characterId,
      table.locationId,
    ),
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

/**
 * Immutable per-character ForceSales board-refresh entitlement records (#217).
 *
 * The Work Order counterpart of `characterPowerCellDailyClaims`, sharing its
 * exact shape and the same `pacificResetDate` boundary — but kept as its own
 * table rather than folded into the Annex's, because the two ledgers record
 * genuinely different rewards for genuinely different features, and reusing
 * one table for both would need a second `rewardSourceId`-shaped concept doing
 * no real simplifying work.
 *
 * A row existing for today's reset date is the single authoritative fact that
 * today's refresh is spent; a row existing at all, for ANY reset date, is what
 * "has this character ever used their first ForceSales refresh" derives from
 * — no separate first-use flag. Nothing is cleared at midnight; eligibility is
 * derived by comparing the current reset date against the rows that exist.
 */
export const characterWorkOrderBoardRefreshes = pgTable(
  "character_work_order_board_refreshes",
  {
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    resetDate: date("reset_date", { mode: "string" }).notNull(),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.characterId, table.resetDate],
      name: "character_work_order_board_refreshes_pk",
    }),
    index("character_work_order_board_refreshes_character_id_idx").on(table.characterId),
  ],
);

/**
 * Per-character merchant daily purchase allowances (#230).
 *
 * Wade's Scrap and Bix's Power Cells are each capped per character per
 * RuneSpace Pacific reset date. One row is one merchant price line's usage for
 * one reset date: `(character, merchant, item, reset date)` is the key, so
 * Wade's Scrap row and Bix's Cell row are independent records that never share
 * a counter, and neither shares a table with the Annex claim or the ForceSales
 * refresh — those are different rewards for different features, while these
 * two are the same rule (a merchant line's daily limit) applied to two lines.
 *
 * The row is written only by the authoritative purchase transaction, in the
 * same transaction as the Credit and inventory mutation, so a refused or
 * rolled-back purchase leaves no trace. Selling back never touches it.
 * Nothing is cleared at midnight: a new reset date simply has no row yet.
 * The limit itself is content (`game/content/merchants`), never mirrored here;
 * the CHECK only rejects a row that could not describe a real purchase.
 */
export const characterMerchantDailyPurchases = pgTable(
  "character_merchant_daily_purchases",
  {
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    merchantId: text("merchant_id").notNull(),
    itemId: text("item_id").notNull(),
    resetDate: date("reset_date", { mode: "string" }).notNull(),
    quantityPurchased: integer("quantity_purchased").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.characterId, table.merchantId, table.itemId, table.resetDate],
      name: "character_merchant_daily_purchases_pk",
    }),
    check(
      "character_merchant_daily_purchases_quantity_positive",
      sql`${table.quantityPurchased} > 0`,
    ),
    index("character_merchant_daily_purchases_character_id_idx").on(table.characterId),
  ],
);

/**
 * Append-only operator audit log (Issue #113). One immutable row records a
 * SUCCESSFUL operator mutation, atomically committed with that mutation inside
 * the same transaction. Refused/failed commands, no-op/idempotent commands,
 * and normal lazy gameplay reconciliation are never logged here (the explicit
 * operator action is).
 *
 * This is deliberately NOT an event-sourcing or observability store:
 * - `admin_user_id` is the authenticated Better Auth admin user id (opaque
 *   text; no FK so the log is decoupled and can never be orphaned by a user).
 * - `target_kind` makes the target scope explicit (issue #223): `character`
 *   rows carry only `character_id`, `player_account` rows carry only
 *   `player_account_id`, and `system` rows (global RuneSpace access state)
 *   carry neither. A CHECK enforces exactly that shape; both FKs RESTRICT.
 *   Every row written before #223 is a `character` row and keeps its meaning.
 * - `operation` is a stable op-kind, e.g. `stop_current_action`.
 * - `target_identity` is the affected stack/instance/mission/skill/location/
 *   action id where applicable.
 * - `details` is concise structured before/after or operation JSON (never
 *   secrets, tokens, or session data).
 * Writes happen only through application code; there is intentionally no
 * `updatedAt` and no update/delete path.
 */
export const operatorAuditLogs = pgTable(
  "operator_audit_logs",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    adminUserId: text("admin_user_id").notNull(),
    targetKind: text("target_kind").notNull(),
    characterId: text("character_id").references(() => characters.id, { onDelete: "restrict" }),
    playerAccountId: text("player_account_id").references(() => playerAccounts.id, {
      onDelete: "restrict",
    }),
    operation: text("operation").notNull(),
    targetIdentity: text("target_identity"),
    details: jsonb("details").notNull(),
    // Issue #248 — the moderation case a moderation action belongs to, so a
    // case shows its own action history. Null for every non-moderation row.
    moderationCaseId: text("moderation_case_id").references((): AnyPgColumn => moderationCases.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "operator_audit_logs_target_kind_check",
      sql`${table.targetKind} in ('character', 'player_account', 'system')`,
    ),
    check(
      "operator_audit_logs_target_shape_check",
      sql`(${table.targetKind} = 'character' and ${table.characterId} is not null and ${table.playerAccountId} is null) or (${table.targetKind} = 'player_account' and ${table.playerAccountId} is not null and ${table.characterId} is null) or (${table.targetKind} = 'system' and ${table.characterId} is null and ${table.playerAccountId} is null)`,
    ),
    index("operator_audit_logs_character_created_idx").on(table.characterId, table.createdAt),
    index("operator_audit_logs_player_account_created_idx").on(
      table.playerAccountId,
      table.createdAt,
    ),
    index("operator_audit_logs_system_created_idx")
      .on(table.createdAt)
      .where(sql`${table.targetKind} = 'system'`),
    index("operator_audit_logs_moderation_case_created_idx")
      .on(table.moderationCaseId, table.createdAt)
      .where(sql`${table.moderationCaseId} is not null`),
  ],
);

/**
 * The one explicit application-data boundary for global RuneSpace access state
 * (issue #223). Exactly one row (`id = 1`, enforced by CHECK); it is not a
 * generic settings/key-value store and has no lifecycle enum.
 *
 * - `public_gameplay_open` is the explicit, reversible operator switch. The
 *   migration seeds it `false` (Closed) and only an audited operator command
 *   changes it — never a clock, an env var, or a redeploy.
 * - `soft_alpha_launch_target_at` is a fixed presentation instant for the
 *   October 27 countdown, seeded by the migration. Reaching it never mutates
 *   access state, and no application code path writes it.
 * - `updated_by_admin_user_id` is null only for the migration-seeded row.
 */
export const runespaceAccessState = pgTable(
  "runespace_access_state",
  {
    id: smallint("id").primaryKey().default(1),
    publicGameplayOpen: boolean("public_gameplay_open").notNull().default(false),
    softAlphaLaunchTargetAt: timestamp("soft_alpha_launch_target_at", {
      withTimezone: true,
    }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedByAdminUserId: text("updated_by_admin_user_id"),
  },
  (table) => [check("runespace_access_state_singleton_check", sql`${table.id} = 1`)],
);

/**
 * Short-lived ledger behind the signup / verification-mail abuse limits
 * (Issue #221). One row per admitted signup attempt, verification resend
 * request, or verification email actually dispatched; `server/account-abuse.ts`
 * is its only reader and writer and prunes rows once they can no longer affect
 * any limit window.
 *
 * - `ip_bucket` is the normalized client IP as Better Auth resolves it, or
 *   `unknown` when none can be resolved. It is a weak rate-limit signal, never
 *   an identity key, and is never joined to accounts.
 * - `email_key` is the lowercased address for resend/dispatch rows and null
 *   for signup attempts. Resend rows are recorded for any requested address,
 *   registered or not, so the limits cannot be used to probe for accounts.
 */
export const accountAbuseEvents = pgTable(
  "account_abuse_events",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    kind: text("kind").notNull(),
    ipBucket: text("ip_bucket").notNull(),
    emailKey: text("email_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "account_abuse_events_kind_check",
      sql`${table.kind} in ('signup_attempt', 'verification_resend', 'verification_dispatch')`,
    ),
    index("account_abuse_events_kind_ip_created_idx").on(
      table.kind,
      table.ipBucket,
      table.createdAt,
    ),
    index("account_abuse_events_kind_email_created_idx").on(
      table.kind,
      table.emailKey,
      table.createdAt,
    ),
    index("account_abuse_events_created_idx").on(table.createdAt),
  ],
);

/**
 * Public General/Trade chat (issue #246). One immutable row per successful
 * send; players can neither edit nor delete. `server/chat.ts` is its only
 * writer.
 *
 * - `seq` is the durable feed order and pagination cursor. It is unique even
 *   when many messages share an instant, so "older than this" pages never skip
 *   or repeat a row.
 * - Sender identity is stable ids plus the character's name at send time, all
 *   derived server-side; renames never rewrite history.
 * - A promoted Trade ad is ONE row in `trade` carrying the price it paid; the
 *   General feed reads it too. Price and channel are CHECKed together.
 * - Ordinary retention (90 days) deletes rows outright — see
 *   `pruneExpiredChatMessages` — rather than only hiding them.
 * - Each row is also one successful send in the account-wide rate window and,
 *   when promoted, the account's ad cooldown; neither is stored twice.
 * - A Whisper (issue #247) is a `whisper` row bound to exactly one
 *   `whisper_conversations` pair, so Whispers share the one immutable message
 *   contract, the one send budget, and the one retention sweep. Public feeds
 *   select by channel and never read a `whisper` row.
 */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull().unique(),
    channel: text("channel").notNull(),
    /**
     * What this row is (#308): `player` is a message a character sent, and
     * `rare_find` is an automatic System announcement of a Mining find. A
     * System row has NO sender: it is not a player, so it never borrows an
     * account, a character, or a made-up identity — the three sender columns
     * below are null exactly when the row is not a `player` message.
     */
    kind: text("kind").notNull().default("player"),
    senderPlayerAccountId: text("sender_player_account_id").references(() => playerAccounts.id, {
      onDelete: "restrict",
    }),
    senderCharacterId: text("sender_character_id").references(() => characters.id, {
      onDelete: "restrict",
    }),
    senderCharacterName: text("sender_character_name"),
    body: text("body").notNull(),
    // Null for an ordinary message; the Credits paid for a promoted Trade ad.
    promotedPriceCredits: integer("promoted_price_credits"),
    // Set exactly when `channel` is `whisper` (#247).
    conversationId: text("conversation_id").references(() => whisperConversations.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("chat_messages_channel_check", sql`${table.channel} in ('general', 'trade', 'whisper')`),
    check("chat_messages_kind_check", sql`${table.kind} in ('player', 'rare_find')`),
    check(
      "chat_messages_sender_check",
      sql`(${table.kind} = 'player') = (${table.senderPlayerAccountId} is not null and ${table.senderCharacterId} is not null and ${table.senderCharacterName} is not null)
        and (${table.kind} = 'player' or (${table.senderPlayerAccountId} is null and ${table.senderCharacterId} is null and ${table.senderCharacterName} is null and ${table.channel} = 'general'))`,
    ),
    check(
      "chat_messages_conversation_check",
      sql`(${table.channel} = 'whisper') = (${table.conversationId} is not null)`,
    ),
    check("chat_messages_body_length_check", sql`char_length(${table.body}) between 1 and 280`),
    check(
      "chat_messages_promoted_check",
      sql`${table.promotedPriceCredits} is null or (${table.promotedPriceCredits} > 0 and ${table.channel} = 'trade')`,
    ),
    index("chat_messages_channel_seq_idx").on(table.channel, table.seq),
    index("chat_messages_promoted_seq_idx")
      .on(table.seq)
      .where(sql`${table.promotedPriceCredits} is not null`),
    index("chat_messages_sender_account_created_idx").on(
      table.senderPlayerAccountId,
      table.createdAt,
    ),
    index("chat_messages_created_idx").on(table.createdAt),
    index("chat_messages_conversation_seq_idx")
      .on(table.conversationId, table.seq)
      .where(sql`${table.conversationId} is not null`),
  ],
);

/**
 * One 1:1 Whisper conversation (issue #247) between two characters of two
 * different accounts. Player-facing identity is character-to-character, so the
 * pair is two character ids — stable across renames — and `participant_key`
 * (the two ids, lower first, joined by `:`) makes each pair unique. A
 * conversation is created by its first Whisper, never merely by opening one,
 * and is never deleted: ordinary retention removes its messages only.
 */
export const whisperConversations = pgTable("whisper_conversations", {
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  participantKey: text("participant_key").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Each side of a Whisper conversation (#247): the participant character, its
 * account (the safety identity Block and Report use), and that character's
 * durable read position. Unread is derived, never counted: the other
 * character's retained messages with `seq` above `last_read_seq`. Reading on
 * any tab or device advances it, so unread clears everywhere.
 *
 * `hidden_through_seq` (#261) is this side's "Hide conversation": the newest
 * message it hid, or null. The inbox leaves the conversation out until a
 * message newer than that arrives — from either character — or this side
 * reopens it. Hiding never deletes or alters a message and never touches the
 * other side's row.
 */
export const whisperParticipants = pgTable(
  "whisper_participants",
  {
    conversationId: text("conversation_id")
      .notNull()
      .references(() => whisperConversations.id, { onDelete: "cascade" }),
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    playerAccountId: text("player_account_id")
      .notNull()
      .references(() => playerAccounts.id, { onDelete: "restrict" }),
    lastReadSeq: bigint("last_read_seq", { mode: "number" }).notNull().default(0),
    hiddenThroughSeq: bigint("hidden_through_seq", { mode: "number" }),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.characterId] }),
    index("whisper_participants_character_idx").on(table.characterId),
  ],
);

/**
 * The characters one public General/Trade message `@mentions` (issue #261).
 *
 * A mention is part of the one canonical message, never a copy of it: the row
 * commits in the send's transaction and is deleted with its message by
 * ordinary retention. The target is a stable character (and its account, the
 * identity Block is checked against); `mentioned_character_name` is the name
 * the message showed at send, so a later rename never makes it ambiguous.
 *
 * `read_at` is the mentioned character's durable read state: unread mention
 * attention is derived from rows still null, minus any whose sender and target
 * accounts have a Block between them. Reading the channel on any tab or device
 * sets it, so attention clears everywhere. Never written for a Whisper.
 */
export const chatMessageMentions = pgTable(
  "chat_message_mentions",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    mentionedCharacterId: text("mentioned_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    mentionedPlayerAccountId: text("mentioned_player_account_id")
      .notNull()
      .references(() => playerAccounts.id, { onDelete: "restrict" }),
    mentionedCharacterName: text("mentioned_character_name").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.mentionedCharacterId] }),
    index("chat_message_mentions_unread_idx")
      .on(table.mentionedCharacterId)
      .where(sql`${table.readAt} is null`),
  ],
);

/**
 * One System recipe-unlock notice (issue #274): a read-only message the
 * Chat/Social "System" conversation shows a character after a gameplay XP
 * award raised a skill level past one or more recipes' `minimumLevel`.
 *
 * Deliberately separate from Whispers: System is not a player, so there is no
 * sender account, sender character, conversation pair, Block, or Report here,
 * and no fake identity is ever created to fit the Whisper tables.
 *
 * - Written only by `grantCharacterSkillXp`, in the transaction that commits
 *   the XP, so the XP and its notice commit or roll back together. The level
 *   crossing is the only state boundary: there is no sent flag or per-recipe
 *   ledger, and a later award starts above the crossed level.
 * - One row per progression event, however many recipes it unlocked. It
 *   stores the crossing and the unlocked recipes' action IDs, never their
 *   names: names are rendered from current item presentation when read.
 * - `seq` is the durable display order. `read_at` is set once, when the
 *   character first reads the notice, so it never lights the launcher again.
 * - Not on the chat retention sweep: these are the character's own
 *   progression notices, bounded by how many recipe levels a skill has.
 */
export const recipeUnlockNotices = pgTable(
  "recipe_unlock_notices",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull().unique(),
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    skillId: text("skill_id").notNull(),
    previousLevel: integer("previous_level").notNull(),
    level: integer("level").notNull(),
    recipeActionIds: text("recipe_action_ids").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "recipe_unlock_notices_levels_check",
      sql`${table.previousLevel} >= 1 and ${table.level} > ${table.previousLevel}`,
    ),
    check("recipe_unlock_notices_recipes_check", sql`cardinality(${table.recipeActionIds}) >= 1`),
    index("recipe_unlock_notices_character_seq_idx").on(table.characterId, table.seq),
  ],
);

/**
 * Current account-level Blocks (issue #247): the blocker account does not want
 * the blocked account interacting with it. One row per pair while the Block
 * stands; unblocking deletes it. The characters are the ones the player acted
 * on and through — context only, since the Block covers every character of
 * both accounts. History lives in `player_block_events`.
 */
export const playerBlocks = pgTable(
  "player_blocks",
  {
    blockerPlayerAccountId: text("blocker_player_account_id")
      .notNull()
      .references(() => playerAccounts.id, { onDelete: "restrict" }),
    blockedPlayerAccountId: text("blocked_player_account_id")
      .notNull()
      .references(() => playerAccounts.id, { onDelete: "restrict" }),
    blockerCharacterId: text("blocker_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    blockedCharacterId: text("blocked_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.blockerPlayerAccountId, table.blockedPlayerAccountId] }),
    check(
      "player_blocks_distinct_accounts_check",
      sql`${table.blockerPlayerAccountId} <> ${table.blockedPlayerAccountId}`,
    ),
    index("player_blocks_blocked_idx").on(table.blockedPlayerAccountId),
  ],
);

/**
 * Append-only Block/Unblock history (#247): interpretable safety signals for
 * operator review (#248), with stable account and character identities and
 * the instant. Never a score, and nothing acts on it automatically.
 */
export const playerBlockEvents = pgTable(
  "player_block_events",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    kind: text("kind").notNull(),
    blockerPlayerAccountId: text("blocker_player_account_id")
      .notNull()
      .references(() => playerAccounts.id, { onDelete: "restrict" }),
    blockedPlayerAccountId: text("blocked_player_account_id")
      .notNull()
      .references(() => playerAccounts.id, { onDelete: "restrict" }),
    blockerCharacterId: text("blocker_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    blockedCharacterId: text("blocked_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("player_block_events_kind_check", sql`${table.kind} in ('block', 'unblock')`),
    index("player_block_events_blocked_created_idx").on(
      table.blockedPlayerAccountId,
      table.createdAt,
    ),
    index("player_block_events_blocker_created_idx").on(
      table.blockerPlayerAccountId,
      table.createdAt,
    ),
  ],
);

/**
 * Player reports (issue #247): "RuneSpace should review this". Each row is a
 * self-contained piece of moderation evidence for operator review (#248).
 *
 * - A `message` report names the immutable message id and snapshots the exact
 *   message plus a bounded window of its own channel or Whisper conversation
 *   into `evidence`, so the case survives ordinary 90-day retention deleting
 *   the chat rows. `message_id` deliberately has no foreign key for the same
 *   reason. A Whisper's window never reaches another conversation.
 * - A `player` report names only the reported character; its name at report
 *   time is kept for offensive-name reports.
 * - One account can report one message once (the partial unique index).
 * - The reported player is never told, and nothing here sanctions anyone.
 */
export const playerReports = pgTable(
  "player_reports",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    kind: text("kind").notNull(),
    reporterPlayerAccountId: text("reporter_player_account_id")
      .notNull()
      .references(() => playerAccounts.id, { onDelete: "restrict" }),
    reporterCharacterId: text("reporter_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    reportedPlayerAccountId: text("reported_player_account_id")
      .notNull()
      .references(() => playerAccounts.id, { onDelete: "restrict" }),
    reportedCharacterId: text("reported_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    reportedCharacterName: text("reported_character_name").notNull(),
    reason: text("reason").notNull(),
    note: text("note"),
    messageId: text("message_id"),
    // `general`, `trade`, or `whisper` for a message report.
    channel: text("channel"),
    conversationId: text("conversation_id").references(() => whisperConversations.id, {
      onDelete: "restrict",
    }),
    evidence: jsonb("evidence"),
    // Issue #248 — the moderation case this report is reviewed in. A report
    // joins its reported account's one open-or-reviewed case, or opens one.
    caseId: text("case_id")
      .notNull()
      .references((): AnyPgColumn => moderationCases.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("player_reports_kind_check", sql`${table.kind} in ('message', 'player')`),
    check(
      "player_reports_reason_check",
      sql`${table.reason} in ('harassment_hate', 'threats', 'spam_scam', 'sexual_inappropriate', 'offensive_name_profile', 'other')`,
    ),
    check(
      "player_reports_message_check",
      sql`(${table.kind} = 'message') = (${table.messageId} is not null and ${table.channel} is not null and ${table.evidence} is not null)`,
    ),
    check(
      "player_reports_conversation_check",
      sql`(${table.channel} = 'whisper') = (${table.conversationId} is not null)`,
    ),
    uniqueIndex("player_reports_reporter_message_idx")
      .on(table.reporterPlayerAccountId, table.messageId)
      .where(sql`${table.messageId} is not null`),
    index("player_reports_reported_created_idx").on(table.reportedPlayerAccountId, table.createdAt),
    index("player_reports_case_created_idx").on(table.caseId, table.createdAt),
  ],
);

/**
 * Moderation cases (issue #248): the unit an operator reviews and actions.
 * Each case is about one subject account — the reported account, the safety
 * identity behind every character — and moves Open → Reviewed → Actioned or
 * Dismissed (`game/domain/moderation.ts`).
 *
 * - A report joins its subject's one open-or-reviewed case (the partial
 *   unique index), or opens one; a report after that case closes opens a new
 *   case. An operator may also open a case with a stated reason, for an
 *   investigation that no report started.
 * - `case_number` is the durable source of the player-facing reference
 *   (`MOD-00042`) that sanction notices and appeals cite.
 * - Status changes are the only mutation, each audited in
 *   `operator_audit_logs` with this case's id. Cases are never deleted, so
 *   permanent suspension never erases evidence.
 */
export const moderationCases = pgTable(
  "moderation_cases",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    caseNumber: bigint("case_number", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .notNull()
      .unique(),
    subjectPlayerAccountId: text("subject_player_account_id")
      .notNull()
      .references(() => playerAccounts.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("open"),
    // `report` when the first report opened it; `operator` when an operator did.
    openedBy: text("opened_by").notNull(),
    openedByAdminUserId: text("opened_by_admin_user_id"),
    openingReason: text("opening_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "moderation_cases_status_check",
      sql`${table.status} in ('open', 'reviewed', 'actioned', 'dismissed')`,
    ),
    check(
      "moderation_cases_opened_by_check",
      sql`(${table.openedBy} = 'report' and ${table.openedByAdminUserId} is null and ${table.openingReason} is null) or (${table.openedBy} = 'operator' and ${table.openedByAdminUserId} is not null and ${table.openingReason} is not null)`,
    ),
    uniqueIndex("moderation_cases_one_active_per_subject_idx")
      .on(table.subjectPlayerAccountId)
      .where(sql`${table.status} in ('open', 'reviewed')`),
    index("moderation_cases_status_updated_idx").on(table.status, table.updatedAt),
    index("moderation_cases_subject_created_idx").on(table.subjectPlayerAccountId, table.createdAt),
  ],
);

/**
 * Append-only operator notes on a case (#248). Internal only: a sanctioned
 * player never sees them. There is no update or delete path.
 */
export const moderationCaseNotes = pgTable(
  "moderation_case_notes",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    caseId: text("case_id")
      .notNull()
      .references(() => moderationCases.id, { onDelete: "restrict" }),
    adminUserId: text("admin_user_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("moderation_case_notes_body_check", sql`char_length(${table.body}) between 1 and 2000`),
    index("moderation_case_notes_case_created_idx").on(table.caseId, table.createdAt),
  ],
);

/**
 * Sanctions (#248): an operator's explicit action on a case against its
 * subject account. Account-wide by construction — every character of the
 * account is covered, so switching characters never evades one.
 *
 * - `warning` restricts nothing; `social_restriction` stops outbound social
 *   contact (`server/moderation-sanctions.ts`); `suspension` stops gameplay
 *   through the gameplay-access rule.
 * - `duration` is the preset it was issued (or last changed) with; `ends_at`
 *   is derived from `starts_at` and that preset, null when permanent. Changing
 *   the duration rewrites both; reversing sets the reversal pair. Every change
 *   is audited in `operator_audit_logs`; the row keeps only current state.
 * - Whether a sanction is in effect is always derived from these facts and
 *   the request's clock, never stored, so expiry needs no job.
 */
export const moderationSanctions = pgTable(
  "moderation_sanctions",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    caseId: text("case_id")
      .notNull()
      .references(() => moderationCases.id, { onDelete: "restrict" }),
    playerAccountId: text("player_account_id")
      .notNull()
      .references(() => playerAccounts.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    ruleCategory: text("rule_category").notNull(),
    duration: text("duration"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    issuedByAdminUserId: text("issued_by_admin_user_id").notNull(),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedByAdminUserId: text("reversed_by_admin_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "moderation_sanctions_kind_check",
      sql`${table.kind} in ('warning', 'social_restriction', 'suspension')`,
    ),
    check(
      "moderation_sanctions_rule_check",
      sql`${table.ruleCategory} in ('identity_hate', 'harassment', 'threats_private_info', 'sexual_content', 'scams_spam', 'moderation_abuse', 'block_or_sanction_evasion', 'offensive_name')`,
    ),
    check(
      "moderation_sanctions_duration_check",
      sql`(${table.kind} = 'warning' and ${table.duration} is null and ${table.endsAt} is null) or (${table.kind} <> 'warning' and ${table.duration} is not null and ${table.duration} in ('24h', '7d', '30d', '90d', '1y', 'permanent') and (${table.duration} = 'permanent') = (${table.endsAt} is null))`,
    ),
    check(
      "moderation_sanctions_reversal_paired_check",
      sql`(${table.reversedAt} is null) = (${table.reversedByAdminUserId} is null)`,
    ),
    index("moderation_sanctions_account_kind_idx").on(table.playerAccountId, table.kind),
    index("moderation_sanctions_case_idx").on(table.caseId),
  ],
);

/**
 * A player's appeal of one sanction (#248), submitted from the authenticated
 * in-game appeal form. One appeal per sanction. The submission (`body`,
 * `submitted_at`) is never changed; the operator's decision is set once —
 * Upheld, Modified, or Reversed — and audited with any resulting sanction
 * change in the same transaction. `decision_note` is internal.
 */
export const moderationAppeals = pgTable(
  "moderation_appeals",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sanctionId: text("sanction_id")
      .notNull()
      .unique()
      .references(() => moderationSanctions.id, { onDelete: "restrict" }),
    caseId: text("case_id")
      .notNull()
      .references(() => moderationCases.id, { onDelete: "restrict" }),
    playerAccountId: text("player_account_id")
      .notNull()
      .references(() => playerAccounts.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    outcome: text("outcome"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedByAdminUserId: text("decided_by_admin_user_id"),
    decisionNote: text("decision_note"),
  },
  (table) => [
    check("moderation_appeals_body_check", sql`char_length(${table.body}) between 1 and 1000`),
    check(
      "moderation_appeals_outcome_check",
      sql`${table.outcome} is null or ${table.outcome} in ('upheld', 'modified', 'reversed')`,
    ),
    check(
      "moderation_appeals_decision_paired_check",
      sql`(${table.outcome} is null) = (${table.decidedAt} is null) and (${table.outcome} is null) = (${table.decidedByAdminUserId} is null)`,
    ),
    index("moderation_appeals_case_idx").on(table.caseId),
    index("moderation_appeals_pending_idx")
      .on(table.submittedAt)
      .where(sql`${table.outcome} is null`),
  ],
);

/**
 * Privileged access audit (#248): one immutable row for every operator view
 * of sensitive safety data — the moderation queue, a case's reports and
 * preserved evidence, retained public chat or Whispers, an account's
 * moderation history, and this log itself — written in the same transaction
 * as the read, before any data is returned, even when nothing is changed.
 *
 * It is separate from `operator_audit_logs` on purpose: that table's contract
 * is "one row per successful mutation", and mixing reads into it would make
 * that contract misleading. `admin_user_id` is always the server-derived
 * operator identity. There is no update or delete path, and only the
 * allowlisted operators can read it.
 */
export const privilegedAccessLogs = pgTable(
  "privileged_access_logs",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    adminUserId: text("admin_user_id").notNull(),
    accessKind: text("access_kind").notNull(),
    caseId: text("case_id").references(() => moderationCases.id, { onDelete: "restrict" }),
    targetPlayerAccountId: text("target_player_account_id").references(() => playerAccounts.id, {
      onDelete: "restrict",
    }),
    targetCharacterId: text("target_character_id").references(() => characters.id, {
      onDelete: "restrict",
    }),
    // What exactly was viewed: filters, windows, conversation ids. Never data.
    context: jsonb("context").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "privileged_access_logs_kind_check",
      sql`${table.accessKind} in ('case_queue', 'case_detail', 'retained_public_chat', 'retained_whispers', 'account_moderation_history', 'privileged_access_log')`,
    ),
    index("privileged_access_logs_created_idx").on(table.createdAt),
    index("privileged_access_logs_case_created_idx")
      .on(table.caseId, table.createdAt)
      .where(sql`${table.caseId} is not null`),
    index("privileged_access_logs_account_created_idx")
      .on(table.targetPlayerAccountId, table.createdAt)
      .where(sql`${table.targetPlayerAccountId} is not null`),
  ],
);

/**
 * Same-location player trade requests (issue #266). One row per request the
 * server actually created — a refused attempt never writes one — so the rows
 * are also the short-lived ledger behind the account's rolling request budget
 * and the repeated-recipient escalation. Both characters and both accounts
 * are stored as stable ids; `location_id` is the World Location the two shared
 * when the request was made.
 *
 * `status` is the durable terminal outcome once one is written. A `pending`
 * row is only effectively pending while it has not expired and both
 * characters are still at `location_id` (`game/domain/player-trade.ts`); the
 * derived outcome is written down before the requester's slot is reused and
 * at acceptance. The partial unique index is the persistence-level arbiter of
 * one outgoing pending request per character. Terminal rows older than the
 * rolling window are pruned when a request is created.
 */
export const playerTradeRequests = pgTable(
  "player_trade_requests",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    requesterCharacterId: text("requester_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    requesterPlayerAccountId: text("requester_player_account_id")
      .notNull()
      .references(() => playerAccounts.id, { onDelete: "restrict" }),
    recipientCharacterId: text("recipient_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    recipientPlayerAccountId: text("recipient_player_account_id")
      .notNull()
      .references(() => playerAccounts.id, { onDelete: "restrict" }),
    locationId: text("location_id").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    // The session an accepted request began.
    sessionId: text("session_id").references(() => playerTradeSessions.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    check(
      "player_trade_requests_status_check",
      sql`${table.status} in ('pending', 'accepted', 'canceled', 'declined', 'expired', 'invalidated')`,
    ),
    check(
      "player_trade_requests_distinct_characters_check",
      sql`${table.requesterCharacterId} <> ${table.recipientCharacterId}`,
    ),
    check(
      "player_trade_requests_resolved_check",
      sql`(${table.status} = 'pending') = (${table.resolvedAt} is null)`,
    ),
    check(
      "player_trade_requests_session_check",
      sql`(${table.status} = 'accepted') = (${table.sessionId} is not null)`,
    ),
    check("player_trade_requests_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    uniqueIndex("player_trade_requests_one_pending_per_requester")
      .on(table.requesterCharacterId)
      .where(sql`${table.status} = 'pending'`),
    index("player_trade_requests_recipient_pending_idx")
      .on(table.recipientCharacterId)
      .where(sql`${table.status} = 'pending'`),
    index("player_trade_requests_account_created_idx").on(
      table.requesterPlayerAccountId,
      table.createdAt,
    ),
    index("player_trade_requests_account_pair_created_idx").on(
      table.requesterPlayerAccountId,
      table.recipientPlayerAccountId,
      table.createdAt,
    ),
    index("player_trade_requests_created_idx").on(table.createdAt),
  ],
);

/**
 * One accepted player trade session (issue #266) and its offer state (#267).
 * A session is database state, so it survives refresh and reconnect; it
 * expires after five minutes without trade activity (derived from
 * `last_activity_at`, written down when it matters), and either participant
 * may cancel it before commit. `ended_at` is the authoritative end instant;
 * for an inactivity expiry it is the moment the session went idle-expired, not
 * the moment that was noticed, and for `completed` it is the commit instant.
 *
 * The row is also the serialization point for every offer command: each one
 * locks it. `offer_version` is server-owned and advances on every change to
 * either offer (Credits here; stacks and unique items in the offer tables
 * below), and every advance clears all four consent flags, so a Ready or
 * Confirm can only ever belong to the exact offers it was given for. Confirm
 * requires both Ready, and `completed` requires both Confirmed.
 */
export const playerTradeSessions = pgTable(
  "player_trade_sessions",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    requesterCharacterId: text("requester_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    requesterPlayerAccountId: text("requester_player_account_id")
      .notNull()
      .references(() => playerAccounts.id, { onDelete: "restrict" }),
    recipientCharacterId: text("recipient_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    recipientPlayerAccountId: text("recipient_player_account_id")
      .notNull()
      .references(() => playerAccounts.id, { onDelete: "restrict" }),
    locationId: text("location_id").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    // The participant who canceled; null for an inactivity expiry or a commit.
    endedByCharacterId: text("ended_by_character_id").references(() => characters.id, {
      onDelete: "restrict",
    }),
    offerVersion: integer("offer_version").notNull().default(1),
    requesterCredits: integer("requester_credits").notNull().default(0),
    recipientCredits: integer("recipient_credits").notNull().default(0),
    requesterReady: boolean("requester_ready").notNull().default(false),
    recipientReady: boolean("recipient_ready").notNull().default(false),
    requesterConfirmed: boolean("requester_confirmed").notNull().default(false),
    recipientConfirmed: boolean("recipient_confirmed").notNull().default(false),
    // Why the latest final Confirm could not settle (#268), and whose side it
    // was, so both participants see what to correct. Written with the refused
    // settlement's new version; any later offer change clears it.
    settlementRefusal: text("settlement_refusal"),
    settlementRefusalSide: text("settlement_refusal_side"),
  },
  (table) => [
    check(
      "player_trade_sessions_settlement_refusal_check",
      sql`(${table.settlementRefusal} is null or ${table.settlementRefusal} in ('offer_unavailable', 'inventory_full', 'too_heavy', 'last_cutter', 'credit_limit', 'ineligible', 'empty_trade')) and (${table.settlementRefusalSide} is null or (${table.settlementRefusal} is not null and ${table.settlementRefusalSide} in ('requester', 'recipient')))`,
    ),
    check(
      "player_trade_sessions_status_check",
      sql`${table.status} in ('active', 'canceled', 'expired', 'completed')`,
    ),
    check("player_trade_sessions_offer_version_check", sql`${table.offerVersion} >= 1`),
    check(
      "player_trade_sessions_credits_check",
      sql`${table.requesterCredits} >= 0 and ${table.recipientCredits} >= 0`,
    ),
    check(
      "player_trade_sessions_confirm_check",
      sql`not (${table.requesterConfirmed} or ${table.recipientConfirmed}) or (${table.requesterReady} and ${table.recipientReady})`,
    ),
    check(
      "player_trade_sessions_completed_check",
      sql`${table.status} <> 'completed' or (${table.requesterConfirmed} and ${table.recipientConfirmed} and ${table.endedByCharacterId} is null)`,
    ),
    check(
      "player_trade_sessions_distinct_characters_check",
      sql`${table.requesterCharacterId} <> ${table.recipientCharacterId}`,
    ),
    check(
      "player_trade_sessions_ended_check",
      sql`(${table.status} = 'active') = (${table.endedAt} is null)`,
    ),
    index("player_trade_sessions_requester_idx").on(table.requesterCharacterId),
    index("player_trade_sessions_recipient_idx").on(table.recipientCharacterId),
  ],
);

/**
 * A character's claim on its one active trade session (issue #266). The
 * primary key on `character_id` is the persistence-level arbiter: a character
 * can hold at most one claim, so it can never be in two accepted sessions,
 * whichever accounts are involved. Acceptance inserts both claims in the same
 * transaction that creates the session; ending the session deletes them.
 */
export const playerTradeClaims = pgTable(
  "player_trade_claims",
  {
    characterId: text("character_id")
      .primaryKey()
      .references(() => characters.id, { onDelete: "restrict" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => playerTradeSessions.id, { onDelete: "restrict" }),
  },
  (table) => [index("player_trade_claims_session_idx").on(table.sessionId)],
);

/**
 * The stackable part of one participant's offer in one session (#267): an
 * item id and a whole positive quantity, at most one row per item per side.
 * Rows are offer state, not a reservation or escrow — nothing leaves the
 * character's Inventory until commit, which re-proves every quantity against
 * the carried stacks. Rows of an ended session are inert.
 */
export const playerTradeOfferStacks = pgTable(
  "player_trade_offer_stacks",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => playerTradeSessions.id, { onDelete: "restrict" }),
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    itemId: text("item_id").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.sessionId, table.characterId, table.itemId],
      name: "player_trade_offer_stacks_pk",
    }),
    check("player_trade_offer_stacks_quantity_check", sql`${table.quantity} > 0`),
  ],
);

/**
 * The unique-item part of one participant's offer in one session (#267). An
 * instance appears at most once per session. Deliberately no foreign key to
 * `item_instances`: the instance's ownership and location are re-proved at
 * every edit and at commit, and an ended session's rows must never constrain
 * what later happens to the instance.
 */
export const playerTradeOfferItems = pgTable(
  "player_trade_offer_items",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => playerTradeSessions.id, { onDelete: "restrict" }),
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    itemInstanceId: text("item_instance_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.sessionId, table.itemInstanceId],
      name: "player_trade_offer_items_pk",
    }),
  ],
);

/**
 * The permanent economic audit of committed player trades (#267): exactly one
 * immutable row per completed session, written in the same transaction as the
 * settlement, so a trade cannot complete without it and it cannot exist for a
 * trade that did not. The primary key is the trade (session) id, which makes a
 * second row for one trade impossible. It preserves both explicit offers —
 * Credits, stack item ids and quantities, and unique instance ids with their
 * item ids, each side as offered rather than a net delta — with both accounts,
 * both characters, the World Location, and the commit instant.
 *
 * Retained permanently for alpha operational review. Writes happen only
 * through settlement; there is no `updated_at` and no update or delete path.
 * Read through `server/player-trade-audit.ts` by trade, account, or character.
 */
export const playerTradeAudits = pgTable(
  "player_trade_audits",
  {
    tradeId: text("trade_id")
      .primaryKey()
      .references(() => playerTradeSessions.id, { onDelete: "restrict" }),
    committedAt: timestamp("committed_at", { withTimezone: true }).notNull(),
    locationId: text("location_id").notNull(),
    requesterPlayerAccountId: text("requester_player_account_id")
      .notNull()
      .references(() => playerAccounts.id, { onDelete: "restrict" }),
    requesterCharacterId: text("requester_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    recipientPlayerAccountId: text("recipient_player_account_id")
      .notNull()
      .references(() => playerAccounts.id, { onDelete: "restrict" }),
    recipientCharacterId: text("recipient_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    requesterCredits: integer("requester_credits").notNull(),
    recipientCredits: integer("recipient_credits").notNull(),
    // [{ itemId, quantity }] as offered by each side.
    requesterStacks: jsonb("requester_stacks").notNull(),
    recipientStacks: jsonb("recipient_stacks").notNull(),
    // [{ itemInstanceId, itemId }] as offered by each side.
    requesterItems: jsonb("requester_items").notNull(),
    recipientItems: jsonb("recipient_items").notNull(),
  },
  (table) => [
    check(
      "player_trade_audits_credits_check",
      sql`${table.requesterCredits} >= 0 and ${table.recipientCredits} >= 0`,
    ),
    check(
      "player_trade_audits_offers_shape_check",
      sql`jsonb_typeof(${table.requesterStacks}) = 'array' and jsonb_typeof(${table.recipientStacks}) = 'array' and jsonb_typeof(${table.requesterItems}) = 'array' and jsonb_typeof(${table.recipientItems}) = 'array'`,
    ),
    check(
      "player_trade_audits_distinct_characters_check",
      sql`${table.requesterCharacterId} <> ${table.recipientCharacterId}`,
    ),
    index("player_trade_audits_requester_account_idx").on(
      table.requesterPlayerAccountId,
      table.committedAt,
    ),
    index("player_trade_audits_recipient_account_idx").on(
      table.recipientPlayerAccountId,
      table.committedAt,
    ),
    index("player_trade_audits_requester_character_idx").on(
      table.requesterCharacterId,
      table.committedAt,
    ),
    index("player_trade_audits_recipient_character_idx").on(
      table.recipientCharacterId,
      table.committedAt,
    ),
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
export type CharacterMission = typeof characterMissions.$inferSelect;
export type CharacterMissionProgress = typeof characterMissionProgress.$inferSelect;
export type CharacterPowerCellDailyClaim = typeof characterPowerCellDailyClaims.$inferSelect;
export type CharacterRepairTarget = typeof characterRepairTargets.$inferSelect;
export type CharacterMerchantDailyPurchase = typeof characterMerchantDailyPurchases.$inferSelect;
export type CharacterWorkOrderPosting = typeof characterWorkOrderPostings.$inferSelect;
export type CargoHoldStack = typeof cargoHoldStacks.$inferSelect;
export type CargoHoldItemInstance = typeof cargoHoldItemInstances.$inferSelect;
export type SiteStashContainer = typeof siteStashContainers.$inferSelect;
export type SiteStashStack = typeof siteStashStacks.$inferSelect;
export type SiteStashItemInstance = typeof siteStashItemInstances.$inferSelect;
export type OperatorAuditLog = typeof operatorAuditLogs.$inferSelect;
export type NewOperatorAuditLog = typeof operatorAuditLogs.$inferInsert;
export type RuneSpaceAccessState = typeof runespaceAccessState.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;

/** A `chat_messages` row a character sent: its sender identity is present. */
export type PlayerChatMessage = ChatMessage & {
  senderPlayerAccountId: string;
  senderCharacterId: string;
  senderCharacterName: string;
};

/**
 * Narrow a row to a player's message (#308). A System announcement has no
 * sender, and every path that reads, reports, or whispers one by sender is
 * about a player; reaching one with a System row is a bug, not a case.
 */
export function asPlayerChatMessage(row: ChatMessage): PlayerChatMessage {
  if (
    row.senderPlayerAccountId === null ||
    row.senderCharacterId === null ||
    row.senderCharacterName === null
  ) {
    throw new Error(`Chat message ${row.id} has no sender: it is not a player's message`);
  }
  return row as PlayerChatMessage;
}
export type ChatMessageMention = typeof chatMessageMentions.$inferSelect;
export type RecipeUnlockNotice = typeof recipeUnlockNotices.$inferSelect;
export type PlayerReport = typeof playerReports.$inferSelect;
export type ModerationCase = typeof moderationCases.$inferSelect;
export type ModerationCaseNote = typeof moderationCaseNotes.$inferSelect;
export type ModerationSanction = typeof moderationSanctions.$inferSelect;
export type ModerationAppeal = typeof moderationAppeals.$inferSelect;
export type PrivilegedAccessLog = typeof privilegedAccessLogs.$inferSelect;
export type PlayerTradeRequest = typeof playerTradeRequests.$inferSelect;
export type PlayerTradeSession = typeof playerTradeSessions.$inferSelect;
export type PlayerTradeOfferStack = typeof playerTradeOfferStacks.$inferSelect;
export type PlayerTradeOfferItem = typeof playerTradeOfferItems.$inferSelect;
export type PlayerTradeAudit = typeof playerTradeAudits.$inferSelect;
