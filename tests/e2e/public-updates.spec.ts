import { expect, test } from "@playwright/test";
import { resolveArticleArt } from "@/game/content/article-art";
import { NPC_IDS } from "@/game/config/foundations";

const updateSlug = "runespace-is-starting-to-feel-like-a-game";
const updateTitle = "RuneSpace Is Starting to Feel Like a Game";

test.describe("public Updates", () => {
  test("lists published Updates and renders an article and its patch notes", async ({ page }) => {
    await page.goto("/updates");

    await expect(page).toHaveTitle("Updates — RuneSpace");
    await expect(page.getByRole("heading", { name: "Updates", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Public" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Home", exact: true })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(page.getByRole("link", { name: "Updates", exact: true })).toHaveAttribute(
      "href",
      "/updates",
    );
    await expect(page.getByRole("link", { name: updateTitle, exact: true })).toHaveAttribute(
      "href",
      `/updates/${updateSlug}`,
    );
    const updateListItem = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: updateTitle, exact: true }) });
    await expect(updateListItem.getByText("September 8, 2026", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: updateTitle, exact: true }).click();
    await expect(page).toHaveURL(`/updates/${updateSlug}`);
    await expect(page).toHaveTitle(`${updateTitle} — RuneSpace`);
    await expect(page.getByRole("heading", { name: updateTitle, level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Patch notes", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Added", level: 3 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Changed", level: 3 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Fixed", level: 3 })).toHaveCount(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `/updates/${updateSlug}`,
    );
  });

  test("renders the Holo Hollow Update with its town hero", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/updates/holo-hollow-opens-for-business");

    await expect(
      page.getByRole("heading", { name: "Holo Hollow Opens for Business", level: 1 }),
    ).toBeVisible();
    const hero = page.getByRole("img", { name: /main street of Holo Hollow/ });
    await hero.scrollIntoViewIfNeeded();
    await expect(hero).toBeVisible();
    // The committed file actually loads rather than rendering a broken image.
    await expect
      .poll(() => hero.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth))
      .toBeGreaterThan(0);
    const box = (await hero.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });

  test("returns a normal 404 for an unknown Update slug", async ({ page }) => {
    const response = await page.goto("/updates/not-a-real-update");

    expect(response?.status()).toBe(404);
  });

  test("keeps the article contained on a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/updates/${updateSlug}`);

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    const image = page.getByRole("img", { name: /Location view/ });
    const box = await image.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });
});

test("Rare Finds renders canonical Topaz only in its article", async ({ page }) => {
  await page.goto("/updates");
  await expect(page.locator(".rs-update-figure")).toHaveCount(0);
  await page.goto("/updates/rare-finds");
  const figure = page.locator(".rs-update-figure");
  await expect(figure).toHaveCount(1);
  await expect(figure.locator("figcaption")).toHaveText("Uncut Topaz");
  await expect(figure.locator("img")).toHaveAttribute("src", /uncut-topaz/);
  await expect
    .poll(() =>
      figure
        .locator("img")
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
});

for (const width of [1280, 390]) {
  test(`ordered item/NPC figures wrap or stack and clear Patch Notes at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/updates/rare-finds");
    // Unit coverage renders multiple authored item/NPC blocks through the real
    // component. This browser fixture reuses its actual server-rendered frame
    // to prove CSS wrapping/stacking with long prose and a short tall-portrait
    // group, without publishing test prose or adding an application test route.
    const npcArt = resolveArticleArt({ kind: "npc", npcId: NPC_IDS.curly });
    await page.locator(".rs-update-body").evaluate((body, art) => {
      const item = body.querySelector("figure")!.cloneNode(true) as HTMLElement;
      const portrait = item.cloneNode(true) as HTMLElement;
      portrait.classList.replace("rs-update-figure--item", "rs-update-figure--npc");
      portrait.classList.replace("rs-update-figure--right", "rs-update-figure--left");
      const image = portrait.querySelector("img")!;
      image.removeAttribute("srcset");
      image.removeAttribute("sizes");
      image.src = art.src;
      image.alt = art.accessibleDescription;
      image.width = 400;
      image.height = 500;
      portrait.querySelector("figcaption")!.textContent = art.displayName;
      const gemProse = document.createElement("p");
      gemProse.textContent = "Gem paragraph. ".repeat(100);
      const npcProse = document.createElement("p");
      npcProse.textContent = "Short portrait paragraph.";
      body.replaceChildren(item, gemProse, portrait, npcProse);
    }, npcArt);
    const figures = page.locator(".rs-update-figure");
    await expect(figures).toHaveCount(2);
    for (const image of await figures.locator("img").all()) {
      await expect
        .poll(() =>
          image.evaluate(
            (element: HTMLImageElement) => element.complete && element.naturalWidth > 0,
          ),
        )
        .toBe(true);
      const shape = await image.evaluate((element: HTMLImageElement) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return {
          fit: style.objectFit,
          width: box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
          height: box.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
          naturalRatio: element.naturalWidth / element.naturalHeight,
        };
      });
      expect(shape.fit).toBe("contain");
      expect(shape.width / shape.height).toBeCloseTo(shape.naturalRatio, 2);
    }
    const layout = await page.locator(".rs-update-body").evaluate((body) => {
      const figures = [...body.querySelectorAll("figure")];
      return figures.map((figure) => {
        const box = figure.getBoundingClientRect();
        const paragraph = figure.nextElementSibling!;
        // Text line boxes, rather than the paragraph's full-width block box,
        // demonstrate that the prose really flows beside then below the frame.
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        const lines = [...range.getClientRects()];
        return {
          float: getComputedStyle(figure).cssFloat,
          x: box.x,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          center: box.x + box.width / 2,
          bodyCenter: body.getBoundingClientRect().x + body.getBoundingClientRect().width / 2,
          lines: lines.map((line) => ({ x: line.x, right: line.right, top: line.top })),
        };
      });
    });
    for (const [index, figure] of layout.entries()) {
      expect(figure.x).toBeGreaterThanOrEqual(0);
      expect(figure.right).toBeLessThanOrEqual(width);
      if (width === 390) {
        expect(figure.float).toBe("none");
        expect(Math.abs(figure.center - figure.bodyCenter)).toBeLessThan(1);
        expect(figure.lines[0]!.top).toBeGreaterThanOrEqual(figure.bottom);
      } else {
        expect(figure.float).toBe(index === 0 ? "right" : "left");
        const beside = figure.lines.filter((line) => line.top < figure.bottom);
        expect(beside.length).toBeGreaterThan(0);
        for (const line of beside) {
          if (index === 0) expect(line.right).toBeLessThan(figure.x);
          else expect(line.x).toBeGreaterThan(figure.right);
        }
        if (index === 0) expect(figure.lines.some((line) => line.top > figure.bottom)).toBe(true);
      }
    }
    const patch = (await page
      .locator('section[aria-labelledby="patch-notes-heading"]')
      .boundingBox())!;
    expect(patch.y).toBeGreaterThan(layout[1]!.bottom);
    expect(layout[1]!.top).toBeGreaterThan(layout[0]!.bottom);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
}
