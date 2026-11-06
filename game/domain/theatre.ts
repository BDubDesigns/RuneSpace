import { NPC_IDS, type TheatreFilmId } from "@/game/config/foundations";
import { getDialogue, DIALOGUE_SEQUENCES, type DialogueSequence } from "@/game/content/dialogue";
import {
  getTheatreFilm,
  WELDING_FILM_BUFF,
  getTheatreScreensAt,
  getTheatreTicketTier,
  THEATRE_FILMS,
  THEATRE_SCREENS,
  THEATRE_TICKET_TIERS,
  type TheatreFilmDefinition,
  type TheatreScreenDefinition,
  type TheatreTicketTierDefinition,
} from "@/game/content/theatre";
import { getSkillLevelDialogue } from "@/game/content/dialogue";

/**
 * The Holo Drive-In's pure rules (#491): which film a screen shows when, how a ticket
 * tops a buff up, whether a ticket can be sold, and which opening Tamsyn plays. No
 * clock, database or React: the server passes the instant it is deciding at, and the
 * conversation surface passes the showing it was opened at.
 *
 * Authority: the server owns the schedule. A purchase is judged against
 * `currentShowingsAt(locationId, now)` computed from the server's own clock inside the
 * purchase transaction, never from anything the browser claims; the projection below
 * is what the Play state carries so the client can show it and Tamsyn can speak to it.
 */

/** One screen showing one film in one window. */
export type ShowingInstance = {
  /** Stable identity of this screen's showing: the screen and the canonical showtime. */
  showingId: string;
  /**
   * The canonical showtime this window is: its start instant as a UTC ISO string. It names
   * the interval, never a screen, so a second screen carrying the same film in the same
   * window shares it and cannot be bought twice.
   */
  showtimeId: string;
  screenId: string;
  filmId: TheatreFilmId;
  /** Inclusive start, epoch milliseconds. */
  startsAtMs: number;
  /** Exclusive end, epoch milliseconds: the next showing's start. */
  endsAtMs: number;
};

/** A showing as the Play state carries it: ISO strings, safe to serialize. */
export type ShowingProjection = {
  showingId: string;
  showtimeId: string;
  screenId: string;
  filmId: TheatreFilmId;
  startsAt: string;
  endsAt: string;
};

/** What `PlayGameplayState.theatre` carries: every screen's current and next showing. */
export type TheatreProgrammeProjection = {
  screens: readonly {
    screenId: string;
    locationId: string;
    now: ShowingProjection;
    next: ShowingProjection;
  }[];
};

export function showtimeIdAt(startsAtMs: number): string {
  return new Date(startsAtMs).toISOString();
}

function showingForWindow(screen: TheatreScreenDefinition, windowIndex: number): ShowingInstance {
  const startsAtMs = windowIndex * screen.windowMs;
  const showtimeId = showtimeIdAt(startsAtMs);
  const rotation = screen.rotation;
  // A negative index (an instant before the epoch) still rotates deterministically.
  const filmId = rotation[((windowIndex % rotation.length) + rotation.length) % rotation.length]!;
  return {
    showingId: `${screen.id}@${showtimeId}`,
    showtimeId,
    screenId: screen.id,
    filmId,
    startsAtMs,
    endsAtMs: startsAtMs + screen.windowMs,
  };
}

/**
 * The showing a screen has at `nowMs`: the window [start, end) that contains it. An
 * instant exactly on a boundary belongs to the window that starts there, so a purchase
 * at HH:00:00.000 is the incoming showing's and the last millisecond before it is the
 * outgoing one's.
 */
export function showingAt(screen: TheatreScreenDefinition, nowMs: number): ShowingInstance {
  if (!Number.isFinite(nowMs)) throw new RangeError("The showing instant must be a finite time.");
  return showingForWindow(screen, Math.floor(nowMs / screen.windowMs));
}

/** The showing that follows the one containing `nowMs`. */
export function nextShowingAt(screen: TheatreScreenDefinition, nowMs: number): ShowingInstance {
  if (!Number.isFinite(nowMs)) throw new RangeError("The showing instant must be a finite time.");
  return showingForWindow(screen, Math.floor(nowMs / screen.windowMs) + 1);
}

/** Every showing on at one World Location at `nowMs`, in the screens' authored order. */
export function currentShowingsAt(locationId: string, nowMs: number): readonly ShowingInstance[] {
  return getTheatreScreensAt(locationId).map((screen) => showingAt(screen, nowMs));
}

function projectShowing(showing: ShowingInstance): ShowingProjection {
  return {
    showingId: showing.showingId,
    showtimeId: showing.showtimeId,
    screenId: showing.screenId,
    filmId: showing.filmId,
    startsAt: new Date(showing.startsAtMs).toISOString(),
    endsAt: new Date(showing.endsAtMs).toISOString(),
  };
}

/** The programme every screen is running at `nowMs`, for the Play state. */
export function projectTheatreProgramme(
  nowMs: number,
  screens: readonly TheatreScreenDefinition[] = THEATRE_SCREENS,
): TheatreProgrammeProjection {
  return {
    screens: screens.map((screen) => ({
      screenId: screen.id,
      locationId: screen.locationId,
      now: projectShowing(showingAt(screen, nowMs)),
      next: projectShowing(nextShowingAt(screen, nowMs)),
    })),
  };
}

/**
 * The film Tamsyn speaks about when her "What's showing?" topic is opened at `nowMs`: the
 * film on the first screen at this location. The authoritative projection decides; only
 * when the projection has already run out (the browser's synchronized clock is past its
 * `endsAt` and no fresher state has arrived) does it fall back to the same schedule rule,
 * so the topic never names yesterday's film. It is read once, when the topic is opened,
 * and the conversation keeps it.
 */
export function resolveShowingFilmId(
  programme: TheatreProgrammeProjection | undefined,
  locationId: string,
  nowMs: number,
): TheatreFilmId | undefined {
  const screen = getTheatreScreensAt(locationId)[0];
  if (!screen) return undefined;
  const projected = programme?.screens.find((entry) => entry.screenId === screen.id);
  if (
    projected &&
    nowMs < Date.parse(projected.now.endsAt) &&
    nowMs >= Date.parse(projected.now.startsAt)
  ) {
    return projected.now.filmId;
  }
  return showingAt(screen, nowMs).filmId;
}

/**
 * How a ticket changes a skill buff's remaining charges. A new ticket for the same skill
 * sets the balance to the larger of what remains and the tier's capacity: never a sum,
 * and never less than the character already bought.
 */
export type TopUp = {
  remainingBefore: number;
  remainingAfter: number;
  /** What the ticket actually adds; zero when the existing balance already covers it. */
  added: number;
  /**
   * `fills`: nothing remained, so the buff starts at capacity. `tops_up`: some remained and
   * the ticket raises it. `adds_none`: the balance already meets or exceeds the tier, so the
   * purchase changes no charges (it still grants the showing's receipt and replay).
   */
  outcome: "fills" | "tops_up" | "adds_none";
};

export function topUpCharges(remaining: number, capacity: number): TopUp {
  if (!Number.isInteger(remaining) || remaining < 0) {
    throw new RangeError("Remaining charges must be a whole number of at least zero.");
  }
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError("A ticket capacity must be a whole number of at least one.");
  }
  const remainingAfter = Math.max(remaining, capacity);
  return {
    remainingBefore: remaining,
    remainingAfter,
    added: remainingAfter - remaining,
    outcome: remaining === 0 ? "fills" : remainingAfter > remaining ? "tops_up" : "adds_none",
  };
}

export type TicketRefusalReason =
  | "not_at_theatre"
  | "in_transit"
  | "active_action"
  | "unknown_tier"
  | "showing_changed"
  | "already_purchased"
  | "insufficient_credits";

export type TicketPlan =
  | {
      ok: true;
      showing: ShowingInstance;
      film: TheatreFilmDefinition;
      tier: TheatreTicketTierDefinition;
      topUp: TopUp;
    }
  | {
      ok: false;
      reason: TicketRefusalReason;
      /** For `already_purchased`: the film and showtime the character already holds. */
      held?: { filmId: string; showtimeId: string };
    };

/**
 * Decide whether a ticket can be sold, from facts the server has just read under the
 * character lock. Order is the order a player would want to hear about it: where they are
 * and whether they are idle, then what they asked for, then whether it is still on, then
 * whether they already hold it, then whether they can pay. A refusal changes nothing.
 *
 * `requestedShowingId` is the showing the player saw. A showing that has since turned over
 * is `showing_changed`, never silently bought as the incoming film; a showing the player
 * already holds a receipt for is `already_purchased`, which is also what a retry after a
 * lost response, a double tap or a second tab finds.
 */
export function planTicketPurchase(input: {
  atLocationId: string;
  busy: "in_transit" | "active_action" | undefined;
  requestedShowingId: string;
  requestedTierId: string;
  nowMs: number;
  credits: number;
  /** Showings (by film and showtime) the character already holds a receipt for. */
  receipts: readonly { filmId: string; showtimeId: string }[];
  /** The character's remaining charges for each skill, absent when they have none. */
  remainingBySkill: Readonly<Record<string, number>>;
}): TicketPlan {
  if (getTheatreScreensAt(input.atLocationId).length === 0) {
    return { ok: false, reason: "not_at_theatre" };
  }
  if (input.busy) return { ok: false, reason: input.busy };
  const tier = getTheatreTicketTier(input.requestedTierId);
  if (!tier) return { ok: false, reason: "unknown_tier" };
  const showing = currentShowingsAt(input.atLocationId, input.nowMs).find(
    (candidate) => candidate.showingId === input.requestedShowingId,
  );
  if (!showing) return { ok: false, reason: "showing_changed" };
  const film = getTheatreFilm(showing.filmId);
  if (!film) return { ok: false, reason: "showing_changed" };
  if (
    input.receipts.some(
      (receipt) => receipt.filmId === showing.filmId && receipt.showtimeId === showing.showtimeId,
    )
  ) {
    return {
      ok: false,
      reason: "already_purchased",
      held: { filmId: showing.filmId, showtimeId: showing.showtimeId },
    };
  }
  if (input.credits < tier.credits) return { ok: false, reason: "insufficient_credits" };
  return {
    ok: true,
    showing,
    film,
    tier,
    topUp: topUpCharges(input.remainingBySkill[film.skillId] ?? 0, tier.capacity),
  };
}

export function ticketRefusalMessage(reason: TicketRefusalReason): string {
  switch (reason) {
    case "not_at_theatre":
      return "Tickets are sold at the Holo Drive-In.";
    case "in_transit":
      return "Arrive before buying a ticket.";
    case "active_action":
      return "Finish the active activity before buying a ticket.";
    case "unknown_tier":
      return "That ticket is not on sale.";
    case "showing_changed":
      return "That showing has ended. Check what is on now.";
    case "already_purchased":
      return "You already have a ticket for this showing.";
    case "insufficient_credits":
      return "You cannot afford that ticket.";
  }
}

/**
 * One section's or attempt's XP with a film buff's bonus applied: `ceil(baseXp * (10000 +
 * bonusBps) / 10000)` in integers (#491). Zero stays zero, so an attempt that earns nothing
 * is not made something by a buff, and a section that pays 50 pays 55 at +10%.
 */
export function applyFilmXpBonus(baseXp: number, bonusBps: number): number {
  if (!Number.isInteger(baseXp) || baseXp < 0) {
    throw new RangeError("Base XP must be a non-negative integer");
  }
  if (!Number.isInteger(bonusBps) || bonusBps < 0) {
    throw new RangeError("A film XP bonus must be a non-negative integer of basis points");
  }
  return Math.ceil((baseXp * (10_000 + bonusBps)) / 10_000);
}

/**
 * Whether a Welding film buff applies to the next completed section, and what that section
 * pays: the charge is spent only when a section actually completes and pays XP (a section that
 * pays nothing leaves the buff alone). Pure, so every Welding resolver and the Clean Pass claim
 * spend a charge by one rule.
 */
export function weldingSectionAward(input: { sectionXp: number; remainingCharges: number }): {
  xp: number;
  chargeConsumed: boolean;
} {
  if (!Number.isInteger(input.remainingCharges) || input.remainingCharges < 0) {
    throw new RangeError("Remaining charges must be a whole number of at least zero");
  }
  const buffed = input.remainingCharges > 0 && input.sectionXp > 0;
  return {
    xp: buffed ? applyFilmXpBonus(input.sectionXp, WELDING_FILM_BUFF.xpBonusBps) : input.sectionXp,
    chargeConsumed: buffed,
  };
}

/**
 * `sections` completed sections of equal worth in one window, with a film buff of
 * `remainingCharges`: the first charged sections pay the bonus, then the buff runs out
 * partway and the rest pay ordinary XP. Equivalent to calling `weldingSectionAward` once per
 * section, so a batch and one-at-a-time resolution can never disagree.
 */
export function weldingSectionsAward(input: {
  sections: number;
  sectionXp: number;
  remainingCharges: number;
}): { xp: number; chargesConsumed: number } {
  if (!Number.isInteger(input.sections) || input.sections < 0) {
    throw new RangeError("Sections must be a non-negative integer");
  }
  const buffed = input.sectionXp > 0 ? Math.min(input.sections, input.remainingCharges) : 0;
  const bonusXp =
    buffed === 0 ? 0 : applyFilmXpBonus(input.sectionXp, WELDING_FILM_BUFF.xpBonusBps);
  return {
    xp: buffed * bonusXp + (input.sections - buffed) * input.sectionXp,
    chargesConsumed: buffed,
  };
}

/**
 * Tamsyn's film-specific opening for the showing a conversation was opened at, or
 * undefined for a film the catalog does not know.
 */
export function resolveShowingOpening(filmId: string): DialogueSequence | undefined {
  const film = getTheatreFilm(filmId);
  return film ? getDialogue(film.showingDialogueId) : undefined;
}

/**
 * Startup validation: fail fast at module load so a catalog mistake never reaches a player
 * as a missing opening, a mis-priced ticket or a schedule that cannot rotate.
 */
export function validateTheatreContent(
  sequences: readonly DialogueSequence[] = DIALOGUE_SEQUENCES,
): void {
  const filmIds = new Set<string>();
  for (const film of THEATRE_FILMS) {
    const where = `Theatre film "${film.filmId}"`;
    if (filmIds.has(film.filmId)) throw new Error(`${where} is declared more than once.`);
    filmIds.add(film.filmId);
    const opening = getDialogue(film.showingDialogueId);
    if (!opening) throw new Error(`${where} names unknown dialogue "${film.showingDialogueId}".`);
    if (opening.npcId !== NPC_IDS.tamsynSuzara) {
      throw new Error(`${where} showing dialogue must be Tamsyn Suzara's.`);
    }
    if (opening.beats.length === 0 || opening.currentShowingDialogue) {
      throw new Error(`${where} showing dialogue must be ordinary beats.`);
    }
  }
  // One opening per film: two films sharing one would play the wrong film's lines.
  if (new Set(THEATRE_FILMS.map((film) => film.showingDialogueId)).size !== THEATRE_FILMS.length) {
    throw new Error("Each theatre film needs its own showing dialogue.");
  }

  const tierIds = new Set<string>();
  for (const tier of THEATRE_TICKET_TIERS) {
    const where = `Theatre ticket tier "${tier.id}"`;
    if (tierIds.has(tier.id)) throw new Error(`${where} is declared more than once.`);
    tierIds.add(tier.id);
    if (!Number.isInteger(tier.credits) || tier.credits < 1) {
      throw new Error(`${where} must cost a whole number of Credits.`);
    }
    if (!Number.isInteger(tier.capacity) || tier.capacity < 1) {
      throw new Error(`${where} must fill a whole number of charges.`);
    }
  }

  const screenIds = new Set<string>();
  for (const screen of THEATRE_SCREENS) {
    const where = `Theatre screen "${screen.id}"`;
    if (screenIds.has(screen.id)) throw new Error(`${where} is declared more than once.`);
    screenIds.add(screen.id);
    if (!Number.isInteger(screen.windowMs) || screen.windowMs < 1) {
      throw new Error(`${where} needs a whole-millisecond showing window.`);
    }
    if (screen.rotation.length === 0) throw new Error(`${where} needs at least one film.`);
    for (const filmId of screen.rotation) {
      if (!filmIds.has(filmId)) throw new Error(`${where} shows unknown film "${filmId}".`);
    }
  }

  for (const sequence of sequences) {
    if (!sequence.currentShowingDialogue) continue;
    const where = `Dialogue "${sequence.id}"`;
    if (sequence.npcId !== NPC_IDS.tamsynSuzara) {
      throw new Error(`${where} plays the current showing's opening but is not Tamsyn's.`);
    }
    if (sequence.beats.length === 0) {
      throw new Error(`${where} plays the current showing's opening and needs its own closing.`);
    }
    if (sequence.skillLevelDialogueId && getSkillLevelDialogue(sequence.skillLevelDialogueId)) {
      throw new Error(`${where} cannot combine a showing opening with a skill-level choice.`);
    }
  }
}
