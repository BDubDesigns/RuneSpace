import { readFileSync } from "node:fs";
import path from "node:path";
import { Reader, type CountryResponse } from "mmdb-lib";
import { isPublicClientIp } from "@/server/client-ip";

/**
 * Offline IP-to-country lookup over the vendored DB-IP Country Lite database
 * (issue #419, part of #417; source, license and maintenance in
 * `server/geo/README.md`). Not imported by any live code yet.
 *
 * Every failure is `null` (an unknown location): a missing or corrupt file, a
 * database older than `COUNTRY_DATABASE_MAX_AGE_MS`, an unsuitable address, a
 * miss, or an unexpected record. Nothing here throws to a caller, logs, caches
 * or returns the address it was given; the only output is a two-letter code.
 */

/** The vendored database. Replace the file and this name together on refresh. */
export const COUNTRY_DATABASE_FILE = "dbip-country-lite-2026-10.mmdb";

/**
 * Past this age the database is treated as absent and every lookup is unknown.
 * DB-IP publishes monthly, so this tolerates a couple of missed refreshes but
 * never lets stale data quietly decide a visitor's jurisdiction.
 */
export const COUNTRY_DATABASE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export type CountryDatabase = {
  /** Build time of the database, from its own metadata. */
  readonly builtAt: Date;
  /** Uppercase ISO 3166-1 alpha-2 code for a public address, otherwise null. */
  lookup(ip: string): string | null;
};

/**
 * Open a database from its raw bytes. `null` if the bytes are not a readable
 * MMDB, or are not a DB-IP / country database with a usable build time.
 */
export function openCountryDatabase(bytes: Buffer): CountryDatabase | null {
  try {
    const reader = new Reader<CountryResponse>(bytes);
    const builtAt = reader.metadata.buildEpoch;
    if (!(builtAt instanceof Date) || Number.isNaN(builtAt.getTime())) return null;
    if (!/country/i.test(reader.metadata.databaseType)) return null;
    return {
      builtAt,
      lookup(ip) {
        if (!isPublicClientIp(ip)) return null;
        try {
          const code = reader.get(ip)?.country?.iso_code;
          return typeof code === "string" && /^[A-Z]{2}$/.test(code) ? code : null;
        } catch {
          return null;
        }
      },
    };
  } catch {
    return null;
  }
}

/** Whether the database may still be used at `now`. */
export function isCountryDatabaseFresh(database: CountryDatabase, now: Date): boolean {
  const age = now.getTime() - database.builtAt.getTime();
  // A build time in the future means a bad clock or bad file: not usable.
  return age >= 0 && age <= COUNTRY_DATABASE_MAX_AGE_MS;
}

/**
 * The country of a public address, or `null` when unknown for any reason.
 * `database` is `null` when none could be opened.
 */
export function lookupCountry(
  ip: string | null,
  database: CountryDatabase | null,
  now: Date = new Date(),
): string | null {
  if (!ip || !database || !isCountryDatabaseFresh(database, now)) return null;
  return database.lookup(ip);
}

let bundled: CountryDatabase | null | undefined;

/**
 * The bundled database, read from disk on first use and then kept for the life
 * of the process (about 8 MB). A failed load is remembered too, so a missing
 * file costs one read, not one per request.
 */
export function bundledCountryDatabase(): CountryDatabase | null {
  if (bundled !== undefined) return bundled;
  try {
    bundled = openCountryDatabase(
      readFileSync(path.join(process.cwd(), "server", "geo", COUNTRY_DATABASE_FILE)),
    );
  } catch {
    bundled = null;
  }
  return bundled;
}
