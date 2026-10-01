import { describe, expect, it } from "vitest";
import {
  decideTradeRequestBudget,
  effectiveTradeRequestStatus,
  effectiveTradeSessionStatus,
  hasTradeConsent,
  isRepeatedTradeRequester,
  isValidCreditOffer,
  isValidStackQuantity,
  NO_TRADE_CONSENT,
  PLAYER_TRADE_POLICY,
  tradeOfferPhase,
  tradeRequestExpiresAt,
  tradeSessionExpiresAt,
  type TradeConsent,
  type TradeRequestFacts,
} from "@/game/domain/player-trade";

/**
 * Issue #266 — the pure request/session rules. Ownership, locking, and the
 * concurrency arbiters are proved against PostgreSQL in
 * tests/integration/player-trade.test.ts.
 */

const t0 = new Date("2026-10-01T12:00:00.000Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

function pending(overrides: Partial<TradeRequestFacts> = {}): TradeRequestFacts {
  return {
    status: "pending",
    locationId: "crash_site",
    expiresAt: tradeRequestExpiresAt(t0),
    ...overrides,
  };
}

const together = { requesterLocationId: "crash_site", recipientLocationId: "crash_site" };

describe("player trade policy", () => {
  it("locks the approved numbers", () => {
    expect(PLAYER_TRADE_POLICY).toEqual({
      requestTtlMs: 20_000,
      requestBudget: { maxRequests: 4, windowMs: 30_000 },
      repeatedRecipientThreshold: 4,
      sessionInactivityMs: 300_000,
    });
  });
});

describe("effectiveTradeRequestStatus", () => {
  it("is pending until exactly 20 seconds after creation", () => {
    expect(effectiveTradeRequestStatus(pending(), together, at(19_999))).toBe("pending");
    expect(effectiveTradeRequestStatus(pending(), together, at(20_000))).toBe("expired");
  });

  it("is invalidated as soon as either character leaves the request's location", () => {
    for (const locations of [
      { requesterLocationId: "elsewhere", recipientLocationId: "crash_site" },
      { requesterLocationId: "crash_site", recipientLocationId: "elsewhere" },
    ]) {
      expect(effectiveTradeRequestStatus(pending(), locations, at(1_000))).toBe("invalidated");
    }
  });

  it("reports expiry over movement, since expiry needs no other fact", () => {
    const apart = { requesterLocationId: "crash_site", recipientLocationId: "elsewhere" };
    expect(effectiveTradeRequestStatus(pending(), apart, at(20_000))).toBe("expired");
  });

  it("never revives a stored terminal outcome", () => {
    for (const status of ["accepted", "canceled", "declined", "expired", "invalidated"] as const) {
      expect(effectiveTradeRequestStatus(pending({ status }), together, at(0))).toBe(status);
    }
  });
});

describe("effectiveTradeSessionStatus", () => {
  it("expires exactly five minutes after the last trade activity", () => {
    const session = { status: "active" as const, lastActivityAt: t0 };
    expect(tradeSessionExpiresAt(t0)).toEqual(at(300_000));
    expect(effectiveTradeSessionStatus(session, at(299_999))).toBe("active");
    expect(effectiveTradeSessionStatus(session, at(300_000))).toBe("expired");
  });

  it("keeps a canceled session canceled", () => {
    expect(effectiveTradeSessionStatus({ status: "canceled", lastActivityAt: t0 }, at(0))).toBe(
      "canceled",
    );
  });
});

describe("decideTradeRequestBudget", () => {
  it("allows four requests in a rolling 30 seconds and refuses the fifth", () => {
    const sent = [at(0), at(1_000), at(2_000)];
    expect(decideTradeRequestBudget(sent, at(3_000))).toEqual({ allowed: true });
    expect(decideTradeRequestBudget([...sent, at(3_000)], at(4_000))).toEqual({
      allowed: false,
      retryAfterMs: 26_000,
    });
  });

  it("frees a slot exactly when the oldest request leaves the window", () => {
    const sent = [at(0), at(1_000), at(2_000), at(3_000)];
    expect(decideTradeRequestBudget(sent, at(29_999))).toEqual({ allowed: false, retryAfterMs: 1 });
    expect(decideTradeRequestBudget(sent, at(30_000))).toEqual({ allowed: true });
  });
});

describe("isRepeatedTradeRequester", () => {
  it("makes Block prominent from the fourth request in the window", () => {
    expect(isRepeatedTradeRequester(3)).toBe(false);
    expect(isRepeatedTradeRequester(4)).toBe(true);
  });
});

/** Issue #267 — the offer and consent rules of an accepted session. */
describe("player trade offers and consent", () => {
  const consent = (overrides: Partial<TradeConsent> = {}): TradeConsent => ({
    ...NO_TRADE_CONSENT,
    ...overrides,
  });

  it("freezes the offers into review only when both participants are Ready", () => {
    expect(tradeOfferPhase(consent())).toBe("compose");
    expect(tradeOfferPhase(consent({ requesterReady: true }))).toBe("compose");
    expect(tradeOfferPhase(consent({ recipientReady: true }))).toBe("compose");
    expect(tradeOfferPhase(consent({ requesterReady: true, recipientReady: true }))).toBe("review");
  });

  it("knows when there is any consent for Change Offer to clear", () => {
    expect(hasTradeConsent(NO_TRADE_CONSENT)).toBe(false);
    expect(hasTradeConsent(consent({ recipientReady: true }))).toBe(true);
    expect(
      hasTradeConsent(
        consent({ requesterReady: true, recipientReady: true, requesterConfirmed: true }),
      ),
    ).toBe(true);
  });

  it("accepts only whole, non-negative Credit offers within the balance", () => {
    for (const valid of [0, 1, 10]) expect(isValidCreditOffer(valid, 10)).toBe(true);
    for (const invalid of [-1, 0.5, 11, Number.NaN, Number.POSITIVE_INFINITY, "5", null]) {
      expect(isValidCreditOffer(invalid, 10)).toBe(false);
    }
  });

  it("accepts only positive whole stack quantities", () => {
    expect(isValidStackQuantity(1)).toBe(true);
    for (const invalid of [0, -1, 1.5, Number.NaN, Number.MAX_VALUE, "2", undefined]) {
      expect(isValidStackQuantity(invalid)).toBe(false);
    }
  });
});
