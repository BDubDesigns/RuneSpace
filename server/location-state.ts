import { eq, isNotNull, and } from "drizzle-orm";
import { characterMissions, characterRepairTargets } from "@/db/rune-space";
import {
  resolveLocationStateById,
  type LocationStateFacts,
  type ResolvedLocationState,
} from "@/game/domain/location-state";
import type { DatabaseTransaction } from "@/server/action-resolution";

/**
 * Load the two authoritative facts the location-state boundary derives from
 * (#209): which Missions the character has accepted, and which repair targets
 * they have completed.
 *
 * Both already exist as authoritative rows, which is the whole point — a
 * collapsed Deep Jag opens because its repair row says the brace is in, not
 * because a separate unlock column was written alongside it and could drift.
 */
export async function loadLocationStateFacts(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<LocationStateFacts> {
  const [missionRows, repairRows] = await Promise.all([
    transaction
      .select({ missionId: characterMissions.missionId })
      .from(characterMissions)
      .where(
        and(
          eq(characterMissions.characterId, characterId),
          isNotNull(characterMissions.acceptedAt),
        ),
      ),
    transaction
      .select({ targetId: characterRepairTargets.targetId })
      .from(characterRepairTargets)
      .where(
        and(
          eq(characterRepairTargets.characterId, characterId),
          isNotNull(characterRepairTargets.completedAt),
        ),
      ),
  ]);
  return {
    acceptedMissionIds: new Set(missionRows.map((row) => row.missionId)),
    completedRepairTargetIds: new Set(repairRows.map((row) => row.targetId)),
  };
}

/** Resolve one location's current state for a character, inside a transaction. */
export async function loadLocationState(
  transaction: DatabaseTransaction,
  characterId: string,
  locationId: string,
): Promise<ResolvedLocationState | undefined> {
  const facts = await loadLocationStateFacts(transaction, characterId);
  return resolveLocationStateById(locationId, facts);
}

/**
 * The server-authoritative answer to "may this character do this here?".
 *
 * Every activity command asks this rather than the bare content registry, so a
 * forged request cannot start Galvanite Mining at a Deep Jag whose brace is not
 * in yet.
 */
export async function isActionAvailableForCharacter(
  transaction: DatabaseTransaction,
  characterId: string,
  locationId: string,
  actionId: string,
): Promise<boolean> {
  const state = await loadLocationState(transaction, characterId, locationId);
  return state?.availableActionIds.includes(actionId) ?? false;
}
