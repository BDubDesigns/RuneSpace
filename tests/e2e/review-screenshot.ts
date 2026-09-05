import type { Page } from "@playwright/test";
import { resolve } from "node:path";

/** Curated review captures are opt-in; Playwright failure diagnostics remain automatic. */
export async function captureReviewScreenshot(page: Page, filename: string) {
  if (process.env.RUNESPACE_E2E_SCREENSHOTS !== "true") return;
  const directory = process.env.RUNESPACE_E2E_SCREENSHOT_DIR ?? "test-results";
  await page.screenshot({ path: resolve(process.cwd(), directory, filename) });
}
