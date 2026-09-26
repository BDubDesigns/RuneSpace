import { relations, sql } from "drizzle-orm";
import {
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
    // there rather than carrying an unused window nobody may claim.
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
    // The structural invariant behind "riding offers nothing to scavenge":
    // a walk always has an authored window, and no other mode ever does.
    check(
      "character_travel_state_scavenge_window_matches_mode",
      sql`(${table.mode} = 'walk' AND ${table.scavengeOpportunityStartTick} IS NOT NULL AND ${table.scavengeOpportunityStartTick} >= 3 AND ${table.scavengeOpportunityStartTick} <= 30) OR (${table.mode} <> 'walk' AND ${table.scavengeOpportunityStartTick} IS NULL)`,
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
export const characterRefiningState = pgTable("character_refining_state", {
  characterId: text("character_id")
    .primaryKey()
    .references(() => characters.id, { onDelete: "restrict" }),
  lastStopReason: text("last_stop_reason"),
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
  runXpGained: integer("run_xp_gained").notNull().default(0),
  /** Latest ten immutable server-resolved refining attempt summaries for the current run. */
  recentAttempts: jsonb("recent_attempts").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
 * the persistent Slag preference, and the bounded `This Run` totals that mirror
 * Mining and Refining.
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
    /** Persistent per-character preference, read at each weld's completion. */
    autoDiscardSlag: boolean("auto_discard_slag").notNull().default(false),
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
    // A weld that is not in progress cannot hold partial sections: the pair is
    // written together by one resolution, so a split state is corruption.
    check(
      "character_practice_welds_sections_require_active_cycle",
      sql`${table.cycleActive} OR ${table.sectionsCompleted} = 0`,
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
export type OperatorAuditLog = typeof operatorAuditLogs.$inferSelect;
export type NewOperatorAuditLog = typeof operatorAuditLogs.$inferInsert;
export type RuneSpaceAccessState = typeof runespaceAccessState.$inferSelect;
