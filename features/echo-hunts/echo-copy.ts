import { resolveItemPresentation } from "@/game/content/item-presentation";
import {
  echoDirectionWords,
  type EchoClueCheck,
  type EchoEastWest,
  type EchoNorthSouth,
} from "@/game/domain/echo-hunts";
import type { EchoReadingCommandError } from "@/server/echo-hunt-commands";

/**
 * Player-facing copy for Beginner Echo hunts (#393). Pure, so every sentence a
 * reading can produce is provable without a browser. Directions always describe
 * where the Echo lies from the hex the reading was taken at.
 */

/**
 * "northeast", or "due north" when the reading was already lined up on the other
 * axis. Both axes aligned never reaches a wrong reading: that is a discovery.
 */
export function echoDirectionsCopy(eastWest: EchoEastWest, northSouth: EchoNorthSouth): string {
  if (eastWest !== "aligned" && northSouth !== "aligned") {
    return echoDirectionWords({ eastWest, northSouth });
  }
  return `due ${echoDirectionWords({ eastWest, northSouth })}`;
}

/**
 * Screen-compass orientation of the authored two-axis clue. This is a compass
 * hint, not an exact bearing or range to the hidden hex. North points up.
 */
export function echoCompassDegrees(eastWest: EchoEastWest, northSouth: EchoNorthSouth): number {
  const x = eastWest === "east" ? 1 : eastWest === "west" ? -1 : 0;
  const y = northSouth === "south" ? 1 : northSouth === "north" ? -1 : 0;
  return ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
}

/** The wrong-reading line: "A faint resonance pulls toward the northwest. The Echo is not here." */
export function echoWrongReadingLine(eastWest: EchoEastWest, northSouth: EchoNorthSouth): string {
  const both = eastWest !== "aligned" && northSouth !== "aligned";
  const words = echoDirectionWords({ eastWest, northSouth });
  return `A faint resonance pulls ${both ? `toward the ${words}` : `due ${words}`}. The Echo is not here.`;
}

/**
 * Whether the hex the player stands on now fits the last reading. Ruled out
 * names the axis that contradicts it, relative to where the reading was taken;
 * otherwise it is only "not ruled out" — never a promise that the Echo is here.
 */
export function echoClueVerdict(
  check: EchoClueCheck,
  eastWest: EchoEastWest,
  northSouth: EchoNorthSouth,
  sourceName: string,
): string {
  if (!check.ruledOut) return "This location is not ruled out by your last reading.";
  const reasons: string[] = [];
  if (check.eastWestConflict) {
    reasons.push(
      eastWest === "aligned"
        ? `the Echo is neither east nor west of ${sourceName}`
        : `the Echo is ${eastWest} of ${sourceName}`,
    );
  }
  if (check.northSouthConflict) {
    reasons.push(
      northSouth === "aligned"
        ? `the Echo is neither north nor south of ${sourceName}`
        : `the Echo is ${northSouth} of ${sourceName}`,
    );
  }
  return `This location is ruled out by your last reading: ${reasons.join(", and ")}.`;
}

/** The loss line for a rolled item that did not fit. */
export function echoRewardLostLine(itemId: string): string {
  const name = resolveItemPresentation(itemId, itemId).displayName;
  return `${name} slipped back into RuneSpace — not enough Inventory space.`;
}

export function echoReadingErrorMessage(error: EchoReadingCommandError): string {
  return error === "echo_no_seeker"
    ? "You need a Beginner Echo Seeker in your Inventory to take a reading."
    : "There are no Resonance Echoes to listen for here.";
}

export const ECHO_CAPACITY_ADVISORY =
  "Leave room in your Inventory. An ordinary item an Echo gives up is lost if it doesn't fit — the discovery still awards Runeworking XP.";

/** Readable local time for a reading's timestamp. */
export function echoReadingTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
