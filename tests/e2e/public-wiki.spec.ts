import { expect, test } from "@playwright/test";

const articleSlug = "getting-started";
const articleTitle = "Getting Started";
const articleTitles = [
  "Getting Started",
  "Missions",
  "Skills & Progression",
  "Mining & Refining",
  "Cargo Hold & Welding",
  "Practice Welding",
  "Inventory & Equipment",
  "Power Cells",
  "Credits & Trading",
  "Player Trading",
  "Travel & Scavenging",
  "Holo Hollow",
  "Wade Rusk",
  "Tansy Rusk",
  "Bix Weller",
  "Renn Calder",
  "Mara Kells",
  "Curly",
  "Work Orders",
  "Fabrication & Tinkering",
  "Chat & Community Rules",
  "Safety & Privacy",
];

/** Every Mission guide: title, then its permanent slug. */
const missionGuides = [
  ["Walk It Off", "mission-walk-it-off"],
  ["Cut Your Teeth", "mission-cut-your-teeth"],
  ["Waste Not", "mission-waste-not"],
  ["Hold It Together", "mission-hold-it-together"],
  ["Keep the Change", "mission-keep-the-change"],
  ["10,000 Hours", "mission-10000-hours"],
  ["Return the Favor", "mission-return-the-favor"],
  ["Break It Down", "mission-break-it-down"],
  ["Brace Yourself", "mission-brace-yourself"],
  ["Wheel Be Right Back", "mission-wheel-be-right-back"],
  ["Thrust Issues", "mission-thrust-issues"],
  ["10,001 Hours", "mission-10001-hours"],
  ["Out of the Weather", "mission-out-of-the-weather"],
  ["A Cut Above", "mission-a-cut-above"],
  ["Cutting Costs", "mission-cutting-costs"],
  ["Curly Must-Stash", "mission-curly-must-stash"],
] as const;

/** The index's category headings, in the order the page renders them. */
const categoryHeadings = [
  "Getting Started",
  "Work",
  "Gear & Credits",
  "Places & Travel",
  "People",
  "Community & Safety",
];

test.describe("public Wiki", () => {
  test("lists every article and renders one with its sections", async ({ page }) => {
    await page.goto("/wiki");

    await expect(page).toHaveTitle("Wiki — RuneSpace");
    await expect(page.getByRole("heading", { name: "Wiki", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Public" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Home", exact: true })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(page.getByRole("link", { name: "Updates", exact: true })).toHaveAttribute(
      "href",
      "/updates",
    );
    await expect(page.getByRole("link", { name: "Wiki", exact: true })).toHaveAttribute(
      "href",
      "/wiki",
    );

    for (const title of articleTitles) {
      await expect(page.getByRole("link", { name: title, exact: true }).first()).toBeVisible();
    }

    await page.getByRole("link", { name: articleTitle, exact: true }).first().click();
    await expect(page).toHaveURL(`/wiki/${articleSlug}`);
    await expect(page).toHaveTitle(`${articleTitle} — RuneSpace Wiki`);
    await expect(page.getByRole("heading", { name: articleTitle, level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The early loop", level: 2 })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `/wiki/${articleSlug}`,
    );
  });

  test("reads as a landing page: an intro, one way in, and compact category panels", async ({
    page,
  }) => {
    await page.goto("/wiki");

    // Two sections, not twenty article cards.
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "Start here",
      "Browse by category",
    ]);

    // The spotlight points at the existing Getting Started article, not a new one.
    const startHere = page.locator("section", {
      has: page.getByRole("heading", { name: "Start here", level: 2 }),
    });
    await expect(
      startHere.getByRole("link", { name: "Getting Started", exact: true }),
    ).toHaveAttribute("href", "/wiki/getting-started");

    // The six categories are the page's navigation, each with its own copy.
    await expect(page.getByRole("heading", { level: 3 })).toHaveText(categoryHeadings);

    const browse = page.locator("section", {
      has: page.getByRole("heading", { name: "Browse by category", level: 2 }),
    });
    await expect(browse.getByRole("listitem")).toHaveCount(articleTitles.length);

    // Every article is still one tap away — no category route in between.
    for (const title of articleTitles) {
      await expect(browse.getByRole("link", { name: title, exact: true })).toHaveCount(1);
    }
  });

  test("keeps the landing page free of per-article summary cards", async ({ page }) => {
    await page.goto("/wiki");

    // The old index repeated every article's summary; only the spotlight has one now.
    await expect(page.getByRole("link", { name: "Read article" })).toHaveCount(0);
  });

  test("renders a character article from the People category", async ({ page }) => {
    await page.goto("/wiki");
    await page.getByRole("link", { name: "Wade Rusk", exact: true }).click();

    await expect(page).toHaveURL("/wiki/wade-rusk");
    await expect(page).toHaveTitle("Wade Rusk — RuneSpace Wiki");
    await expect(page.getByRole("heading", { name: "Wade Rusk", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Where to find him", level: 2 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Tansy Rusk" })).toBeVisible();
  });

  test("links the Missions directory once and keeps the Mission guides off the index", async ({
    page,
  }) => {
    await page.goto("/wiki");

    await expect(page.getByRole("link", { name: "Missions", exact: true })).toHaveCount(1);
    for (const [title] of missionGuides) {
      await expect(page.getByRole("link", { name: title, exact: true })).toHaveCount(0);
    }
  });

  test("lists all sixteen Mission guides on the hub and opens each as its own article", async ({
    page,
  }) => {
    await page.goto("/wiki/missions");

    expect(missionGuides).toHaveLength(16);
    for (const [title, slug] of missionGuides) {
      await expect(page.getByRole("link", { name: title, exact: true })).toHaveCount(1);
      await expect(page.getByRole("link", { name: title, exact: true })).toHaveAttribute(
        "href",
        `/wiki/${slug}`,
      );
    }

    await page.getByRole("link", { name: "Brace Yourself", exact: true }).click();
    await expect(page).toHaveURL("/wiki/mission-brace-yourself");
    await expect(page).toHaveTitle("Brace Yourself — RuneSpace Wiki");
    await expect(page.getByRole("heading", { name: "Brace Yourself", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Where it begins", level: 2 })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "/wiki/mission-brace-yourself",
    );

    // Every guide leads back to the hub.
    await page.getByRole("link", { name: "Missions", exact: true }).first().click();
    await expect(page).toHaveURL("/wiki/missions");
  });

  test("keeps the Missions hub and long and short guides contained on a narrow viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    for (const path of [
      "/wiki/missions",
      "/wiki/mission-waste-not",
      "/wiki/mission-brace-yourself",
      "/wiki/mission-thrust-issues",
    ]) {
      await page.goto(path);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        path,
      ).toBeLessThanOrEqual(390);
    }
  });

  test("returns a normal 404 for an unknown Wiki slug", async ({ page }) => {
    const response = await page.goto("/wiki/not-a-real-article");

    expect(response?.status()).toBe(404);
  });

  test("keeps the article contained on a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/wiki/${articleSlug}`);

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
});
