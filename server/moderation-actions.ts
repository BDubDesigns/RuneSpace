"use server";

import { headers } from "next/headers";
import {
  AddCaseNoteRequestSchema,
  ChangeSanctionDurationRequestSchema,
  DecideAppealRequestSchema,
  IssueSanctionRequestSchema,
  OpenModerationCaseRequestSchema,
  RetainedChatRequestSchema,
  ReverseSanctionRequestSchema,
  SetCaseStatusRequestSchema,
  type RetainedChatView,
} from "@/game/schemas/moderation";
import { AdminError } from "@/server/admin-auth";
import {
  addModerationCaseNote,
  changeSanctionDuration,
  decideAppeal,
  issueSanction,
  loadRetainedPublicChat,
  loadRetainedWhispers,
  ModerationCommandError,
  openModerationCase,
  reverseSanction,
  setModerationCaseStatus,
  type ModerationMutationResult,
} from "@/server/moderation-commands";
import { OwnershipError } from "@/server/ownership";

/**
 * Operator Console moderation server actions (issue #248): schema-parse, then
 * the `requireAdmin`-guarded command in `server/moderation-commands.ts`.
 * Authorization and the operator's identity are always derived server-side
 * inside the command; the browser supplies only ids and choices.
 */

export type ModerationActionResult = ModerationMutationResult | { error: string };
export type RetainedChatActionResult = RetainedChatView | { error: string };

function moderationError(error: unknown): { error: string } {
  if (error instanceof AdminError) return { error: error.message };
  if (error instanceof ModerationCommandError) return { error: error.message };
  if (error instanceof OwnershipError) return { error: error.message };
  throw error;
}

export async function openModerationCaseAction(input: unknown): Promise<ModerationActionResult> {
  const request = OpenModerationCaseRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid case request." };
  try {
    return await openModerationCase(await headers(), request.data.characterId, request.data.reason);
  } catch (error) {
    return moderationError(error);
  }
}

export async function setModerationCaseStatusAction(
  input: unknown,
): Promise<ModerationActionResult> {
  const request = SetCaseStatusRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid case status." };
  try {
    return await setModerationCaseStatus(await headers(), request.data.caseId, request.data.status);
  } catch (error) {
    return moderationError(error);
  }
}

export async function addModerationCaseNoteAction(input: unknown): Promise<ModerationActionResult> {
  const request = AddCaseNoteRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid note." };
  try {
    return await addModerationCaseNote(await headers(), request.data.caseId, request.data.body);
  } catch (error) {
    return moderationError(error);
  }
}

export async function issueSanctionAction(input: unknown): Promise<ModerationActionResult> {
  const request = IssueSanctionRequestSchema.safeParse(input);
  if (!request.success) return { error: "Choose a sanction, a rule, and a duration." };
  try {
    return await issueSanction(await headers(), request.data);
  } catch (error) {
    return moderationError(error);
  }
}

export async function changeSanctionDurationAction(
  input: unknown,
): Promise<ModerationActionResult> {
  const request = ChangeSanctionDurationRequestSchema.safeParse(input);
  if (!request.success) return { error: "Choose a duration." };
  try {
    return await changeSanctionDuration(
      await headers(),
      request.data.sanctionId,
      request.data.duration,
    );
  } catch (error) {
    return moderationError(error);
  }
}

export async function reverseSanctionAction(input: unknown): Promise<ModerationActionResult> {
  const request = ReverseSanctionRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid sanction." };
  try {
    return await reverseSanction(await headers(), request.data.sanctionId);
  } catch (error) {
    return moderationError(error);
  }
}

export async function decideAppealAction(input: unknown): Promise<ModerationActionResult> {
  const request = DecideAppealRequestSchema.safeParse(input);
  if (!request.success) return { error: "Choose an outcome (and a new duration to Modify)." };
  try {
    return await decideAppeal(await headers(), request.data);
  } catch (error) {
    return moderationError(error);
  }
}

/** Load (and audit) the case subject's retained public chat around one report. */
export async function loadRetainedPublicChatAction(
  input: unknown,
): Promise<RetainedChatActionResult> {
  const request = RetainedChatRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid request." };
  try {
    return await loadRetainedPublicChat(await headers(), request.data.caseId, request.data.reportId);
  } catch (error) {
    return moderationError(error);
  }
}

/** Load (and audit) the retained Whispers between one report's two accounts. */
export async function loadRetainedWhispersAction(
  input: unknown,
): Promise<RetainedChatActionResult> {
  const request = RetainedChatRequestSchema.safeParse(input);
  if (!request.success) return { error: "Invalid request." };
  try {
    return await loadRetainedWhispers(await headers(), request.data.caseId, request.data.reportId);
  } catch (error) {
    return moderationError(error);
  }
}
