"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { AdminError } from "@/server/admin-auth";
import { AdminCommandError } from "@/server/admin-commands";
import { OwnershipError } from "@/server/ownership";
import {
  AdminAddItemRequestSchema,
  AdminCarriedStackRemovalRequestSchema,
  AdminDeleteUniqueItemRequestSchema,
  AdminForceUnequipRequestSchema,
  AdminResetAllMissionsRequestSchema,
  AdminResetMissionChainRequestSchema,
  AdminSetSkillXpRequestSchema,
  AdminStopActionRequestSchema,
  AdminTeleportRequestSchema,
} from "@/game/schemas/admin";
import {
  addItem,
  deleteUniqueItem,
  forceUnequipItem,
  removeCargoStackQuantity,
  removeCarriedStackQuantity,
  resetAllMissions,
  resetMissionChain,
  setSkillTotalXp,
  stopCurrentAction,
  teleportCharacter,
  type AdminAddItemResult,
  type AdminDeleteItemResult,
  type AdminForceUnequipResult,
  type AdminResetMissionResult,
  type AdminSetXpResult,
  type AdminStackRemovalResult,
  type AdminStopResult,
  type AdminTeleportResult,
} from "@/server/admin-commands";
import {
  loadAdminInspectorState,
  searchCharactersAdmin,
  type AdminInspectorState,
} from "@/server/admin-state";

/**
 * Admin operator server actions (Issue #113). Thin server-authoritative layers
 * over `server/admin-commands`, mirroring the schema-parse + `requireAdmin` +
 * friendly-error pattern of `server/actions.ts`. Admin authorization always
 * happens server-side inside the underlying command.
 */

function adminError(error: unknown) {
  if (error instanceof AdminError) return { error: error.message };
  if (error instanceof AdminCommandError) return { error: error.message };
  if (error instanceof OwnershipError) return { error: error.message };
  throw error;
}

export type AdminStopActionResult = AdminStopResult | { error: string };

export async function adminStopCurrentAction(input: unknown): Promise<AdminStopActionResult> {
  const request = AdminStopActionRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid admin command." };
  try {
    return await stopCurrentAction(await headers(), request.data.characterId);
  } catch (error) {
    return adminError(error);
  }
}

export type AdminTeleportActionResult = AdminTeleportResult | { error: string };

export async function adminTeleportCharacter(input: unknown): Promise<AdminTeleportActionResult> {
  const request = AdminTeleportRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid destination location." };
  try {
    return await teleportCharacter(
      await headers(),
      request.data.characterId,
      request.data.destinationLocationId,
    );
  } catch (error) {
    return adminError(error);
  }
}

export type AdminStackRemovalActionResult = AdminStackRemovalResult | { error: string };

async function runStackRemoval(
  input: unknown,
  run: (
    headers: Headers,
    characterId: string,
    stackId: string,
    mode: "one" | "stack",
    expectedQuantity: number,
  ) => Promise<AdminStackRemovalResult>,
): Promise<AdminStackRemovalActionResult> {
  const request = AdminCarriedStackRemovalRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid stack removal command." };
  try {
    const reqHeaders = await headers();
    return await run(
      reqHeaders,
      request.data.characterId,
      request.data.stackId,
      request.data.mode,
      request.data.expectedQuantity,
    );
  } catch (error) {
    return adminError(error);
  }
}

export async function adminRemoveCarriedStackQuantity(
  input: unknown,
): Promise<AdminStackRemovalActionResult> {
  return runStackRemoval(input, removeCarriedStackQuantity);
}

export async function adminRemoveCargoStackQuantity(
  input: unknown,
): Promise<AdminStackRemovalActionResult> {
  return runStackRemoval(input, removeCargoStackQuantity);
}

export type AdminForceUnequipActionResult = AdminForceUnequipResult | { error: string };

export async function adminForceUnequipItem(
  input: unknown,
): Promise<AdminForceUnequipActionResult> {
  const request = AdminForceUnequipRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid unequip command." };
  try {
    return await forceUnequipItem(
      await headers(),
      request.data.characterId,
      request.data.itemInstanceId,
    );
  } catch (error) {
    return adminError(error);
  }
}

export type AdminDeleteItemActionResult = AdminDeleteItemResult | { error: string };

export async function adminDeleteUniqueItem(input: unknown): Promise<AdminDeleteItemActionResult> {
  const request = AdminDeleteUniqueItemRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid delete command." };
  try {
    return await deleteUniqueItem(
      await headers(),
      request.data.characterId,
      request.data.itemInstanceId,
    );
  } catch (error) {
    return adminError(error);
  }
}

export type AdminAddItemActionResult = AdminAddItemResult | { error: string };

export async function adminAddItem(input: unknown): Promise<AdminAddItemActionResult> {
  const request = AdminAddItemRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid add-item command." };
  try {
    return await addItem(
      await headers(),
      request.data.characterId,
      request.data.itemId,
      request.data.quantity,
    );
  } catch (error) {
    return adminError(error);
  }
}

export type AdminResetMissionActionResult = AdminResetMissionResult | { error: string };

export async function adminResetMissionChain(
  input: unknown,
): Promise<AdminResetMissionActionResult> {
  const request = AdminResetMissionChainRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid mission reset command." };
  try {
    return await resetMissionChain(
      await headers(),
      request.data.characterId,
      request.data.missionId,
    );
  } catch (error) {
    return adminError(error);
  }
}

export async function adminResetAllMissions(
  input: unknown,
): Promise<AdminResetMissionActionResult> {
  const request = AdminResetAllMissionsRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid mission reset command." };
  try {
    return await resetAllMissions(await headers(), request.data.characterId);
  } catch (error) {
    return adminError(error);
  }
}

export type AdminSetXpActionResult = AdminSetXpResult | { error: string };

export async function adminSetSkillXp(input: unknown): Promise<AdminSetXpActionResult> {
  const request = AdminSetSkillXpRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid XP command." };
  try {
    return await setSkillTotalXp(
      await headers(),
      request.data.characterId,
      request.data.skillId,
      request.data.totalXp,
    );
  } catch (error) {
    return adminError(error);
  }
}

// ---------------------------------------------------------------------------
// Admin read actions (inspector / search)
// ---------------------------------------------------------------------------

function adminReadError(error: unknown) {
  if (error instanceof AdminError) return { error: error.message };
  if (error instanceof OwnershipError) return { error: error.message };
  throw error;
}

const AdminSearchQuerySchema = z.object({ query: z.string().max(200).optional() });
const AdminInspectorQuerySchema = z.object({ characterId: z.string().uuid() });

export type AdminSearchResult =
  | {
      results: readonly {
        id: string;
        displayName: string;
        normalizedName: string;
        currentLocationId: string;
        slot: number;
        owner: { playerAccountId: string; maskedEmail?: string };
      }[];
    }
  | { error: string };

export async function adminSearchCharacters(input: unknown): Promise<AdminSearchResult> {
  const parsed = AdminSearchQuerySchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid search query." };
  try {
    const results = await searchCharactersAdmin(await headers(), parsed.data.query ?? "");
    return { results };
  } catch (error) {
    return adminReadError(error);
  }
}

export type AdminInspectorResult = { state: AdminInspectorState } | { error: string };

export async function adminLoadInspector(input: unknown): Promise<AdminInspectorResult> {
  const parsed = AdminInspectorQuerySchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid inspector request." };
  try {
    const state = await loadAdminInspectorState(await headers(), parsed.data.characterId);
    return { state };
  } catch (error) {
    return adminReadError(error);
  }
}
