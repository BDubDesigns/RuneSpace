"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ensurePlayerAccount, requireCurrentUser, OwnershipError } from "@/server/ownership";
import { createCharacter, CharacterError } from "@/server/characters";
import {
  getMiningGameplayState,
  startCrashSiteMining,
  stopMining,
  type MiningGameplayState,
} from "@/server/mining";
import { changeEquipment } from "@/server/equipment";
import { EquipmentRuleError } from "@/game/domain/equipment";
import {
  EquipEquipmentRequestSchema,
  UnequipEquipmentRequestSchema,
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
  try {
    const user = await requireCurrentUser(await headers());
    const account = await ensurePlayerAccount(user.id);
    const character = await createCharacter(account.id, displayName);
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
    throw error;
  }
}

export async function refreshMiningAction(characterId: string): Promise<MiningActionResult> {
  return runMiningAction(characterId, getMiningGameplayState);
}

export async function startMiningAction(characterId: string): Promise<MiningActionResult> {
  return runMiningAction(characterId, startCrashSiteMining);
}

export async function stopMiningAction(characterId: string): Promise<MiningActionResult> {
  return runMiningAction(characterId, stopMining);
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
