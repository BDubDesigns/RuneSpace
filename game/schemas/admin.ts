import { z } from "zod";
import { ItemIdSchema, SkillIdSchema } from "./gameplay";
import { LOCATION_ID_VALUES } from "./locations";

/**
 * Admin operator request boundary schemas (Issue #113).
 *
 * The browser supplies only narrow command intent plus the authoritative entity
 * identity it selected from the server-rendered inspector (character, stack,
 * instance, mission, location, skill). Everything else — item facts, stack
 * limits, mass/capacity, mission descendants, reward rules, progression curves,
 * effective totals — is resolved server-side. A destination location is typed
 * as a canonical `LocationId` so the server always re-validates it against the
 * authoritative registry before any operator mutation. These schemas carry no
 * secrets and no field that would let a client control gameplay outcomes.
 */

const characterId = z.string().uuid();

/** STOP CURRENT ACTION. */
export const AdminStopActionRequestSchema = z.object({
  characterId,
});

/** TELEPORT / SET LOCATION — destination must be a canonical location id. */
export const AdminTeleportRequestSchema = z.object({
  characterId,
  destinationLocationId: z.enum(LOCATION_ID_VALUES),
});

const stackRemovalFields = {
  characterId,
  stackId: z.string().uuid(),
} as const;

/**
 * Exact carried/Cargo stack removal. `mode`:
 * - `"one"` removes exactly one item;
 * - `"stack"` removes the confirmed `expectedQuantity`.
 * `expectedQuantity` is the optimistic concurrency precondition the operator
 * confirmed from the fresh authoritative inspector.
 */
export const AdminCarriedStackRemovalRequestSchema = z.object({
  ...stackRemovalFields,
  mode: z.enum(["one", "stack"]),
  expectedQuantity: z.number().int().positive(),
});

/** Force unequip one equipped unique item instance. */
export const AdminForceUnequipRequestSchema = z.object({
  characterId,
  itemInstanceId: z.string().uuid(),
});

/** Delete one carried/Cargo unique item instance (exact identity). */
export const AdminDeleteUniqueItemRequestSchema = z.object({
  characterId,
  itemInstanceId: z.string().uuid(),
});

/** ADD ITEM — canonical item id plus stackable quantity. */
export const AdminAddItemRequestSchema = z.object({
  characterId,
  itemId: ItemIdSchema,
  /** For stackables only: positive integer <= the canonical stack limit. */
  quantity: z.number().int().positive().optional(),
});

/** RESET ONE MISSION + authored descendants. */
export const AdminResetMissionChainRequestSchema = z.object({
  characterId,
  missionId: z.string().min(1).max(128),
});

/** RESET ALL authored missions for the selected character. */
export const AdminResetAllMissionsRequestSchema = z.object({
  characterId,
});

/** SET TOTAL XP — canonical skill, absolute non-negative whole integer. */
export const AdminSetSkillXpRequestSchema = z.object({
  characterId,
  skillId: SkillIdSchema,
  totalXp: z.number().int().nonnegative(),
});
