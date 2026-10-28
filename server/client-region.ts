import type { BetterAuthOptions } from "better-auth";
import { classifyCountry, type AnalyticsRegion } from "@/features/analytics/analytics-region";
import { resolveClientIp } from "@/server/client-ip";
import {
  bundledCountryDatabase,
  lookupCountry,
  type CountryDatabase,
} from "@/server/geo/country-lookup";

/**
 * The analytics region of a request (issue #419, part of #417): trusted client
 * address, then offline country, then region. It never throws and any doubt is
 * `unknown`. It reads nothing but the address Better Auth resolves, and
 * neither stores nor returns that address.
 *
 * Nothing imports this yet. The consent model is unchanged (opt-in worldwide);
 * wiring it to a server-authoritative policy is a later slice.
 */
export function classifyClientRegion(
  source: Request | Headers | undefined,
  options: BetterAuthOptions,
  deps: { database?: CountryDatabase | null; now?: Date } = {},
): AnalyticsRegion {
  try {
    const database = deps.database === undefined ? bundledCountryDatabase() : deps.database;
    const country = lookupCountry(resolveClientIp(source, options), database, deps.now);
    return classifyCountry(country);
  } catch {
    return "unknown";
  }
}
