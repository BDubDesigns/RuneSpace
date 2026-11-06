import { describe, expect, it } from "vitest";
import {
  LOCATION_IDS,
  SKILL_IDS,
  THEATRE_FILM_IDS,
  THEATRE_PRE_ROLL_AD_IDS,
  THEATRE_SCREEN_IDS,
  THEATRE_TICKET_TIER_IDS,
} from "@/game/config/foundations";
import {
  getTheatreFilm,
  getTheatreScreen,
  getTheatreTicketTier,
  isTheatreFilmId,
  PRE_ROLL_DURATION_MS,
  THEATRE_COPY,
  THEATRE_PRE_ROLL_SLOTS,
  theatreViewerReady,
} from "@/game/content/theatre";
import {
  describeTicketOffer,
  displayedShowings,
  formatCountdown,
  projectTheatreProgramme,
  planViewing,
  selectPreRollSlot,
  ticketLabel,
  viewerEntry,
  viewingRefusalMessage,
  type LatestTicketProjection,
} from "@/game/domain/theatre";
import {
  filmControlsActive,
  initialViewerState,
  preRollPercent,
  shouldSuggestLandscape,
  viewerReducer,
  type ViewerEvent,
  type ViewerState,
} from "@/features/theatre/viewer-machine";

/**
 * Issue #491, slice 4 — the player-facing theatre's pure rules: the approved copy, the ticket
 * confirmation's before/after and zero-added statements, the viewer entry label, the countdown,
 * the random pre-roll draw, the server's viewing decision and the viewer's lifecycle machine.
 * The panel, the player and the fullscreen behaviour need a browser and are covered by
 * tests/e2e/holo-drive-in-theatre.spec.ts; the server transactions by
 * tests/integration/theatre-ui.test.ts.
 */

const mining = getTheatreFilm(THEATRE_FILM_IDS.thatMinesMine)!;
const welding = getTheatreFilm(THEATRE_FILM_IDS.rareOrWeldDone)!;
const filmTier = getTheatreTicketTier(THEATRE_TICKET_TIER_IDS.film)!;
const concessionsTier = getTheatreTicketTier(THEATRE_TICKET_TIER_IDS.concessions)!;

const ticket: LatestTicketProjection = {
  receiptId: "receipt-1",
  filmId: THEATRE_FILM_IDS.thatMinesMine,
  showtimeId: "2026-11-06T10:00:00.000Z",
  tierId: THEATRE_TICKET_TIER_IDS.film,
  purchasedAt: "2026-11-06T10:15:00.000Z",
};

describe("the owner-approved copy", () => {
  it("is exactly the approved labels and short ticket explanation", () => {
    expect(THEATRE_COPY).toEqual({
      sectionHeading: "The Big Screen",
      nowShowing: "Now Showing",
      upNext: "Up Next",
      nextShowingIn: "Next showing in",
      watchFilm: "Watch Film",
      replayLastFilm: "Replay Last Film",
      close: "Close",
      ticketExplanation:
        "Your skill bonus starts when you buy your ticket. Stay for the picture, or head back to work. You get the buffed attempts either way.",
    });
    expect(ticketLabel(filmTier)).toBe("Film Ticket: 20 Credits");
    expect(ticketLabel(concessionsTier)).toBe("Ticket + Concessions: 50 Credits");
  });

  it("uses no em dash anywhere in the player-facing copy", () => {
    const text = [
      ...Object.values(THEATRE_COPY),
      ticketLabel(filmTier),
      ticketLabel(concessionsTier),
      ...[filmTier, concessionsTier].flatMap((tier) =>
        [mining, welding].map(
          (film) => describeTicketOffer({ tier, film, remaining: 7, credits: 100 }).warning ?? "",
        ),
      ),
      ...(["not_at_theatre", "in_transit", "no_ticket", "unavailable"] as const).map(
        viewingRefusalMessage,
      ),
    ].join("\n");
    expect(text).not.toMatch(/—/);
  });
});

describe("the ticket confirmation shown before anything is charged", () => {
  it("states the Credits and the buff before and after for a fresh buff, with no warning", () => {
    const offer = describeTicketOffer({ tier: filmTier, film: mining, remaining: 0, credits: 120 });
    expect(offer).toMatchObject({
      label: "Film Ticket: 20 Credits",
      credits: 20,
      creditsAfter: 100,
      affordable: true,
      skillName: "Mining",
      summary: "Mining bonus attempts: 0 to 20",
    });
    expect(offer.topUp).toMatchObject({ outcome: "fills", added: 20 });
    expect(offer.warning).toBeUndefined();
  });

  it("warns, with the current and the new count, whenever the same skill's buff has attempts left", () => {
    const offer = describeTicketOffer({ tier: filmTier, film: welding, remaining: 5, credits: 40 });
    expect(offer.summary).toBe("Welding bonus attempts: 5 to 20");
    expect(offer.topUp).toMatchObject({ outcome: "tops_up", added: 15 });
    expect(offer.warning).toContain("You already have 5 Welding bonus attempts");
    expect(offer.warning).toContain("raises your bonus to 20, adding 15 rather than 20");
  });

  it("says plainly that a ticket adds zero attempts, without calling the player ineligible", () => {
    const offer = describeTicketOffer({
      tier: filmTier,
      film: mining,
      remaining: 30,
      credits: 500,
    });
    expect(offer.topUp).toMatchObject({ outcome: "adds_none", added: 0, remainingAfter: 30 });
    expect(offer.summary).toBe("Mining bonus attempts: 30 to 30");
    expect(offer.warning).toContain("adds none, so your bonus stays at 30");
    expect(offer.warning).toContain("You can still buy it for this showing");
    expect(offer.warning).not.toMatch(/ineligible|cannot|can't|not allowed/i);
  });

  it("says the 50-Credit combo tops up to 50 rather than adding 50", () => {
    const offer = describeTicketOffer({
      tier: concessionsTier,
      film: mining,
      remaining: 30,
      credits: 500,
    });
    expect(offer.topUp).toMatchObject({ outcome: "tops_up", added: 20, remainingAfter: 50 });
    expect(offer.warning).toContain("adding 20 rather than 50");
    expect(offer.warning).toContain("they do not add to it");
  });

  it("reports an unaffordable ticket and never a negative balance", () => {
    const offer = describeTicketOffer({
      tier: concessionsTier,
      film: mining,
      remaining: 0,
      credits: 30,
    });
    expect(offer.affordable).toBe(false);
    expect(offer.creditsAfter).toBe(0);
  });

  it("matches the server's own top-up for every balance and tier (one rule, not two)", () => {
    for (const tier of [filmTier, concessionsTier]) {
      for (const remaining of [0, 1, 19, 20, 21, 49, 50, 51, 200]) {
        const offer = describeTicketOffer({ tier, film: mining, remaining, credits: 999 });
        expect(offer.topUp.remainingAfter).toBe(Math.max(remaining, tier.capacity));
        expect(offer.topUp.added).toBe(offer.topUp.remainingAfter - remaining);
        expect(offer.warning === undefined).toBe(remaining === 0);
      }
    }
  });
});

describe("the viewer entry", () => {
  const showtime = "2026-11-06T10:00:00.000Z";

  it("offers nothing to a character who has never bought a ticket", () => {
    expect(viewerEntry(undefined, showtime)).toBeUndefined();
  });

  it("is Watch Film while the ticket is for the showing on now", () => {
    expect(viewerEntry(ticket, showtime)).toEqual({
      kind: "watch",
      filmId: THEATRE_FILM_IDS.thatMinesMine,
    });
  });

  it("is Replay Last Film once the hour has turned, and still plays the ticket's film", () => {
    expect(viewerEntry(ticket, "2026-11-06T11:00:00.000Z")).toEqual({
      kind: "replay",
      filmId: THEATRE_FILM_IDS.thatMinesMine,
    });
    expect(viewerEntry(ticket, "2026-11-07T10:00:00.000Z")?.kind).toBe("replay");
  });
});

describe("the countdown", () => {
  it("counts down to the end of the showing and rounds up", () => {
    expect(formatCountdown(61 * 60 * 1000)).toBe("1:01:00");
    expect(formatCountdown(59 * 60 * 1000 + 59_000)).toBe("59:59");
    expect(formatCountdown(65_000)).toBe("1:05");
    expect(formatCountdown(1)).toBe("0:01");
    expect(formatCountdown(999)).toBe("0:01");
    expect(formatCountdown(1000)).toBe("0:01");
    expect(formatCountdown(1001)).toBe("0:02");
  });

  it("never goes negative", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5000)).toBe("0:00");
  });
});

describe("the pre-roll slots", () => {
  it("has exactly the three locked advertisers", () => {
    expect(THEATRE_PRE_ROLL_SLOTS.map((slot) => slot.title)).toEqual([
      "DeWHAT",
      "Visit Skatboll!",
      "FedHex",
    ]);
    expect(THEATRE_PRE_ROLL_SLOTS.map((slot) => slot.id)).toEqual(
      Object.values(THEATRE_PRE_ROLL_AD_IDS),
    );
  });

  it("is approximately 15 seconds", () => {
    expect(PRE_ROLL_DURATION_MS).toBe(15_000);
  });

  it("holds a finished commercial in every slot, so the viewer is ready for players", () => {
    // The commercials' own scripts and timing are proven in tests/unit/theatre-commercials.test.ts.
    expect(THEATRE_PRE_ROLL_SLOTS.every((slot) => slot.filmId !== undefined)).toBe(true);
    expect(theatreViewerReady()).toBe(true);
  });

  it("is ready only when all three slots have a commercial", () => {
    const filled = THEATRE_PRE_ROLL_SLOTS.map((slot) => ({ ...slot, filmId: `ad-${slot.id}` }));
    expect(theatreViewerReady(filled)).toBe(true);
    expect(theatreViewerReady(filled.slice(0, 2))).toBe(false);
    expect(theatreViewerReady([...filled.slice(0, 2), { ...filled[2]!, filmId: undefined }])).toBe(
      false,
    );
    expect(theatreViewerReady([])).toBe(false);
  });

  it("draws uniformly from a unit-interval source and allows consecutive repeats", () => {
    const draw = (value: number) => selectPreRollSlot(THEATRE_PRE_ROLL_SLOTS, () => value).id;
    expect(draw(0)).toBe(THEATRE_PRE_ROLL_AD_IDS.deWhat);
    expect(draw(0.33)).toBe(THEATRE_PRE_ROLL_AD_IDS.deWhat);
    expect(draw(0.34)).toBe(THEATRE_PRE_ROLL_AD_IDS.visitSkatboll);
    expect(draw(0.66)).toBe(THEATRE_PRE_ROLL_AD_IDS.visitSkatboll);
    expect(draw(0.67)).toBe(THEATRE_PRE_ROLL_AD_IDS.fedhex);
    expect(draw(0.999999)).toBe(THEATRE_PRE_ROLL_AD_IDS.fedhex);
    // A source that misbehaves can never index outside the slots.
    expect(draw(1)).toBe(THEATRE_PRE_ROLL_AD_IDS.fedhex);
    expect(draw(-3)).toBe(THEATRE_PRE_ROLL_AD_IDS.deWhat);
    // Independent draws: the same value twice is the same slot twice.
    expect(draw(0.5)).toBe(draw(0.5));
    expect(() => selectPreRollSlot([], () => 0.5)).toThrow(RangeError);
  });

  it("covers every slot over a seeded run (no slot is unreachable)", () => {
    let seed = 12345;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const seen = new Set<string>();
    for (let i = 0; i < 60; i += 1) seen.add(selectPreRollSlot(THEATRE_PRE_ROLL_SLOTS, random).id);
    expect(seen.size).toBe(3);
  });
});

describe("the server's viewing decision", () => {
  const base = {
    atLocationId: LOCATION_IDS.holoDriveIn as string,
    busy: undefined,
    latestTicket: ticket,
    viewerAvailable: true,
  } as const;

  it("allows the ticket's film at the Drive-In", () => {
    expect(planViewing(base)).toEqual({
      ok: true,
      filmId: THEATRE_FILM_IDS.thatMinesMine,
      showtimeId: ticket.showtimeId,
      tierId: ticket.tierId,
    });
  });

  it("keeps the entitlement while away but refuses to play it anywhere but the Drive-In", () => {
    expect(planViewing({ ...base, atLocationId: LOCATION_IDS.holoHollow })).toEqual({
      ok: false,
      reason: "not_at_theatre",
    });
  });

  it("refuses on the road, with no ticket, and while the viewer is not offered", () => {
    expect(planViewing({ ...base, busy: "in_transit" })).toEqual({
      ok: false,
      reason: "in_transit",
    });
    expect(planViewing({ ...base, latestTicket: undefined })).toEqual({
      ok: false,
      reason: "no_ticket",
    });
    expect(planViewing({ ...base, viewerAvailable: false })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("judges the location before anything else, so a distant character learns where films play", () => {
    expect(
      planViewing({
        atLocationId: LOCATION_IDS.holoHollow,
        busy: "in_transit",
        latestTicket: undefined,
        viewerAvailable: false,
      }),
    ).toEqual({ ok: false, reason: "not_at_theatre" });
  });

  it("is not blocked by an unrelated activity, which cannot exist at the Drive-In anyway", () => {
    expect(planViewing({ ...base, busy: "active_action" }).ok).toBe(true);
  });

  it("recognises only catalog films as replayable", () => {
    expect(isTheatreFilmId(THEATRE_FILM_IDS.rareOrWeldDone)).toBe(true);
    expect(isTheatreFilmId("template")).toBe(false);
    expect(isTheatreFilmId("")).toBe(false);
  });
});

describe("the viewer lifecycle machine", () => {
  const PRE_ROLL = 15_000;
  const run = (state: ViewerState, ...events: ViewerEvent[]) => events.reduce(viewerReducer, state);
  const authorized = (): ViewerState =>
    run(initialViewerState(PRE_ROLL), {
      type: "authorized",
      filmId: THEATRE_FILM_IDS.thatMinesMine,
      slotId: THEATRE_PRE_ROLL_AD_IDS.deWhat,
    });

  it("opens authorizing: no picture, no ad and no film before the server answers", () => {
    const state = initialViewerState(PRE_ROLL);
    expect(state.phase).toEqual({ kind: "authorizing" });
    expect(state.filmId).toBeUndefined();
    expect(filmControlsActive(state.phase)).toBe(false);
  });

  it("plays one pre-roll and only then the film", () => {
    let state = authorized();
    expect(state.phase).toEqual({
      kind: "pre_roll",
      slotId: THEATRE_PRE_ROLL_AD_IDS.deWhat,
      elapsedMs: 0,
    });
    expect(state.filmId).toBe(THEATRE_FILM_IDS.thatMinesMine);
    state = run(state, { type: "pre_roll_tick", elapsedMs: 7_500 });
    expect(state.phase).toMatchObject({ kind: "pre_roll", elapsedMs: 7_500 });
    expect(preRollPercent(state)).toBe(50);
    state = run(state, { type: "pre_roll_tick", elapsedMs: 14_999 });
    expect(state.phase.kind).toBe("pre_roll");
    state = run(state, { type: "pre_roll_tick", elapsedMs: 15_000 });
    expect(state.phase).toEqual({ kind: "film", playback: "playing" });
  });

  it("cannot be skipped: nothing but the clock reaching its length leaves the pre-roll", () => {
    const state = authorized();
    for (const event of [
      { type: "playback", playback: "playing" },
      { type: "playback", playback: "paused" },
      { type: "ended" },
      { type: "authorized", filmId: "x", slotId: "y" },
    ] as const) {
      expect(viewerReducer(state, event).phase.kind).toBe("pre_roll");
    }
    // A start control pressed mid-pre-roll starts a NEW viewing; it does not skip this one.
    expect(viewerReducer(state, { type: "start" }).phase.kind).toBe("authorizing");
    expect(filmControlsActive(state.phase)).toBe(false);
  });

  it("only moves pre-roll time forward and never past its length", () => {
    let state = run(authorized(), { type: "pre_roll_tick", elapsedMs: 9_000 });
    state = run(state, { type: "pre_roll_tick", elapsedMs: 2_000 });
    expect(state.phase).toMatchObject({ elapsedMs: 9_000 });
    state = run(state, { type: "pre_roll_tick", elapsedMs: 1e9 });
    expect(state.phase.kind).toBe("film");
    // A late tick after the hand-over changes nothing.
    expect(run(state, { type: "pre_roll_tick", elapsedMs: 50 })).toBe(state);
  });

  it("restarts and replays through the server and a new pre-roll, counting every start", () => {
    let state = run(authorized(), { type: "pre_roll_tick", elapsedMs: PRE_ROLL });
    expect(state.starts).toBe(1);
    state = run(state, { type: "playback", playback: "paused" });
    expect(state.phase).toEqual({ kind: "film", playback: "paused" });
    state = run(state, { type: "start" });
    expect(state.phase).toEqual({ kind: "authorizing" });
    expect(state.starts).toBe(2);
    state = run(
      state,
      {
        type: "authorized",
        filmId: THEATRE_FILM_IDS.thatMinesMine,
        slotId: THEATRE_PRE_ROLL_AD_IDS.fedhex,
      },
      { type: "pre_roll_tick", elapsedMs: PRE_ROLL },
      { type: "ended" },
    );
    expect(state.phase).toEqual({ kind: "ended" });
    state = run(state, { type: "start" });
    expect(state.phase).toEqual({ kind: "authorizing" });
    expect(state.starts).toBe(3);
  });

  it("starts nothing twice for a double tap while the server is still answering", () => {
    const state = initialViewerState(PRE_ROLL);
    expect(viewerReducer(state, { type: "start" })).toBe(state);
    expect(run(state, { type: "start" }, { type: "start" }).starts).toBe(1);
  });

  it("ignores a late server answer unless it is still waiting for one", () => {
    const playing = run(authorized(), { type: "pre_roll_tick", elapsedMs: PRE_ROLL });
    const late = viewerReducer(playing, {
      type: "authorized",
      filmId: THEATRE_FILM_IDS.rareOrWeldDone,
      slotId: THEATRE_PRE_ROLL_AD_IDS.fedhex,
    });
    expect(late).toBe(playing);
    expect(late.filmId).toBe(THEATRE_FILM_IDS.thatMinesMine);
  });

  it("shows a refusal or failure and lets a failed start be tried again", () => {
    let state = run(initialViewerState(PRE_ROLL), {
      type: "refused",
      message: "Films are shown at the Holo Drive-In.",
    });
    expect(state.phase).toEqual({
      kind: "refused",
      message: "Films are shown at the Holo Drive-In.",
    });
    expect(filmControlsActive(state.phase)).toBe(false);
    state = run(state, { type: "failed", message: "Comms interruption." });
    expect(state.phase.kind).toBe("failed");
    state = run(state, { type: "start" });
    expect(state.phase.kind).toBe("authorizing");
    expect(state.starts).toBe(2);
  });

  it("puts the film back in play when the viewer seeks away from the end card, without a new pre-roll", () => {
    let state = run(
      authorized(),
      { type: "pre_roll_tick", elapsedMs: PRE_ROLL },
      { type: "ended" },
    );
    expect(filmControlsActive(state.phase)).toBe(true);
    state = run(state, { type: "playback", playback: "paused" });
    expect(state.phase).toEqual({ kind: "film", playback: "paused" });
    expect(state.starts).toBe(1);
  });

  it("only exposes the film's own controls once the film is in play", () => {
    const phases = [
      initialViewerState(PRE_ROLL).phase,
      authorized().phase,
      run(authorized(), { type: "pre_roll_tick", elapsedMs: PRE_ROLL }).phase,
      run(authorized(), { type: "pre_roll_tick", elapsedMs: PRE_ROLL }, { type: "ended" }).phase,
    ];
    expect(phases.map(filmControlsActive)).toEqual([false, false, true, true]);
  });

  it("rejects a pre-roll of no length", () => {
    expect(() => initialViewerState(0)).toThrow(RangeError);
    expect(() => initialViewerState(Number.NaN)).toThrow(RangeError);
  });
});

describe("the landscape suggestion", () => {
  it("is offered only on a portrait touch device, and only once", () => {
    const base = { portrait: true, coarsePointer: true, alreadySuggested: false };
    expect(shouldSuggestLandscape(base)).toBe(true);
    expect(shouldSuggestLandscape({ ...base, portrait: false })).toBe(false);
    expect(shouldSuggestLandscape({ ...base, coarsePointer: false })).toBe(false);
    expect(shouldSuggestLandscape({ ...base, alreadySuggested: true })).toBe(false);
  });
});

describe("the film each ticket plays", () => {
  it("is the ticket's own film for both skills, never inferred from the schedule", () => {
    for (const film of [mining, welding]) {
      const entry = viewerEntry({ ...ticket, filmId: film.filmId }, "2030-01-01T00:00:00.000Z");
      expect(entry?.filmId).toBe(film.filmId);
    }
    expect(mining.skillId).toBe(SKILL_IDS.mining);
    expect(welding.skillId).toBe(SKILL_IDS.welding);
  });
});

describe("the programme a screen displays across a turnover", () => {
  const screen = getTheatreScreen(THEATRE_SCREEN_IDS.main)!;
  const HOUR = 60 * 60 * 1000;
  const at18 = Date.parse("2026-11-06T18:30:00.000Z");
  const projected = projectTheatreProgramme(at18).screens[0]!;

  it("shows the server's projection until the clock reaches its end", () => {
    for (const nowMs of [at18, Date.parse("2026-11-06T18:00:00.000Z"), at18 + HOUR / 2 - 1]) {
      const shown = displayedShowings(screen, projected, nowMs);
      expect(shown.stale).toBe(false);
      expect(shown.now).toBe(projected.now);
      expect(shown.next).toBe(projected.next);
    }
    // The last millisecond of the 18:00 showing is still that showing.
    expect(displayedShowings(screen, projected, Date.parse("2026-11-06T18:59:59.999Z")).stale).toBe(
      false,
    );
  });

  it("hands the exact boundary instant to the incoming showing and waits for a fresh state", () => {
    const shown = displayedShowings(screen, projected, Date.parse("2026-11-06T19:00:00.000Z"));
    expect(shown.stale).toBe(true);
    expect(shown.now.filmId).toBe(THEATRE_FILM_IDS.rareOrWeldDone);
    expect(shown.now.startsAt).toBe("2026-11-06T19:00:00.000Z");
    expect(shown.next.filmId).toBe(THEATRE_FILM_IDS.thatMinesMine);
  });

  it("agrees with the server's own projection at the same instant", () => {
    for (const nowMs of [at18 + HOUR, at18 + 5 * HOUR, at18 + 30 * HOUR + 17]) {
      const fresh = projectTheatreProgramme(nowMs).screens[0]!;
      const shown = displayedShowings(screen, projected, nowMs);
      expect(shown.now).toEqual(fresh.now);
      expect(shown.next).toEqual(fresh.next);
    }
  });
});
