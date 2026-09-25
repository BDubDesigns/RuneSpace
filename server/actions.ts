"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  ensurePlayerAccount,
  requireCurrentUser,
  requireVerifiedUser,
  OwnershipError,
} from "@/server/ownership";
import { createCharacter, changeCharacterPortrait, CharacterError } from "@/server/characters";
import { GameplayAccessError, loadAccountGameplayAccess } from "@/server/gameplay-access";
import { db } from "@/db";
import { acknowledgeNews } from "@/server/account-news";
import {
  getPlayGameplayState,
  beginTransportTravel,
  beginTravel,
  claimScavenge,
  acknowledgeScavengeReveal,
  type PlayGameplayState,
} from "@/server/play";
import {
  startMining,
  stopMining,
  loadSalvageCutterPowerCell,
  type LoadPowerCellResult,
} from "@/server/mining-commands";
import { startRefining, stopRefining } from "@/server/refining-commands";
import { changeEquipment } from "@/server/equipment";
import { discardInventoryStack, type DiscardInventoryStackResult } from "@/server/inventory";
import {
  depositCargoStack,
  depositCargoUniqueItem,
  withdrawCargoStack,
  withdrawCargoUniqueItem,
  type CargoHoldStateResult,
  type CargoHoldTransferStatus,
} from "@/server/cargo-hold";
import {
  contributeRepairMaterials,
  startWelding,
  stopWelding,
  type RepairContributionStatus,
  type RepairStateResult,
} from "@/server/repair-commands";
import {
  finishCurrentPracticeWeld,
  setPracticeSlagPreference,
  startPracticeWelding,
  stopPracticeWelding,
} from "@/server/practice-commands";
import {
  acceptWorkOrder,
  startWorkOrderWelding,
  stopWorkOrderWelding,
  type WorkOrderCommandState,
} from "@/server/work-order-commands";
import {
  refreshWorkOrderBoard,
  type WorkOrderRefreshCommandState,
} from "@/server/work-order-refresh";
import { claimCleanPass, type CleanPassClaimResult } from "@/server/clean-pass";
import { EquipmentRuleError } from "@/game/domain/equipment";
import { TravelRuleError } from "@/server/travel";
import { claimPowerCells, type PowerAnnexClaimResult } from "@/server/power-annex";
import { tradeWithMerchant, type TradeResult } from "@/server/trade";
import {
  acceptMission,
  acknowledgeMissionConversation,
  completeMission,
  type MissionAcceptanceResult,
  type MissionCompletionResult,
  type MissionConversationAcknowledgementResult,
} from "@/server/missions";
import {
  EquipEquipmentRequestSchema,
  UnequipEquipmentRequestSchema,
  BeginTravelRequestSchema,
  ScavengeClaimRequestSchema,
  ScavengeRevealAcknowledgmentRequestSchema,
  ClaimPowerCellsRequestSchema,
  TradeRequestSchema,
  LoadPowerCellRequestSchema,
  DiscardInventoryStackRequestSchema,
  RepairMaterialContributionRequestSchema,
  StartRefiningRequestSchema,
  WeldingCommandRequestSchema,
  PracticeCommandRequestSchema,
  PracticeSlagPreferenceRequestSchema,
  WorkOrderAcceptRequestSchema,
  WorkOrderCommandRequestSchema,
  CleanPassClaimRequestSchema,
  DepositCargoStackRequestSchema,
  WithdrawCargoStackRequestSchema,
  DepositCargoUniqueItemRequestSchema,
  WithdrawCargoUniqueItemRequestSchema,
  ChangeCharacterPortraitRequestSchema,
  AcceptMissionRequestSchema,
  CompleteMissionRequestSchema,
  AcknowledgeMissionConversationRequestSchema,
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

/**
 * Stale-page recovery for player gameplay commands (issue #223).
 *
 * The gameplay-access DECISION is never made here: every gameplay command's own
 * server boundary (`server/action-resolution.ts` for commands and the Play
 * state load) requires access for each request and throws `GameplayAccessError`.
 * Every gameplay action's error handler calls this first, so when Early Access
 * was revoked or public gameplay closed after the page loaded, the browser is
 * navigated back to Characters instead of being left in a broken retry loop.
 * An action that forgot this call would still be refused (the error is an
 * `OwnershipError`); it would only lose the navigation. The classification in
 * `tests/unit/gameplay-entrypoints.test.ts` keeps every gameplay action on it.
 */
function redirectOnGameplayRefusal(error: unknown): void {
  if (error instanceof GameplayAccessError) redirect("/characters");
}

/**
 * Character reservation (issue #221) — account/character management, NOT
 * gameplay: it stays available while public gameplay is closed. After a
 * successful reservation the server decides where to go from authoritative
 * access state (issue #223): an account that can play right now keeps the
 * normal Play entry, while a verified ordinary account waiting for Soft Alpha
 * returns to Characters and its waiting-state treatment.
 */
export async function createCharacterAction(formData: FormData): Promise<ActionResult> {
  const displayName = String(formData.get("name") ?? "");
  // The deliberate portrait choice is part of the authoritative creation
  // command (issue #65): the browser submits only the stable portrait ID, and
  // the server re-validates selectability before anything is persisted.
  const portraitId = String(formData.get("portraitId") ?? "");
  try {
    // Character reservation requires a verified email (issue #221), enforced
    // here independently of the page so a forged submission is refused too.
    const user = await requireVerifiedUser(await headers());
    const account = await ensurePlayerAccount(user.id);
    const character = await createCharacter(account.id, displayName, portraitId);
    const access = await loadAccountGameplayAccess(db, user.id);
    // `redirect` throws NEXT_REDIRECT; let it propagate out of the action so
    // Next performs the navigation. Only domain errors are caught here.
    redirect(access.decision.allowed ? `/play/${character.id}` : "/characters");
  } catch (err) {
    if (err instanceof CharacterError) return { error: err.message };
    if (err instanceof OwnershipError) return { error: err.message };
    // Re-throw redirect navigation and any unexpected error.
    throw err;
  }
}

/**
 * Acknowledge account-level news (issue #156). The authenticated account's
 * news read-through boundary advances to the newest published Update's
 * instant as resolved server-side, then the browser navigates to the Updates
 * index — an ordinary form submission, so this works as normal navigation
 * even without client JavaScript. Errors intentionally fall through to the
 * thrown redirect/error rather than a client-visible result: this control has
 * no other in-place error affordance, and a failed acknowledgement should
 * surface the same way any other broken navigation would.
 */
export async function acknowledgeNewsAction(): Promise<void> {
  const user = await requireCurrentUser(await headers());
  await acknowledgeNews(user.id);
  redirect("/updates");
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

export type PlayActionResult = { state?: PlayGameplayState; error?: string };

async function runPlayAction(
  characterId: string,
  command: (userId: string, id: string) => Promise<PlayGameplayState>,
): Promise<PlayActionResult> {
  try {
    const user = await requireCurrentUser(await headers());
    return { state: await command(user.id, characterId) };
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    if (error instanceof TravelRuleError) return { error: error.message };
    throw error;
  }
}

export async function refreshPlayAction(characterId: string): Promise<PlayActionResult> {
  return runPlayAction(characterId, getPlayGameplayState);
}

export type MissionActionResult =
  | MissionAcceptanceResult
  | MissionCompletionResult
  | { error: string };

export type MissionConversationActionResult =
  | MissionConversationAcknowledgementResult
  | { error: string };

/**
 * Generic mission acceptance command. The browser submits only narrow command
 * identity/intent (owned character, authored mission, NPC); the server
 * revalidates every rule from the mission definition inside the transaction.
 */
export async function acceptMissionAction(input: unknown): Promise<MissionActionResult> {
  const request = AcceptMissionRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid mission acceptance command." };
  try {
    const user = await requireCurrentUser(await headers());
    return await acceptMission(
      user.id,
      request.data.characterId,
      request.data.missionId,
      request.data.npcId,
    );
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

/**
 * Generic mission completion command. Requirements, consumption, rewards, and
 * the completion stamp are all server-authoritative; nothing is trusted from
 * the client beyond the narrow command identity/intent.
 */
export async function completeMissionAction(input: unknown): Promise<MissionActionResult> {
  const request = CompleteMissionRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid mission completion command." };
  try {
    const user = await requireCurrentUser(await headers());
    return await completeMission(
      user.id,
      request.data.characterId,
      request.data.missionId,
      request.data.npcId,
    );
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

/**
 * Generic mandatory-conversation command. The browser reports only which
 * mission, NPC, and authored sequence it played; the server confirms the
 * mission authors exactly that conversation and that the character is really
 * there before the requirement is satisfied.
 */
export async function acknowledgeMissionConversationAction(
  input: unknown,
): Promise<MissionConversationActionResult> {
  const request = AcknowledgeMissionConversationRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid mission conversation command." };
  try {
    const user = await requireCurrentUser(await headers());
    return await acknowledgeMissionConversation(
      user.id,
      request.data.characterId,
      request.data.missionId,
      request.data.npcId,
      request.data.dialogueId,
    );
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function startMiningAction(characterId: string): Promise<PlayActionResult> {
  return runPlayAction(characterId, startMining);
}

export async function stopMiningAction(characterId: string): Promise<PlayActionResult> {
  return runPlayAction(characterId, stopMining);
}

export async function startRefiningAction(input: unknown): Promise<PlayActionResult> {
  const request = StartRefiningRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Refining command." };
  return runPlayAction(request.data.characterId, (userId, characterId) =>
    startRefining(userId, characterId, request.data.recipeActionId),
  );
}

export async function stopRefiningAction(characterId: string): Promise<PlayActionResult> {
  return runPlayAction(characterId, stopRefining);
}

export async function startWeldingAction(input: unknown): Promise<PlayActionResult> {
  const request = WeldingCommandRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Welding command." };
  try {
    const user = await requireCurrentUser(await headers());
    return {
      state: await startWelding(user.id, request.data.characterId, request.data.targetId),
    };
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function startPracticeWeldingAction(input: unknown): Promise<PlayActionResult> {
  const request = PracticeCommandRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Practice command." };
  try {
    const user = await requireCurrentUser(await headers());
    return { state: await startPracticeWelding(user.id, request.data.characterId) };
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function stopPracticeWeldingAction(input: unknown): Promise<PlayActionResult> {
  const request = PracticeCommandRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Practice command." };
  try {
    const user = await requireCurrentUser(await headers());
    return { state: await stopPracticeWelding(user.id, request.data.characterId) };
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function finishCurrentPracticeWeldAction(input: unknown): Promise<PlayActionResult> {
  const request = PracticeCommandRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Practice command." };
  try {
    const user = await requireCurrentUser(await headers());
    return { state: await finishCurrentPracticeWeld(user.id, request.data.characterId) };
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export type WorkOrderActionResult = WorkOrderCommandState | { error: string };

export async function acceptWorkOrderAction(input: unknown): Promise<WorkOrderActionResult> {
  const request = WorkOrderAcceptRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Work Order command." };
  try {
    const user = await requireCurrentUser(await headers());
    return await acceptWorkOrder(user.id, request.data.characterId, request.data.workOrderId);
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function startWorkOrderWeldingAction(input: unknown): Promise<WorkOrderActionResult> {
  const request = WorkOrderCommandRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Work Order command." };
  try {
    const user = await requireCurrentUser(await headers());
    return await startWorkOrderWelding(user.id, request.data.characterId);
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function stopWorkOrderWeldingAction(input: unknown): Promise<WorkOrderActionResult> {
  const request = WorkOrderCommandRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Work Order command." };
  try {
    const user = await requireCurrentUser(await headers());
    return await stopWorkOrderWelding(user.id, request.data.characterId);
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export type WorkOrderRefreshActionResult = WorkOrderRefreshCommandState | { error: string };

export async function refreshWorkOrderBoardAction(
  input: unknown,
): Promise<WorkOrderRefreshActionResult> {
  const request = WorkOrderCommandRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Work Order command." };
  try {
    const user = await requireCurrentUser(await headers());
    return await refreshWorkOrderBoard(user.id, request.data.characterId);
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function setPracticeSlagPreferenceAction(input: unknown): Promise<PlayActionResult> {
  const request = PracticeSlagPreferenceRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Practice setting." };
  try {
    const user = await requireCurrentUser(await headers());
    return {
      state: await setPracticeSlagPreference(
        user.id,
        request.data.characterId,
        request.data.autoDiscardSlag,
      ),
    };
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export type CleanPassClaimActionResult = CleanPassClaimResult | { error: string };

export async function claimCleanPassAction(input: unknown): Promise<CleanPassClaimActionResult> {
  const request = CleanPassClaimRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Clean Pass claim." };
  try {
    const user = await requireCurrentUser(await headers());
    return await claimCleanPass(user.id, request.data.characterId);
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function stopWeldingAction(input: unknown): Promise<PlayActionResult> {
  const request = WeldingCommandRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Welding command." };
  try {
    const user = await requireCurrentUser(await headers());
    return {
      state: await stopWelding(user.id, request.data.characterId, request.data.targetId),
    };
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export type RepairMaterialContributionActionResult =
  | RepairStateResult<RepairContributionStatus>
  | { error: string };

export async function contributeRepairMaterialsAction(
  input: unknown,
): Promise<RepairMaterialContributionActionResult> {
  const request = RepairMaterialContributionRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid repair contribution command." };
  try {
    const user = await requireCurrentUser(await headers());
    return await contributeRepairMaterials(user.id, request.data.characterId, {
      targetId: request.data.targetId,
      expectedMaterials: request.data.expectedMaterials,
    });
  } catch (error) {
    redirectOnGameplayRefusal(error);
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
    redirectOnGameplayRefusal(error);
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
    redirectOnGameplayRefusal(error);
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
    redirectOnGameplayRefusal(error);
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
    redirectOnGameplayRefusal(error);
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
    const selectedStack =
      request.data.stackId && request.data.expectedQuantity !== undefined
        ? {
            stackId: request.data.stackId,
            expectedQuantity: request.data.expectedQuantity,
          }
        : undefined;
    return await loadSalvageCutterPowerCell(
      user.id,
      request.data.characterId,
      undefined,
      undefined,
      selectedStack,
    );
  } catch (error) {
    redirectOnGameplayRefusal(error);
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
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function beginTravelAction(input: unknown): Promise<PlayActionResult> {
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
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    if (error instanceof TravelRuleError) return { error: error.message };
    throw error;
  }
}

/** Board a paid transport ride. The fare and route are resolved server-side. */
export async function beginTransportTravelAction(input: unknown): Promise<PlayActionResult> {
  const request = BeginTravelRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid ride command." };
  try {
    const user = await requireCurrentUser(await headers());
    return {
      state: await beginTransportTravel(
        user.id,
        request.data.characterId,
        request.data.destinationLocationId,
      ),
    };
  } catch (error) {
    redirectOnGameplayRefusal(error);
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
    redirectOnGameplayRefusal(error);
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
    redirectOnGameplayRefusal(error);
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
): Promise<PlayActionResult> {
  try {
    const user = await requireCurrentUser(await headers());
    return {
      state: await changeEquipment(user.id, request.characterId, change(request)),
    };
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError || error instanceof EquipmentRuleError)
      return { error: error.message };
    throw error;
  }
}

export async function equipEquipmentAction(input: unknown): Promise<PlayActionResult> {
  const request = EquipEquipmentRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid equipment command." };
  return runEquipmentAction(request.data, (request) => ({
    kind: "equip",
    itemInstanceId: request.itemInstanceId!,
    target: request.target,
  }));
}

export async function unequipEquipmentAction(input: unknown): Promise<PlayActionResult> {
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
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export type TradeActionResult = TradeResult | { error: string };

export async function tradeWithMerchantAction(input: unknown): Promise<TradeActionResult> {
  const request = TradeRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid trade command." };
  try {
    const user = await requireCurrentUser(await headers());
    const { characterId, ...trade } = request.data;
    return await tradeWithMerchant(user.id, characterId, trade);
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}
