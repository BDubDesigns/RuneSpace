"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ensurePlayerAccount, requireCurrentUser, OwnershipError } from "@/server/ownership";
import { createCharacter, changeCharacterPortrait, CharacterError } from "@/server/characters";
import {
  beginTravel,
  claimScavenge,
  acknowledgeScavengeReveal,
  getMiningGameplayState,
  startFerriteShaleMining,
  startRefining,
  stopMining,
  stopRefining,
  loadSalvageCutterPowerCell,
  type LoadPowerCellResult,
  type MiningGameplayState,
} from "@/server/mining";
import { changeEquipment } from "@/server/equipment";
import { discardInventoryStack, type DiscardInventoryStackResult } from "@/server/inventory";
import {
  contributeCargoHoldMaterials,
  depositCargoStack,
  depositCargoUniqueItem,
  startCargoHoldWelding,
  stopCargoHoldWelding,
  withdrawCargoStack,
  withdrawCargoUniqueItem,
  type CargoHoldContributionStatus,
  type CargoHoldStateResult,
  type CargoHoldTransferStatus,
} from "@/server/cargo-hold";
import { EquipmentRuleError } from "@/game/domain/equipment";
import { TravelRuleError } from "@/server/travel";
import { claimPowerCells, type PowerAnnexClaimResult } from "@/server/power-annex";
import {
  acceptWalkItOff,
  completeWalkItOff,
  type MissionAcceptanceResult,
  type MissionCompletionResult,
} from "@/server/missions";
import {
  EquipEquipmentRequestSchema,
  UnequipEquipmentRequestSchema,
  BeginTravelRequestSchema,
  ScavengeClaimRequestSchema,
  ScavengeRevealAcknowledgmentRequestSchema,
  ClaimPowerCellsRequestSchema,
  LoadPowerCellRequestSchema,
  DiscardInventoryStackRequestSchema,
  CargoHoldMaterialContributionRequestSchema,
  DepositCargoStackRequestSchema,
  WithdrawCargoStackRequestSchema,
  DepositCargoUniqueItemRequestSchema,
  WithdrawCargoUniqueItemRequestSchema,
  ChangeCharacterPortraitRequestSchema,
  AcceptWalkItOffRequestSchema,
  CompleteWalkItOffRequestSchema,
} from "@/game/schemas/gameplay";

/**
 * Player-facing server action for character creation (thin composition over
 * RuneSpace ownership). The browser is never the source of truth: the action
 * re-authenticates via Better Auth (using the session cookie set natively by
 * the `/api/auth/*` route) and resolves ownership server-side.
 *
 * Authentication itself is handled by the Better Auth client
 * (`features/auth/auth-client.ts`) talking to `/api/auth/*`, which sets the
 * session cookie on the HTTP response directly — so no manual cookie bridging
 * is needed here, and the token is never re-encoded.
 */
export type ActionResult = { error?: string };

export async function createCharacterAction(formData: FormData): Promise<ActionResult> {
  const displayName = String(formData.get("name") ?? "");
  // The deliberate portrait choice is part of the authoritative creation
  // command (issue #65): the browser submits only the stable portrait ID, and
  // the server re-validates selectability before anything is persisted.
  const portraitId = String(formData.get("portraitId") ?? "");
  try {
    const user = await requireCurrentUser(await headers());
    const account = await ensurePlayerAccount(user.id);
    const character = await createCharacter(account.id, displayName, portraitId);
    // `redirect` throws NEXT_REDIRECT; let it propagate out of the action so
    // Next performs the navigation. Only domain errors are caught here.
    redirect(`/play/${character.id}`);
  } catch (err) {
    if (err instanceof CharacterError) return { error: err.message };
    if (err instanceof OwnershipError) return { error: err.message };
    // Re-throw redirect navigation and any unexpected error.
    throw err;
  }
}

export type ChangeCharacterPortraitActionResult = { characterId?: string; error?: string };

export async function changeCharacterPortraitAction(
  input: unknown,
): Promise<ChangeCharacterPortraitActionResult> {
  const request = ChangeCharacterPortraitRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid portrait command." };
  try {
    const user = await requireCurrentUser(await headers());
    const character = await changeCharacterPortrait(
      user.id,
      request.data.characterId,
      request.data.portraitId,
    );
    return { characterId: character.id };
  } catch (error) {
    if (error instanceof CharacterError) return { error: error.message };
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export type MiningActionResult = { state?: MiningGameplayState; error?: string };

async function runMiningAction(
  characterId: string,
  command: (userId: string, id: string) => Promise<MiningGameplayState>,
): Promise<MiningActionResult> {
  try {
    const user = await requireCurrentUser(await headers());
    return { state: await command(user.id, characterId) };
  } catch (error) {
    if (error instanceof OwnershipError) return { error: error.message };
    if (error instanceof TravelRuleError) return { error: error.message };
    throw error;
  }
}

export async function refreshMiningAction(characterId: string): Promise<MiningActionResult> {
  return runMiningAction(characterId, getMiningGameplayState);
}

export type MissionActionResult =
  | MissionAcceptanceResult
  | MissionCompletionResult
  | { error: string };

export async function acceptWalkItOffAction(input: unknown): Promise<MissionActionResult> {
  const request = AcceptWalkItOffRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Walk It Off acceptance command." };
  try {
    const user = await requireCurrentUser(await headers());
    return await acceptWalkItOff(user.id, request.data.characterId);
  } catch (error) {
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function completeWalkItOffAction(input: unknown): Promise<MissionActionResult> {
  const request = CompleteWalkItOffRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Walk It Off completion command." };
  try {
    const user = await requireCurrentUser(await headers());
    return await completeWalkItOff(user.id, request.data.characterId);
  } catch (error) {
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function startMiningAction(characterId: string): Promise<MiningActionResult> {
  return runMiningAction(characterId, startFerriteShaleMining);
}

export async function stopMiningAction(characterId: string): Promise<MiningActionResult> {
  return runMiningAction(characterId, stopMining);
}

export async function startRefiningAction(characterId: string): Promise<MiningActionResult> {
  return runMiningAction(characterId, startRefining);
}

export async function stopRefiningAction(characterId: string): Promise<MiningActionResult> {
  return runMiningAction(characterId, stopRefining);
}

export async function startWeldingAction(characterId: string): Promise<MiningActionResult> {
  return runMiningAction(characterId, startCargoHoldWelding);
}

export async function stopWeldingAction(characterId: string): Promise<MiningActionResult> {
  return runMiningAction(characterId, stopCargoHoldWelding);
}

export type CargoHoldMaterialContributionActionResult =
  | CargoHoldStateResult<CargoHoldContributionStatus>
  | { error: string };

export async function contributeCargoHoldMaterialsAction(
  input: unknown,
): Promise<CargoHoldMaterialContributionActionResult> {
  const request = CargoHoldMaterialContributionRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Cargo Hold contribution command." };
  try {
    const user = await requireCurrentUser(await headers());
    return await contributeCargoHoldMaterials(user.id, request.data.characterId, {
      expectedRefinedFerrite: request.data.expectedRefinedFerrite,
      expectedSlag: request.data.expectedSlag,
    });
  } catch (error) {
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export type CargoHoldTransferActionResult =
  | CargoHoldStateResult<CargoHoldTransferStatus>
  | { error: string };

export async function depositCargoStackAction(
  input: unknown,
): Promise<CargoHoldTransferActionResult> {
  const request = DepositCargoStackRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Cargo Hold deposit command." };
  try {
    const user = await requireCurrentUser(await headers());
    return await depositCargoStack(user.id, request.data.characterId, request.data);
  } catch (error) {
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function withdrawCargoStackAction(
  input: unknown,
): Promise<CargoHoldTransferActionResult> {
  const request = WithdrawCargoStackRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Cargo Hold withdrawal command." };
  try {
    const user = await requireCurrentUser(await headers());
    return await withdrawCargoStack(user.id, request.data.characterId, request.data);
  } catch (error) {
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function depositCargoUniqueItemAction(
  input: unknown,
): Promise<CargoHoldTransferActionResult> {
  const request = DepositCargoUniqueItemRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Cargo Hold item deposit command." };
  try {
    const user = await requireCurrentUser(await headers());
    return await depositCargoUniqueItem(user.id, request.data.characterId, request.data);
  } catch (error) {
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function withdrawCargoUniqueItemAction(
  input: unknown,
): Promise<CargoHoldTransferActionResult> {
  const request = WithdrawCargoUniqueItemRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Cargo Hold item withdrawal command." };
  try {
    const user = await requireCurrentUser(await headers());
    return await withdrawCargoUniqueItem(user.id, request.data.characterId, request.data);
  } catch (error) {
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export type LoadPowerCellActionResult = LoadPowerCellResult | { error: string };

export async function loadPowerCellAction(input: unknown): Promise<LoadPowerCellActionResult> {
  const request = LoadPowerCellRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Power Cell load command." };
  try {
    const user = await requireCurrentUser(await headers());
    return await loadSalvageCutterPowerCell(user.id, request.data.characterId);
  } catch (error) {
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export type DiscardInventoryStackActionResult = DiscardInventoryStackResult | { error: string };

export async function discardInventoryStackAction(
  input: unknown,
): Promise<DiscardInventoryStackActionResult> {
  const request = DiscardInventoryStackRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid inventory command." };
  try {
    const user = await requireCurrentUser(await headers());
    return await discardInventoryStack(user.id, request.data.characterId, {
      stackId: request.data.stackId,
      mode: request.data.mode,
      expectedQuantity: request.data.expectedQuantity,
    });
  } catch (error) {
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function beginTravelAction(input: unknown): Promise<MiningActionResult> {
  const request = BeginTravelRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid travel command." };
  try {
    const user = await requireCurrentUser(await headers());
    return {
      state: await beginTravel(
        user.id,
        request.data.characterId,
        request.data.destinationLocationId,
      ),
    };
  } catch (error) {
    if (error instanceof OwnershipError) return { error: error.message };
    if (error instanceof TravelRuleError) return { error: error.message };
    throw error;
  }
}

export type ScavengeClaimActionResult =
  | Awaited<ReturnType<typeof claimScavenge>>
  | { error: string };

export async function claimScavengeAction(input: unknown): Promise<ScavengeClaimActionResult> {
  const request = ScavengeClaimRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Scavenge command." };
  try {
    const user = await requireCurrentUser(await headers());
    return await claimScavenge(user.id, request.data.characterId);
  } catch (error) {
    if (error instanceof OwnershipError || error instanceof TravelRuleError)
      return { error: error.message };
    throw error;
  }
}

export type ScavengeRevealAcknowledgmentActionResult =
  | Awaited<ReturnType<typeof acknowledgeScavengeReveal>>
  | { error: string };

export async function acknowledgeScavengeRevealAction(
  input: unknown,
): Promise<ScavengeRevealAcknowledgmentActionResult> {
  const request = ScavengeRevealAcknowledgmentRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Scavenge reveal acknowledgment." };
  try {
    const user = await requireCurrentUser(await headers());
    return await acknowledgeScavengeReveal(
      user.id,
      request.data.characterId,
      request.data.revealId,
    );
  } catch (error) {
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

type EquipmentActionRequest = {
  characterId: string;
  target: { assignmentKind: "gear" | "container"; suitSlotId: string };
  itemInstanceId?: string;
};

async function runEquipmentAction(
  request: EquipmentActionRequest,
  change: (request: EquipmentActionRequest) => Parameters<typeof changeEquipment>[2],
): Promise<MiningActionResult> {
  try {
    const user = await requireCurrentUser(await headers());
    return {
      state: await changeEquipment(user.id, request.characterId, change(request)),
    };
  } catch (error) {
    if (error instanceof OwnershipError || error instanceof EquipmentRuleError)
      return { error: error.message };
    throw error;
  }
}

export async function equipEquipmentAction(input: unknown): Promise<MiningActionResult> {
  const request = EquipEquipmentRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid equipment command." };
  return runEquipmentAction(request.data, (request) => ({
    kind: "equip",
    itemInstanceId: request.itemInstanceId!,
    target: request.target,
  }));
}

export async function unequipEquipmentAction(input: unknown): Promise<MiningActionResult> {
  const request = UnequipEquipmentRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid equipment command." };
  return runEquipmentAction(request.data, (request) => ({
    kind: "unequip",
    target: request.target,
  }));
}

export type PowerAnnexActionResult = PowerAnnexClaimResult | { error: string };

export async function claimPowerCellsAction(input: unknown): Promise<PowerAnnexActionResult> {
  const request = ClaimPowerCellsRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Power Annex command." };
  try {
    const user = await requireCurrentUser(await headers());
    return await claimPowerCells(user.id, request.data.characterId);
  } catch (error) {
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}
