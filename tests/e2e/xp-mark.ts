import { expect, type Locator } from "@playwright/test";

/**
 * The inline XP mark must track the text it sits in (#304): real text reading
 * `XP`, sized from the surrounding font (never a fixed pixel size), under one
 * line high, coloured as asked, and — measured in the real browser against the
 * same text with the mark swapped for plain `XP` — adding no height to its line
 * box.
 */
export async function expectXpMarkTracksText(container: Locator, expectedColor?: string) {
  const mark = container.locator("[data-xp-mark]").first();
  await expect(mark).toBeVisible();
  await expect
    .poll(() =>
      mark.evaluate((element) => {
        const parent = element.parentElement!;
        const style = getComputedStyle(element);
        const parentFont = parseFloat(getComputedStyle(parent).fontSize);
        const markHeight = element.getBoundingClientRect().height;
        // The nearest block ancestor owns the line box.
        let block: HTMLElement = parent;
        while (getComputedStyle(block).display.startsWith("inline") && block.parentElement) {
          block = block.parentElement;
        }
        const withMark = block.getBoundingClientRect().height;
        const plain = element.cloneNode(true) as HTMLElement;
        plain.removeAttribute("class");
        plain.removeAttribute("style");
        element.replaceWith(plain);
        const withPlain = block.getBoundingClientRect().height;
        plain.replaceWith(element);
        return {
          text: element.textContent,
          scalesWithText: Math.abs(parseFloat(style.fontSize) - parentFont * 0.7) < 0.5,
          underOneLine: markHeight < parentFont,
          lineBoxGrowth: Math.round(Math.abs(withMark - withPlain)),
          color: style.color,
        };
      }),
    )
    .toMatchObject({
      text: "XP",
      scalesWithText: true,
      underOneLine: true,
      lineBoxGrowth: 0,
      ...(expectedColor ? { color: expectedColor } : {}),
    });
}

/** The shared medallion reward tile: the real artwork loaded, not the `XP` text fallback. */
export async function expectXpMedallionLoaded(tile: Locator) {
  const artwork = tile.getByTestId("item-artwork");
  await expect(artwork).toBeVisible();
  await expect(artwork).toHaveAttribute("src", /xp-medallion\.webp/);
  await expect
    .poll(() =>
      artwork.evaluate((element) => {
        const image = element as HTMLImageElement;
        return image.complete && image.naturalWidth > 0;
      }),
    )
    .toBe(true);
  await expect(tile.locator("[data-item-fallback]")).toHaveCount(0);
}
