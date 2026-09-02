import { asc, eq, or, sql } from "drizzle-orm";
import { characters, playerAccounts, characterMissions } from "@/db/rune-space";
import { user } from "@/db/auth-schema";
import { requireAdmin } from "@/server/admin-auth";
import { loadCharacterAuditLog } from "@/server/admin-audit";
import { withResolvedCharacter } from "@/server/action-resolution";
import { createPlayResolver, stateFromTransaction, type PlayGameplayState } from "@/server/play";
import { getMission, MISSIONS } from "@/game/content/missions";
import { db } from "@/db";
import type { DatabaseTransaction } from "@/server/action-resolution";

/**
 * Admin read / state-query boundary (Issue #113).
 *
 * Every read authenticates via `requireAdmin`. The selected-character inspector
 * runs through the SHARED character lock + lazy reconcile boundary so it reports
 * the coherent POST-reconciliation authoritative state exactly as a player
 * command would — normal lazy reconciliation is not an operator mutation and is
 * never logged to the operator audit (the explicit operator action is).
 */

/** Narrow owning-account identity for disambiguation (no secrets/tokens). */
export type AdminOwnerIdentity = {
  playerAccountId: string;
  /** Masked Better Auth email, e.g. "a***@example.com". */
  maskedEmail?: string;
};

async function maskEmail(email: string): Promise<string> {
  const [localRaw, domain] = email.split("@");
  if (!domain) return "***";
  const local = localRaw ?? "";
  const head = local.slice(0, 1);
  const tail = local.slice(-1) || "*";
  return `${head}***${tail}@${domain}`;
}

/** Character search results with narrow owner disambiguation. */
export type AdminCharacterSearchResult = {
  id: string;
  displayName: string;
  normalizedName: string;
  currentLocationId: string;
  slot: number;
  owner: AdminOwnerIdentity;
};

export async function searchCharactersAdmin(
  headers: Headers,
  query: string,
  limit: number = 20,
): Promise<readonly AdminCharacterSearchResult[]> {
  await requireAdmin(headers);
  const trimmed = query.trim();
  const safeLimit = Math.max(1, Math.min(limit, 100));
  if (!trimmed) return [];

  const pattern = `%${trimmed.toLowerCase()}%`;
  const rows = await db
    .select({
      id: characters.id,
      displayName: characters.displayName,
      normalizedName: characters.normalizedName,
      currentLocationId: characters.currentLocationId,
      slot: characters.slot,
      playerAccountId: characters.playerAccountId,
      userEmail: user.email,
    })
    .from(characters)
    .innerJoin(playerAccounts, eq(playerAccounts.id, characters.playerAccountId))
    .innerJoin(user, eq(user.id, playerAccounts.userId))
    .where(
      or(
        sql`${characters.normalizedName} LIKE ${pattern}`,
        sql`${characters.displayName} ILIKE ${pattern}`,
      ),
    )
    .orderBy(asc(characters.normalizedName))
    .limit(safeLimit);

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      displayName: row.displayName,
      normalizedName: row.normalizedName,
      currentLocationId: row.currentLocationId,
      slot: row.slot,
      owner: {
        playerAccountId: row.playerAccountId,
        maskedEmail: row.userEmail ? await maskEmail(row.userEmail) : undefined,
      },
    })),
  );
}

/**
 * Authored mission detail surfaced to the operator console for one character.
 * `status` reflects the persisted record (accepted vs completed) and is
 * independent of the live `play.missions` projection so timestamps can be shown
 * alongside progression state.
 */
export type AdminMissionDetail = {
  missionId: string;
  title: string;
  prerequisiteMissionId?: string;
  status: "accepted" | "completed";
  acceptedAt?: string;
  completedAt?: string;
};

/** Complete authoritative inspector snapshot for one selected character. */
export type AdminInspectorState = {
  characterId: string;
  displayName: string;
  owner: AdminOwnerIdentity;
  currentLocationId: string;
  play: PlayGameplayState;
  /** Persisted authored-mission records (with timestamps + prerequisite). */
  missions: readonly AdminMissionDetail[];
  audit: readonly (typeof import("@/db/rune-space").operatorAuditLogs.$inferSelect)[];
};

export async function loadAdminInspectorState(
  headers: Headers,
  characterId: string,
  now: Date = new Date(),
): Promise<AdminInspectorState> {
  const admin = await requireAdmin(headers);
  return withResolvedCharacter(
    characterId,
    createPlayResolver(),
    async (transaction, context) => {
      const [ownerRows, auditRows, missionRows] = await Promise.all([
        ownerIdentity(transaction, context.character.id),
        loadCharacterAuditLog(transaction, characterId),
        transaction
          .select()
          .from(characterMissions)
          .where(eq(characterMissions.characterId, context.character.id)),
      ]);
      const state = await stateFromTransaction(
        transaction,
        characterId,
        { successes: 0, failures: 0, awardedXp: 0 },
        undefined,
        undefined,
        undefined,
        undefined,
        now,
      );
      const missions: AdminMissionDetail[] = [];
      const byAuthoredId = new Map(MISSIONS.map((m) => [m.id, m]));
      for (const row of missionRows) {
        const authored = getMission(row.missionId) ?? byAuthoredId.get(row.missionId);
        missions.push({
          missionId: row.missionId,
          title: authored?.title ?? row.missionId,
          prerequisiteMissionId: authored?.prerequisiteMissionId,
          status: row.completedAt ? "completed" : "accepted",
          acceptedAt: row.acceptedAt.toISOString(),
          completedAt: row.completedAt ? row.completedAt.toISOString() : undefined,
        });
      }
      missions.sort((a, b) => a.missionId.localeCompare(b.missionId));
      return {
        characterId,
        displayName: context.character.displayName,
        owner: ownerRows,
        currentLocationId: state.location.currentLocationId,
        play: state,
        missions,
        audit: auditRows,
      };
    },
    now,
  );
}

async function ownerIdentity(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<AdminOwnerIdentity> {
  const rows = await transaction
    .select({ playerAccountId: characters.playerAccountId, email: user.email })
    .from(characters)
    .innerJoin(playerAccounts, eq(playerAccounts.id, characters.playerAccountId))
    .innerJoin(user, eq(user.id, playerAccounts.userId))
    .where(eq(characters.id, characterId))
    .limit(1);
  const row = rows[0];
  return {
    playerAccountId: row?.playerAccountId ?? "",
    maskedEmail: row?.email ? await maskEmail(row.email) : undefined,
  };
}
