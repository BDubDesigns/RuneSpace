import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DIALOGUE_IDS,
  EXPRESSION_IDS,
  LOCATION_IDS,
  NPC_IDS,
  SKILL_IDS,
  THEATRE_FILM_IDS,
  THEATRE_SCREEN_IDS,
  THEATRE_TICKET_TIER_IDS,
} from "@/game/config/foundations";
import { DIALOGUE_SEQUENCES, getDialogue, type DialogueSequence } from "@/game/content/dialogue";
import {
  getTheatreFilm,
  getTheatreScreen,
  getTheatreScreensAt,
  getTheatreTicketTier,
  THEATRE_FILMS,
  THEATRE_SCREENS,
  THEATRE_TICKET_TIERS,
} from "@/game/content/theatre";
import {
  composePresentedDialogue,
  resolvePresentedDialogue,
} from "@/game/domain/skill-level-dialogue";
import {
  currentShowingsAt,
  nextShowingAt,
  planTicketPurchase,
  projectTheatreProgramme,
  resolveShowingFilmId,
  resolveShowingOpening,
  showingAt,
  showtimeIdAt,
  ticketRefusalMessage,
  topUpCharges,
  validateTheatreContent,
  type TicketRefusalReason,
} from "@/game/domain/theatre";

/**
 * Issue #491, slice 2 — the Holo Drive-In's pure rules: the UTC schedule, the top-up, the
 * purchase decision, the catalog and Tamsyn's film-specific dialogue. Everything here is
 * derived without PostgreSQL or a browser; the transaction itself, its atomicity and its
 * concurrency are proven against real PostgreSQL in tests/integration/theatre-tickets.test.ts.
 */

const HOUR = 60 * 60 * 1000;
const screen = getTheatreScreen(THEATRE_SCREEN_IDS.main)!;
const mines = THEATRE_FILM_IDS.thatMinesMine;
const weld = THEATRE_FILM_IDS.rareOrWeldDone;
const at = (iso: string) => Date.parse(iso);

describe("the authoritative schedule", () => {
  it("shows That Mines Mine! in even UTC hours and Rare or Weld Done? in odd ones, all day", () => {
    const midnight = at("2026-11-06T00:00:00.000Z");
    for (let hour = 0; hour < 24; hour += 1) {
      const showing = showingAt(screen, midnight + hour * HOUR + 12 * 60 * 1000);
      expect(showing.filmId, `${hour}:12 UTC`).toBe(hour % 2 === 0 ? mines : weld);
      expect(new Date(showing.startsAtMs).getUTCHours()).toBe(hour);
    }
  });

  it("holds even and odd across month, year, leap day and 1970 boundaries", () => {
    for (const iso of [
      "1970-01-01T00:30:00.000Z",
      "2024-02-29T05:30:00.000Z",
      "2026-12-31T23:59:59.999Z",
      "2027-01-01T00:00:00.000Z",
      "2038-01-19T03:14:07.000Z",
    ]) {
      const ms = at(iso);
      expect(showingAt(screen, ms).filmId, iso).toBe(
        new Date(ms).getUTCHours() % 2 === 0 ? mines : weld,
      );
    }
    // An instant before the epoch still rotates deterministically.
    expect(showingAt(screen, -1).filmId).toBe(weld);
    expect(showingAt(screen, -HOUR - 1).filmId).toBe(mines);
  });

  it("is half-open: HH:00:00.000 is the incoming showing, HH:59:59.999 the outgoing one", () => {
    const boundary = at("2026-11-06T19:00:00.000Z");
    const outgoing = showingAt(screen, boundary - 1);
    const incoming = showingAt(screen, boundary);
    expect(outgoing.filmId).toBe(mines);
    expect(incoming.filmId).toBe(weld);
    expect(outgoing.endsAtMs).toBe(boundary);
    expect(incoming.startsAtMs).toBe(boundary);
    expect(outgoing.showtimeId).not.toBe(incoming.showtimeId);
    // Every instant of a window is one showing, whole.
    for (const offset of [0, 1, 999, 60_000, HOUR - 1]) {
      expect(showingAt(screen, at("2026-11-06T18:00:00.000Z") + offset)).toEqual(
        showingAt(screen, at("2026-11-06T18:00:00.000Z")),
      );
    }
  });

  it("gives every showing a stable, canonical identity that names the interval, not the screen", () => {
    const showing = showingAt(screen, at("2026-11-06T18:30:00.000Z"));
    expect(showing.showtimeId).toBe("2026-11-06T18:00:00.000Z");
    expect(showing.showtimeId).toBe(showtimeIdAt(showing.startsAtMs));
    expect(showing.screenId).toBe(THEATRE_SCREEN_IDS.main);
    expect(showing.showingId).toBe(`${THEATRE_SCREEN_IDS.main}@2026-11-06T18:00:00.000Z`);
    // The same instant always yields the same identity: the server authors it, never the client.
    expect(showingAt(screen, at("2026-11-06T18:59:00.000Z")).showingId).toBe(showing.showingId);
    expect(showing.endsAtMs - showing.startsAtMs).toBe(HOUR);
  });

  it("names Up Next as the showing that starts where this one ends", () => {
    const now = showingAt(screen, at("2026-11-06T18:30:00.000Z"));
    const next = nextShowingAt(screen, at("2026-11-06T18:30:00.000Z"));
    expect(next.startsAtMs).toBe(now.endsAtMs);
    expect(next.filmId).toBe(weld);
    expect(nextShowingAt(screen, at("2026-11-06T23:59:59.999Z")).filmId).toBe(mines);
    expect(nextShowingAt(screen, at("2026-11-06T23:59:59.999Z")).showtimeId).toBe(
      "2026-11-07T00:00:00.000Z",
    );
  });

  it("refuses a non-finite instant rather than inventing a showing", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => showingAt(screen, bad)).toThrow(RangeError);
      expect(() => nextShowingAt(screen, bad)).toThrow(RangeError);
    }
  });

  it("has exactly one screen, at the Holo Drive-In, and none anywhere else", () => {
    expect(THEATRE_SCREENS).toHaveLength(1);
    expect(screen.locationId).toBe(LOCATION_IDS.holoDriveIn);
    expect(screen.windowMs).toBe(HOUR);
    expect(getTheatreScreensAt(LOCATION_IDS.holoDriveIn)).toEqual([screen]);
    expect(getTheatreScreensAt(LOCATION_IDS.holoHollow)).toEqual([]);
    expect(currentShowingsAt(LOCATION_IDS.holoHollow, at("2026-11-06T18:00:00.000Z"))).toEqual([]);
    expect(currentShowingsAt(LOCATION_IDS.holoDriveIn, at("2026-11-06T18:00:00.000Z"))).toEqual([
      showingAt(screen, at("2026-11-06T18:00:00.000Z")),
    ]);
  });

  it("projects every screen's current and next showing as serializable ISO strings", () => {
    const projection = projectTheatreProgramme(at("2026-11-06T18:30:00.000Z"));
    expect(projection.screens).toHaveLength(1);
    expect(projection.screens[0]).toEqual({
      screenId: THEATRE_SCREEN_IDS.main,
      locationId: LOCATION_IDS.holoDriveIn,
      now: {
        showingId: `${THEATRE_SCREEN_IDS.main}@2026-11-06T18:00:00.000Z`,
        showtimeId: "2026-11-06T18:00:00.000Z",
        screenId: THEATRE_SCREEN_IDS.main,
        filmId: mines,
        startsAt: "2026-11-06T18:00:00.000Z",
        endsAt: "2026-11-06T19:00:00.000Z",
      },
      next: {
        showingId: `${THEATRE_SCREEN_IDS.main}@2026-11-06T19:00:00.000Z`,
        showtimeId: "2026-11-06T19:00:00.000Z",
        screenId: THEATRE_SCREEN_IDS.main,
        filmId: weld,
        startsAt: "2026-11-06T19:00:00.000Z",
        endsAt: "2026-11-06T20:00:00.000Z",
      },
    });
    expect(JSON.parse(JSON.stringify(projection))).toEqual(projection);
  });

  it("is ready for more screens: a second screen is data, and a shared film and showtime share one identity", () => {
    const second = {
      ...screen,
      id: "holo_drive_in_second" as typeof screen.id,
      rotation: [mines, weld] as const,
    };
    const first = showingAt(screen, at("2026-11-06T18:30:00.000Z"));
    const other = showingAt(second, at("2026-11-06T18:30:00.000Z"));
    expect(other.showingId).not.toBe(first.showingId);
    expect(other.showtimeId).toBe(first.showtimeId);
    expect(other.filmId).toBe(first.filmId);
  });
});

describe("the buff top-up", () => {
  it.each([
    // remaining, capacity, after, added, outcome
    [0, 20, 20, 20, "fills"],
    [0, 50, 50, 50, "fills"],
    [5, 20, 20, 15, "tops_up"],
    [30, 50, 50, 20, "tops_up"],
    [30, 20, 30, 0, "adds_none"],
    [20, 20, 20, 0, "adds_none"],
    [50, 20, 50, 0, "adds_none"],
    [50, 50, 50, 0, "adds_none"],
    [200, 50, 200, 0, "adds_none"],
  ] as const)(
    "%i remaining + a %i ticket -> %i (adds %i, %s)",
    (remaining, capacity, after, added, outcome) => {
      expect(topUpCharges(remaining, capacity)).toEqual({
        remainingBefore: remaining,
        remainingAfter: after,
        added,
        outcome,
      });
    },
  );

  it("never sums and never reduces what was already bought", () => {
    for (let remaining = 0; remaining <= 80; remaining += 1) {
      for (const capacity of [20, 50]) {
        const result = topUpCharges(remaining, capacity);
        expect(result.remainingAfter).toBe(Math.max(remaining, capacity));
        expect(result.remainingAfter).toBeGreaterThanOrEqual(remaining);
        expect(result.added).toBe(result.remainingAfter - remaining);
      }
    }
  });

  it("rejects values that could not be a balance or a capacity", () => {
    for (const bad of [-1, 1.5, Number.NaN]) {
      expect(() => topUpCharges(bad, 20)).toThrow(RangeError);
    }
    for (const bad of [0, -5, 2.5, Number.NaN]) {
      expect(() => topUpCharges(5, bad)).toThrow(RangeError);
    }
  });
});

describe("the ticket purchase decision", () => {
  const NOW = at("2026-11-06T18:30:00.000Z");
  const minesShowing = showingAt(screen, NOW);
  const base = {
    atLocationId: LOCATION_IDS.holoDriveIn,
    busy: undefined as "in_transit" | "active_action" | undefined,
    requestedShowingId: minesShowing.showingId,
    requestedTierId: THEATRE_TICKET_TIER_IDS.film as string,
    nowMs: NOW,
    credits: 100,
    receipts: [] as { filmId: string; showtimeId: string }[],
    remainingBySkill: {} as Record<string, number>,
  };
  const refusal = (overrides: Partial<typeof base>): TicketRefusalReason | "ok" => {
    const plan = planTicketPurchase({ ...base, ...overrides });
    return plan.ok ? "ok" : plan.reason;
  };

  it("sells the current showing's ticket and says what it does to the buff", () => {
    const plan = planTicketPurchase(base);
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;
    expect(plan.showing).toEqual(minesShowing);
    expect(plan.film.filmId).toBe(mines);
    expect(plan.film.skillId).toBe(SKILL_IDS.mining);
    expect(plan.tier.credits).toBe(20);
    expect(plan.topUp).toEqual({
      remainingBefore: 0,
      remainingAfter: 20,
      added: 20,
      outcome: "fills",
    });
  });

  it("grants the Welding buff for the Welding film and reads only that skill's balance", () => {
    const welding = showingAt(screen, at("2026-11-06T19:30:00.000Z"));
    const plan = planTicketPurchase({
      ...base,
      nowMs: at("2026-11-06T19:30:00.000Z"),
      requestedShowingId: welding.showingId,
      requestedTierId: THEATRE_TICKET_TIER_IDS.concessions,
      // A full Mining buff does not touch the Welding top-up.
      remainingBySkill: { [SKILL_IDS.mining]: 50 },
    });
    expect(plan.ok && plan.film.skillId).toBe(SKILL_IDS.welding);
    expect(plan.ok && plan.topUp).toEqual({
      remainingBefore: 0,
      remainingAfter: 50,
      added: 50,
      outcome: "fills",
    });
  });

  it("reports a ticket that adds nothing, and does not refuse it", () => {
    const plan = planTicketPurchase({
      ...base,
      remainingBySkill: { [SKILL_IDS.mining]: 30 },
    });
    expect(plan.ok && plan.topUp).toEqual({
      remainingBefore: 30,
      remainingAfter: 30,
      added: 0,
      outcome: "adds_none",
    });
  });

  it("refuses with one reason per fact, in the order a player would want to hear it", () => {
    expect(refusal({ atLocationId: LOCATION_IDS.holoHollow })).toBe("not_at_theatre");
    expect(refusal({ busy: "in_transit" })).toBe("in_transit");
    expect(refusal({ busy: "active_action" })).toBe("active_action");
    expect(refusal({ requestedTierId: "film_ticket_plus" })).toBe("unknown_tier");
    expect(refusal({ requestedShowingId: "nonsense" })).toBe("showing_changed");
    expect(refusal({ credits: 19 })).toBe("insufficient_credits");
    expect(refusal({ credits: 20 })).toBe("ok");
    expect(refusal({ requestedTierId: THEATRE_TICKET_TIER_IDS.concessions, credits: 49 })).toBe(
      "insufficient_credits",
    );
    // Place before busy before tier before showing before receipt before money.
    expect(
      refusal({
        atLocationId: LOCATION_IDS.holoHollow,
        busy: "in_transit",
        requestedTierId: "nope",
        credits: 0,
      }),
    ).toBe("not_at_theatre");
    expect(refusal({ busy: "in_transit", requestedTierId: "nope", credits: 0 })).toBe("in_transit");
    expect(refusal({ requestedTierId: "nope", requestedShowingId: "x", credits: 0 })).toBe(
      "unknown_tier",
    );
    expect(
      refusal({
        requestedShowingId: "x",
        credits: 0,
        receipts: [{ filmId: mines, showtimeId: minesShowing.showtimeId }],
      }),
    ).toBe("showing_changed");
    expect(
      refusal({ credits: 0, receipts: [{ filmId: mines, showtimeId: minesShowing.showtimeId }] }),
    ).toBe("already_purchased");
  });

  it("gives every refusal a plain message", () => {
    for (const reason of [
      "not_at_theatre",
      "in_transit",
      "active_action",
      "unknown_tier",
      "showing_changed",
      "already_purchased",
      "insufficient_credits",
    ] as const) {
      expect(ticketRefusalMessage(reason).length).toBeGreaterThan(10);
    }
  });

  it("is one receipt per character, actual film and canonical showtime", () => {
    const held = { filmId: mines, showtimeId: minesShowing.showtimeId };
    const plan = planTicketPurchase({ ...base, receipts: [held] });
    expect(plan).toEqual({ ok: false, reason: "already_purchased", held });
    // A tier upgrade or downgrade in the same showing is the same refusal.
    for (const tierId of [THEATRE_TICKET_TIER_IDS.film, THEATRE_TICKET_TIER_IDS.concessions]) {
      expect(refusal({ requestedTierId: tierId, receipts: [held] })).toBe("already_purchased");
    }
    // A different film in the same showtime (a future concurrent screen) is independent.
    expect(refusal({ receipts: [{ filmId: weld, showtimeId: minesShowing.showtimeId }] })).toBe(
      "ok",
    );
    // The same film in a later showtime is a new opportunity.
    expect(refusal({ receipts: [{ filmId: mines, showtimeId: "2026-11-06T16:00:00.000Z" }] })).toBe(
      "ok",
    );
    // A second screen carrying the same film in the same window is still the same claim: the
    // key is the film and the showtime, so a showing on any screen finds the same receipt.
    expect(refusal({ receipts: [{ ...held }] })).toBe("already_purchased");
  });

  it("belongs the exact boundary instant to the incoming showing only", () => {
    const boundary = at("2026-11-06T19:00:00.000Z");
    const outgoing = showingAt(screen, boundary - 1);
    const incoming = showingAt(screen, boundary);
    // The last millisecond before the hour sells the outgoing film.
    const last = planTicketPurchase({
      ...base,
      nowMs: boundary - 1,
      requestedShowingId: outgoing.showingId,
    });
    expect(last.ok && last.film.filmId).toBe(mines);
    // At the boundary the outgoing showing is gone: a stale request is refused, never
    // silently bought as the incoming film...
    expect(
      planTicketPurchase({ ...base, nowMs: boundary, requestedShowingId: outgoing.showingId }),
    ).toEqual({ ok: false, reason: "showing_changed" });
    // ...and the incoming showing is the one on sale.
    const first = planTicketPurchase({
      ...base,
      nowMs: boundary,
      requestedShowingId: incoming.showingId,
    });
    expect(first.ok && first.film.filmId).toBe(weld);
    // Naming the incoming showing a millisecond early is just as stale.
    expect(
      planTicketPurchase({ ...base, nowMs: boundary - 1, requestedShowingId: incoming.showingId }),
    ).toEqual({ ok: false, reason: "showing_changed" });
  });
});

describe("the film catalog and its tickets", () => {
  it("validates at module load, and again here", () => {
    expect(() => validateTheatreContent()).not.toThrow();
    expect(() => validateTheatreContent(DIALOGUE_SEQUENCES)).not.toThrow();
  });

  it("registers exactly the two launch films, each tied to its skill and its own Tamsyn opening", () => {
    expect(THEATRE_FILMS.map((film) => film.filmId)).toEqual([mines, weld]);
    expect(getTheatreFilm(mines)).toMatchObject({
      title: "That Mines Mine!",
      skillId: SKILL_IDS.mining,
      showingDialogueId: DIALOGUE_IDS.tamsynShowingThatMinesMine,
    });
    expect(getTheatreFilm(weld)).toMatchObject({
      title: "Rare or Weld Done?",
      skillId: SKILL_IDS.welding,
      showingDialogueId: DIALOGUE_IDS.tamsynShowingRareOrWeldDone,
    });
    expect(getTheatreFilm("template")).toBeUndefined();
    for (const film of THEATRE_FILMS) {
      const opening = getDialogue(film.showingDialogueId);
      expect(opening?.npcId).toBe(NPC_IDS.tamsynSuzara);
      expect(opening?.currentShowingDialogue).toBeUndefined();
    }
  });

  it("restates the Holo Film Studio's own film IDs, and the studio still registers them", () => {
    const registry = readFileSync(
      join(process.cwd(), "tools/holo-film-studio/src/films/index.js"),
      "utf8",
    );
    const studioIds = [...registry.matchAll(/\{ id: '([a-z0-9-]+)'/g)].map((match) => match[1]);
    for (const film of THEATRE_FILMS) expect(studioIds).toContain(film.filmId);
    // The launch programme shows only the two authored films, never the hidden template.
    expect(Object.values(THEATRE_FILM_IDS).sort()).toEqual(
      [...THEATRE_FILMS.map((f) => f.filmId)].sort(),
    );
    expect(screen.rotation.every((id) => studioIds.includes(id))).toBe(true);
  });

  it("sells two ordinary-Credit tickets at exactly one Credit an attempt", () => {
    expect(THEATRE_TICKET_TIERS).toHaveLength(2);
    expect(getTheatreTicketTier(THEATRE_TICKET_TIER_IDS.film)).toEqual({
      id: THEATRE_TICKET_TIER_IDS.film,
      name: "Film Ticket",
      credits: 20,
      capacity: 20,
      includesConcessions: false,
    });
    expect(getTheatreTicketTier(THEATRE_TICKET_TIER_IDS.concessions)).toEqual({
      id: THEATRE_TICKET_TIER_IDS.concessions,
      name: "Ticket + Concessions",
      credits: 50,
      capacity: 50,
      includesConcessions: true,
    });
    // The combo is a larger package, never a per-attempt discount.
    for (const tier of THEATRE_TICKET_TIERS) expect(tier.credits).toBe(tier.capacity);
    expect(getTheatreTicketTier("vip")).toBeUndefined();
  });

  it("rejects a malformed catalog entry at startup", () => {
    const wrongNpc: DialogueSequence = {
      ...getDialogue(DIALOGUE_IDS.tamsynWhatsShowingTopic)!,
      npcId: NPC_IDS.wadeRusk,
    };
    expect(() => validateTheatreContent([wrongNpc])).toThrow(/not Tamsyn's/);
    const beatless: DialogueSequence = {
      ...getDialogue(DIALOGUE_IDS.tamsynWhatsShowingTopic)!,
      beats: [],
    };
    expect(() => validateTheatreContent([beatless])).toThrow(/own closing/);
  });
});

describe("Tamsyn's What's showing? dialogue", () => {
  const topic = DIALOGUE_IDS.tamsynWhatsShowingTopic;
  const beats = (sequence: DialogueSequence | undefined) =>
    (sequence?.beats ?? []).map((beat) =>
      beat.kind === "npc"
        ? { expression: beat.expressionId, text: beat.text, speaker: beat.speakerNpcId }
        : { kind: beat.kind },
    );

  const sharedClosing = [
    {
      expression: EXPRESSION_IDS.neutral,
      text: "Tickets are 20 Credits, or 50 with concessions. That's 20 or 50 attempts with the bonus, whichever you choose. We change pictures every hour.",
    },
    {
      expression: EXPRESSION_IDS.welcoming,
      text: "And the bonus comes with your ticket, so you don't have to watch the whole thing. Though I'd certainly love it if you stayed.",
    },
  ];

  it("plays the Mining opening verbatim for That Mines Mine!, then the shared closing", () => {
    const played = resolvePresentedDialogue(topic, {}, mines);
    expect(beats(played).map(({ expression, text }) => ({ expression, text }))).toEqual([
      {
        expression: EXPRESSION_IDS.welcoming,
        text: "Right now we've got That Mines Mine! on the screen. A classic! Well, by my standards, anyway.",
      },
      {
        expression: EXPRESSION_IDS.amused,
        text: "Some of the rocks give better performances than the actors. But don't tell anybody I said that.",
      },
      {
        expression: EXPRESSION_IDS.welcoming,
        text: "It's a good one for miners, too. A little extra experience, and another shot at finding something special when a successful haul comes up empty on the extras.",
      },
      ...sharedClosing,
    ]);
  });

  it("plays the Welding opening verbatim for Rare or Weld Done?, then the same closing", () => {
    const played = resolvePresentedDialogue(topic, {}, weld);
    expect(beats(played).map(({ expression, text }) => ({ expression, text }))).toEqual([
      {
        expression: EXPRESSION_IDS.welcoming,
        text: "Tonight's feature is Rare or Weld Done? Wonderful picture. Sparks, suspense, and some truly questionable craftsmanship.",
      },
      { expression: EXPRESSION_IDS.amused, text: "At least the welding looks convincing. Mostly." },
      {
        expression: EXPRESSION_IDS.welcoming,
        text: "And it's good for your own welding! A little extra experience for each section you finish, including those lovely Clean Passes.",
      },
      ...sharedClosing,
    ]);
  });

  it("changes expression with each beat's emotion, in the owner's order", () => {
    const expressions = (filmId: string) =>
      beats(resolvePresentedDialogue(topic, {}, filmId)).map((beat) =>
        "expression" in beat ? beat.expression : undefined,
      );
    const expected = [
      EXPRESSION_IDS.welcoming,
      EXPRESSION_IDS.amused,
      EXPRESSION_IDS.welcoming,
      EXPRESSION_IDS.neutral,
      EXPRESSION_IDS.welcoming,
    ];
    expect(expressions(mines)).toEqual(expected);
    expect(expressions(weld)).toEqual(expected);
  });

  it("is spoken entirely by Tamsyn, against her concession stand, in the local presentation", () => {
    for (const filmId of [mines, weld]) {
      const played = resolvePresentedDialogue(topic, {}, filmId)!;
      expect(played.npcId).toBe(NPC_IDS.tamsynSuzara);
      for (const beat of played.beats) {
        expect(beat.kind).toBe("npc");
        if (beat.kind !== "npc") continue;
        expect(beat.speakerNpcId).toBe(NPC_IDS.tamsynSuzara);
        expect(beat.presentationMode).toBe("local");
        expect(beat.text).not.toMatch(/—/);
        expect(beat.text).not.toMatch(/\bTamsy\b/);
      }
    }
  });

  it("keeps its ticket numbers true to the ticket tiers and its hourly rhythm true to the schedule", () => {
    const [film, concessions] = THEATRE_TICKET_TIERS;
    const closing = (getDialogue(topic)!.beats[0] as { text: string }).text;
    expect(closing).toContain(
      `Tickets are ${film.credits} Credits, or ${concessions.credits} with concessions.`,
    );
    expect(closing).toContain(`${film.capacity} or ${concessions.capacity} attempts`);
    expect(closing).toContain("We change pictures every hour.");
    expect(screen.windowMs).toBe(HOUR);
  });

  it("plays only its own closing when no film is named, never nothing", () => {
    const played = resolvePresentedDialogue(topic, {});
    expect(beats(played).map((beat) => ("text" in beat ? beat.text : ""))).toEqual(
      sharedClosing.map((beat) => beat.text),
    );
    expect(resolvePresentedDialogue(topic, {}, "template")?.beats).toHaveLength(2);
  });

  it("changes nothing for any other sequence, whatever film is named", () => {
    const projector = DIALOGUE_IDS.tamsynAboutTheProjectorTopic;
    expect(resolvePresentedDialogue(projector, {}, mines)).toEqual(getDialogue(projector));
    expect(resolvePresentedDialogue(projector, {})).toEqual(getDialogue(projector));
  });

  it("composes with a continuation as one scene, the opening first", () => {
    const composed = composePresentedDialogue(
      [topic, DIALOGUE_IDS.tamsynAboutTheProjectorTopic],
      {},
      weld,
    );
    expect(composed?.beats).toHaveLength(5 + 3);
    expect((composed?.beats[0] as { text: string }).text).toMatch(/Rare or Weld Done\?/);
  });

  it("uses a film's opening only for that film: two films never share one", () => {
    expect(resolveShowingOpening(mines)?.id).toBe(DIALOGUE_IDS.tamsynShowingThatMinesMine);
    expect(resolveShowingOpening(weld)?.id).toBe(DIALOGUE_IDS.tamsynShowingRareOrWeldDone);
    expect(resolveShowingOpening("template")).toBeUndefined();
    expect(resolveShowingOpening(mines)?.beats).toHaveLength(3);
    expect(resolveShowingOpening(weld)?.beats).toHaveLength(3);
  });
});

describe("choosing the film Tamsyn speaks about when the topic is opened", () => {
  const hollow = LOCATION_IDS.holoHollow;
  const driveIn = LOCATION_IDS.holoDriveIn;
  const projected = projectTheatreProgramme(at("2026-11-06T18:30:00.000Z"));

  it("reads the authoritative projection while it is current", () => {
    expect(resolveShowingFilmId(projected, driveIn, at("2026-11-06T18:30:00.000Z"))).toBe(mines);
    expect(resolveShowingFilmId(projected, driveIn, at("2026-11-06T18:00:00.000Z"))).toBe(mines);
    expect(resolveShowingFilmId(projected, driveIn, at("2026-11-06T18:59:59.999Z"))).toBe(mines);
  });

  it("falls back to the same schedule rule once the projection has run out, never yesterday's film", () => {
    expect(resolveShowingFilmId(projected, driveIn, at("2026-11-06T19:00:00.000Z"))).toBe(weld);
    expect(resolveShowingFilmId(projected, driveIn, at("2026-11-06T20:00:00.000Z"))).toBe(mines);
    expect(resolveShowingFilmId(undefined, driveIn, at("2026-11-06T19:30:00.000Z"))).toBe(weld);
    // A clock that has not caught up to the projection's start still gets the true showing.
    expect(resolveShowingFilmId(projected, driveIn, at("2026-11-06T17:30:00.000Z"))).toBe(weld);
  });

  it("has nothing to say where there is no screen", () => {
    expect(resolveShowingFilmId(projected, hollow, at("2026-11-06T18:30:00.000Z"))).toBeUndefined();
  });

  it("is read once: the conversation keeps the opening it started with across a turnover", () => {
    // The surface calls resolveShowingFilmId when the topic is opened and passes that film on
    // every render after. Opened in the last second of the Mining hour, the Mining opening
    // keeps playing even though the next render happens in the Welding hour.
    const opened = resolveShowingFilmId(projected, driveIn, at("2026-11-06T18:59:59.000Z"));
    expect(opened).toBe(mines);
    const later = at("2026-11-06T19:00:05.000Z");
    expect(resolveShowingFilmId(projected, driveIn, later)).toBe(weld);
    const kept = resolvePresentedDialogue(DIALOGUE_IDS.tamsynWhatsShowingTopic, {}, opened);
    expect((kept?.beats[0] as { text: string }).text).toMatch(/That Mines Mine!/);
    // Reopening after the turnover picks the new film.
    const reopened = resolveShowingFilmId(projected, driveIn, later);
    expect(
      (
        resolvePresentedDialogue(DIALOGUE_IDS.tamsynWhatsShowingTopic, {}, reopened)?.beats[0] as {
          text: string;
        }
      ).text,
    ).toMatch(/Rare or Weld Done\?/);
  });
});
