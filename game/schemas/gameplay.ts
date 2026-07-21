import { z } from "zod";
import {
  EQUIPMENT_ASSIGNMENT_KINDS,
  ITEM_IDS,
  SKILL_IDS,
  type ItemId,
  type SkillId,
} from "@/game/config/foundations";
import { ContentId } from "./ids";

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

/** Containers can only hold non-container item definitions. */
export const ContainerContentItemSchema = z.object({
  itemId: ItemIdSchema,
  isContainer: z.literal(false),
});

export const ContainerContentsSchema = z.array(ContainerContentItemSchema);
