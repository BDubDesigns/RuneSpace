/**
 * Canonical player-facing mass formatter.
 *
 * Grams are RuneSpace's only authoritative unit. This module owns *presentation
 * only*: `formatMassGrams` renders integer gram quantities into the single
 * deterministic `g` / `kg` form required by Issue #116. Domain, server, and
 * persistence code continues to carry and calculate integer grams.
 *
 * Display contract (deterministic, locale-independent):
 * - <  1000 g → "<n> g"  (integer grams)
 * - >= 1000 g → "<k>[.<frac>] kg" with up to three decimals, trailing zeroes
 *               stripped, no floating-point noise, and a plain "." decimal.
 *
 * Implementation uses integer arithmetic (whole kilograms + remainder) so
 * binary floating-point never leaks into output. The formatter expects
 * valid RuneSpace mass data — finite, non-negative integer grams — and throws
 * consistently with existing pure domain helpers rather than inventing a
 * valid-looking mass from malformed input.
 */
export function formatMassGrams(grams: number): string {
  if (!Number.isFinite(grams) || !Number.isInteger(grams) || grams < 0) {
    throw new RangeError("Mass must be a finite non-negative integer gram value");
  }

  if (grams < 1000) return `${grams} g`;

  const wholeKg = Math.trunc(grams / 1000);
  const remainder = grams % 1000;
  if (remainder === 0) return `${wholeKg} kg`;

  const frac = String(remainder).padStart(3, "0").replace(/0+$/, "");
  return `${wholeKg}.${frac} kg`;
}
