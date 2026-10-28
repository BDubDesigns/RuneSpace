import { describe, expect, it } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createReferralCounter } from "@/server/referral-counts";
import type { ReferralCountLabels } from "@/features/analytics/referral-counts";

/**
 * The counter's isolation rules, against a scripted database stand-in: bounded
 * in-flight work, back-off after a failure, and cardinality collapse. The
 * SQL itself is proved on real PostgreSQL in `tests/integration`.
 */

const base: ReferralCountLabels = {
  sourceGroup: "reddit",
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
  routeCategory: "wiki",
};

function scriptedDatabase(behavior: () => Promise<unknown>) {
  const writes: Record<string, unknown>[] = [];
  let attempts = 0;
  const database = {
    insert: () => ({
      values: (value: Record<string, unknown>) => ({
        onConflictDoUpdate: () => {
          attempts += 1;
          writes.push(value);
          return behavior();
        },
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  } as unknown as NodePgDatabase;
  return { database, writes, attempts: () => attempts };
}

describe("createReferralCounter", () => {
  it("writes one row per page load keyed by day and sanitized labels", async () => {
    const db = scriptedDatabase(async () => undefined);
    const counter = createReferralCounter({
      database: () => db.database,
      now: () => new Date("2026-11-02T23:59:00Z"),
    });
    await counter.record({ ...base, utmSource: "reddit", utmCampaign: "launch" });
    expect(db.writes).toEqual([
      {
        day: "2026-11-02",
        sourceGroup: "reddit",
        utmSource: "reddit",
        utmMedium: "",
        utmCampaign: "launch",
        routeCategory: "wiki",
        visits: 1,
      },
    ]);
  });

  it("never rejects, and backs off after a database failure instead of retrying every request", async () => {
    let clock = Date.parse("2026-11-02T10:00:00Z");
    const db = scriptedDatabase(async () => {
      throw new Error("connection refused");
    });
    const counter = createReferralCounter({
      database: () => db.database,
      now: () => new Date(clock),
      failureBackoffMs: 30_000,
    });
    await expect(counter.record(base)).resolves.toBeUndefined();
    expect(db.attempts()).toBe(1);

    // During the back-off, page loads are skipped without touching the database.
    for (let i = 0; i < 25; i++) await counter.record(base);
    expect(db.attempts()).toBe(1);

    clock += 30_001;
    await counter.record(base);
    expect(db.attempts()).toBe(2);
  });

  it("survives a database handle that throws before returning a query", async () => {
    const counter = createReferralCounter({
      database: () => {
        throw new Error("no DATABASE_URL");
      },
    });
    await expect(counter.record(base)).resolves.toBeUndefined();
  });

  it("bounds in-flight writes: excess page loads are dropped, not queued without limit", async () => {
    const release: Array<() => void> = [];
    const db = scriptedDatabase(() => new Promise<void>((resolve) => release.push(resolve)));
    const counter = createReferralCounter({ database: () => db.database, maxInFlight: 3 });
    const pending = Array.from({ length: 10 }, () => counter.record(base));
    expect(db.attempts()).toBe(3);
    release.forEach((resolve) => resolve());
    await Promise.all(pending);

    // Capacity returns once the writes settle.
    const more = counter.record(base);
    expect(db.attempts()).toBe(4);
    release.forEach((resolve) => resolve());
    await more;
  });

  it("caps distinct label sets per day and collapses overflow to one safe label", async () => {
    let day = "2026-11-02";
    const db = scriptedDatabase(async () => undefined);
    const counter = createReferralCounter({
      database: () => db.database,
      now: () => new Date(`${day}T12:00:00Z`),
      maxUtmCombinationsPerDay: 2,
    });
    const labelsFor = (campaign: string): ReferralCountLabels => ({
      ...base,
      utmSource: "reddit",
      utmCampaign: campaign,
    });

    await counter.record(labelsFor("a"));
    await counter.record(labelsFor("b"));
    await counter.record(labelsFor("c")); // over the cap
    await counter.record(labelsFor("d")); // over the cap
    await counter.record(labelsFor("a")); // already known: still itself
    await counter.record(base); // no tags: never capped

    expect(db.writes.map((write) => write.utmCampaign)).toEqual([
      "a",
      "b",
      "(other)",
      "(other)",
      "a",
      "",
    ]);
    expect(db.writes[2]).toMatchObject({
      sourceGroup: "reddit",
      utmSource: "(other)",
      utmMedium: "(other)",
      routeCategory: "wiki",
    });

    // A new UTC day starts a fresh allowance.
    day = "2026-11-03";
    await counter.record(labelsFor("c"));
    expect(db.writes.at(-1)).toMatchObject({ day: "2026-11-03", utmCampaign: "c" });
  });
});
