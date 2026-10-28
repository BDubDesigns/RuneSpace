/**
 * Pure country-to-region classification for analytics (issue #419, part of
 * #417). It only names a region. It decides nothing about consent: the shipped
 * model stays opt-in worldwide (`ANALYTICS_CONSENT_MODEL`), and no live code
 * imports this module yet.
 *
 * The regions are a coarse grouping of jurisdictions with different analytics
 * rules, kept deliberately small. `other` means "a real country that is not
 * US, EEA or UK", not "approved for anything"; `unknown` means the location is
 * missing, malformed, untrusted or not a country. Callers must treat both, and
 * every future region, as the most restrictive case.
 */

export type AnalyticsRegion = "us" | "eea" | "uk" | "other" | "unknown";

/** EU member states plus Iceland, Liechtenstein and Norway (the EEA). */
const EEA_COUNTRIES: ReadonlySet<string> = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "IS",
  "LI",
  "NO",
]);

/**
 * Codes that look like a country but are not one: ISO 3166-1 user-assigned
 * ranges (AA, QM-QZ, XA-XZ, ZZ) and exceptional reservations that name a union
 * or a placeholder, never a visitor's country.
 */
const NOT_A_COUNTRY = /^(?:AA|Q[M-Z]|X[A-Z]|ZZ)$/;
const EXCEPTIONAL_RESERVATIONS: ReadonlySet<string> = new Set(["AP", "EU", "UK", "UN"]);

/**
 * Region of an ISO 3166-1 alpha-2 country code. Anything that is not exactly
 * two uppercase ASCII letters naming a real country is `unknown`. US
 * territories, the Crown Dependencies, overseas territories of EEA states and
 * Switzerland are `other` here: each gets its own region only with a basis.
 */
export function classifyCountry(country: string | null | undefined): AnalyticsRegion {
  if (typeof country !== "string" || !/^[A-Z]{2}$/.test(country)) return "unknown";
  if (NOT_A_COUNTRY.test(country) || EXCEPTIONAL_RESERVATIONS.has(country)) return "unknown";
  if (country === "US") return "us";
  if (country === "GB") return "uk";
  if (EEA_COUNTRIES.has(country)) return "eea";
  return "other";
}
