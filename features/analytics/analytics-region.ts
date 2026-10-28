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
 * The 249 officially assigned ISO 3166-1 alpha-2 codes. An allowlist, so a
 * reserved, retired, user-assigned or simply unassigned pair of letters (AC,
 * CP, DG, EA, EZ, FX, IC, SU, TA, UK, EU, UN, XK, ZZ, ...) can never become a
 * country. Kosovo has no assigned code (`XK` is user-assigned), so it is
 * `unknown` here like any other code ISO has not assigned. Changing this set
 * needs ISO's own list as the basis, not a lookup database's output.
 */
const ASSIGNED_COUNTRIES: ReadonlySet<string> = new Set(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ " +
    "BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ " +
    "DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY " +
    "HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
    "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY " +
    "MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
    "NA NC NE NF NG NI NL NO NP NR NU NZ OM " +
    "PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ " +
    "TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
    "UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
  ).split(" "),
);

/**
 * Region of an ISO 3166-1 alpha-2 country code. Anything that is not exactly
 * two uppercase ASCII letters currently assigned to a country is `unknown`. US
 * territories, the Crown Dependencies, overseas territories of EEA states and
 * Switzerland are `other` here: each gets its own region only with a basis.
 */
export function classifyCountry(country: string | null | undefined): AnalyticsRegion {
  if (typeof country !== "string" || !ASSIGNED_COUNTRIES.has(country)) return "unknown";
  if (country === "US") return "us";
  if (country === "GB") return "uk";
  if (EEA_COUNTRIES.has(country)) return "eea";
  return "other";
}
