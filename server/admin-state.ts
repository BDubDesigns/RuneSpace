import { asc, eq, or, sql } from "drizzle-orm";
import {
  characters,
  playerAccounts,
  characterMissions,
  cargoHoldItemInstances,
  equippedItems,
  itemInstances,
} from "@/db/rune-space";
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
 * The list iterates the CANONICAL `MISSIONS` registry in authored order and
 * joins any persisted `characterMissions` row: an authored mission with no
 * persistence row appears as `not_accepted` with absent timestamps, regardless
 * of its live `play.missions` projection. This satisfies the #113 contract that
 * EVERY currently authored mission is listed. Stale rows whose mission id is no
 * longer authored are presented separately (`stale` flag) and never substitute
 * for the authored list.
 */
export type AdminMissionDetail = {
  missionId: string;
  title: string;
  prerequisiteMissionId?: string;
  /** Authored missions are always listed; absent row ⇒ `not_accepted`. */
  status: "not_accepted" | "accepted" | "completed";
  acceptedAt?: string;
  completedAt?: string;
  /**
   * True only for a persisted row whose mission id is NOT in the canonical
   * `MISSIONS` registry (leftover from before removal).
   */
  stale?: boolean;
};

/**
 * One canonical "occupied unique instance" for the operator console, unifying
 * equipped / carried / Cargo instances so every unique item's item ID, instance
 * ID, mutable state, and (when equipped) slot is visible together.
 */
export type AdminUniqueInstanceView = {
  itemId: string;
  instanceId: string;
  /** Mutable persistent state (e.g. Cutter charge), when the item exposes one. */
  currentCharge?: number;
  /** "equipped:<assignmentKind>:<suitSlotId>" | "carried" | "cargo". */
  location: string;
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
  /** Unified view of every occupied unique instance (equipped/carried/Cargo). */
  uniqueInstances: readonly AdminUniqueInstanceView[];
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
      const [ownerRows, auditRows, missionRows, instanceRows, equippedRows, cargoItemRows] =
        await Promise.all([
          ownerIdentity(transaction, context.character.id),
          loadCharacterAuditLog(transaction, characterId),
          transaction
            .select()
            .from(characterMissions)
            .where(eq(characterMissions.characterId, context.character.id)),
          transaction
            .select()
            .from(itemInstances)
            .where(eq(itemInstances.characterId, context.character.id)),
          transaction
            .select()
            .from(equippedItems)
            .where(eq(equippedItems.characterId, context.character.id)),
          transaction
            .select()
            .from(cargoHoldItemInstances)
            .where(eq(cargoHoldItemInstances.characterId, context.character.id)),
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
      // Iterate the CANONICAL authored missions and join any persisted row; an
      // authored mission with no persistence row appears as `not_accepted`.
      const byRowMissionId = new Map(missionRows.map((row) => [row.missionId, row]));
      const authored = MISSIONS.map((definition) => {
        const row = byRowMissionId.get(definition.id);
        return {
          missionId: definition.id,
          title: definition.title,
          prerequisiteMissionId: definition.prerequisiteMissionId,
          status: (!row ? "not_accepted" : row.completedAt ? "completed" : "accepted") as
            | "not_accepted"
            | "accepted"
            | "completed",
          acceptedAt: row?.acceptedAt.toISOString(),
          completedAt: row?.completedAt ? row.completedAt.toISOString() : undefined,
        };
      });
      // Persisted rows whose id is not currently authored are preserved (never
      // silently dropped from the DB) and surfaced as stale, but they do NOT
      // substitute for or merge into the authored list.
      const staleRows = missionRows
        .filter((row) => !getMission(row.missionId))
        .map((row) => ({
          missionId: row.missionId,
          title: row.missionId,
          status: (row.completedAt ? "completed" : "accepted") as "accepted" | "completed",
          acceptedAt: row.acceptedAt.toISOString(),
          completedAt: row.completedAt ? row.completedAt.toISOString() : undefined,
          stale: true,
        }));
      const missions: AdminMissionDetail[] = [...authored, ...staleRows];
      missions.sort((a, b) => a.missionId.localeCompare(b.missionId));

      // Unified "occupied unique instance" view: every unique `itemInstances`
      // row categorized as equipped (with its slot) / carried / Cargo, so the
      // operator sees item ID + instance ID + mutable state + equipped slot
      // together for each unique item.
      const equippedSlotByInstance = new Map<string, string>();
      for (const row of equippedRows) {
        equippedSlotByInstance.set(row.itemInstanceId, `${row.assignmentKind}:${row.suitSlotId}`);
      }
      const cargoInstanceIds = new Set(cargoItemRows.map((row) => row.itemInstanceId));
      const uniqueInstances: AdminUniqueInstanceView[] = instanceRows
        .map((instance) => {
          const slot = equippedSlotByInstance.get(instance.id);
          const location = slot
            ? `equipped:${slot}`
            : cargoInstanceIds.has(instance.id)
              ? "cargo"
              : "carried";
          return {
            itemId: instance.itemId,
            instanceId: instance.id,
            currentCharge:
              typeof instance.currentCharge === "number" ? instance.currentCharge : undefined,
            location,
          };
        })
        .sort((a, b) => a.instanceId.localeCompare(b.instanceId));

      return {
        characterId,
        displayName: context.character.displayName,
        owner: ownerRows,
        currentLocationId: state.location.currentLocationId,
        play: state,
        missions,
        uniqueInstances,
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
