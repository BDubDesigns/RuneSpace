"use server";

import { headers } from "next/headers";
import type { z } from "zod";
import { redirect } from "next/navigation";
import {
  ensurePlayerAccount,
  requireCurrentUser,
  requireVerifiedUser,
  OwnershipError,
} from "@/server/ownership";
import { FabricationReservationError } from "@/server/fabrication-reservation";
import { createCharacter, changeCharacterPortrait, CharacterError } from "@/server/characters";
import { GameplayAccessError, loadAccountGameplayAccess } from "@/server/gameplay-access";
import { db } from "@/db";
import { acknowledgeNews } from "@/server/account-news";
import { SubmitAppealRequestSchema, type SubmitAppealResult } from "@/game/schemas/moderation";
import { submitAppeal } from "@/server/moderation-notices";
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
  loadMiningToolPowerCell,
  type LoadPowerCellResult,
} from "@/server/mining-commands";
import { setAutoDiscardSlagPreference } from "@/server/character-preference-commands";
import { startRefining, stopRefining } from "@/server/refining-commands";
import {
  finishCurrentFabrication,
  lockInFabricationOverride,
  pushFabricationOverride,
  setManualOverride,
  startFabrication,
} from "@/server/fabrication-commands";
import {
  finishCurrentTinkering,
  setTinkeringScrapPreference,
  startTinkering,
  stopTinkering,
} from "@/server/tinkering-commands";
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
  depositSiteStashStack,
  depositSiteStashUniqueItem,
  installSiteStashContainer,
  removeSiteStashContainer,
  swapSiteStashContainer,
  withdrawSiteStashStack,
  withdrawSiteStashUniqueItem,
  type SiteStashStateResult,
} from "@/server/site-stash";
import {
  contributeRepairMaterials,
  startWelding,
  stopWelding,
  type RepairContributionStatus,
  type RepairStateResult,
} from "@/server/repair-commands";
import {
  finishCurrentPracticeWeld,
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
import { turnBackTravel } from "@/server/travel-commands";
import { claimPowerCells, type PowerAnnexClaimResult } from "@/server/power-annex";
import { tradeWithMerchant, type TradeResult } from "@/server/trade";
import { markChatMentionsRead, postPromotedTradeAd, sendChatMessage } from "@/server/chat";
import {
  hideWhisperConversation,
  markWhisperRead,
  openWhisper,
  sendWhisper,
  WhisperError,
} from "@/server/whispers";
import { markSystemNoticesRead } from "@/server/system-notices";
import { blockPlayer, unblockPlayer } from "@/server/player-blocks";
import { reportMessage, reportPlayer } from "@/server/player-reports";
import {
  acceptTradeRequest,
  addTradeOfferItem,
  addTradeOfferStack,
  cancelTradeRequest,
  cancelTradeSession,
  changeTradeOffer,
  confirmTrade,
  createTradeRequest,
  declineTradeRequest,
  readyTradeOffer,
  removeTradeOfferItem,
  removeTradeOfferStack,
  setTradeOfferCredits,
} from "@/server/player-trades";
import {
  CreateTradeRequestSchema,
  SetTradeCreditsSchema,
  TradeConsentCommandSchema,
  TradeItemOfferSchema,
  TradeRequestCommandSchema,
  TradeSessionCommandSchema,
  TradeStackOfferSchema,
  type TradeCommandResult,
} from "@/game/schemas/player-trade";
import {
  HideWhisperConversationRequestSchema,
  MarkWhisperReadRequestSchema,
  OpenWhisperRequestSchema,
  SendWhisperRequestSchema,
  type OpenWhisperResult,
  type WhisperSendResult,
} from "@/game/schemas/whispers";
import { MarkSystemNoticesReadRequestSchema } from "@/game/schemas/system-notices";
import {
  BlockRequestSchema,
  ReportMessageRequestSchema,
  ReportPlayerRequestSchema,
  UnblockRequestSchema,
  type BlockResult,
  type ReportResult,
} from "@/game/schemas/social-safety";
import {
  MarkChatMentionsReadRequestSchema,
  PostPromotedTradeAdRequestSchema,
  SendChatMessageRequestSchema,
  type ChatSendResult,
} from "@/game/schemas/chat";
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
  TurnBackTravelRequestSchema,
  ScavengeClaimRequestSchema,
  ScavengeRevealAcknowledgmentRequestSchema,
  ClaimPowerCellsRequestSchema,
  TradeRequestSchema,
  LoadPowerCellRequestSchema,
  DiscardInventoryStackRequestSchema,
  RepairMaterialContributionRequestSchema,
  StartRefiningRequestSchema,
  StartFabricationRequestSchema,
  FabricationCommandRequestSchema,
  ManualOverrideToggleRequestSchema,
  ManualOverridePushRequestSchema,
  ManualOverrideLockInRequestSchema,
  StartTinkeringRequestSchema,
  TinkeringCommandRequestSchema,
  TinkeringScrapPreferenceRequestSchema,
  WeldingCommandRequestSchema,
  PracticeCommandRequestSchema,
  StartPracticeRequestSchema,
  AutoDiscardSlagPreferenceRequestSchema,
  WorkOrderAcceptRequestSchema,
  WorkOrderCommandRequestSchema,
  CleanPassClaimRequestSchema,
  DepositCargoStackRequestSchema,
  WithdrawCargoStackRequestSchema,
  DepositCargoUniqueItemRequestSchema,
  WithdrawCargoUniqueItemRequestSchema,
  DepositSiteStashStackRequestSchema,
  WithdrawSiteStashStackRequestSchema,
  DepositSiteStashUniqueItemRequestSchema,
  WithdrawSiteStashUniqueItemRequestSchema,
  InstallSiteStashContainerRequestSchema,
  RemoveSiteStashContainerRequestSchema,
  SwapSiteStashContainerRequestSchema,
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

/**
 * Appeal one moderation sanction on the player's own account (issue #248).
 * Account management, not gameplay: a suspended player must still be able to
 * appeal, so this needs only an authenticated session and never enters the
 * gameplay-access gate.
 */
export async function submitModerationAppealAction(input: unknown): Promise<SubmitAppealResult> {
  const request = SubmitAppealRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid appeal." };
  try {
    const user = await requireCurrentUser(await headers());
    return await submitAppeal(user.id, request.data);
  } catch (error) {
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
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
    startRefining(
      userId,
      characterId,
      request.data.recipeActionId,
      undefined,
      undefined,
      request.data.quantity,
    ),
  );
}

export async function stopRefiningAction(characterId: string): Promise<PlayActionResult> {
  return runPlayAction(characterId, stopRefining);
}

export async function startFabricationAction(input: unknown): Promise<PlayActionResult> {
  const request = StartFabricationRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Fabrication command." };
  return runPlayAction(request.data.characterId, (userId, characterId) =>
    startFabrication(userId, characterId, request.data.recipeActionId, request.data.quantity),
  );
}

/** Stop, for a Fabrication run, is Finish Current: there is no cancel (#232). */
export async function finishCurrentFabricationAction(input: unknown): Promise<PlayActionResult> {
  const request = FabricationCommandRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Fabrication command." };
  return runPlayAction(request.data.characterId, (userId, characterId) =>
    finishCurrentFabrication(userId, characterId),
  );
}

export async function setManualOverrideAction(input: unknown): Promise<PlayActionResult> {
  const request = ManualOverrideToggleRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Manual Override command." };
  return runPlayAction(request.data.characterId, (userId, characterId) =>
    setManualOverride(userId, characterId, request.data.enabled),
  );
}

export async function pushManualOverrideAction(input: unknown): Promise<PlayActionResult> {
  const request = ManualOverridePushRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Manual Override command." };
  return runPlayAction(request.data.characterId, (userId, characterId) =>
    pushFabricationOverride(
      userId,
      characterId,
      request.data.feed,
      request.data.expectedWorkpiece,
      request.data.expectedPushes,
    ),
  );
}

export async function lockInManualOverrideAction(input: unknown): Promise<PlayActionResult> {
  const request = ManualOverrideLockInRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Manual Override command." };
  return runPlayAction(request.data.characterId, (userId, characterId) =>
    lockInFabricationOverride(userId, characterId, request.data.expectedWorkpiece),
  );
}

export async function startTinkeringAction(input: unknown): Promise<PlayActionResult> {
  const request = StartTinkeringRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Tinkering command." };
  return runPlayAction(request.data.characterId, (userId, characterId) =>
    startTinkering(userId, characterId, request.data.targetActionId, request.data.quantity),
  );
}

export async function stopTinkeringAction(input: unknown): Promise<PlayActionResult> {
  const request = TinkeringCommandRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Tinkering command." };
  return runPlayAction(request.data.characterId, (userId, characterId) =>
    stopTinkering(userId, characterId),
  );
}

export async function finishCurrentTinkeringAction(input: unknown): Promise<PlayActionResult> {
  const request = TinkeringCommandRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Tinkering command." };
  return runPlayAction(request.data.characterId, (userId, characterId) =>
    finishCurrentTinkering(userId, characterId),
  );
}

export async function setTinkeringScrapPreferenceAction(input: unknown): Promise<PlayActionResult> {
  const request = TinkeringScrapPreferenceRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Tinkering setting." };
  return runPlayAction(request.data.characterId, (userId, characterId) =>
    setTinkeringScrapPreference(userId, characterId, request.data.autoDiscardScrap),
  );
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
  const request = StartPracticeRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Practice command." };
  try {
    const user = await requireCurrentUser(await headers());
    return {
      state: await startPracticeWelding(
        user.id,
        request.data.characterId,
        undefined,
        undefined,
        request.data.quantity,
      ),
    };
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

export async function setAutoDiscardSlagPreferenceAction(
  input: unknown,
): Promise<PlayActionResult> {
  const request = AutoDiscardSlagPreferenceRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Auto-discard Slag setting." };
  try {
    const user = await requireCurrentUser(await headers());
    return {
      state: await setAutoDiscardSlagPreference(
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

export type SiteStashActionResult = SiteStashStateResult | { error: string };

/**
 * One wrapper for every site stash command (#284): parse, authenticate, run,
 * and translate the two refusal exceptions exactly as the Cargo actions do.
 */
async function runSiteStashAction<Schema extends z.ZodType<{ characterId: string }>>(
  schema: Schema,
  input: unknown,
  invalidMessage: string,
  run: (userId: string, request: z.infer<Schema>) => Promise<SiteStashStateResult>,
): Promise<SiteStashActionResult> {
  const request = schema.safeParse(input);
  if (!request.success) return { error: invalidMessage };
  try {
    const user = await requireCurrentUser(await headers());
    return await run(user.id, request.data);
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function depositSiteStashStackAction(input: unknown): Promise<SiteStashActionResult> {
  return runSiteStashAction(
    DepositSiteStashStackRequestSchema,
    input,
    "Invalid stash deposit command.",
    (userId, request) => depositSiteStashStack(userId, request.characterId, request),
  );
}

export async function withdrawSiteStashStackAction(input: unknown): Promise<SiteStashActionResult> {
  return runSiteStashAction(
    WithdrawSiteStashStackRequestSchema,
    input,
    "Invalid stash withdrawal command.",
    (userId, request) => withdrawSiteStashStack(userId, request.characterId, request),
  );
}

export async function depositSiteStashUniqueItemAction(
  input: unknown,
): Promise<SiteStashActionResult> {
  return runSiteStashAction(
    DepositSiteStashUniqueItemRequestSchema,
    input,
    "Invalid stash item deposit command.",
    (userId, request) => depositSiteStashUniqueItem(userId, request.characterId, request),
  );
}

export async function withdrawSiteStashUniqueItemAction(
  input: unknown,
): Promise<SiteStashActionResult> {
  return runSiteStashAction(
    WithdrawSiteStashUniqueItemRequestSchema,
    input,
    "Invalid stash item withdrawal command.",
    (userId, request) => withdrawSiteStashUniqueItem(userId, request.characterId, request),
  );
}

export async function installSiteStashContainerAction(
  input: unknown,
): Promise<SiteStashActionResult> {
  return runSiteStashAction(
    InstallSiteStashContainerRequestSchema,
    input,
    "Invalid stash container install command.",
    (userId, request) => installSiteStashContainer(userId, request.characterId, request),
  );
}

export async function removeSiteStashContainerAction(
  input: unknown,
): Promise<SiteStashActionResult> {
  return runSiteStashAction(
    RemoveSiteStashContainerRequestSchema,
    input,
    "Invalid stash container removal command.",
    (userId, request) => removeSiteStashContainer(userId, request.characterId, request),
  );
}

export async function swapSiteStashContainerAction(input: unknown): Promise<SiteStashActionResult> {
  return runSiteStashAction(
    SwapSiteStashContainerRequestSchema,
    input,
    "Invalid stash container swap command.",
    (userId, request) => swapSiteStashContainer(userId, request.characterId, request),
  );
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
    return await loadMiningToolPowerCell(
      user.id,
      request.data.characterId,
      undefined,
      undefined,
      selectedStack,
    );
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError || error instanceof FabricationReservationError)
      return { error: error.message };
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
    if (error instanceof OwnershipError || error instanceof FabricationReservationError)
      return { error: error.message };
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

/** Turn Back from the active Journey. Arrival wins any race; see `turnBackTravel`. */
export async function turnBackTravelAction(input: unknown): Promise<PlayActionResult> {
  const request = TurnBackTravelRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Turn Back command." };
  return runPlayAction(request.data.characterId, turnBackTravel);
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
    if (
      error instanceof OwnershipError ||
      error instanceof EquipmentRuleError ||
      error instanceof FabricationReservationError
    )
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

export type ChatActionResult = ChatSendResult | { error: string };

/**
 * Public chat sends (issue #246). The browser names its active character,
 * what to say, and which characters it selected to `@mention` (#261); sender
 * identity, mention resolution, the shared account-wide budget, and every
 * refusal are decided by `server/chat.ts`.
 */
export async function sendChatMessageAction(input: unknown): Promise<ChatActionResult> {
  const request = SendChatMessageRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid chat message." };
  try {
    const user = await requireCurrentUser(await headers());
    const { characterId, ...message } = request.data;
    return await sendChatMessage(user.id, characterId, message);
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function postPromotedTradeAdAction(input: unknown): Promise<ChatActionResult> {
  const request = PostPromotedTradeAdRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid promoted ad." };
  try {
    const user = await requireCurrentUser(await headers());
    const { characterId, text, mentions } = request.data;
    return await postPromotedTradeAd(user.id, characterId, { text, mentions });
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

/**
 * Public `@mention` attention (#261): reading a channel marks the active
 * character's mentions in it read through what this tab showed.
 */
export async function markChatMentionsReadAction(
  input: unknown,
): Promise<{ status: "read" } | { error: string }> {
  const request = MarkChatMentionsReadRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid request." };
  try {
    const user = await requireCurrentUser(await headers());
    const { characterId, ...read } = request.data;
    return await markChatMentionsRead(user.id, characterId, read);
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export type WhisperActionResult = WhisperSendResult | { error: string };

/**
 * Whispers (issue #247). Opening resolves the character a character-facing
 * surface named and persists nothing; sending shares public chat's account-
 * wide budget; reading advances the active character's durable read position.
 */
export async function openWhisperAction(input: unknown): Promise<OpenWhisperResult> {
  const request = OpenWhisperRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Whisper." };
  try {
    const user = await requireCurrentUser(await headers());
    return await openWhisper(user.id, request.data.characterId, request.data.target);
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function sendWhisperAction(input: unknown): Promise<WhisperActionResult> {
  const request = SendWhisperRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid Whisper." };
  try {
    const user = await requireCurrentUser(await headers());
    const { characterId, ...message } = request.data;
    return await sendWhisper(user.id, characterId, message);
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function markWhisperReadAction(
  input: unknown,
): Promise<{ status: "read" } | { error: string }> {
  const request = MarkWhisperReadRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid request." };
  try {
    const user = await requireCurrentUser(await headers());
    const { characterId, ...read } = request.data;
    return await markWhisperRead(user.id, characterId, read);
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError || error instanceof WhisperError) {
      return { error: error.message };
    }
    throw error;
  }
}

/**
 * Hide a Whisper conversation from the active character's own inbox (#261).
 * Nothing is deleted and the other participant sees no change.
 */
export async function hideWhisperConversationAction(
  input: unknown,
): Promise<{ status: "hidden" } | { error: string }> {
  const request = HideWhisperConversationRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid request." };
  try {
    const user = await requireCurrentUser(await headers());
    const { characterId, ...hide } = request.data;
    return await hideWhisperConversation(user.id, characterId, hide);
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError || error instanceof WhisperError) {
      return { error: error.message };
    }
    throw error;
  }
}

/**
 * The System conversation (issue #274): reading marks the active character's
 * recipe-unlock notices read through what this tab showed.
 */
export async function markSystemNoticesReadAction(
  input: unknown,
): Promise<{ status: "read" } | { error: string }> {
  const request = MarkSystemNoticesReadRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid request." };
  try {
    const user = await requireCurrentUser(await headers());
    const { characterId, ...read } = request.data;
    return await markSystemNoticesRead(user.id, characterId, read);
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

/**
 * Block, Unblock, and Report (issue #247). Every account identity is resolved
 * server-side; the browser names only its active character and a
 * character-facing target.
 */
export async function blockPlayerAction(input: unknown): Promise<BlockResult> {
  const request = BlockRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid request." };
  try {
    const user = await requireCurrentUser(await headers());
    return await blockPlayer(user.id, request.data.characterId, request.data.target);
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function unblockPlayerAction(input: unknown): Promise<BlockResult> {
  const request = UnblockRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid request." };
  try {
    const user = await requireCurrentUser(await headers());
    return await unblockPlayer(user.id, request.data.characterId, request.data.blockedCharacterId);
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function reportMessageAction(input: unknown): Promise<ReportResult> {
  const request = ReportMessageRequestSchema.safeParse(input);
  if (!request.success) return { error: "Choose a reason for the report." };
  try {
    const user = await requireCurrentUser(await headers());
    const { characterId, ...report } = request.data;
    return await reportMessage(user.id, characterId, report);
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function reportPlayerAction(input: unknown): Promise<ReportResult> {
  const request = ReportPlayerRequestSchema.safeParse(input);
  if (!request.success) return { error: "Choose a reason for the report." };
  try {
    const user = await requireCurrentUser(await headers());
    const { characterId, ...report } = request.data;
    return await reportPlayer(user.id, characterId, report);
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export type PlayerTradeActionResult = TradeCommandResult | { error: string };

/**
 * Same-location player trade requests and sessions (issue #266). The browser
 * names only its active character and a target, request, or session; every
 * eligibility, ownership, and participant check is server-side in
 * `server/player-trades.ts`.
 */
export async function createTradeRequestAction(input: unknown): Promise<PlayerTradeActionResult> {
  const request = CreateTradeRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid trade request." };
  try {
    const user = await requireCurrentUser(await headers());
    return await createTradeRequest(user.id, request.data.characterId, request.data.target);
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

async function runTradeRequestCommand(
  input: unknown,
  command: typeof cancelTradeRequest,
): Promise<PlayerTradeActionResult> {
  const request = TradeRequestCommandSchema.safeParse(input);
  if (!request.success) return { error: "Invalid trade request." };
  try {
    const user = await requireCurrentUser(await headers());
    return await command(user.id, request.data.characterId, request.data.requestId);
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function cancelTradeRequestAction(input: unknown): Promise<PlayerTradeActionResult> {
  return runTradeRequestCommand(input, cancelTradeRequest);
}

export async function declineTradeRequestAction(input: unknown): Promise<PlayerTradeActionResult> {
  return runTradeRequestCommand(input, declineTradeRequest);
}

export async function acceptTradeRequestAction(input: unknown): Promise<PlayerTradeActionResult> {
  return runTradeRequestCommand(input, acceptTradeRequest);
}

export async function cancelTradeSessionAction(input: unknown): Promise<PlayerTradeActionResult> {
  const request = TradeSessionCommandSchema.safeParse(input);
  if (!request.success) return { error: "Invalid trade." };
  try {
    const user = await requireCurrentUser(await headers());
    return await cancelTradeSession(user.id, request.data.characterId, request.data.sessionId);
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

/**
 * One accepted trade's offer and consent commands (issue #267). The browser
 * names its active character, the session, the offer version it is looking
 * at, and its own intended change; ownership, balances, item state, location,
 * capacity, and the counterpart's consent are all proved server-side in
 * `server/player-trades.ts`.
 */
async function runTradeOfferAction<Request>(
  input: unknown,
  schema: { safeParse(input: unknown): { success: true; data: Request } | { success: false } },
  command: (userId: string, request: Request) => Promise<TradeCommandResult>,
): Promise<PlayerTradeActionResult> {
  const request = schema.safeParse(input);
  if (!request.success) return { error: "Invalid trade offer." };
  try {
    const user = await requireCurrentUser(await headers());
    return await command(user.id, request.data);
  } catch (error) {
    redirectOnGameplayRefusal(error);
    if (error instanceof OwnershipError) return { error: error.message };
    throw error;
  }
}

export async function setTradeOfferCreditsAction(input: unknown): Promise<PlayerTradeActionResult> {
  return runTradeOfferAction(input, SetTradeCreditsSchema, (userId, request) =>
    setTradeOfferCredits(
      userId,
      request.characterId,
      request.sessionId,
      request.offerVersion,
      request.credits,
    ),
  );
}

export async function addTradeOfferStackAction(input: unknown): Promise<PlayerTradeActionResult> {
  return runTradeOfferAction(input, TradeStackOfferSchema, (userId, request) =>
    addTradeOfferStack(
      userId,
      request.characterId,
      request.sessionId,
      request.offerVersion,
      request.itemId,
      request.quantity,
    ),
  );
}

export async function removeTradeOfferStackAction(
  input: unknown,
): Promise<PlayerTradeActionResult> {
  return runTradeOfferAction(input, TradeStackOfferSchema, (userId, request) =>
    removeTradeOfferStack(
      userId,
      request.characterId,
      request.sessionId,
      request.offerVersion,
      request.itemId,
      request.quantity,
    ),
  );
}

export async function addTradeOfferItemAction(input: unknown): Promise<PlayerTradeActionResult> {
  return runTradeOfferAction(input, TradeItemOfferSchema, (userId, request) =>
    addTradeOfferItem(
      userId,
      request.characterId,
      request.sessionId,
      request.offerVersion,
      request.itemInstanceId,
    ),
  );
}

export async function removeTradeOfferItemAction(input: unknown): Promise<PlayerTradeActionResult> {
  return runTradeOfferAction(input, TradeItemOfferSchema, (userId, request) =>
    removeTradeOfferItem(
      userId,
      request.characterId,
      request.sessionId,
      request.offerVersion,
      request.itemInstanceId,
    ),
  );
}

export async function readyTradeOfferAction(input: unknown): Promise<PlayerTradeActionResult> {
  return runTradeOfferAction(input, TradeConsentCommandSchema, (userId, request) =>
    readyTradeOffer(userId, request.characterId, request.sessionId, request.offerVersion),
  );
}

export async function changeTradeOfferAction(input: unknown): Promise<PlayerTradeActionResult> {
  return runTradeOfferAction(input, TradeConsentCommandSchema, (userId, request) =>
    changeTradeOffer(userId, request.characterId, request.sessionId, request.offerVersion),
  );
}

export async function confirmTradeAction(input: unknown): Promise<PlayerTradeActionResult> {
  return runTradeOfferAction(input, TradeConsentCommandSchema, (userId, request) =>
    confirmTrade(userId, request.characterId, request.sessionId, request.offerVersion),
  );
}
