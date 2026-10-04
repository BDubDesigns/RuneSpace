import { expect, type Locator } from "@playwright/test";

/**
 * The inline Credits icon must track the text it sits in (#290): rendered
 * height equals the adjacent font size at every typography, never a fixed
 * pixel size, and the real SVG must have loaded.
 */
export async function expectCreditsIconTracksText(container: Locator) {
  const icon = container.locator("[data-credits-icon]").first();
  await expect(icon).toBeVisible();
  await expect
    .poll(() =>
      icon.evaluate((element) => {
        const image = element as HTMLImageElement;
        const style = getComputedStyle(image);
        const fontSize = parseFloat(getComputedStyle(image.parentElement!).fontSize);
        return {
          loaded: image.complete && image.naturalWidth > 0,
          heightMatchesText: Math.abs(parseFloat(style.height) - fontSize) < 0.5,
          hidden: image.getAttribute("aria-hidden") === "true" && image.alt === "",
        };
      }),
    )
    .toEqual({ loaded: true, heightMatchesText: true, hidden: true });
}
