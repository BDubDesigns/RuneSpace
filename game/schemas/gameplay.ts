import { z } from "zod";
import {
  BOUNDED_RUN_MAX,
  BOUNDED_RUN_MINIMUM_QUANTITY,
  BOUNDED_RUN_QUANTITY_CEILING,
  EQUIPMENT_ASSIGNMENT_KINDS,
  ITEM_IDS,
  REPAIR_TARGET_IDS,
  SKILL_IDS,
  type ItemId,
  type RepairTargetId,
  type SkillId,
} from "@/game/config/foundations";
import { ContentId } from "./ids";
import { LocationIdSchema } from "./locations";

const skillIdValues = Object.values(SKILL_IDS) as [SkillId, ...SkillId[]];
const itemIdValues = Object.values(ITEM_IDS) as [ItemId, ...ItemId[]];
const repairTargetIdValues = Object.values(REPAIR_TARGET_IDS) as [
  RepairTargetId,
  ...RepairTargetId[],
];

export const SkillIdSchema = z.enum(skillIdValues);
export const ItemIdSchema = z.enum(itemIdValues);
/** A repair target the client may name; every rule about it stays server-side. */
export const RepairTargetIdSchema = z.enum(repairTargetIdValues);

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

/**
 * Loading from Equipment supplies only the owned character identity. Loading
 * from Inventory additionally carries the selected stack identity and the
 * quantity the player confirmed, so the server can reject stale selections
 * without substituting another Power Cell stack.
 */
export const LoadPowerCellRequestSchema = z
  .object({
    characterId: z.string().uuid(),
    stackId: z.string().uuid().optional(),
    expectedQuantity: z.number().int().positive().optional(),
  })
  .refine(
    ({ stackId, expectedQuantity }) => (stackId === undefined) === (expectedQuantity === undefined),
    "Selected Power Cell identity and expected quantity must be supplied together.",
  );

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

/**
 * The confirmed, exact useful quantities for one irreversible repair commit,
 * plus which repair target is being worked on. The target's recipe, its
 * location, and the Mission that authorizes it are all revalidated server-side.
 */
export const RepairMaterialContributionRequestSchema = z.object({
  characterId: z.string().uuid(),
  targetId: RepairTargetIdSchema,
  /**
   * The exact useful quantity per item ID the client believed it was
   * committing (#209). Generic rather than a Refined-Ferrite/Slag pair, so a
   * recipe wanting Power Cells needs no new request field. The server
   * recomputes the useful plan and refuses on any mismatch.
   */
  expectedMaterials: z.record(ContentId, z.number().int().nonnegative()),
});

/**
 * A bounded run's selection (#229): a whole number of batches or welds inside
 * the structural bounds, or `"max"` to run until the activity is blocked.
 * Whether a number is actually affordable is never this schema's call — the
 * command revalidates it against the inputs carried and refuses one that no
 * longer fits.
 */
export const BoundedRunSelectionSchema = z.union([
  z.number().int().min(BOUNDED_RUN_MINIMUM_QUANTITY).max(BOUNDED_RUN_QUANTITY_CEILING),
  z.literal(BOUNDED_RUN_MAX),
]);

/**
 * Starting Refining names the character, which authored recipe (#209), and the
 * run selection: how many batches to attempt, or Max (#229).
 *
 * The recipe is a stable action ID and nothing more: its inputs, outputs,
 * duration, success curve and minimum Refining level are all resolved
 * server-side from authored content, and the command refuses a recipe the
 * character's level does not authorize. The client cannot describe a recipe,
 * only choose among the authored ones.
 */
export const StartRefiningRequestSchema = z.object({
  characterId: z.string().uuid(),
  recipeActionId: ContentId,
  quantity: BoundedRunSelectionSchema,
});

/** Starting or stopping Welding names only the character and the repair target. */
export const WeldingCommandRequestSchema = z.object({
  characterId: z.string().uuid(),
  targetId: RepairTargetIdSchema,
});

/**
 * Practice Welding commands name only the character: which bench, which weld,
 * and what it costs are all server-authoritative (#190).
 */
export const PracticeCommandRequestSchema = z.object({
  characterId: z.string().uuid(),
});

/** Starting Practice adds only the run selection: complete welds, or Max (#229). */
export const StartPracticeRequestSchema = PracticeCommandRequestSchema.extend({
  quantity: BoundedRunSelectionSchema,
});

/**
 * Work Order commands name only the character and, for acceptance, which job
 * (#207).
 *
 * Deliberately no slot index, no materials, no payout, and no section count:
 * the server resolves which posting holds that job, what it costs, and what it
 * pays from authored content, so a client can never submit a cheaper recipe or
 * a larger payout.
 */
export const WorkOrderAcceptRequestSchema = z.object({
  characterId: z.string().uuid(),
  workOrderId: ContentId,
});

export const WorkOrderCommandRequestSchema = z.object({
  characterId: z.string().uuid(),
});

/**
 * The character-wide Auto-discard Slag preference (#256), shared by Practice
 * Welding and Refining.
 */
export const AutoDiscardSlagPreferenceRequestSchema = z.object({
  characterId: z.string().uuid(),
  autoDiscardSlag: z.boolean(),
});

/**
 * Fabrication (#232). Starting names the character, one authored recipe by its
 * stable action ID, and the run selection; everything the recipe costs,
 * makes, takes, and pays is resolved server-side.
 */
export const StartFabricationRequestSchema = z.object({
  characterId: z.string().uuid(),
  recipeActionId: ContentId,
  quantity: BoundedRunSelectionSchema,
});

/** Finish Current and Lock-less station commands name only the character. */
export const FabricationCommandRequestSchema = z.object({
  characterId: z.string().uuid(),
});

/** The station's Manual Override toggle. */
export const ManualOverrideToggleRequestSchema = z.object({
  characterId: z.string().uuid(),
  enabled: z.boolean(),
});

/**
 * One Manual Override push: the Feed, plus the workpiece and push count the
 * player's screen showed, so a retried push can never roll the machine twice
 * or land on a later workpiece. The dial's range is balance; the server checks it.
 */
export const ManualOverridePushRequestSchema = z.object({
  characterId: z.string().uuid(),
  feed: z.number().int(),
  expectedWorkpiece: z.number().int().positive(),
  expectedPushes: z.number().int().nonnegative(),
});

/** Lock In names the workpiece the player was looking at. */
export const ManualOverrideLockInRequestSchema = z.object({
  characterId: z.string().uuid(),
  expectedWorkpiece: z.number().int().positive(),
});

/** Tinkering (#232): which authored target, and the run selection. */
export const StartTinkeringRequestSchema = z.object({
  characterId: z.string().uuid(),
  targetActionId: ContentId,
  quantity: BoundedRunSelectionSchema,
});

export const TinkeringCommandRequestSchema = z.object({
  characterId: z.string().uuid(),
});

/** The persistent per-character Auto-discard Scrap preference. */
export const TinkeringScrapPreferenceRequestSchema = z.object({
  characterId: z.string().uuid(),
  autoDiscardScrap: z.boolean(),
});

/** A Clean Pass claim names only the character; the open window is derived. */
export const CleanPassClaimRequestSchema = z.object({
  characterId: z.string().uuid(),
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

/**
 * Site stash commands (#284). The location is a stale-view guard, not an
 * authority: the server proves the character is actually there and that the
 * location is an authored stash site. Capacity, container type and quantities
 * are never accepted from the client.
 */
const SiteStashLocationField = z.string().min(1).max(100);

const SiteStashStackTransferFields = {
  characterId: z.string().uuid(),
  locationId: SiteStashLocationField,
  stackId: z.string().uuid(),
  mode: z.enum(["one", "stack"]),
  expectedQuantity: z.number().int().positive(),
} as const;

export const DepositSiteStashStackRequestSchema = z.object(SiteStashStackTransferFields);
export const WithdrawSiteStashStackRequestSchema = z.object(SiteStashStackTransferFields);

const SiteStashUniqueTransferFields = {
  characterId: z.string().uuid(),
  locationId: SiteStashLocationField,
  itemInstanceId: z.string().uuid(),
} as const;

export const DepositSiteStashUniqueItemRequestSchema = z.object(SiteStashUniqueTransferFields);
export const WithdrawSiteStashUniqueItemRequestSchema = z.object(SiteStashUniqueTransferFields);
export const InstallSiteStashContainerRequestSchema = z.object(SiteStashUniqueTransferFields);

export const RemoveSiteStashContainerRequestSchema = z.object({
  characterId: z.string().uuid(),
  locationId: SiteStashLocationField,
  expectedContainerInstanceId: z.string().uuid(),
});

export const SwapSiteStashContainerRequestSchema = z.object({
  characterId: z.string().uuid(),
  locationId: SiteStashLocationField,
  expectedContainerInstanceId: z.string().uuid(),
  itemInstanceId: z.string().uuid(),
});

/**
 * Generic mission commands identify only the owned character plus the narrow
 * command intent: which authored mission and which NPC the player is acting
 * with. Everything else — required items, quantities, requirement
 * satisfaction, consumption, rewards, prerequisite status, completion
 * eligibility — stays server-owned and is revalidated inside the transaction.
 * No client-calculated state is ever accepted.
 */
export const AcceptMissionRequestSchema = z.object({
  characterId: z.string().uuid(),
  missionId: ContentId,
  npcId: ContentId,
});
export const CompleteMissionRequestSchema = z.object({
  characterId: z.string().uuid(),
  missionId: ContentId,
  npcId: ContentId,
});
/**
 * Narrow identity for the generic mandatory-conversation command. The dialogue
 * is part of the intent so the server can confirm the played scene is the one
 * the mission actually authored for that NPC; it grants nothing by itself.
 */
export const AcknowledgeMissionConversationRequestSchema = z.object({
  characterId: z.string().uuid(),
  missionId: ContentId,
  npcId: ContentId,
  dialogueId: ContentId,
});

/**
 * A merchant transaction identifies only the intent: the owned character, which
 * Local Place the player is trading in, the item, the direction, and how many.
 *
 * The Local Place is a request, not proof of anything — the server revalidates
 * it against the character's authoritative World Location, that place's derived
 * access, and whether it actually owns a merchant. Unit price, total, stock
 * eligibility, affordability, and capacity are all server-resolved, so no price
 * or total appears in this contract at all.
 */
export const TradeRequestSchema = z.object({
  characterId: z.string().uuid(),
  /**
   * The Local Place the player is trading in, when the merchant lives inside
   * one. Omitted for a merchant the World Location itself hosts (#190) — Wade
   * trades out of his yard, which is not a room in a town. Either way the
   * venue is a request, never proof: the server resolves the merchant from the
   * character's own authoritative position.
   */
  localPlaceId: ContentId.optional(),
  itemId: ItemIdSchema,
  direction: z.enum(["buy", "sell"]),
  quantity: z.number().int().positive(),
});

/** Containers can only hold non-container item definitions. */
export const ContainerContentItemSchema = z.object({
  itemId: ItemIdSchema,
  isContainer: z.literal(false),
});

export const ContainerContentsSchema = z.array(ContainerContentItemSchema);
