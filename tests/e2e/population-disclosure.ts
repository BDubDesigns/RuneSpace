import type { Page } from "@playwright/test";

/**
 * Accessible-name contract for the "Characters here" population disclosure
 * (issues #62/#64): the label states the action truthfully with the correct
 * singular/plural form — "Show 1 character here", "Show 2 characters here",
 * or "Hide characters here". The regex intentionally accepts both forms so
 * locators work regardless of how many other characters are present.
 */
export const POPULATION_DISCLOSURE_NAME = /^(Show|Hide) .*characters? here$/;

/** Locator for the population disclosure trigger by its accessible name. */
export function populationDisclosure(page: Page) {
  return page.getByRole("button", { name: POPULATION_DISCLOSURE_NAME });
}
