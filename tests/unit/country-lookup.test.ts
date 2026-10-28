import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BetterAuthOptions } from "better-auth";
import { classifyClientRegion } from "@/server/client-region";
import {
  COUNTRY_DATABASE_FILE,
  COUNTRY_DATABASE_MAX_AGE_MS,
  isCountryDatabaseFresh,
  lookupCountry,
  openCountryDatabase,
  type CountryDatabase,
} from "@/server/geo/country-lookup";

/**
 * Offline country lookup (issue #419) against the vendored DB-IP Country Lite
 * October 2026 file. The file is fixed, so anchor addresses are deterministic;
 * a refresh to a newer file may legitimately change an anchor and its
 * expectation together. `now` is always injected so the staleness window never
 * makes these tests depend on the wall clock.
 */

const DB_PATH = path.join(process.cwd(), "server", "geo", COUNTRY_DATABASE_FILE);
const NOW = new Date("2026-10-28T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const options: BetterAuthOptions = {};

function loadVendored(): CountryDatabase {
  const database = openCountryDatabase(readFileSync(DB_PATH));
  if (!database) throw new Error("vendored database failed to open");
  return database;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("vendored database file", () => {
  it("is the byte-for-byte file DB-IP published (SHA-1 from its download page)", () => {
    const bytes = readFileSync(DB_PATH);
    expect(bytes.length).toBe(8_348_509);
    expect(createHash("sha1").update(bytes).digest("hex")).toBe(
      "e515b63075ad48847f9c4332b724742e8ba15b0e",
    );
  });

  it("opens as the October 2026 country database", () => {
    const database = loadVendored();
    expect(database.builtAt.toISOString().slice(0, 7)).toBe("2026-10");
    expect(isCountryDatabaseFresh(database, NOW)).toBe(true);
  });
});

describe("lookupCountry with the vendored database", () => {
  const database = loadVendored();

  it.each([
    ["8.8.8.8", "US"],
    ["81.2.69.142", "GB"],
    ["185.86.151.11", "LV"],
    ["1.1.1.1", "AU"],
    ["2a00:1450:4001::1", "DE"],
    ["2a00:1450:4001:0000:0000:0000:0000:0000", "DE"],
  ])("reads %s as %s", (ip, country) => {
    expect(lookupCountry(ip, database, NOW)).toBe(country);
  });

  it.each(["10.0.0.1", "127.0.0.1", "192.168.1.1", "100.64.0.1", "::1", "fe80::1", "192.0.2.1"])(
    "is unknown for the non-public address %s without consulting the database",
    (ip) => {
      expect(lookupCountry(ip, database, NOW)).toBeNull();
    },
  );

  it.each(["", "garbage", "8.8.8", "8.8.8.8, 1.1.1.1", "2a00:1450::1::2"])(
    "is unknown for the malformed value %j",
    (ip) => {
      expect(lookupCountry(ip, database, NOW)).toBeNull();
    },
  );

  it("is unknown for a missing address or database", () => {
    expect(lookupCountry(null, database, NOW)).toBeNull();
    expect(lookupCountry("8.8.8.8", null, NOW)).toBeNull();
  });

  it("returns only a two-letter code, never the address", () => {
    const country = lookupCountry("8.8.8.8", database, NOW);
    expect(country).toMatch(/^[A-Z]{2}$/);
    expect(country).not.toContain("8.8");
  });
});

describe("failure handling", () => {
  it.each([
    ["an empty buffer", Buffer.alloc(0)],
    ["random bytes", Buffer.from("not an mmdb file at all".repeat(40))],
    ["a truncated database", readFileSync(DB_PATH).subarray(0, 4096)],
  ])("opens %s as no database", (_label, bytes) => {
    expect(openCountryDatabase(bytes)).toBeNull();
  });

  it("is unknown when the reader throws", () => {
    const throwing: CountryDatabase = {
      builtAt: NOW,
      lookup() {
        throw new Error("boom");
      },
    };
    // `classifyClientRegion` is the never-throws boundary.
    const region = classifyClientRegion(new Headers({ "x-forwarded-for": "8.8.8.8" }), options, {
      database: throwing,
      now: NOW,
    });
    expect(region).toBe("unknown");
  });

  describe("staleness", () => {
    const database = loadVendored();
    const builtAt = database.builtAt.getTime();

    it("is fresh up to the maximum age", () => {
      const edge = new Date(builtAt + COUNTRY_DATABASE_MAX_AGE_MS);
      expect(lookupCountry("8.8.8.8", database, edge)).toBe("US");
    });

    it("is unknown once the database is older than the maximum age", () => {
      const stale = new Date(builtAt + COUNTRY_DATABASE_MAX_AGE_MS + 1);
      expect(lookupCountry("8.8.8.8", database, stale)).toBeNull();
      expect(lookupCountry("8.8.8.8", database, new Date(builtAt + 400 * DAY_MS))).toBeNull();
    });

    it("is unknown when the clock is before the database was built", () => {
      expect(lookupCountry("8.8.8.8", database, new Date(builtAt - 1))).toBeNull();
    });

    it("is unknown for an invalid clock", () => {
      expect(lookupCountry("8.8.8.8", database, new Date(Number.NaN))).toBeNull();
    });
  });
});

describe("bundledCountryDatabase", () => {
  it("loads the vendored file from the repository root", async () => {
    const { bundledCountryDatabase: load } = await import("@/server/geo/country-lookup");
    const database = load();
    expect(database).not.toBeNull();
    expect(database?.lookup("8.8.8.8")).toBe("US");
    expect(load()).toBe(database); // read once, then reused
  });

  it("is unknown (and does not throw) when the file is missing, remembering the miss", async () => {
    const empty = mkdtempSync(path.join(tmpdir(), "runespace-geo-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(empty);
    const { bundledCountryDatabase: load } = await import("@/server/geo/country-lookup");
    expect(load()).toBeNull();
    cwd.mockRestore();
    expect(load()).toBeNull(); // the real file is back, but the miss is remembered
  });
});

describe("classifyClientRegion", () => {
  const database = loadVendored();
  const classify = (forwardedFor: string | null) =>
    classifyClientRegion(
      new Headers(forwardedFor === null ? {} : { "x-forwarded-for": forwardedFor }),
      options,
      { database, now: NOW },
    );

  it.each([
    ["8.8.8.8", "us"],
    ["81.2.69.142", "uk"],
    ["185.86.151.11", "eea"],
    ["2a00:1450:4001::1", "eea"],
    ["1.1.1.1", "other"],
  ])("classifies %s as %s", (ip, region) => {
    expect(classify(ip)).toBe(region);
  });

  it.each([
    ["no header", null],
    ["private", "10.0.0.1"],
    ["spoofed multi-entry", "8.8.8.8, 81.2.69.142"],
    ["malformed", "not-an-ip"],
    ["documentation range", "203.0.113.7"],
  ])("fails closed to unknown for %s", (_label, value) => {
    expect(classify(value)).toBe("unknown");
  });

  it("ignores country headers a client could send", () => {
    const region = classifyClientRegion(
      new Headers({ "cf-ipcountry": "US", "x-vercel-ip-country": "US", "x-country": "US" }),
      options,
      { database, now: NOW },
    );
    expect(region).toBe("unknown");
  });

  it("is unknown without a database or with a stale one", () => {
    const headers = new Headers({ "x-forwarded-for": "8.8.8.8" });
    expect(classifyClientRegion(headers, options, { database: null, now: NOW })).toBe("unknown");
    expect(
      classifyClientRegion(headers, options, { database, now: new Date("2027-06-01T00:00:00Z") }),
    ).toBe("unknown");
  });
});
