import {
  DIALOGUE_IDS,
  LOCATION_IDS,
  SKILL_IDS,
  THEATRE_FILM_IDS,
  THEATRE_SCREEN_IDS,
  THEATRE_TICKET_TIER_IDS,
  type DialogueId,
  type LocationId,
  type SkillId,
  type TheatreFilmId,
  type TheatreScreenId,
  type TheatreTicketTierId,
} from "@/game/config/foundations";

/**
 * The Holo Drive-In's authored theatre content (#491): the film catalog, the ticket
 * tiers and the programme. Pure data with stable IDs; the rules that read it are in
 * `game/domain/theatre`, and the server persists receipts and buffs against these IDs.
 *
 * Not here: the films themselves (the Holo Film Studio, an independent development tool that
 * nothing shipped imports), Tamsyn's lines (`game/content/dialogue`, which this
 * catalog only points at by ID), or any gameplay effect of a buff (later slices of #491).
 */

/**
 * One film the theatre can show. A new film is one entry here plus the Tamsyn showing
 * dialogue it names; her permanent topics are never rewritten.
 */
export type TheatreFilmDefinition = {
  /** The Holo Film Studio's own film ID. */
  filmId: TheatreFilmId;
  title: string;
  /** The skill whose buff a ticket to this film grants. */
  skillId: SkillId;
  /**
   * Tamsyn's film-specific opening for her "What's showing?" topic: an ordinary
   * sequence of hers in `game/content/dialogue`. The topic plays it, then its own
   * shared closing.
   */
  showingDialogueId: DialogueId;
};

export const THEATRE_FILMS = [
  {
    filmId: THEATRE_FILM_IDS.thatMinesMine,
    title: "That Mines Mine!",
    skillId: SKILL_IDS.mining,
    showingDialogueId: DIALOGUE_IDS.tamsynShowingThatMinesMine,
  },
  {
    filmId: THEATRE_FILM_IDS.rareOrWeldDone,
    title: "Rare or Weld Done?",
    skillId: SKILL_IDS.welding,
    showingDialogueId: DIALOGUE_IDS.tamsynShowingRareOrWeldDone,
  },
] as const satisfies readonly TheatreFilmDefinition[];

/**
 * One ticket choice. `capacity` is the number of eligible completed attempts the buff
 * is filled to, never a per-attempt discount: 20 Credits for 20 and 50 for 50 are both
 * exactly one Credit an attempt. Concessions are a bundled presentation only, not an
 * Inventory item or a nutrition system.
 */
export type TheatreTicketTierDefinition = {
  id: TheatreTicketTierId;
  /** Ordinary Credits (`characters.credits`). */
  credits: number;
  /** What the matching skill buff's remaining charges are filled to. */
  capacity: number;
  includesConcessions: boolean;
};

export const THEATRE_TICKET_TIERS = [
  { id: THEATRE_TICKET_TIER_IDS.film, credits: 20, capacity: 20, includesConcessions: false },
  {
    id: THEATRE_TICKET_TIER_IDS.concessions,
    credits: 50,
    capacity: 50,
    includesConcessions: true,
  },
] as const satisfies readonly TheatreTicketTierDefinition[];

/**
 * One screen and its programme. A screen shows one film at a time for one `windowMs`
 * window aligned to the UTC epoch, so windows start on the hour: [HH:00:00, next
 * HH:00:00). The film in a window is `rotation[hourIndex % rotation.length]`, where
 * `hourIndex` counts whole UTC hours since 1970-01-01T00:00Z. That epoch is midnight,
 * so with a two-film rotation even UTC hours (00, 02, ... 22) show the first film and
 * odd hours (01, 03, ... 23) the second.
 *
 * Extra screens and personalized schedules later add entries here and a way to choose
 * the schedule per character; the receipt rule (one per character, film and showtime)
 * already does not look at the screen.
 */
export type TheatreScreenDefinition = {
  id: TheatreScreenId;
  /** The World Location the screen is at, and so where tickets are bought and films watched. */
  locationId: LocationId;
  windowMs: number;
  rotation: readonly TheatreFilmId[];
};

export const THEATRE_SCREENS: readonly TheatreScreenDefinition[] = [
  {
    id: THEATRE_SCREEN_IDS.main,
    locationId: LOCATION_IDS.holoDriveIn,
    windowMs: 60 * 60 * 1000,
    rotation: [THEATRE_FILM_IDS.thatMinesMine, THEATRE_FILM_IDS.rareOrWeldDone],
  },
];

/**
 * What a film's buff does while it has charges (#491). One charge is spent per eligible
 * completed attempt or section, in the same authoritative resolution that earns the effect.
 *
 * - Mining (That Mines Mine!): `xpBonusBps` is ADDED to the worn Legendary gear's Mining XP
 *   bonus (500 each) and the sum is rounded once per attempt, over the attempt's primary and
 *   retained secondary-find XP together. It does not change the success chance, the yield or
 *   the speed. The same charge also grants the one blank-secondary bonus roll (see
 *   `resolveMining`): a successful extraction whose first secondary roll found nothing rolls
 *   the source's whole, unchanged table once more.
 * - Welding (Rare or Weld Done?): `xpBonusBps` applies to each completed XP-paying section's
 *   own XP (Practice, repairs, Work Orders and a successfully claimed Clean Pass section),
 *   rounded up per section: 50 -> 55 and Practice's 10 -> 11. No section-time reduction, no
 *   material discount, nothing for Missions, turn-ins or any other XP.
 */
export const MINING_FILM_BUFF = { xpBonusBps: 500 } as const;
export const WELDING_FILM_BUFF = { xpBonusBps: 1_000 } as const;

export function getTheatreFilm(filmId: string): TheatreFilmDefinition | undefined {
  return THEATRE_FILMS.find((film) => film.filmId === filmId);
}

export function getTheatreTicketTier(tierId: string): TheatreTicketTierDefinition | undefined {
  return THEATRE_TICKET_TIERS.find((tier) => tier.id === tierId);
}

export function getTheatreScreen(screenId: string): TheatreScreenDefinition | undefined {
  return THEATRE_SCREENS.find((screen) => screen.id === screenId);
}

/** The screens at one World Location, in authored order. */
export function getTheatreScreensAt(locationId: string): readonly TheatreScreenDefinition[] {
  return THEATRE_SCREENS.filter((screen) => screen.locationId === locationId);
}
