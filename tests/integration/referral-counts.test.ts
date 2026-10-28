import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ReferralCountLabels } from "@/features/analytics/referral-counts";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

const labels: ReferralCountLabels = {
  sourceGroup: "linkedin",
  utmSource: "linkedin",
  utmMedium: "social",
  utmCampaign: "launch",
  routeCategory: "landing",
};

/**
 * Issue #425 — the aggregate referral counter on real PostgreSQL: the
 * committed migration, race-safe increments across several counters and
 * pools, cardinality collapse, retention pruning, and failure isolation.
 */
suite("aggregate referral counts (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let counts: typeof import("@/db/site-analytics");
  let counterModule: typeof import("@/server/referral-counts");
  const extraPools: Pool[] = [];

  function counterAt(
    day: string,
    extra: Partial<Parameters<typeof counterModule.createReferralCounter>[0]> = {},
  ) {
    return counterModule.createReferralCounter({
      database: () => db,
      now: () => new Date(`${day}T12:00:00Z`),
      ...extra,
    });
  }

  async function all() {
    const result = await db.execute(
      sql`select day::text, source_group, utm_source, utm_medium, utm_campaign, route_category, visits from referral_daily_counts order by day, source_group, utm_source, utm_campaign, route_category`,
    );
    return result.rows as Array<Record<string, string | number>>;
  }

  beforeAll(async () => {
    db = (await import("@/db")).db;
    counts = await import("@/db/site-analytics");
    counterModule = await import("@/server/referral-counts");
  });
  beforeEach(async () => {
    await db.delete(counts.referralDailyCounts);
  });
  afterAll(async () => {
    await db.delete(counts.referralDailyCounts);
    await Promise.all(extraPools.map((pool) => pool.end()));
  });

  it("stores nothing but day, sanitized labels, and a count", async () => {
    const columns = await db.execute(
      sql`select column_name from information_schema.columns where table_name = 'referral_daily_counts' order by ordinal_position`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "day",
      "source_group",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "route_category",
      "visits",
    ]);
    const key = await db.execute(
      sql`select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = 'referral_daily_counts'::regclass and i.indisprimary`,
    );
    expect(key.rows).toHaveLength(6);
    await expect(
      db.execute(
        sql`insert into referral_daily_counts (day, source_group, route_category, visits) values ('2026-01-01', 'x', 'wiki', -1)`,
      ),
    ).rejects.toThrow();
    await expect(
      db.execute(
        sql`insert into referral_daily_counts (day, source_group, route_category, utm_campaign, visits) values ('2026-01-01', 'x', 'wiki', ${"a".repeat(65)}, 1)`,
      ),
    ).rejects.toThrow();
  });

  it("is shipped by the committed migration", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0054_referral_daily_counts.sql"),
      "utf8",
    );
    expect(migration).toContain('CREATE TABLE "referral_daily_counts"');
    expect(migration).toContain(
      'PRIMARY KEY("day","source_group","utm_source","utm_medium","utm_campaign","route_category")',
    );
  });

  it("increments one row race-safely under concurrency, across counters and pools", async () => {
    const otherPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    extraPools.push(otherPool);
    const otherDb = drizzle(otherPool);
    const first = counterAt("2031-03-15");
    const second = counterModule.createReferralCounter({
      database: () => otherDb,
      now: () => new Date("2031-03-15T01:00:00Z"),
    });

    await Promise.all(
      Array.from({ length: 120 }, (_, i) => (i % 2 === 0 ? first : second).record(labels)),
    );

    expect(await all()).toEqual([
      expect.objectContaining({
        day: "2031-03-15",
        source_group: "linkedin",
        utm_source: "linkedin",
        utm_medium: "social",
        utm_campaign: "launch",
        route_category: "landing",
        visits: 120,
      }),
    ]);
  }, 60_000);

  it("keeps different labels, routes, and UTC days in separate rows", async () => {
    const day1 = counterAt("2031-03-15");
    const day2 = counterAt("2031-03-16");
    await day1.record(labels);
    await day1.record({ ...labels, routeCategory: "wiki" });
    await day1.record({
      ...labels,
      utmSource: "",
      utmMedium: "",
      utmCampaign: "",
      sourceGroup: "direct_unknown",
    });
    await day2.record(labels);
    expect(
      (await all()).map(
        (row) => `${row.day}|${row.source_group}|${row.route_category}|${row.visits}`,
      ),
    ).toEqual([
      "2031-03-15|direct_unknown|landing|1",
      "2031-03-15|linkedin|landing|1",
      "2031-03-15|linkedin|wiki|1",
      "2031-03-16|linkedin|landing|1",
    ]);
  });

  it("collapses campaign overflow into one row instead of growing without bound", async () => {
    const counter = counterAt("2031-03-15", { maxUtmCombinationsPerDay: 3 });
    for (let i = 0; i < 40; i++) {
      await counter.record({ ...labels, utmCampaign: `campaign-${i}` });
    }
    const rows = await all();
    expect(rows).toHaveLength(4);
    const overflow = rows.find((row) => row.utm_campaign === "(other)");
    expect(overflow).toMatchObject({ source_group: "linkedin", visits: 37 });
  });

  it("prunes rows older than 25 months, once per day, off the request path", async () => {
    await db.execute(sql`insert into referral_daily_counts (day, source_group, route_category, visits) values
      ('2028-09-30', 'old', 'wiki', 5),
      ('2028-10-28', 'edge', 'wiki', 3),
      ('2028-10-29', 'kept', 'wiki', 2)`);
    // 25 months before 2030-11-28 is 2028-10-28: that day is kept, earlier days go.
    const counter = counterAt("2030-11-28");
    await counter.record(labels);
    expect((await all()).map((row) => row.source_group).sort()).toEqual([
      "edge",
      "kept",
      "linkedin",
    ]);
    await counter.prune();
    expect((await all()).map((row) => row.source_group).sort()).toEqual([
      "edge",
      "kept",
      "linkedin",
    ]);
  });

  it("counts through the real middleware without delaying or failing the response", async () => {
    const { NextRequest } = await import("next/server");
    const { middleware } = await import("@/middleware");
    const waited: Promise<unknown>[] = [];
    const response = middleware(
      new NextRequest(
        "https://runespace.qcfailed.com/updates?utm_source=Discord&utm_campaign=Beta",
        {
          headers: {
            host: "runespace.qcfailed.com",
            "user-agent":
              "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
            accept: "text/html",
            "sec-fetch-mode": "navigate",
            "sec-fetch-dest": "document",
            referer: "https://discord.com/channels/1/2",
          },
        },
      ),
      { waitUntil: (promise: Promise<unknown>) => waited.push(promise) } as never,
    );
    expect(response.status).toBe(200);
    await Promise.all(waited);
    const today = new Date().toISOString().slice(0, 10);
    expect(await all()).toEqual([
      expect.objectContaining({
        day: today,
        source_group: "discord",
        utm_source: "discord",
        utm_campaign: "beta",
        route_category: "updates",
        visits: 1,
      }),
    ]);
  });

  it("is harmless when the database is unreachable", async () => {
    const dead = new Pool({
      connectionString: "postgres://nobody@127.0.0.1:1/none",
      max: 1,
      connectionTimeoutMillis: 300,
    });
    dead.on("error", () => undefined);
    extraPools.push(dead);
    const deadDb = drizzle(dead);
    const counter = counterModule.createReferralCounter({ database: () => deadDb });
    const started = Date.now();
    await expect(counter.record(labels)).resolves.toBeUndefined();
    await expect(counter.prune()).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(await all()).toEqual([]);
  });
});
