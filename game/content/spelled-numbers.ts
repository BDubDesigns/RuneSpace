/**
 * Whole numbers spelled out the way RuneSpace dialogue writes them (#230).
 *
 * Dialogue that quotes a shop price or a price-derived total reads the number
 * from the merchant registry and spells it here, so an authored line can never
 * keep saying a price the shop no longer charges. Deliberately small: dialogue
 * only ever quotes everyday Credit amounts, so anything outside 0..99 is a
 * content error rather than a case to spell.
 */
const UNITS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
] as const;

const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** `36` → `"thirty-six"`. */
export function spelledNumber(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 99) {
    throw new RangeError(`Dialogue spells whole numbers from 0 to 99, not ${value}`);
  }
  if (value < UNITS.length) return UNITS[value]!;
  const tens = TENS[Math.floor(value / 10)]!;
  const units = value % 10;
  return units === 0 ? tens : `${tens}-${UNITS[units]}`;
}

/** `36` → `"Thirty-six"`, for a number that opens a sentence. */
export function spelledNumberCapitalized(value: number): string {
  const spelled = spelledNumber(value);
  return spelled.charAt(0).toUpperCase() + spelled.slice(1);
}
