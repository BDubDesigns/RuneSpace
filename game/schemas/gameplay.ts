import { z } from "zod";
import {
  EQUIPMENT_ASSIGNMENT_KINDS,
  ITEM_IDS,
  SKILL_IDS,
  type ItemId,
  type SkillId,
} from "@/game/config/foundations";
import { ContentId } from "./ids";
import { LocationIdSchema } from "./locations";

const skillIdValues = Object.values(SKILL_IDS) as [SkillId, ...SkillId[]];
const itemIdValues = Object.values(ITEM_IDS) as [ItemId, ...ItemId[]];

export const SkillIdSchema = z.enum(skillIdValues);
export const ItemIdSchema = z.enum(itemIdValues);

/**
 * Suit slot identities are stable content IDs supplied by future equipment
 * content. This foundation deliberately does not invent a slot layout.
 */
export const SuitSlotIdSchema = ContentId;
export const EquipmentAssignmentKindSchema = z.enum(EQUIPMENT_ASSIGNMENT_KINDS);
export const EquipmentTargetSchema = z.object({
  assignmentKind: EquipmentAssignmentKindSchema,
  suitSlotId: SuitSlotIdSchema,
});
export const EquipEquipmentRequestSchema = z.object({
  characterId: z.string().uuid(),
  itemInstanceId: z.string().uuid(),
  target: EquipmentTargetSchema,
});
export const UnequipEquipmentRequestSchema = z.object({
  characterId: z.string().uuid(),
  target: EquipmentTargetSchema,
});

/** A begin-travel command: the client supplies only the destination location. */
export const BeginTravelRequestSchema = z.object({
  characterId: z.string().uuid(),
  destinationLocationId: LocationIdSchema,
});

/** Scavenge supplies only the owned character identity; timing and reward are server-owned. */
export const ScavengeClaimRequestSchema = z.object({
  characterId: z.string().uuid(),
});

/** Acknowledgment is presentation-only and identifies one owned reveal row. */
export const ScavengeRevealAcknowledgmentRequestSchema = z.object({
  characterId: z.string().uuid(),
  revealId: z.string().uuid(),
});

/** The Power Annex command supplies only the owned character identity. */
export const ClaimPowerCellsRequestSchema = z.object({
  characterId: z.string().uuid(),
});

/** Loading supplies only the owned character identity; all item state is server-resolved. */
export const LoadPowerCellRequestSchema = z.object({
  characterId: z.string().uuid(),
});

/**
 * A portrait-change command supplies only the owned character identity and the
 * desired stable portrait ID (issue #65). The schema is deliberately
 * structural: selectability (the `player-starter` subset) is authoritative
 * catalog metadata enforced by the server command boundary, so this validation
 * contract never lists `npc-only` or `reserved` IDs as accepted values.
 */
export const ChangeCharacterPortraitRequestSchema = z.object({
  characterId: z.string().uuid(),
  portraitId: ContentId,
});

/**
 * Discarding identifies only the operation: the authoritative stack row, the
 * narrow mode, and the expected selected-stack quantity as an optimistic
 * concurrency precondition. Item identity, mass, names, stack limits, and
 * resulting quantities are always server-resolved.
 */
export const DiscardInventoryStackRequestSchema = z.object({
  characterId: z.string().uuid(),
  stackId: z.string().uuid(),
  mode: z.enum(["one", "stack"]),
  expectedQuantity: z.number().int().positive(),
});

/** The confirmed, exact useful quantities for one irreversible Cargo repair commit. */
export const CargoHoldMaterialContributionRequestSchema = z.object({
  characterId: z.string().uuid(),
  expectedRefinedFerrite: z.number().int().nonnegative(),
  expectedSlag: z.number().int().nonnegative(),
});

const CargoHoldStackTransferFields = {
  characterId: z.string().uuid(),
  stackId: z.string().uuid(),
  mode: z.enum(["one", "stack"]),
  expectedQuantity: z.number().int().positive(),
} as const;

export const DepositCargoStackRequestSchema = z.object(CargoHoldStackTransferFields);
export const WithdrawCargoStackRequestSchema = z.object(CargoHoldStackTransferFields);

export const DepositCargoUniqueItemRequestSchema = z.object({
  characterId: z.string().uuid(),
  itemInstanceId: z.string().uuid(),
});
export const WithdrawCargoUniqueItemRequestSchema = z.object({
  characterId: z.string().uuid(),
  itemInstanceId: z.string().uuid(),
});

/** Mission commands identify only the owned character; authored mission IDs stay server-owned. */
export const AcceptWalkItOffRequestSchema = z.object({
  characterId: z.string().uuid(),
});
export const CompleteWalkItOffRequestSchema = z.object({
  characterId: z.string().uuid(),
});
/** Issue #110: same trusted shape as the Walk It Off mission commands. */
export const AcceptCutYourTeethRequestSchema = z.object({
  characterId: z.string().uuid(),
});
export const CompleteCutYourTeethRequestSchema = z.object({
  characterId: z.string().uuid(),
});

/** Containers can only hold non-container item definitions. */
export const ContainerContentItemSchema = z.object({
  itemId: ItemIdSchema,
  isContainer: z.literal(false),
});

export const ContainerContentsSchema = z.array(ContainerContentItemSchema);
