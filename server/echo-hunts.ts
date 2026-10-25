import { and, desc, eq, isNull } from "drizzle-orm";
import {
  activeActions,
  characterEchoHunts,
  characters,
  echoReadingNotices,
  itemInstances,
  type ActiveAction,
} from "@/db/rune-space";
import {
  getEffectiveGameBalance,
  getItemDefinition,
  getItemMaximumCharge,
  standardSkillLevelThresholds,
} from "@/game/config/balance";
import { SKILL_IDS } from "@/game/config/foundations";
import { BEGINNER_ECHO_TIER } from "@/game/content/echo-hunts";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { getLocation, getLocationPlanetId } from "@/game/content/locations";
import { getPlanetPresentation } from "@/game/content/planets";
import {
  beginnerEchoTargetPool,
  checkEchoClue,
  isLegendaryEchoReward,
  resolveEchoReading,
  validateEchoHuntContent,
  type EchoClueCheck,
  type EchoEastWest,
  type EchoNorthSouth,
  type EchoRandom,
  type EchoReadingOutcome,
  type EchoReadingSnapshot,
} from "@/game/domain/echo-hunts";
import type { MiningRandom } from "@/game/domain/mining";
import { ticksToMilliseconds } from "@/game/domain/timing";
import type { ActionResolver, DatabaseTransaction } from "@/server/action-resolution";
import { applyCarriedStackDiff } from "@/server/carried-inventory";
import { createEchoRecoveryParcel } from "@/server/fedhex";
import { recordTrackedActivity } from "@/server/mission-progress";
import { loadPlaySnapshot } from "@/server/play-state";
import { grantCharacterSkillXp } from "@/server/progression";
import { recordLegendaryFindAnnouncement } from "@/server/public-system-messages";

// Pools must be real locations of their planets and every table must total 100%;
// fail at module load, not in a player's transaction.
validateEchoHuntContent();

/**
 * Beginner Resonance Echo hunts (#393): persistence, lazy resolution and the
 * play projection.
 *
 * A reading has no payload of its own: it is the active action, its start is
 * the action's durable cursor, the planet it searches is the one the character
 * stands on (a reading is stationary — travel is another action, and a ship in
 * flight blocks every command), and the Seeker it will consume is reserved in
 * the real Inventory until it resolves (`server/fabrication-reservation.ts`).
 * Resolution happens once, under the character lock, in the transaction that
 * also consumes the Seeker, writes the hunt and the durable notice, pays XP and
 * credits the Mission, so a retry, a second tab or an offline catch-up can
 * never read twice, choose a second target or pay twice.
 */

export function isEchoReadingAction(actionId: string | undefined): boolean {
  return actionId === getEffectiveGameBalance().echoHunts.beginner.readingActionId;
}

/** The Echo random: the play random's uniform integer draw. */
export function echoRandomFrom(random: MiningRandom): EchoRandom {
  return {
    nextInteger: (exclusiveMaximum) =>
      random.nextInteger
        ? random.nextInteger(exclusiveMaximum)
        : Math.min(exclusiveMaximum - 1, Math.floor(random.nextUnit() * exclusiveMaximum)),
  };
}

async function loadHuntRow(
  transaction: DatabaseTransaction,
  characterId: string,
  planetId: string,
) {
  const rows = await transaction
    .select()
    .from(characterEchoHunts)
    .where(
      and(
        eq(characterEchoHunts.characterId, characterId),
        eq(characterEchoHunts.planetId, planetId),
        eq(characterEchoHunts.tier, BEGINNER_ECHO_TIER),
      ),
    )
    .for("update");
  return rows[0];
}

/** What one reading needs to resolve, read under the command lock. */
export async function loadEchoReadingSnapshot(
  transaction: DatabaseTransaction,
  characterId: string,
  currentLocationId: string,
): Promise<EchoReadingSnapshot> {
  const snapshot = await loadPlaySnapshot(transaction, characterId);
  const planetId = getLocationPlanetId(currentLocationId);
  const hunt = planetId ? await loadHuntRow(transaction, characterId, planetId) : undefined;
  return {
    currentLocationId,
    stacks: snapshot.stacks,
    slotsAvailable: snapshot.slotsAvailable,
    massAvailableGrams: snapshot.massAvailableGrams,
    ...(hunt ? { hunt: { targetLocationId: hunt.targetLocationId } } : {}),
  };
}

export type PersistedEchoReading =
  | { kind: "pending" }
  | (EchoReadingOutcome & { characterId: string; readAt: Date });

/** Persist one resolved reading, all in the caller's character transaction. */
export async function persistEchoReading(
  transaction: DatabaseTransaction,
  outcome: Exclude<PersistedEchoReading, { kind: "pending" }>,
  /** The discoverer, whose name a Legendary announcement carries (#399). */
  character: { displayName: string },
): Promise<void> {
  if (outcome.kind === "no_seeker" || outcome.kind === "no_hunt_here") return;
  const { characterId, readAt } = outcome;
  await applyCarriedStackDiff(transaction, { characterId, diff: outcome, now: readAt });

  if (outcome.kind === "wrong") {
    const lastReading = {
      lastReadingLocationId: outcome.sourceLocationId,
      lastReadingEastWest: outcome.directions.eastWest,
      lastReadingNorthSouth: outcome.directions.northSouth,
      lastReadingAt: readAt,
    };
    if (outcome.startedTargetLocationId) {
      await transaction.insert(characterEchoHunts).values({
        characterId,
        planetId: outcome.planetId,
        tier: BEGINNER_ECHO_TIER,
        targetLocationId: outcome.startedTargetLocationId,
        startedAt: readAt,
        ...lastReading,
      });
    } else {
      await transaction
        .update(characterEchoHunts)
        .set(lastReading)
        .where(
          and(
            eq(characterEchoHunts.characterId, characterId),
            eq(characterEchoHunts.planetId, outcome.planetId),
            eq(characterEchoHunts.tier, BEGINNER_ECHO_TIER),
          ),
        );
    }
  } else {
    // The discovery ends this planet's hunt and its clue together; the next
    // reading here starts a genuinely new one. Other planets are untouched.
    await transaction
      .delete(characterEchoHunts)
      .where(
        and(
          eq(characterEchoHunts.characterId, characterId),
          eq(characterEchoHunts.planetId, outcome.planetId),
          eq(characterEchoHunts.tier, BEGINNER_ECHO_TIER),
        ),
      );
    await grantCharacterSkillXp(transaction, {
      characterId,
      skillId: SKILL_IDS.runeworking,
      awardedXp: outcome.xpAwarded,
      thresholds: standardSkillLevelThresholds(),
    });
    // A unique prize is its own authoritative instance (#399). One that fits is
    // created here, with the XP, the hunt's end and the notice; one that does not
    // fit is a durable FedHex parcel instead, never lost and never rolled again.
    if (outcome.rewardKept && getItemDefinition(outcome.rewardItemId)?.kind === "unique") {
      const maximumCharge = getItemMaximumCharge(outcome.rewardItemId);
      await transaction.insert(itemInstances).values({
        characterId,
        itemId: outcome.rewardItemId,
        currentCharge: maximumCharge === undefined ? null : 0,
        createdAt: readAt,
        updatedAt: readAt,
      });
    } else if (outcome.rewardMailed) {
      await createEchoRecoveryParcel(transaction, {
        characterId,
        itemId: outcome.rewardItemId,
        readAt,
      });
    }
    // Exactly one excited line at the discovery itself, carried or mailed. It
    // lives in this transaction, which runs once per reading, so claiming,
    // re-reading and trading can never repeat it.
    if (isLegendaryEchoReward(outcome.rewardItemId)) {
      await recordLegendaryFindAnnouncement(transaction, {
        characterName: character.displayName,
        itemName: resolveItemPresentation(outcome.rewardItemId, outcome.rewardItemId).displayName,
        planetName: getPlanetPresentation(
          outcome.planetId as Parameters<typeof getPlanetPresentation>[0],
        ).displayName,
        // The announcement's own instant, as Mining's: a discovery resolved
        // from an offline catch-up is announced when it is recorded.
        now: new Date(),
      });
    }
    // One genuine discovery, credited only to an accepted, unfinished Mission
    // that counts Echoes — never a wrong reading, and never back-credited.
    await recordTrackedActivity(transaction, {
      characterId,
      activity: "echo_hunt",
      metric: "completions",
      attemptCount: 1,
      actionId: getEffectiveGameBalance().echoHunts.beginner.readingActionId,
    });
  }

  await transaction
    .insert(echoReadingNotices)
    .values({
      characterId,
      outcome: outcome.kind,
      planetId: outcome.planetId,
      sourceLocationId: outcome.sourceLocationId,
      ...(outcome.kind === "wrong"
        ? { eastWest: outcome.directions.eastWest, northSouth: outcome.directions.northSouth }
        : {
            rewardItemId: outcome.rewardItemId,
            rewardKept: outcome.rewardKept,
            rewardMailed: outcome.rewardMailed,
          }),
      xpAwarded: outcome.kind === "found" ? outcome.xpAwarded : 0,
      readAt,
    })
    .onConflictDoNothing();
}

/**
 * The Echo reading resolver: a single-shot timed action. A window shorter than
 * the reading resolves nothing; once the reading's ticks have passed — live, on
 * refresh, or in an offline catch-up — it resolves exactly once and stops.
 */
export function createEchoReadingResolver(
  random: EchoRandom,
): ActionResolver<EchoReadingSnapshot, PersistedEchoReading> {
  const durationTicks = getEffectiveGameBalance().echoHunts.beginner.readingDurationTicks;
  return {
    supports: (action: ActiveAction) => isEchoReadingAction(action.actionId),
    load: (transaction, { character }) =>
      loadEchoReadingSnapshot(transaction, character.id, character.currentLocationId),
    resolve: ({ action, snapshot, window }) => {
      if (window.elapsedTicks < durationTicks) {
        return { outcome: { kind: "pending" }, transition: { kind: "continue", consumedTicks: 0 } };
      }
      const outcome = resolveEchoReading({ snapshot: snapshot as EchoReadingSnapshot, random });
      return {
        outcome: {
          ...outcome,
          characterId: action.characterId,
          readAt: new Date(window.startsAt.getTime() + ticksToMilliseconds(durationTicks)),
        },
        transition: { kind: "stop", consumedTicks: durationTicks },
      };
    },
    persist: async (transaction, outcome, context) => {
      if (outcome.kind === "pending") return;
      if (!context) throw new Error("Persisting an Echo reading needs the character it resolved");
      await persistEchoReading(transaction, outcome, context.character);
    },
  };
}

/** Begin one reading. The caller has already proved every start rule. */
export async function insertEchoReadingAction(
  transaction: DatabaseTransaction,
  characterId: string,
  now: Date,
): Promise<void> {
  // A new reading is the player moving on from the last result.
  await transaction
    .update(echoReadingNotices)
    .set({ acknowledgedAt: now })
    .where(
      and(
        eq(echoReadingNotices.characterId, characterId),
        isNull(echoReadingNotices.acknowledgedAt),
      ),
    );
  await transaction.insert(activeActions).values({
    characterId,
    actionId: getEffectiveGameBalance().echoHunts.beginner.readingActionId,
    startedAt: now,
    resolvedThroughAt: now,
  });
}

/** Dismiss one reading notice; presentation only. Idempotent. */
export async function acknowledgeEchoReadingNotice(
  transaction: DatabaseTransaction,
  input: { characterId: string; noticeId: string; now: Date },
): Promise<boolean> {
  const rows = await transaction
    .update(echoReadingNotices)
    .set({ acknowledgedAt: input.now })
    .where(
      and(
        eq(echoReadingNotices.id, input.noticeId),
        eq(echoReadingNotices.characterId, input.characterId),
        isNull(echoReadingNotices.acknowledgedAt),
      ),
    )
    .returning({ id: echoReadingNotices.id });
  return rows.length > 0;
}

/** The last wrong reading on the current planet, as Item Details shows it. */
export type EchoLastReadingProjection = {
  locationId: string;
  locationName: string;
  eastWest: EchoEastWest;
  northSouth: EchoNorthSouth;
  readAt: string;
  /** The current hex against that clue: read-only, derived on every read. */
  check: EchoClueCheck;
};

export type EchoReadingNoticeProjection = {
  noticeId: string;
  outcome: "wrong" | "found";
  planetName: string;
  locationName: string;
  eastWest?: EchoEastWest;
  northSouth?: EchoNorthSouth;
  rewardItemId?: string;
  rewardKept?: boolean;
  /** A Legendary that did not fit was sent to the FedHex mailbox (#399). */
  rewardMailed?: boolean;
  xpAwarded: number;
  readAt: string;
};

/**
 * Everything a player may know about their Beginner Echo hunts (#393). The
 * hidden target is never part of it, on any planet.
 */
export type EchoHuntProjection = {
  seekerItemId: string;
  readingActionId: string;
  readingDurationTicks: number;
  discoveryXp: number;
  /** The planet a Seeker would search right now; absent where no hunt exists. */
  searching?: { planetId: string; planetName: string };
  /** This planet's last wrong reading, while its hunt is still unsolved. */
  lastReading?: EchoLastReadingProjection;
  /** The newest undismissed reading result. */
  notice?: EchoReadingNoticeProjection;
};

const locationName = (locationId: string) => getLocation(locationId)?.displayName ?? locationId;

export async function loadEchoHuntProjection(
  transaction: DatabaseTransaction,
  characterId: string,
  currentLocationId?: string,
): Promise<EchoHuntProjection> {
  const beginner = getEffectiveGameBalance().echoHunts.beginner;
  const locationId =
    currentLocationId ??
    (
      await transaction
        .select({ currentLocationId: characters.currentLocationId })
        .from(characters)
        .where(eq(characters.id, characterId))
        .limit(1)
    )[0]?.currentLocationId;
  const planetId = locationId ? getLocationPlanetId(locationId) : undefined;
  const searchable = planetId && beginnerEchoTargetPool(planetId) ? planetId : undefined;
  const [huntRows, noticeRows] = await Promise.all([
    searchable
      ? transaction
          .select()
          .from(characterEchoHunts)
          .where(
            and(
              eq(characterEchoHunts.characterId, characterId),
              eq(characterEchoHunts.planetId, searchable),
              eq(characterEchoHunts.tier, BEGINNER_ECHO_TIER),
            ),
          )
      : Promise.resolve([]),
    transaction
      .select()
      .from(echoReadingNotices)
      .where(
        and(
          eq(echoReadingNotices.characterId, characterId),
          isNull(echoReadingNotices.acknowledgedAt),
        ),
      )
      .orderBy(desc(echoReadingNotices.readAt))
      .limit(1),
  ]);
  const hunt = huntRows[0];
  const notice = noticeRows[0];
  const lastReading =
    hunt?.lastReadingLocationId &&
    hunt.lastReadingEastWest &&
    hunt.lastReadingNorthSouth &&
    hunt.lastReadingAt &&
    locationId
      ? {
          locationId: hunt.lastReadingLocationId,
          locationName: locationName(hunt.lastReadingLocationId),
          eastWest: hunt.lastReadingEastWest as EchoEastWest,
          northSouth: hunt.lastReadingNorthSouth as EchoNorthSouth,
          readAt: hunt.lastReadingAt.toISOString(),
          check: checkEchoClue({
            sourceLocationId: hunt.lastReadingLocationId,
            directions: {
              eastWest: hunt.lastReadingEastWest as EchoEastWest,
              northSouth: hunt.lastReadingNorthSouth as EchoNorthSouth,
            },
            currentLocationId: locationId,
          }),
        }
      : undefined;
  return {
    seekerItemId: beginner.seekerItemId,
    readingActionId: beginner.readingActionId,
    readingDurationTicks: beginner.readingDurationTicks,
    discoveryXp: beginner.discoveryXp,
    ...(searchable
      ? {
          searching: {
            planetId: searchable,
            planetName: getPlanetPresentation(searchable).displayName,
          },
        }
      : {}),
    ...(lastReading ? { lastReading } : {}),
    ...(notice
      ? {
          notice: {
            noticeId: notice.id,
            outcome: notice.outcome as "wrong" | "found",
            planetName: getPlanetPresentation(
              notice.planetId as Parameters<typeof getPlanetPresentation>[0],
            ).displayName,
            locationName: locationName(notice.sourceLocationId),
            ...(notice.eastWest ? { eastWest: notice.eastWest as EchoEastWest } : {}),
            ...(notice.northSouth ? { northSouth: notice.northSouth as EchoNorthSouth } : {}),
            ...(notice.rewardItemId ? { rewardItemId: notice.rewardItemId } : {}),
            ...(notice.rewardKept !== null ? { rewardKept: notice.rewardKept } : {}),
            ...(notice.outcome === "found" ? { rewardMailed: notice.rewardMailed } : {}),
            xpAwarded: notice.xpAwarded,
            readAt: notice.readAt.toISOString(),
          },
        }
      : {}),
  };
}
