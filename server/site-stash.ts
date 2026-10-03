import { and, asc, eq } from "drizzle-orm";
import {
  cargoHoldItemInstances,
  characters,
  equippedItems,
  inventoryStacks,
  itemInstances,
  siteStashContainers,
  siteStashItemInstances,
  siteStashStacks,
} from "@/db/rune-space";
import { getItemDefinition } from "@/game/config/balance";
import { ACTION_IDS } from "@/game/config/foundations";
import { getSiteStash, type SiteStashDefinition } from "@/game/content/site-stashes";
import {
  planExactStackAddition,
  planUniqueItemAddition,
  type StackState,
} from "@/game/domain/inventory";
import type { MiningRandom } from "@/game/domain/mining";
import {
  planSiteStashRemoval,
  planSiteStashSwap,
  siteStashSlotCapacity,
  type CarriedRoom,
} from "@/game/domain/site-stash";
import { type DatabaseTransaction, withResolvedOwnedCharacter } from "@/server/action-resolution";
import {
  addStackableItem,
  loadCarriedCapacity,
  removeFromSelectedStack,
  siteStashPlacementOf,
} from "@/server/carried-inventory";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";
import { defaultMiningRandom } from "@/server/mining";
import { loadRepairAccess } from "@/server/repair-access";
import { loadRepairTargetRow, repairStateFromRow } from "@/server/welding";

/**
 * Character-owned site stashes (#284): authoritative commands.
 *
 * A stash is a permanent mount (the site's repair target, built through the
 * ordinary Welding flow) plus one installed ordinary container. Every command
 * runs through the shared owned-character boundary, so it holds the trade
 * gate, the character row lock and the lazy action reconcile, and every one
 * re-proves location, ownership, mount and container on the locked rows. The
 * request carries only ids; nothing the browser says about capacity, type or
 * location is trusted.
 *
 * Stored mass is unlimited. Slot capacity is the installed container's
 * authored equipped capacity.
 */

export type SiteStashStackTransferRequest = {
  locationId: string;
  stackId: string;
  mode: "one" | "stack";
  expectedQuantity: number;
};

export type SiteStashUniqueTransferRequest = {
  locationId: string;
  itemInstanceId: string;
};

export type SiteStashInstallRequest = SiteStashUniqueTransferRequest;

export type SiteStashRemoveRequest = {
  locationId: string;
  /** The container the player believed was installed; a stale view refuses. */
  expectedContainerInstanceId: string;
};

export type SiteStashSwapRequest = {
  locationId: string;
  expectedContainerInstanceId: string;
  /** The carried replacement container. */
  itemInstanceId: string;
};

export type SiteStashRefusalReason =
  | "unknown_site"
  | "in_transit"
  | "not_at_site"
  | "mount_not_built"
  | "no_container"
  | "container_present"
  | "container_changed"
  | "not_a_container"
  | "same_container_type"
  | "not_empty"
  | "stack_changed"
  | "stack_not_found"
  | "unsupported_stack"
  | "stash_capacity"
  | "carried_capacity"
  | "item_not_found"
  | "item_unavailable"
  | "equipped_item"
  | "item_not_stored";

export type SiteStashRefusal = {
  status: "refused";
  reason: SiteStashRefusalReason;
  message: string;
};

export type SiteStashCommandStatus =
  | {
      status: "committed";
      quantity?: number;
      itemInstanceId?: string;
    }
  | SiteStashRefusal;

export type SiteStashStateResult = {
  state: PlayGameplayState;
  stash: SiteStashCommandStatus;
};

const EMPTY_RECENT_RESULT = { successes: 0, failures: 0, awardedXp: 0 } as const;

// Every command settles any running action BEFORE it can refuse for one, and
// that refusal still commits the settlement. The random source must therefore
// be a real one: a fixed always-succeed source would turn every refused stash
// command into a guaranteed-success Mining or Refining settlement.

type StashContext = {
  transaction: DatabaseTransaction;
  characterId: string;
  site: SiteStashDefinition;
  now: Date;
  /** The installed container row, locked; absent until one is installed. */
  container: typeof siteStashContainers.$inferSelect | undefined;
  refuse: (reason: SiteStashRefusalReason, message: string) => Promise<SiteStashStateResult>;
  commit: (
    detail?: Omit<Extract<SiteStashCommandStatus, { status: "committed" }>, "status">,
  ) => Promise<SiteStashStateResult>;
};

async function stateAfterStashCommand(
  transaction: DatabaseTransaction,
  characterId: string,
  now: Date,
): Promise<PlayGameplayState> {
  return stateFromTransaction(
    transaction,
    characterId,
    EMPTY_RECENT_RESULT,
    undefined,
    undefined,
    undefined,
    undefined,
    now,
  );
}

/**
 * The shared stash harness. It authorizes first and only then hands the command
 * a locked context:
 *
 * 1. the site is an authored stash site;
 * 2. no action is running (the same rule Cargo Hold uses: you stop mining or
 *    refining to rummage in a stash);
 * 3. the character is genuinely at that location, read from the locked
 *    character row rather than the request;
 * 4. the mount's repair target is complete: construction is the only thing
 *    that ever builds a mount.
 *
 * Every refusal commits an empty transaction and returns the fresh state, so a
 * stale client reconciles against authority.
 */
async function runStashCommand(
  userId: string,
  characterId: string,
  locationId: string,
  now: Date,
  random: MiningRandom,
  command: (context: StashContext) => Promise<SiteStashStateResult>,
): Promise<SiteStashStateResult> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const refuse = async (reason: SiteStashRefusalReason, message: string) => ({
        state: await stateAfterStashCommand(transaction, context.character.id, now),
        stash: { status: "refused" as const, reason, message },
      });
      const site = getSiteStash(locationId);
      if (!site) return refuse("unknown_site", "There is no stash to use here.");
      if (context.action?.actionId === ACTION_IDS.travel)
        return refuse("in_transit", "A stash is unavailable while traveling.");
      if (context.action)
        return refuse("in_transit", "Finish the active activity before using a stash.");
      const [here] = await transaction
        .select({ currentLocationId: characters.currentLocationId })
        .from(characters)
        .where(eq(characters.id, context.character.id))
        .limit(1);
      if (here?.currentLocationId !== site.locationId)
        return refuse("not_at_site", "That stash can only be used while you are there.");
      const mountRow = await loadRepairTargetRow(
        transaction,
        context.character.id,
        site.mountTargetId,
      );
      const access = await loadRepairAccess(
        transaction,
        context.character.id,
        site.mountTargetId,
        repairStateFromRow(mountRow),
      );
      if (!access.complete)
        return refuse("mount_not_built", "Build a Stash Mount here before using a stash.");
      const [container] = await transaction
        .select()
        .from(siteStashContainers)
        .where(
          and(
            eq(siteStashContainers.characterId, context.character.id),
            eq(siteStashContainers.locationId, site.locationId),
          ),
        )
        .for("update");
      return command({
        transaction,
        characterId: context.character.id,
        site,
        now,
        container,
        refuse,
        commit: async (detail = {}) => ({
          state: await stateAfterStashCommand(transaction, context.character.id, now),
          stash: { status: "committed" as const, ...detail },
        }),
      });
    },
    now,
  );
}

/** Stored rows at one site, locked in a stable order. */
async function loadStashContents(
  transaction: DatabaseTransaction,
  characterId: string,
  locationId: string,
) {
  const [stacks, items] = await Promise.all([
    transaction
      .select()
      .from(siteStashStacks)
      .where(
        and(
          eq(siteStashStacks.characterId, characterId),
          eq(siteStashStacks.locationId, locationId),
        ),
      )
      .orderBy(asc(siteStashStacks.createdAt), asc(siteStashStacks.id))
      .for("update"),
    transaction
      .select()
      .from(siteStashItemInstances)
      .where(
        and(
          eq(siteStashItemInstances.characterId, characterId),
          eq(siteStashItemInstances.locationId, locationId),
        ),
      )
      .for("update"),
  ]);
  return { stacks, items, occupiedSlots: stacks.length + items.length };
}

function carriedRoomOf(carry: Awaited<ReturnType<typeof loadCarriedCapacity>>): CarriedRoom {
  return {
    inventorySlotsUsed: carry.loadout.inventorySlotsUsed,
    slotCapacity: carry.loadout.containerSlotCapacity,
    carriedMassGrams: carry.loadout.carriedMassGrams,
    maximumCarryCapacityGrams: carry.loadout.maximumCarryCapacityGrams,
  };
}

/**
 * A unique instance the character could physically hand over right now: owned,
 * not equipped, not in Cargo, not held by any stash. Locks the rows it reads.
 * `undefined` carries the refusal to report.
 */
async function loadCarriedInstance(
  transaction: DatabaseTransaction,
  characterId: string,
  itemInstanceId: string,
): Promise<
  | { ok: true; instance: typeof itemInstances.$inferSelect }
  | { ok: false; reason: "item_not_found" | "equipped_item" | "item_unavailable"; message: string }
> {
  const [[instance], assignments, [cargo]] = await Promise.all([
    transaction
      .select()
      .from(itemInstances)
      .where(and(eq(itemInstances.characterId, characterId), eq(itemInstances.id, itemInstanceId)))
      .for("update"),
    transaction
      .select()
      .from(equippedItems)
      .where(eq(equippedItems.characterId, characterId))
      .for("update"),
    transaction
      .select()
      .from(cargoHoldItemInstances)
      .where(
        and(
          eq(cargoHoldItemInstances.characterId, characterId),
          eq(cargoHoldItemInstances.itemInstanceId, itemInstanceId),
        ),
      )
      .for("update"),
  ]);
  if (!instance)
    return { ok: false, reason: "item_not_found", message: "That item is no longer available." };
  if (assignments.some((assignment) => assignment.itemInstanceId === instance.id))
    return {
      ok: false,
      reason: "equipped_item",
      message: "Unequip that container before putting it in a stash.",
    };
  if (cargo || (await siteStashPlacementOf(transaction, characterId, instance.id)))
    return {
      ok: false,
      reason: "item_unavailable",
      message: "That item is stored elsewhere, not carried.",
    };
  return { ok: true, instance };
}

export async function installSiteStashContainer(
  userId: string,
  characterId: string,
  request: SiteStashInstallRequest,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<SiteStashStateResult> {
  return runStashCommand(
    userId,
    characterId,
    request.locationId,
    now,
    random,
    async ({ transaction, characterId: id, site, container, refuse, commit }) => {
      if (container) return refuse("container_present", "This stash already has a container.");
      const candidate = await loadCarriedInstance(transaction, id, request.itemInstanceId);
      if (!candidate.ok) return refuse(candidate.reason, candidate.message);
      // Capacity comes from the authored container definition, never the client.
      if (siteStashSlotCapacity(candidate.instance.itemId) === undefined)
        return refuse("not_a_container", "Only a container can be installed in a stash.");
      await transaction.insert(siteStashContainers).values({
        characterId: id,
        locationId: site.locationId,
        itemInstanceId: candidate.instance.id,
        installedAt: now,
      });
      return commit({ itemInstanceId: candidate.instance.id });
    },
  );
}

export async function removeSiteStashContainer(
  userId: string,
  characterId: string,
  request: SiteStashRemoveRequest,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<SiteStashStateResult> {
  return runStashCommand(
    userId,
    characterId,
    request.locationId,
    now,
    random,
    async ({ transaction, characterId: id, site, container, refuse, commit }) => {
      if (!container) return refuse("no_container", "This stash has no container to remove.");
      if (container.itemInstanceId !== request.expectedContainerInstanceId)
        return refuse("container_changed", "The stash changed. Review it and try again.");
      const [contents, [instance], carry] = await Promise.all([
        loadStashContents(transaction, id, site.locationId),
        transaction
          .select()
          .from(itemInstances)
          .where(
            and(eq(itemInstances.characterId, id), eq(itemInstances.id, container.itemInstanceId)),
          )
          .for("update"),
        loadCarriedCapacity(transaction, id),
      ]);
      if (!instance) return refuse("item_not_found", "That container is no longer available.");
      const plan = planSiteStashRemoval({
        occupiedSlots: contents.occupiedSlots,
        installedItemId: instance.itemId,
        carried: carriedRoomOf(carry),
      });
      if (!plan.ok)
        return plan.reason === "not_empty"
          ? refuse("not_empty", "Empty the stash before removing its container.")
          : refuse("carried_capacity", "The container would not fit in carried Inventory.");
      await transaction
        .delete(siteStashContainers)
        .where(
          and(
            eq(siteStashContainers.characterId, id),
            eq(siteStashContainers.locationId, site.locationId),
          ),
        );
      return commit({ itemInstanceId: instance.id });
    },
  );
}

export async function swapSiteStashContainer(
  userId: string,
  characterId: string,
  request: SiteStashSwapRequest,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<SiteStashStateResult> {
  return runStashCommand(
    userId,
    characterId,
    request.locationId,
    now,
    random,
    async ({ transaction, characterId: id, site, container, refuse, commit }) => {
      if (!container) return refuse("no_container", "This stash has no container to swap.");
      if (container.itemInstanceId !== request.expectedContainerInstanceId)
        return refuse("container_changed", "The stash changed. Review it and try again.");
      if (request.itemInstanceId === container.itemInstanceId)
        return refuse("same_container_type", "That container is already installed.");
      const [contents, [installed], replacement, carry] = await Promise.all([
        loadStashContents(transaction, id, site.locationId),
        transaction
          .select()
          .from(itemInstances)
          .where(
            and(eq(itemInstances.characterId, id), eq(itemInstances.id, container.itemInstanceId)),
          )
          .for("update"),
        loadCarriedInstance(transaction, id, request.itemInstanceId),
        loadCarriedCapacity(transaction, id),
      ]);
      if (!installed) return refuse("item_not_found", "The installed container is missing.");
      if (!replacement.ok) return refuse(replacement.reason, replacement.message);
      const plan = planSiteStashSwap({
        installedItemId: installed.itemId,
        replacementItemId: replacement.instance.itemId,
        occupiedSlots: contents.occupiedSlots,
        carried: carriedRoomOf(carry),
      });
      if (!plan.ok) {
        switch (plan.reason) {
          case "not_a_container":
            return refuse("not_a_container", "Only a container can be swapped into a stash.");
          case "same_container_type":
            return refuse(
              "same_container_type",
              "A different kind of container is required; the same kind is no improvement.",
            );
          case "stash_capacity":
            return refuse("stash_capacity", "That container cannot hold everything stored here.");
          case "carried_capacity":
            return refuse(
              "carried_capacity",
              "The old container would not fit in carried Inventory.",
            );
        }
      }
      // One row update: the stored contents stay attached to the same mount and
      // nothing is moved. The replacement leaves carried availability and the
      // old container returns to it by the same relation change.
      await transaction
        .update(siteStashContainers)
        .set({ itemInstanceId: replacement.instance.id, installedAt: now })
        .where(
          and(
            eq(siteStashContainers.characterId, id),
            eq(siteStashContainers.locationId, site.locationId),
            eq(siteStashContainers.itemInstanceId, container.itemInstanceId),
          ),
        );
      return commit({ itemInstanceId: replacement.instance.id });
    },
  );
}

export async function depositSiteStashStack(
  userId: string,
  characterId: string,
  request: SiteStashStackTransferRequest,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<SiteStashStateResult> {
  return runStashCommand(
    userId,
    characterId,
    request.locationId,
    now,
    random,
    async ({ transaction, characterId: id, site, container, refuse, commit }) => {
      if (!container) return refuse("no_container", "Install a container before stashing items.");
      const [[source], contents, [installed]] = await Promise.all([
        transaction
          .select()
          .from(inventoryStacks)
          .where(and(eq(inventoryStacks.characterId, id), eq(inventoryStacks.id, request.stackId)))
          .for("update"),
        loadStashContents(transaction, id, site.locationId),
        transaction
          .select()
          .from(itemInstances)
          .where(
            and(eq(itemInstances.characterId, id), eq(itemInstances.id, container.itemInstanceId)),
          ),
      ]);
      if (!source) return refuse("stack_not_found", "That carried stack is no longer available.");
      if (source.quantity !== request.expectedQuantity)
        return refuse("stack_changed", "Inventory changed. Review the stack and try again.");
      const definition = getItemDefinition(source.itemId);
      if (!definition || definition.kind !== "stack")
        return refuse("unsupported_stack", "That item cannot be stored as a stack.");
      const capacity = installed ? (siteStashSlotCapacity(installed.itemId) ?? 0) : 0;
      const quantity = request.mode === "one" ? 1 : source.quantity;
      const addition = planExactStackAddition(
        contents.stacks as StackState<string>[],
        definition.itemId,
        quantity,
        definition.stackLimit,
        Math.max(0, capacity - contents.occupiedSlots),
        Number.POSITIVE_INFINITY,
        0,
      );
      if (!addition.ok)
        return refuse("stash_capacity", "The stash has no room for that complete transfer.");
      const removal = await removeFromSelectedStack(transaction, {
        characterId: id,
        stackId: request.stackId,
        expectedQuantity: request.expectedQuantity,
        expectedItemId: definition.itemId,
        quantity,
        now,
      });
      if (!removal.ok)
        return refuse("stack_changed", "Inventory changed. Review the stack and try again.");
      await Promise.all(
        addition.plan.updatedStacks.map((update) =>
          transaction
            .update(siteStashStacks)
            .set({ quantity: update.quantity, updatedAt: now })
            .where(and(eq(siteStashStacks.id, update.id), eq(siteStashStacks.characterId, id))),
        ),
      );
      if (addition.plan.createdStacks.length)
        await transaction.insert(siteStashStacks).values(
          addition.plan.createdStacks.map((stack) => ({
            characterId: id,
            locationId: site.locationId,
            itemId: stack.itemId,
            quantity: stack.quantity,
          })),
        );
      return commit({ quantity });
    },
  );
}

export async function withdrawSiteStashStack(
  userId: string,
  characterId: string,
  request: SiteStashStackTransferRequest,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<SiteStashStateResult> {
  return runStashCommand(
    userId,
    characterId,
    request.locationId,
    now,
    random,
    async ({ transaction, characterId: id, site, container, refuse, commit }) => {
      if (!container) return refuse("no_container", "This stash has no container.");
      const [source] = await transaction
        .select()
        .from(siteStashStacks)
        .where(
          and(
            eq(siteStashStacks.characterId, id),
            eq(siteStashStacks.locationId, site.locationId),
            eq(siteStashStacks.id, request.stackId),
          ),
        )
        .for("update");
      if (!source) return refuse("stack_not_found", "That stash stack is no longer available.");
      if (source.quantity !== request.expectedQuantity)
        return refuse("stack_changed", "The stash changed. Review the stack and try again.");
      const definition = getItemDefinition(source.itemId);
      if (!definition || definition.kind !== "stack")
        return refuse("unsupported_stack", "That stash item cannot be withdrawn as a stack.");
      const quantity = request.mode === "one" ? 1 : source.quantity;
      const carry = await loadCarriedCapacity(transaction, id);
      const addition = planExactStackAddition(
        carry.stacks as StackState<string>[],
        definition.itemId,
        quantity,
        definition.stackLimit,
        carry.availableSlots,
        carry.availableMassGrams,
        definition.massGrams,
      );
      if (!addition.ok)
        return refuse(
          "carried_capacity",
          "The requested transfer does not fit in carried Inventory.",
        );
      if (source.quantity === quantity)
        await transaction
          .delete(siteStashStacks)
          .where(and(eq(siteStashStacks.id, source.id), eq(siteStashStacks.characterId, id)));
      else
        await transaction
          .update(siteStashStacks)
          .set({ quantity: source.quantity - quantity, updatedAt: now })
          .where(and(eq(siteStashStacks.id, source.id), eq(siteStashStacks.characterId, id)));
      await addStackableItem(transaction, { characterId: id, plan: addition.plan, now });
      return commit({ quantity });
    },
  );
}

export async function depositSiteStashUniqueItem(
  userId: string,
  characterId: string,
  request: SiteStashUniqueTransferRequest,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<SiteStashStateResult> {
  return runStashCommand(
    userId,
    characterId,
    request.locationId,
    now,
    random,
    async ({ transaction, characterId: id, site, container, refuse, commit }) => {
      if (!container) return refuse("no_container", "Install a container before stashing items.");
      const [candidate, contents, [installed]] = await Promise.all([
        loadCarriedInstance(transaction, id, request.itemInstanceId),
        loadStashContents(transaction, id, site.locationId),
        transaction
          .select()
          .from(itemInstances)
          .where(
            and(eq(itemInstances.characterId, id), eq(itemInstances.id, container.itemInstanceId)),
          ),
      ]);
      if (!candidate.ok) return refuse(candidate.reason, candidate.message);
      const definition = getItemDefinition(candidate.instance.itemId);
      if (!definition || definition.kind !== "unique")
        return refuse("item_not_found", "That item is not a transferable unique item.");
      const capacity = installed ? (siteStashSlotCapacity(installed.itemId) ?? 0) : 0;
      if (contents.occupiedSlots >= capacity)
        return refuse("stash_capacity", "The stash has no free occupied-item slots.");
      await transaction.insert(siteStashItemInstances).values({
        characterId: id,
        locationId: site.locationId,
        itemInstanceId: candidate.instance.id,
        storedAt: now,
      });
      return commit({ itemInstanceId: candidate.instance.id });
    },
  );
}

export async function withdrawSiteStashUniqueItem(
  userId: string,
  characterId: string,
  request: SiteStashUniqueTransferRequest,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<SiteStashStateResult> {
  return runStashCommand(
    userId,
    characterId,
    request.locationId,
    now,
    random,
    async ({ transaction, characterId: id, site, container, refuse, commit }) => {
      if (!container) return refuse("no_container", "This stash has no container.");
      const [[stored], [instance]] = await Promise.all([
        transaction
          .select()
          .from(siteStashItemInstances)
          .where(
            and(
              eq(siteStashItemInstances.characterId, id),
              eq(siteStashItemInstances.locationId, site.locationId),
              eq(siteStashItemInstances.itemInstanceId, request.itemInstanceId),
            ),
          )
          .for("update"),
        transaction
          .select()
          .from(itemInstances)
          .where(
            and(eq(itemInstances.characterId, id), eq(itemInstances.id, request.itemInstanceId)),
          )
          .for("update"),
      ]);
      if (!stored || !instance)
        return refuse("item_not_stored", "That stash item is no longer available.");
      const definition = getItemDefinition(instance.itemId);
      if (!definition || definition.kind !== "unique")
        return refuse("item_not_stored", "That stash item is not transferable.");
      const carry = await loadCarriedCapacity(transaction, id);
      const fit = planUniqueItemAddition({
        ...carriedRoomOf(carry),
        itemMassGrams: definition.massGrams,
      });
      if (!fit.ok)
        return refuse(
          "carried_capacity",
          fit.reason === "slots"
            ? "Carried Inventory has no free occupied-item slot."
            : "That item would exceed carried mass capacity.",
        );
      await transaction
        .delete(siteStashItemInstances)
        .where(
          and(
            eq(siteStashItemInstances.characterId, id),
            eq(siteStashItemInstances.itemInstanceId, instance.id),
          ),
        );
      return commit({ itemInstanceId: instance.id });
    },
  );
}
