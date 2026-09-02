import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ACTION_IDS,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #113 admin operator console: command semantics against a real
 * PostgreSQL database. The `*AsAdmin` command seams (imported directly from
 * `server/admin-command-seams.ts`, an INTERNAL non-production module) take an
 * explicit admin user id so the full shared lock + lazy-reconcile +
 * force-interrupt + atomic-audit logic is exercised exactly as a browser-issued
 * command would be; the HTTP `requireAdmin` boundary is covered separately in
 * the unit suite, and the production surface in `server/admin-commands.ts`
 * safely wraps these seams behind `requireAdmin`.
 */
suite("issue #113 admin operator console (real PostgreSQL)", () => {
  const ADMIN = "admin-operator-test";

  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let miningCommands: typeof import("@/server/mining-commands");
  let refiningCommands: typeof import("@/server/refining-commands");
  let cargo: typeof import("@/server/cargo-hold");
  let adminCommands: typeof import("@/server/admin-command-seams");
  let playInterrupt: typeof import("@/server/play-interrupt");
  const createdUsers: string[] = [];

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    miningCommands = await import("@/server/mining-commands");
    refiningCommands = await import("@/server/refining-commands");
    cargo = await import("@/server/cargo-hold");
    adminCommands = await import("@/server/admin-command-seams");
    playInterrupt = await import("@/server/play-interrupt");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function makeCharacter() {
    const userId = await createTestUser(db, authSchema, "Admin Operator Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Operator ${userId.slice(0, 6)}`,
    );
    return { userId, character };
  }

  /** Mining is only available at The Jag (issue #83); relocate directly. */
  async function moveToTheJag(characterId: string) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.theJag })
      .where(eq(rune.characters.id, characterId));
  }

  /** The equipped gear Cutter instance (distinct from the auto-equipped container). */
  async function equippedCutterId(characterId: string): Promise<string | undefined> {
    const rows = await db
      .select({ itemInstanceId: rune.equippedItems.itemInstanceId })
      .from(rune.equippedItems)
      .innerJoin(rune.itemInstances, eq(rune.itemInstances.id, rune.equippedItems.itemInstanceId))
      .where(
        and(
          eq(rune.equippedItems.characterId, characterId),
          eq(rune.itemInstances.itemId, ITEM_IDS.salvageCutter),
        ),
      );
    return rows[0]?.itemInstanceId;
  }

  async function auditFor(characterId: string) {
    return db
      .select()
      .from(rune.operatorAuditLogs)
      .where(eq(rune.operatorAuditLogs.characterId, characterId))
      .orderBy(rune.operatorAuditLogs.createdAt, rune.operatorAuditLogs.id);
  }

  /** Advance a wall-clock point by `count` game ticks (600ms each). */
  function tick(base: Date, count: number): Date {
    return new Date(base.getTime() + count * GAME_TICK_MS);
  }

  /** Deterministic low-roll random: succeeds (0 < threshold) and yields the minimum output. */
  const detRandom = { nextBasisPoints: () => 0, nextUnit: () => 0 };

  /** Relocate to the Processing Yard (Refining / Welding host) directly. */
  async function moveToProcessingYard(characterId: string) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.abandonedProcessingYard })
      .where(eq(rune.characters.id, characterId));
  }

  /** Seed + install the Cargo-hold repair materials so Welding can actually run. */
  async function installRepairMaterials(userId: string, characterId: string, at: Date) {
    const { getEffectiveGameBalance } = await import("@/game/config/balance");
    const balance = getEffectiveGameBalance();
    await db.insert(rune.inventoryStacks).values([
      {
        characterId,
        itemId: ITEM_IDS.refinedFerrite,
        quantity: balance.cargoHold.refinedFerriteRequired,
      },
      { characterId, itemId: ITEM_IDS.slag, quantity: balance.cargoHold.slagRequired },
    ]);
    const contribution = await cargo.contributeCargoHoldMaterials(
      userId,
      characterId,
      {
        expectedRefinedFerrite: balance.cargoHold.refinedFerriteRequired,
        expectedSlag: balance.cargoHold.slagRequired,
      },
      at,
      detRandom,
    );
    expect(contribution.cargo.status).toBe("committed");
  }

  // -------------------------------------------------------------------------
  // STOP CURRENT ACTION
  // -------------------------------------------------------------------------

  it("STOP is a no-op on an already-idle character and writes no audit", async () => {
    const { character } = await makeCharacter();
    const result = await adminCommands.stopCurrentActionAsAdmin(ADMIN, character.id);
    expect(result.outcome.kind).toBe("already_idle");
    expect(await auditFor(character.id)).toHaveLength(0);
  });

  it("STOP interrupts an in-progress Mining action and audits it", async () => {
    const { userId, character } = await makeCharacter();
    await moveToTheJag(character.id);
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await miningCommands.startFerriteShaleMining(userId, character.id, startedAt);
    const form = await adminCommands.stopCurrentActionAsAdmin(
      ADMIN,
      character.id,
      new Date("2026-01-01T00:00:02.000Z"),
    );
    expect(form.outcome.kind).toBe("interrupted");
    if (form.outcome.kind !== "interrupted") return;
    expect(form.outcome.actionId).toBe(ACTION_IDS.ferriteShaleMining);
    const actions = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(actions).toHaveLength(0);
    // Persisted exactly like the player STOP: Mining keeps `lastStopReason`.
    const miningState = await db
      .select()
      .from(rune.characterMiningState)
      .where(eq(rune.characterMiningState.characterId, character.id));
    expect(miningState[0]?.lastStopReason).toBe("manually_stopped");
    const audit = await auditFor(character.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.operation).toBe("stop_current_action");
    expect(audit[0]?.adminUserId).toBe(ADMIN);
    expect(audit[0]?.targetIdentity).toBe(ACTION_IDS.ferriteShaleMining);
  });

  it("STOP reconciles due activity work (does not lose earned progress) before interrupting", async () => {
    const { userId, character } = await makeCharacter();
    await moveToTheJag(character.id);
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const random = { nextBasisPoints: () => 0, nextUnit: () => 0 };
    await miningCommands.startFerriteShaleMining(userId, character.id, startedAt, random);
    // Bank deterministic mining progress before the admin STOP.
    const banked = await play.getPlayGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:01:00.000Z"),
      random,
    );
    expect(banked.ferriteShaleQuantity).toBeGreaterThan(0);
    // Admin STOP at the same timestamp reconciles nothing new but must NOT
    // discard the already-earned balance.
    const result = await adminCommands.stopCurrentActionAsAdmin(
      ADMIN,
      character.id,
      new Date("2026-01-01T00:01:00.000Z"),
    );
    expect(result.outcome.kind).toBe("interrupted");
    expect(result.state.ferriteShaleQuantity).toBe(banked.ferriteShaleQuantity);
  });

  it("STOP interrupts in-flight Travel without leaving travel state and audits it", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await play.beginTravel(userId, character.id, LOCATION_IDS.abandonedProcessingYard, startedAt);
    const result = await adminCommands.stopCurrentActionAsAdmin(
      ADMIN,
      character.id,
      new Date("2026-01-01T00:00:05.000Z"),
    );
    expect(result.outcome.kind).toBe("interrupted");
    const travelRows = await db
      .select()
      .from(rune.characterTravelState)
      .where(eq(rune.characterTravelState.characterId, character.id));
    expect(travelRows).toHaveLength(0);
    const actions = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(actions).toHaveLength(0);
    const audit = await auditFor(character.id);
    expect(audit.some((a) => a.operation === "stop_current_action")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // TELEPORT / SET LOCATION
  // -------------------------------------------------------------------------

  it("rejects a non-canonical destination before any mutation or audit", async () => {
    const { character } = await makeCharacter();
    await expect(
      adminCommands.teleportCharacterAsAdmin(ADMIN, character.id, "not_a_canonical_location"),
    ).rejects.toThrow(/unknown destination/i);
    const rows = await db
      .select()
      .from(rune.characters)
      .where(eq(rune.characters.id, character.id));
    expect(rows[0]?.currentLocationId).toBe(LOCATION_IDS.crashSite);
    expect(await auditFor(character.id)).toHaveLength(0);
  });

  it("teleports an idle character, updates location, and audits it", async () => {
    const { character } = await makeCharacter();
    const result = await adminCommands.teleportCharacterAsAdmin(
      ADMIN,
      character.id,
      LOCATION_IDS.theJag,
    );
    expect(result.outcome.kind).toBe("teleported");
    if (result.outcome.kind !== "teleported") return;
    expect(result.outcome.fromLocationId).toBe(LOCATION_IDS.crashSite);
    expect(result.outcome.toLocationId).toBe(LOCATION_IDS.theJag);
    expect(result.state.location.currentLocationId).toBe(LOCATION_IDS.theJag);
    const audit = await auditFor(character.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.operation).toBe("teleport_character");
    expect(audit[0]?.targetIdentity).toBe(LOCATION_IDS.theJag);
  });

  it("teleport to the current location while idle is a no-change with no audit", async () => {
    const { character } = await makeCharacter();
    const result = await adminCommands.teleportCharacterAsAdmin(
      ADMIN,
      character.id,
      LOCATION_IDS.crashSite,
    );
    expect(result.outcome.kind).toBe("no_change");
    expect(await auditFor(character.id)).toHaveLength(0);
  });

  it("teleport interrupts an in-flight journey and relocates, auditing both", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await play.beginTravel(userId, character.id, LOCATION_IDS.abandonedProcessingYard, startedAt);
    const result = await adminCommands.teleportCharacterAsAdmin(
      ADMIN,
      character.id,
      LOCATION_IDS.theJag,
      new Date("2026-01-01T00:00:05.000Z"),
    );
    expect(result.outcome.kind).toBe("teleported");
    if (result.outcome.kind !== "teleported") return;
    // Origin stays the Crash Site because the journey had not yet arrived.
    expect(result.outcome.fromLocationId).toBe(LOCATION_IDS.crashSite);
    expect(result.outcome.toLocationId).toBe(LOCATION_IDS.theJag);
    expect(result.state.location.currentLocationId).toBe(LOCATION_IDS.theJag);
    const travelRows = await db
      .select()
      .from(rune.characterTravelState)
      .where(eq(rune.characterTravelState.characterId, character.id));
    expect(travelRows).toHaveLength(0);
    const audit = await auditFor(character.id);
    expect(audit.some((a) => a.operation === "teleport_character")).toBe(true);
    expect(audit.some((a) => a.operation === "stop_current_action")).toBe(false);
  });

  it("teleport after the travel resolved during reconcile is a no-change to the same place", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await play.beginTravel(userId, character.id, LOCATION_IDS.abandonedProcessingYard, startedAt);
    // Arrive at the Processing Yard first, then teleport back to it.
    const result = await adminCommands.teleportCharacterAsAdmin(
      ADMIN,
      character.id,
      LOCATION_IDS.abandonedProcessingYard,
      new Date("2026-01-01T00:00:30.000Z"),
    );
    expect(result.outcome.kind).toBe("no_change");
    // The relocation to the same ready state is not an operator mutation.
    expect(await auditFor(character.id)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Carried / Cargo exact stack removal
  // -------------------------------------------------------------------------

  it("REMOVE 1 from a carried stack by exact identity and audits it", async () => {
    const { userId, character } = await makeCharacter();
    await moveToTheJag(character.id);
    const random = { nextBasisPoints: () => 0, nextUnit: () => 0 };
    const startedAt = new Date("2026-01-01T01:00:00.000Z");
    await miningCommands.startFerriteShaleMining(userId, character.id, startedAt, random);
    // Bank a deterministic Ferrite Shale stack, then remove at the same tick.
    const readyAt = new Date("2026-01-01T01:01:00.000Z");
    const ready = await play.getPlayGameplayState(userId, character.id, readyAt, random);
    const stack = ready.inventory.stacks.find((s) => s.itemId === ITEM_IDS.ferriteShale);
    expect(stack).toBeDefined();
    if (!stack) return;
    const before = stack.quantity;
    const result = await adminCommands.removeCarriedStackQuantityAsAdmin(
      ADMIN,
      character.id,
      stack.id,
      "one",
      stack.quantity,
      readyAt,
    );
    expect(result.outcome.kind).toBe("removed");
    if (result.outcome.kind !== "removed") return;
    expect(result.outcome.source).toBe("carried");
    expect(result.outcome.removedQuantity).toBe(1);
    expect(result.state.inventory.stacks.find((s) => s.id === stack.id)?.quantity).toBe(before - 1);
    const audit = await auditFor(character.id);
    expect(audit.some((a) => a.operation === "removed_stack_quantity")).toBe(true);
    // Fifth-pass enrichment: the audit carries the removed stack's itemId so
    // history renders the item by name.
    const removalAudit = audit.find((a) => a.operation === "removed_stack_quantity");
    expect((removalAudit?.details as { itemId?: string } | undefined)?.itemId).toBe(
      ITEM_IDS.ferriteShale,
    );
  });

  it("REMOVE with a stale expected quantity is refused and not audited", async () => {
    const { userId, character } = await makeCharacter();
    await moveToTheJag(character.id);
    const random = { nextBasisPoints: () => 0, nextUnit: () => 0 };
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await miningCommands.startFerriteShaleMining(userId, character.id, startedAt, random);
    const readyAt = new Date("2026-01-01T00:01:00.000Z");
    const ready = await play.getPlayGameplayState(userId, character.id, readyAt, random);
    const stack = ready.inventory.stacks.find((s) => s.itemId === ITEM_IDS.ferriteShale);
    expect(stack).toBeDefined();
    if (!stack) return;
    const result = await adminCommands.removeCarriedStackQuantityAsAdmin(
      ADMIN,
      character.id,
      stack.id,
      "stack",
      stack.quantity + 10,
      readyAt,
    );
    expect(result.outcome.kind).toBe("stale");
    expect(await auditFor(character.id)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Cargo stack removal (finding #2/#3)
  // -------------------------------------------------------------------------

  it("REMOVE from a Cargo stack reloads the POST-mutation state and audits it", async () => {
    const { character } = await makeCharacter();
    const [inserted] = await db
      .insert(rune.cargoHoldStacks)
      .values({
        characterId: character.id,
        itemId: ITEM_IDS.ferriteShale,
        quantity: 4,
      })
      .returning({ id: rune.cargoHoldStacks.id });
    expect(inserted?.id).toBeTruthy();
    if (!inserted?.id) return;

    const result = await adminCommands.removeCargoStackQuantityAsAdmin(
      ADMIN,
      character.id,
      inserted.id,
      "one",
      4,
    );
    expect(result.outcome.kind).toBe("removed");
    if (result.outcome.kind !== "removed") return;
    expect(result.outcome.removedQuantity).toBe(1);
    // The returned state reflects the mutation (not the pre-mutation snapshot).
    const cargoStack = result.state.cargoHold.stacks.find((s) => s.id === inserted.id);
    expect(cargoStack?.quantity).toBe(3);
    const persisted = await db
      .select()
      .from(rune.cargoHoldStacks)
      .where(eq(rune.cargoHoldStacks.id, inserted.id));
    expect(persisted[0]?.quantity).toBe(3);
    const audit = await auditFor(character.id);
    expect(audit.some((a) => a.operation === "removed_stack_quantity")).toBe(true);
    // Fifth-pass enrichment: the audit carries the removed stack's itemId so
    // history renders the item by name.
    const removalAudit = audit.find((a) => a.operation === "removed_stack_quantity");
    expect((removalAudit?.details as { itemId?: string } | undefined)?.itemId).toBe(
      ITEM_IDS.ferriteShale,
    );
  });

  it("REMOVE STACK from Cargo deletes the whole stack and reloads state", async () => {
    const { character } = await makeCharacter();
    const [inserted] = await db
      .insert(rune.cargoHoldStacks)
      .values({
        characterId: character.id,
        itemId: ITEM_IDS.ferriteShale,
        quantity: 4,
      })
      .returning({ id: rune.cargoHoldStacks.id });
    expect(inserted?.id).toBeTruthy();
    if (!inserted?.id) return;

    const result = await adminCommands.removeCargoStackQuantityAsAdmin(
      ADMIN,
      character.id,
      inserted.id,
      "stack",
      4,
    );
    expect(result.outcome.kind).toBe("removed");
    if (result.outcome.kind !== "removed") return;
    expect(result.outcome.removedQuantity).toBe(4);
    expect(result.state.cargoHold.stacks.find((s) => s.id === inserted.id)).toBeUndefined();
    const persisted = await db
      .select()
      .from(rune.cargoHoldStacks)
      .where(eq(rune.cargoHoldStacks.id, inserted.id));
    expect(persisted).toHaveLength(0);
  });

  it("REMOVE from Cargo against a stale expected quantity is refused and not audited", async () => {
    const { character } = await makeCharacter();
    const [inserted] = await db
      .insert(rune.cargoHoldStacks)
      .values({
        characterId: character.id,
        itemId: ITEM_IDS.ferriteShale,
        quantity: 4,
      })
      .returning({ id: rune.cargoHoldStacks.id });
    expect(inserted?.id).toBeTruthy();
    if (!inserted?.id) return;
    const result = await adminCommands.removeCargoStackQuantityAsAdmin(
      ADMIN,
      character.id,
      inserted.id,
      "one",
      999,
    );
    expect(result.outcome.kind).toBe("stale");
    expect(await auditFor(character.id)).toHaveLength(0);
    const persisted = await db
      .select()
      .from(rune.cargoHoldStacks)
      .where(eq(rune.cargoHoldStacks.id, inserted.id));
    expect(persisted[0]?.quantity).toBe(4);
  });

  // -------------------------------------------------------------------------
  // Force Unequip
  // -------------------------------------------------------------------------

  it("FORCE UNEQUIP removes an equipped unique and audits it", async () => {
    const { character } = await makeCharacter();
    const itemInstanceId = await equippedCutterId(character.id);
    expect(itemInstanceId).toBeTruthy();
    if (!itemInstanceId) return;
    const result = await adminCommands.forceUnequipItemAsAdmin(ADMIN, character.id, itemInstanceId);
    expect(result.outcome.kind).toBe("unequipped");
    const remaining = await db
      .select()
      .from(rune.equippedItems)
      .where(
        and(
          eq(rune.equippedItems.characterId, character.id),
          eq(rune.equippedItems.itemInstanceId, itemInstanceId),
        ),
      );
    expect(remaining).toHaveLength(0);
    const audit = await auditFor(character.id);
    expect(audit.some((a) => a.operation === "force_unequipped_item")).toBe(true);
    // Fifth-pass enrichment: the audit carries the unequipped instance's itemId
    // so history renders the item by name.
    const unequipAudit = audit.find((a) => a.operation === "force_unequipped_item");
    expect((unequipAudit?.details as { itemId?: string } | undefined)?.itemId).toBe(
      ITEM_IDS.salvageCutter,
    );
  });

  it("FORCE UNEQUIP refuses a non-equipped instance and is not audited", async () => {
    const { character } = await makeCharacter();
    const result = await adminCommands.forceUnequipItemAsAdmin(
      ADMIN,
      character.id,
      "00000000-0000-0000-0000-000000000000",
    );
    expect(result.outcome.kind).toBe("refused");
    expect(await auditFor(character.id)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // FORCE UNEQUIP Mining-tool invalidation (finding #1)
  // -------------------------------------------------------------------------

  it("FORCE UNEQUIP of the active Mining tool clears the live Mining action and reports the authoritative stop reason", async () => {
    const { userId, character } = await makeCharacter();
    await moveToTheJag(character.id);
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await miningCommands.startFerriteShaleMining(userId, character.id, startedAt);
    const toolId = await equippedCutterId(character.id);
    expect(toolId).toBeTruthy();
    if (!toolId) return;

    const result = await adminCommands.forceUnequipItemAsAdmin(
      ADMIN,
      character.id,
      toolId,
      new Date("2026-01-01T00:00:01.000Z"),
    );
    expect(result.outcome.kind).toBe("unequipped");
    // The RETURNED state must be reloaded AFTER the mutation: the character is
    // idle (no active Mining action committed with an invalid loadout).
    expect(result.state.activeAction).toBeUndefined();

    const actions = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(actions).toHaveLength(0);
    const miningState = await db
      .select()
      .from(rune.characterMiningState)
      .where(eq(rune.characterMiningState.characterId, character.id));
    // Reuses the authoritative loadout-invalidation stop reason.
    expect(miningState[0]?.lastStopReason).toBe("compatible_mining_tool_missing");
    const audit = await auditFor(character.id);
    expect(audit.some((a) => a.operation === "force_unequipped_item")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Exact unique-item deletion
  // -------------------------------------------------------------------------

  it("refuses to delete an equipped unique until FORCE UNEQUIP (no audit)", async () => {
    const { character } = await makeCharacter();
    const itemInstanceId = await equippedCutterId(character.id);
    expect(itemInstanceId).toBeTruthy();
    if (!itemInstanceId) return;
    const result = await adminCommands.deleteUniqueItemAsAdmin(ADMIN, character.id, itemInstanceId);
    expect(result.outcome.kind).toBe("refused");
    expect(await auditFor(character.id)).toHaveLength(0);
  });

  it("deletes a carried unequipped unique and audits it", async () => {
    const { character } = await makeCharacter();
    // Unequip the gear Cutter so it becomes a carried uniques instance.
    const itemInstanceId = await equippedCutterId(character.id);
    expect(itemInstanceId).toBeTruthy();
    if (!itemInstanceId) return;
    await adminCommands.forceUnequipItemAsAdmin(ADMIN, character.id, itemInstanceId);
    const result = await adminCommands.deleteUniqueItemAsAdmin(ADMIN, character.id, itemInstanceId);
    expect(result.outcome.kind).toBe("deleted");
    if (result.outcome.kind !== "deleted") return;
    expect(result.outcome.source).toBe("carried");
    const instances = await db
      .select()
      .from(rune.itemInstances)
      .where(eq(rune.itemInstances.id, itemInstanceId));
    expect(instances).toHaveLength(0);
    const audit = await auditFor(character.id);
    expect(audit.some((a) => a.operation === "removed_unique_item")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Canonical ADD ITEM
  // -------------------------------------------------------------------------

  it("refuses an unknown item without mutation or audit", async () => {
    const { character } = await makeCharacter();
    const result = await adminCommands.addItemAsAdmin(
      ADMIN,
      character.id,
      "not_an_item",
      undefined,
    );
    expect(result.outcome.kind).toBe("refused");
    expect(await auditFor(character.id)).toHaveLength(0);
  });

  it("ADD ITEM adds a stackable quantity and audits it", async () => {
    const { character } = await makeCharacter();
    const before = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, character.id));
    const result = await adminCommands.addItemAsAdmin(
      ADMIN,
      character.id,
      ITEM_IDS.ferriteShale,
      3,
    );
    expect(result.outcome.kind).toBe("added");
    if (result.outcome.kind !== "added") return;
    expect(result.outcome.quantity).toBe(3);
    const after = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, character.id))
      .orderBy(rune.inventoryStacks.createdAt);
    const totalShale = after
      .filter((s) => s.itemId === ITEM_IDS.ferriteShale)
      .reduce((sum, s) => sum + s.quantity, 0);
    const beforeShale = before
      .filter((s) => s.itemId === ITEM_IDS.ferriteShale)
      .reduce((sum, s) => sum + s.quantity, 0);
    expect(totalShale - beforeShale).toBe(3);
    const audit = await auditFor(character.id);
    expect(audit.some((a) => a.operation === "added_stackable_item")).toBe(true);
  });

  it("ADD ITEM adds a unique item with canonical charge init and audits it", async () => {
    const { character } = await makeCharacter();
    const result = await adminCommands.addItemAsAdmin(
      ADMIN,
      character.id,
      ITEM_IDS.salvageCutter,
      undefined,
    );
    expect(result.outcome.kind).toBe("added");
    const instances = await db
      .select()
      .from(rune.itemInstances)
      .where(
        and(
          eq(rune.itemInstances.characterId, character.id),
          eq(rune.itemInstances.itemId, ITEM_IDS.salvageCutter),
        ),
      );
    // One from the legacy starter fixture plus the admin-added one.
    expect(instances.length).toBeGreaterThanOrEqual(2);
    const audit = await auditFor(character.id);
    expect(audit.some((a) => a.operation === "added_unique_item")).toBe(true);
  });

  it("ADD ITEM refuses a non-positive/invalid stack quantity and audits nothing", async () => {
    const { character } = await makeCharacter();
    const before = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, character.id));
    const beforeShale = before
      .filter((s) => s.itemId === ITEM_IDS.ferriteShale)
      .reduce((sum, s) => sum + s.quantity, 0);

    // 0, negative, and non-integer inputs must be refused — never silently
    // turned into "add one".
    for (const badQuantity of [0, -1, 1.5, Number.NaN]) {
      const result = await adminCommands.addItemAsAdmin(
        ADMIN,
        character.id,
        ITEM_IDS.ferriteShale,
        badQuantity,
      );
      expect(result.outcome.kind).toBe("refused");
      if (result.outcome.kind !== "refused") return;
      const after = await db
        .select()
        .from(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.characterId, character.id));
      const afterShale = after
        .filter((s) => s.itemId === ITEM_IDS.ferriteShale)
        .reduce((sum, s) => sum + s.quantity, 0);
      expect(afterShale).toBe(beforeShale);
    }
    expect(await auditFor(character.id)).toHaveLength(0);
  });

  it("ADD ITEM refuses an explicit quantity for a unique item (fail-closed) and audits nothing", async () => {
    const { character } = await makeCharacter();
    // Uniques are added exactly one-per-command; an explicit quantity must be
    // rejected rather than silently ignored.
    const result = await adminCommands.addItemAsAdmin(
      ADMIN,
      character.id,
      ITEM_IDS.salvageCutter,
      3,
    );
    expect(result.outcome.kind).toBe("refused");
    const created = await db
      .select()
      .from(rune.itemInstances)
      .where(
        and(
          eq(rune.itemInstances.characterId, character.id),
          eq(rune.itemInstances.itemId, ITEM_IDS.salvageCutter),
        ),
      );
    // Only the legacy starter fixture cutter, no admin-added duplicate.
    expect(created.length).toBe(1);
    expect(await auditFor(character.id)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Mission resets (one character only)
  // -------------------------------------------------------------------------

  async function acceptMissions(characterId: string, missionIds: string[]) {
    for (const missionId of missionIds) {
      await db.insert(rune.characterMissions).values({
        characterId,
        missionId,
        acceptedAt: new Date("2026-01-01T00:00:00.000Z"),
        completedAt: null,
      });
    }
  }

  it("RESET FROM THIS MISSION clears the whole transitive chain and audits it", async () => {
    const { character } = await makeCharacter();
    await acceptMissions(character.id, [MISSION_IDS.walkItOff, MISSION_IDS.cutYourTeeth]);
    const result = await adminCommands.resetMissionChainAsAdmin(
      ADMIN,
      character.id,
      MISSION_IDS.walkItOff,
    );
    expect(result.outcome.kind).toBe("reset");
    if (result.outcome.kind !== "reset") return;
    expect(result.outcome.scope).toContain(MISSION_IDS.walkItOff);
    expect(result.outcome.scope).toContain(MISSION_IDS.cutYourTeeth);
    const rows = await db
      .select()
      .from(rune.characterMissions)
      .where(eq(rune.characterMissions.characterId, character.id));
    expect(rows).toHaveLength(0);
    const audit = await auditFor(character.id);
    expect(audit.some((a) => a.operation === "reset_mission_chain")).toBe(true);
  });

  it("RESET FROM rejects an unknown/non-authored mission id server-side (finding #4)", async () => {
    const { character } = await makeCharacter();
    await acceptMissions(character.id, [MISSION_IDS.walkItOff, MISSION_IDS.cutYourTeeth]);
    await expect(
      adminCommands.resetMissionChainAsAdmin(ADMIN, character.id, "not_an_authored_mission"),
    ).rejects.toThrow(/no authored mission/i);
    // Nothing was cleared and nothing was audited on the rejected command.
    const rows = await db
      .select()
      .from(rune.characterMissions)
      .where(eq(rune.characterMissions.characterId, character.id));
    expect(rows).toHaveLength(2);
    expect(await auditFor(character.id)).toHaveLength(0);
  });

  it("RESET ALL deletes only currently-authored mission ids (finding #4)", async () => {
    const { character } = await makeCharacter();
    await acceptMissions(character.id, [MISSION_IDS.walkItOff, MISSION_IDS.cutYourTeeth]);
    // A stale/non-authored persisted row (fictional mission from before removal)
    // must NOT be cleared by RESET ALL.
    await db.insert(rune.characterMissions).values({
      characterId: character.id,
      missionId: "retired_mission_removed_from_authored",
      acceptedAt: new Date("2026-01-01T00:00:00.000Z"),
      completedAt: null,
    });
    const result = await adminCommands.resetAllMissionsAsAdmin(ADMIN, character.id);
    expect(result.outcome.kind).toBe("reset");
    if (result.outcome.kind !== "reset") return;
    expect(result.outcome.deleted).toBe(2);
    const remaining = await db
      .select()
      .from(rune.characterMissions)
      .where(eq(rune.characterMissions.characterId, character.id));
    expect(remaining.map((r) => r.missionId)).toEqual(["retired_mission_removed_from_authored"]);
  });

  it("RESET ALL MISSIONS clears only the selected character", async () => {
    const { character } = await makeCharacter();
    const { character: other } = await makeCharacter();
    await acceptMissions(character.id, [MISSION_IDS.walkItOff, MISSION_IDS.cutYourTeeth]);
    await acceptMissions(other.id, [MISSION_IDS.walkItOff, MISSION_IDS.cutYourTeeth]);
    const result = await adminCommands.resetAllMissionsAsAdmin(ADMIN, character.id);
    expect(result.outcome.kind).toBe("reset");
    const targetRows = await db
      .select()
      .from(rune.characterMissions)
      .where(eq(rune.characterMissions.characterId, character.id));
    expect(targetRows).toHaveLength(0);
    const otherRows = await db
      .select()
      .from(rune.characterMissions)
      .where(eq(rune.characterMissions.characterId, other.id));
    expect(otherRows).toHaveLength(2);
  });

  it("mission reset with no rows to clear is a no-op with no audit", async () => {
    const { character } = await makeCharacter();
    const result = await adminCommands.resetAllMissionsAsAdmin(ADMIN, character.id);
    expect(result.outcome.kind).toBe("nothing_to_reset");
    expect(await auditFor(character.id)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // SET TOTAL XP
  // -------------------------------------------------------------------------

  it("rejects a skill with no approved progression curve", async () => {
    const { character } = await makeCharacter();
    await expect(
      adminCommands.setSkillTotalXpAsAdmin(ADMIN, character.id, SKILL_IDS.strength, 1000),
    ).rejects.toThrow(/no approved progression curve/i);
    expect(rune.characterSkillXp).toBeDefined();
    const rows = await db
      .select()
      .from(rune.characterSkillXp)
      .where(
        and(
          eq(rune.characterSkillXp.characterId, character.id),
          eq(rune.characterSkillXp.skillId, SKILL_IDS.strength),
        ),
      );
    expect(rows).toHaveLength(0);
    expect(await auditFor(character.id)).toHaveLength(0);
  });

  it("SET TOTAL XP writes the absolute value and audits it", async () => {
    const { character } = await makeCharacter();
    const result = await adminCommands.setSkillTotalXpAsAdmin(
      ADMIN,
      character.id,
      SKILL_IDS.mining,
      5000,
    );
    expect(result.outcome.kind).toBe("set");
    if (result.outcome.kind !== "set") return;
    expect(result.outcome.before).toBe(0);
    expect(result.outcome.after).toBe(5000);
    expect(result.outcome.level).toBeGreaterThanOrEqual(1);
    expect(result.state.mining.totalXp).toBe(5000);
    const rows = await db
      .select()
      .from(rune.characterSkillXp)
      .where(
        and(
          eq(rune.characterSkillXp.characterId, character.id),
          eq(rune.characterSkillXp.skillId, SKILL_IDS.mining),
        ),
      );
    expect(rows[0]?.totalXp).toBe(5000);
    const audit = await auditFor(character.id);
    expect(audit.some((a) => a.operation === "set_skill_xp")).toBe(true);
  });

  it("SET TOTAL XP to the same value is a no-op with no audit", async () => {
    const { character } = await makeCharacter();
    await adminCommands.setSkillTotalXpAsAdmin(ADMIN, character.id, SKILL_IDS.mining, 5000);
    const result = await adminCommands.setSkillTotalXpAsAdmin(
      ADMIN,
      character.id,
      SKILL_IDS.mining,
      5000,
    );
    expect(result.outcome.kind).toBe("no_change");
    const audits = await auditFor(character.id);
    expect(audits.filter((a) => a.operation === "set_skill_xp")).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // forceIdleResolvedAction fails closed on an unsupported action (finding #9)
  // -------------------------------------------------------------------------

  it("never deletes an active action for an unknown/unsupported action id", async () => {
    const { character } = await makeCharacter();
    await db.insert(rune.activeActions).values({
      characterId: character.id,
      actionId: "future_unknown_activity",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      resolvedThroughAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    await db.transaction(async (tx) => {
      const characterRow = await tx
        .select()
        .from(rune.characters)
        .where(eq(rune.characters.id, character.id))
        .limit(1);
      const actionRow = await tx
        .select()
        .from(rune.activeActions)
        .where(eq(rune.activeActions.characterId, character.id))
        .limit(1);
      await expect(
        playInterrupt.forceIdleResolvedAction(tx, {
          character: characterRow[0]!,
          action: actionRow[0]!,
          now: new Date("2026-01-01T00:00:00.000Z"),
        }),
      ).rejects.toThrow(/cannot interrupt unsupported activity action/i);
    });

    // The unknown active row must still be present (fail-closed, not deleted).
    const actions = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(actions).toHaveLength(1);
    expect(actions[0]?.actionId).toBe("future_unknown_activity");
  });

  // -------------------------------------------------------------------------
  // Lock / reconcile / interruption matrix (finding #3)
  // -------------------------------------------------------------------------
  // Each admin command runs through `withResolvedCharacter` →
  // `reconcileActiveAction`, which under the row lock resolves due work EXACTLY
  // once (a single `resolver.persist`) before the command force-idles the
  // action. These tests prove single-award + single-audit when the admin
  // command is invoked directly (no prior player refresh), partial-but-unfinished
  // work is not awarded, retried commands neither re-bank nor double-audit, and
  // committed Scavenge reveals survive the interrupt.

  it("STOP reconciles due Mining EXACTLY once when invoked directly and audits once", async () => {
    const { userId, character } = await makeCharacter();
    await moveToTheJag(character.id);
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    // Deliberately NO prior player refresh: the admin STOP itself is the first
    // reconcile boundary the due Mining work hits.
    await miningCommands.startFerriteShaleMining(userId, character.id, startedAt, detRandom);
    const stopAt = tick(startedAt, 10); // exactly one 10-tick attempt
    const result = await adminCommands.stopCurrentActionAsAdmin(
      ADMIN,
      character.id,
      stopAt,
      detRandom,
    );
    expect(result.outcome.kind).toBe("interrupted");
    if (result.outcome.kind !== "interrupted") return;
    expect(result.outcome.actionId).toBe(ACTION_IDS.ferriteShaleMining);
    // Exactly one attempted unit was resolved (not zero, not two).
    expect(result.state.run.attempts).toBe(1);
    expect(result.state.run.successes).toBe(1);
    expect(result.state.run.recentAttempts).toHaveLength(1);
    // Deterministic minimum yield => exactly 1 ferrite shale in exactly one stack.
    expect(result.state.ferriteShaleQuantity).toBe(1);
    const ferriteStacks = result.state.inventory.stacks.filter(
      (s) => s.itemId === ITEM_IDS.ferriteShale,
    );
    expect(ferriteStacks).toHaveLength(1);
    expect(ferriteStacks[0]!.quantity).toBe(1);
    // Persisted exactly once (single award row/quantity), action cleared, one audit row.
    const persisted = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, character.id));
    const persistedFerrite = persisted
      .filter((s) => s.itemId === ITEM_IDS.ferriteShale)
      .reduce((sum, s) => sum + s.quantity, 0);
    expect(persistedFerrite).toBe(1);
    const activeRows = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(activeRows).toHaveLength(0);
    const audit = await auditFor(character.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.operation).toBe("stop_current_action");
    expect(audit[0]?.adminUserId).toBe(ADMIN);
    expect(audit[0]?.targetIdentity).toBe(ACTION_IDS.ferriteShaleMining);
  });

  it("STOP reconciles due Refining EXACTLY once when invoked directly and audits once", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    // Provision state (does not resolve the not-yet-started run), then host + seed.
    await play.getPlayGameplayState(userId, character.id, startedAt, detRandom);
    await moveToProcessingYard(character.id);
    await db.insert(rune.inventoryStacks).values({
      characterId: character.id,
      itemId: ITEM_IDS.ferriteShale,
      quantity: 5,
    });
    await refiningCommands.startRefining(userId, character.id, startedAt, detRandom);
    const stopAt = tick(startedAt, 7); // exactly one 7-tick attempt
    const result = await adminCommands.stopCurrentActionAsAdmin(
      ADMIN,
      character.id,
      stopAt,
      detRandom,
    );
    expect(result.outcome.kind).toBe("interrupted");
    if (result.outcome.kind !== "interrupted") return;
    expect(result.outcome.actionId).toBe(ACTION_IDS.refining);
    // Exactly one attempt consumed exactly 2 shale and produced 1 refined ferrite.
    expect(result.state.refiningRun.attempts).toBe(1);
    expect(result.state.refiningRun.successes).toBe(1);
    expect(result.state.refiningRun.ferriteGained).toBe(1);
    expect(result.state.refiningRun.shaleConsumed).toBe(2);
    expect(result.state.refinedFerriteQuantity).toBe(1);
    expect(result.state.ferriteShaleQuantity).toBe(3); // 5 seeded − 2 consumed
    const refinedStacks = result.state.inventory.stacks.filter(
      (s) => s.itemId === ITEM_IDS.refinedFerrite,
    );
    expect(refinedStacks).toHaveLength(1);
    const activeRows = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(activeRows).toHaveLength(0);
    const audit = await auditFor(character.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.operation).toBe("stop_current_action");
    expect(audit[0]?.targetIdentity).toBe(ACTION_IDS.refining);
  });

  it("STOP reconciles due Welding EXACTLY once when invoked directly and audits once", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await play.getPlayGameplayState(userId, character.id, startedAt, detRandom);
    // Cargo Hold access requires being stationary at the Crash Site (default).
    await installRepairMaterials(userId, character.id, startedAt);
    await cargo.startCargoHoldWelding(userId, character.id, startedAt, detRandom);
    const stopAt = tick(startedAt, 5); // exactly one 5-tick pass
    const result = await adminCommands.stopCurrentActionAsAdmin(ADMIN, character.id, stopAt);
    expect(result.outcome.kind).toBe("interrupted");
    if (result.outcome.kind !== "interrupted") return;
    expect(result.outcome.actionId).toBe(ACTION_IDS.cargoHoldWelding);
    // Exactly one increment banked (1 of 12), 50 XP, not complete.
    expect(result.state.cargoHold.repair.weldingProgress).toBe(1);
    expect(result.state.cargoHold.repair.weldingIncrements).toBe(12);
    expect(result.state.cargoHold.repair.complete).toBe(false);
    expect(result.state.welding.totalXp).toBe(50);
    const persistedRepair = (
      await db
        .select()
        .from(rune.characterCargoHoldRepair)
        .where(eq(rune.characterCargoHoldRepair.characterId, character.id))
    )[0]!;
    expect(persistedRepair.weldingProgress).toBe(1);
    const weldingXp = (
      await db
        .select()
        .from(rune.characterSkillXp)
        .where(
          and(
            eq(rune.characterSkillXp.characterId, character.id),
            eq(rune.characterSkillXp.skillId, SKILL_IDS.welding),
          ),
        )
    )[0];
    expect(weldingXp?.totalXp).toBe(50);
    const audit = await auditFor(character.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.operation).toBe("stop_current_action");
    expect(audit[0]?.targetIdentity).toBe(ACTION_IDS.cargoHoldWelding);
  });

  it("STOP at a partial Mining window awards nothing (partial-but-unfinished not banked)", async () => {
    const { userId, character } = await makeCharacter();
    await moveToTheJag(character.id);
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await miningCommands.startFerriteShaleMining(userId, character.id, startedAt, detRandom);
    const partialAt = tick(startedAt, 5); // 5 ticks < 10-tick attempt
    const result = await adminCommands.stopCurrentActionAsAdmin(ADMIN, character.id, partialAt);
    expect(result.outcome.kind).toBe("interrupted");
    if (result.outcome.kind !== "interrupted") return;
    expect(result.state.ferriteShaleQuantity).toBe(0);
    expect(result.state.run.attempts).toBe(0);
    expect(result.state.run.recentAttempts).toHaveLength(0);
    expect(result.state.activeAction).toBeUndefined();
    const miningState = (
      await db
        .select()
        .from(rune.characterMiningState)
        .where(eq(rune.characterMiningState.characterId, character.id))
    )[0]!;
    expect(miningState.lastStopReason).toBe("manually_stopped");
    expect(miningState.runAttempts).toBe(0);
    const audit = await auditFor(character.id);
    expect(audit).toHaveLength(1);
  });

  it("STOP at a partial Welding window awards nothing (progress stays 0, no XP)", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await play.getPlayGameplayState(userId, character.id, startedAt, detRandom);
    // Cargo Hold access requires being stationary at the Crash Site (default).
    await installRepairMaterials(userId, character.id, startedAt);
    await cargo.startCargoHoldWelding(userId, character.id, startedAt, detRandom);
    const partialAt = tick(startedAt, 4); // 4 ticks < 5-tick pass
    const result = await adminCommands.stopCurrentActionAsAdmin(ADMIN, character.id, partialAt);
    expect(result.outcome.kind).toBe("interrupted");
    if (result.outcome.kind !== "interrupted") return;
    expect(result.state.cargoHold.repair.weldingProgress).toBe(0);
    expect(result.state.cargoHold.repair.complete).toBe(false);
    expect(result.state.welding.totalXp).toBe(0);
    const weldingXp = (
      await db
        .select()
        .from(rune.characterSkillXp)
        .where(
          and(
            eq(rune.characterSkillXp.characterId, character.id),
            eq(rune.characterSkillXp.skillId, SKILL_IDS.welding),
          ),
        )
    )[0];
    expect(weldingXp?.totalXp ?? 0).toBe(0);
    const audit = await auditFor(character.id);
    expect(audit).toHaveLength(1);
  });

  it("a retried STOP on the same already-reconciled action neither re-banks nor double-audits", async () => {
    const { userId, character } = await makeCharacter();
    await moveToTheJag(character.id);
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await miningCommands.startFerriteShaleMining(userId, character.id, startedAt, detRandom);
    const stopAt = tick(startedAt, 10); // due exactly one unit
    const first = await adminCommands.stopCurrentActionAsAdmin(
      ADMIN,
      character.id,
      stopAt,
      detRandom,
    );
    expect(first.outcome.kind).toBe("interrupted");
    if (first.outcome.kind !== "interrupted") return;
    const banked = first.state.ferriteShaleQuantity;
    const attempts = first.state.run.attempts;

    const second = await adminCommands.stopCurrentActionAsAdmin(
      ADMIN,
      character.id,
      stopAt,
      detRandom,
    );
    expect(second.outcome.kind).toBe("already_idle");
    expect(second.state.ferriteShaleQuantity).toBe(banked);
    expect(second.state.run.attempts).toBe(attempts);
    const audit = await auditFor(character.id);
    expect(audit.filter((a) => a.operation === "stop_current_action")).toHaveLength(1);
  });

  it("a retried teleport to the interrupted destination neither re-awards nor double-audits", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await play.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.abandonedProcessingYard,
      startedAt,
      detRandom,
    );
    const now = tick(startedAt, 5); // in-flight
    const first = await adminCommands.teleportCharacterAsAdmin(
      ADMIN,
      character.id,
      LOCATION_IDS.theJag,
      now,
      detRandom,
    );
    expect(first.outcome.kind).toBe("teleported");
    if (first.outcome.kind !== "teleported") return;
    const second = await adminCommands.teleportCharacterAsAdmin(
      ADMIN,
      character.id,
      LOCATION_IDS.theJag,
      now,
      detRandom,
    );
    expect(second.outcome.kind).toBe("no_change");
    const audit = await auditFor(character.id);
    expect(audit.filter((a) => a.operation === "teleport_character")).toHaveLength(1);
  });

  it("admin STOP of an in-flight Travel preserves committed Scavenge reveals", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await play.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.abandonedProcessingYard,
      startedAt,
      detRandom,
    );
    // Claim the Scavenge opportunity while the window is open during the walk.
    const claimed = await play.claimScavenge(userId, character.id, tick(startedAt, 4), detRandom);
    expect(claimed.scavenge.status).toBe("claimed");
    const revealId = claimed.state.scavengeReveals[0]?.revealId;
    expect(revealId).toBeTruthy();
    if (!revealId) return;

    // Admin STOP of the still-in-flight journey (tick 5 < 40-tick arrival).
    const result = await adminCommands.stopCurrentActionAsAdmin(
      ADMIN,
      character.id,
      tick(startedAt, 5),
    );
    expect(result.outcome.kind).toBe("interrupted");
    if (result.outcome.kind !== "interrupted") return;
    // The committed reveal is preserved, not wiped.
    const reveals = await db
      .select()
      .from(rune.characterScavengeReveals)
      .where(eq(rune.characterScavengeReveals.characterId, character.id));
    expect(reveals).toHaveLength(1);
    expect(reveals[0]?.id).toBe(revealId);
    expect(result.state.scavengeReveals).toHaveLength(1);
    // Travel cleaned up regardless.
    const travelRows = await db
      .select()
      .from(rune.characterTravelState)
      .where(eq(rune.characterTravelState.characterId, character.id));
    expect(travelRows).toHaveLength(0);
  });

  it("concurrent STOP vs STOP on one character reconciles once and audits once (row lock serializes)", async () => {
    const { userId, character } = await makeCharacter();
    await moveToTheJag(character.id);
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await miningCommands.startFerriteShaleMining(userId, character.id, startedAt, detRandom);
    const stopAt = tick(startedAt, 10); // due exactly one unit, both commands contend for it

    // Two concurrent admin STOPs against the SAME character must serialize on
    // the shared character row lock: one banks the due Mining unit and
    // force-idles, the other sees an already-idle action. Work/reward and
    // `stop_current_action` audit must not be duplicated.
    const [first, second] = await Promise.all([
      adminCommands.stopCurrentActionAsAdmin(ADMIN, character.id, stopAt, detRandom),
      adminCommands.stopCurrentActionAsAdmin(ADMIN, character.id, stopAt, detRandom),
    ]);

    const outcomes = [first.outcome.kind, second.outcome.kind];
    expect(outcomes).toContain("interrupted");
    // The later command observed the action already cleared, so it is never a
    // second interrupted mutation on the same in-progress action.
    expect(outcomes.filter((kind) => kind === "interrupted")).toHaveLength(1);

    const activeRows = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(activeRows).toHaveLength(0);

    // Exactly one stack item banked, regardless of which command won the lock.
    const persisted = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, character.id));
    const ferrite = persisted
      .filter((s) => s.itemId === ITEM_IDS.ferriteShale)
      .reduce((sum, s) => sum + s.quantity, 0);
    expect(ferrite).toBe(1);

    // Exactly one audit row: not two for the same single successful stop.
    const audit = await auditFor(character.id);
    expect(audit.filter((a) => a.operation === "stop_current_action")).toHaveLength(1);
  });

  it("concurrent STOP vs teleport on one character neither double-awards nor double-audits", async () => {
    const { userId, character } = await makeCharacter();
    await moveToTheJag(character.id);
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await miningCommands.startFerriteShaleMining(userId, character.id, startedAt, detRandom);
    const now = tick(startedAt, 10); // due exactly one unit; both commands contend

    // One command interrupts (STOP) while the other relocates (teleport to a
    // different canonical location). Whichever acquires the character row lock
    // first reconciles the due Mining unit and clears it; the second sees the
    // action already resolved. No double reward, no double audit per operation.
    const [stop, teleport] = await Promise.all([
      adminCommands.stopCurrentActionAsAdmin(ADMIN, character.id, now, detRandom),
      adminCommands.teleportCharacterAsAdmin(
        ADMIN,
        character.id,
        LOCATION_IDS.abandonedProcessingYard,
        now,
        detRandom,
      ),
    ]);

    const stopOutcomes = [stop.outcome.kind];
    const teleportOutcomes = [teleport.outcome.kind];
    // The teleport destination differs from The Jag, so it always relocates.
    expect(stopOutcomes[0]).toMatch(/interrupted|already_idle/);
    expect(teleportOutcomes[0]).toBe("teleported");
    // Whichever command acquired the row lock first interrupted the Mining;
    // the other saw the action already resolved. Exactly one interruption total.
    const interruptions = [
      stop.outcome.kind === "interrupted" ? 1 : 0,
      teleport.outcome.kind === "teleported" && teleport.outcome.interruptedActionId ? 1 : 0,
    ].reduce((a, b) => a + b, 0);
    expect(interruptions).toBe(1);

    const activeRows = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(activeRows).toHaveLength(0);

    // Exactly one stack item banked (whichever command reconciled it first).
    const persisted = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, character.id));
    const ferrite = persisted
      .filter((s) => s.itemId === ITEM_IDS.ferriteShale)
      .reduce((sum, s) => sum + s.quantity, 0);
    expect(ferrite).toBe(1);

    // Exactly one teleport is audited, and at most one stop is audited. The
    // single interruption is audited either as `stop_current_action` (if STOP
    // won the row lock) or folded into the teleport's details (if teleport won
    // and force-idled the action itself). Either way exactly one interruption
    // total happened and is recorded exactly once across the two commands.
    const audit = await auditFor(character.id);
    expect(audit.filter((a) => a.operation === "teleport_character")).toHaveLength(1);
    const stopAudits = audit.filter((a) => a.operation === "stop_current_action");
    expect(stopAudits.length).toBeLessThanOrEqual(1);
    // One interruption total is captured either as the stop audit OR inside the
    // teleport audit's interruptedActionId detail.
    const teleportAudit = audit.find((a) => a.operation === "teleport_character");
    const teleportInterrupted =
      (teleportAudit?.details as { interruptedActionId?: string } | undefined)
        ?.interruptedActionId != null;
    expect(stopAudits.length + (teleportInterrupted ? 1 : 0)).toBe(1);
  });
});
