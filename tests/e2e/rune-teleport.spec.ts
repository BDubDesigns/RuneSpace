import type { Locator, Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterRuneTeleports,
  characters,
  characterSkillXp,
  inventoryStacks,
} from "@/db/rune-space";
import { ACTION_IDS, ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import {
  expect,
  openTestCharacter,
  openUtility,
  test,
  usesDesktopWorkspace,
  utilitySurface,
} from "./fixtures";

/**
 * Skatboll TP Rune (#438): Use from ordinary Inventory Item Details, the
 * confirmation, the server-authoritative teleport and the world-coming-apart
 * cinematic, in the running app. Unit and PostgreSQL coverage own the rules
 * (eligibility, destination, exactly-once settlement, every refusal); this proves
 * what only a browser can: the confirmation costs nothing until TELEPORT, the
 * visible UI breaks apart region by region and portaled Drawers with it, the new
 * world is never visible before the screen is fully black, the durable arrival
 * modal survives a refresh, and no failure leaves the player behind the scrim.
 */

const RUNE = ITEM_IDS.skatbollTpRune;
const DEPARTURE = LOCATION_IDS.theJag;
const CRASH_SITE = LOCATION_IDS.crashSite;

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "sets its own viewports; runs once");
});

async function setUp(characterId: string, quantity = 2, at: string = DEPARTURE) {
  await db
    .delete(characterRuneTeleports)
    .where(eq(characterRuneTeleports.characterId, characterId));
  await db.delete(activeActions).where(eq(activeActions.characterId, characterId));
  await db
    .delete(inventoryStacks)
    .where(and(eq(inventoryStacks.characterId, characterId), eq(inventoryStacks.itemId, RUNE)));
  await db.update(characters).set({ currentLocationId: at }).where(eq(characters.id, characterId));
  await db.insert(inventoryStacks).values({ characterId, itemId: RUNE, quantity });
}

async function runesHeld(characterId: string) {
  const rows = await db
    .select({ quantity: inventoryStacks.quantity })
    .from(inventoryStacks)
    .where(and(eq(inventoryStacks.characterId, characterId), eq(inventoryStacks.itemId, RUNE)));
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}

async function locationOf(characterId: string) {
  const [row] = await db
    .select({ at: characters.currentLocationId })
    .from(characters)
    .where(eq(characters.id, characterId));
  return row?.at;
}

const receipts = (characterId: string) =>
  db
    .select()
    .from(characterRuneTeleports)
    .where(eq(characterRuneTeleports.characterId, characterId));

/** Open Inventory (a modal below desktop width, the docked panel above) and select the rune. */
async function runeDetails(page: Page): Promise<{ surface: Locator; details: Locator }> {
  await openUtility(page, "inventory");
  const surface = utilitySurface(page, "Inventory");
  await expect(surface).toBeVisible();
  await surface.getByRole("button", { name: /Skatboll TP Rune/ }).click();
  const details = surface.locator("[data-rune-teleport-details]");
  await expect(details).toBeVisible();
  return { surface, details };
}

const confirmation = (page: Page) => page.getByRole("dialog", { name: "Teleport confirmation" });
const arrival = (page: Page) => page.getByRole("dialog", { name: "Teleport arrival" });
/**
 * The cinematic has run to its end. It first has to have started: TELEPORT closes
 * the confirmation (a short fade) before the breakup begins, so "no phase" alone
 * would be true both before and after.
 */
async function finished(page: Page) {
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-rs-teleport", /./, { timeout: 10_000 });
  await expect(root).not.toHaveAttribute("data-rs-teleport", /./, { timeout: 20_000 });
}

type Sample = { phase: string; black: number; place: string; at: number };

/**
 * Records, on every animation frame while the cinematic runs, the phase, the
 * black layer's opacity and the place name the page currently shows, plus the
 * pose of every breakup region the first frame it is held behind the collapse.
 */
async function startSampler(page: Page) {
  await page.evaluate(() => {
    const samples: Sample[] = [];
    const poses: Record<string, { transform: string; opacity: number; width: number }> = {};
    const w = window as unknown as { __tp: Sample[]; __tpPoses: typeof poses; __tpStop: boolean };
    w.__tp = samples;
    w.__tpPoses = poses;
    w.__tpStop = false;
    const nameOf = (el: Element) =>
      el.getAttribute("data-rs-region") ??
      (el.matches("[data-play-rail]")
        ? "rail"
        : el.matches("[data-utility-workspace]")
          ? "workspace"
          : "objectives");
    const tick = () => {
      const root = document.documentElement;
      const phase = root.getAttribute("data-rs-teleport");
      if (phase) {
        const black = document.querySelector("[data-teleport-black]");
        samples.push({
          phase,
          black: black ? Number(getComputedStyle(black).opacity) : -1,
          place: (document.querySelector("main h1")?.textContent ?? "").toLowerCase(),
          at: performance.now(),
        });
        if (phase === "collapse") {
          for (const el of document.querySelectorAll(
            "[data-rs-region], [data-play-rail], [data-utility-workspace], [data-objectives-region]",
          )) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            const style = getComputedStyle(el);
            poses[nameOf(el)] = {
              transform: style.transform,
              opacity: Number(style.opacity),
              width: rect.width,
            };
          }
        }
      }
      if (!w.__tpStop) requestAnimationFrame(tick);
    };
    tick();
  });
}

async function readSampler(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as {
      __tp: Sample[];
      __tpPoses: Record<string, { transform: string; opacity: number; width: number }>;
      __tpStop: boolean;
    };
    w.__tpStop = true;
    return { samples: w.__tp, poses: w.__tpPoses };
  });
}

/** The phases in the order they first appeared. */
const phaseOrder = (samples: Sample[]) => [...new Set(samples.map((sample) => sample.phase))];

/**
 * The invariant the whole feature exists for: the departure scene is what the
 * player sees until the black is fully opaque. The confirmed destination is
 * committed and rendered *behind* that black (so the page may already name it
 * late in the collapse), but never on a frame where any of the departure world
 * could be seen through the scrim, and the destination appears nowhere during
 * the breakup itself.
 */
function expectNothingRevealedEarly(
  samples: Sample[],
  departureName: string,
  destinationName: string,
) {
  const departure = departureName.toLowerCase();
  const destination = destinationName.toLowerCase();
  expect(
    samples.some((sample) => sample.phase === "destabilize" || sample.phase === "collapse"),
  ).toBe(true);
  for (const sample of samples) {
    if (sample.phase === "destabilize") expect(sample.place).toBe(departure);
    if (sample.phase !== "reveal" && sample.place !== departure) {
      expect(sample.place).toBe(destination);
      expect(sample.black, "the new world is only ever rendered behind opaque black").toBe(1);
    }
    if (sample.black < 1) {
      // Anything less than opaque still shows the departure world, never the new one.
      if (sample.phase !== "reveal") expect(sample.place).toBe(departure);
    }
  }
  const firstReveal = samples.find((sample) => sample.phase === "reveal");
  expect(firstReveal, "the cinematic reached its reveal").toBeDefined();
  expect(firstReveal!.black).toBeGreaterThan(0.95);
  // The collapse really did go fully black before the reveal began.
  expect(
    samples.some((sample) => sample.phase === "collapse" && sample.black === 1),
    "fully opaque black was reached",
  ).toBe(true);
  expect(samples.at(-1)?.place).toBe(destination);
}

async function useRune(page: Page, details: Locator) {
  await details.locator("[data-rune-use]").click();
  await expect(confirmation(page)).toBeVisible();
  await confirmation(page).locator("[data-rune-teleport-confirm]").click();
}

test.describe("phone", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test("confirmation costs nothing until TELEPORT, then breakup → black → destination → durable arrival", async ({
    page,
    testCharacter,
  }) => {
    test.slow();
    await setUp(testCharacter.id);
    await openTestCharacter(page, testCharacter.id);
    const departure = (await page.locator("main h1").first().textContent()) ?? "";
    expect(departure).not.toBe("");
    const xpBefore = await db
      .select()
      .from(characterSkillXp)
      .where(eq(characterSkillXp.characterId, testCharacter.id));

    const { details } = await runeDetails(page);
    await expect(details.locator("[data-rune-teleport-destination]")).toContainText(
      "Crash Site, Skatboll",
    );

    // Cancel, Escape and tapping outside are all free: no command, no cost.
    await details.locator("[data-rune-use]").click();
    const dialog = confirmation(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Teleport to Skatboll?" })).toBeVisible();
    await expect(dialog).toContainText("One Skatboll TP Rune is used up.");
    await expect(dialog).toContainText("Only you travel, with everything you carry and wear.");
    await expect(dialog).toContainText(
      "Your ship, its fuel and its Cargo Hold stay where they are parked.",
    );
    await expect(dialog.locator("[data-rune-teleport-cancel]")).toBeFocused();
    await dialog.locator("[data-rune-teleport-cancel]").click();
    await expect(dialog).toHaveCount(0);
    await details.locator("[data-rune-use]").click();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(details.locator("[data-rune-use]")).toBeFocused();
    await details.locator("[data-rune-use]").click();
    await page.mouse.click(4, 4);
    await expect(dialog).toHaveCount(0);
    expect(await runesHeld(testCharacter.id)).toBe(2);
    expect(await locationOf(testCharacter.id)).toBe(DEPARTURE);
    expect(await receipts(testCharacter.id)).toHaveLength(0);
    await expect(page.locator("html")).not.toHaveAttribute("data-rs-teleport", /./);

    // TELEPORT: the whole sequence, in order.
    await startSampler(page);
    await useRune(page, details);
    // While it runs the screen is not interactive: the scrim catches the pointer.
    await expect(page.locator("[data-teleport-scrim]")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.elementFromPoint(195, 420)?.closest("[data-teleport-scrim]") !== null,
      ),
    ).toBe(true);
    await finished(page);
    const { samples, poses } = await readSampler(page);

    expect(phaseOrder(samples)).toEqual(["destabilize", "collapse", "reveal"]);
    expectNothingRevealedEarly(samples, departure, "Crash Site");
    const span = samples.at(-1)!.at - samples[0]!.at;
    expect(span).toBeGreaterThan(1_800);
    expect(span).toBeLessThan(8_000);
    // The phone's major regions, the footer, launcher and the portaled Inventory
    // Drawer all left their places.
    for (const name of ["header", "scene", "activity", "footer", "launcher", "drawer"]) {
      expect(poses[name], `${name} is part of the breakup`).toBeDefined();
      expect(poses[name]!.transform).not.toBe("none");
      expect(poses[name]!.opacity).toBeLessThan(1);
    }

    // The server's answer: one rune, the Crash Site, one receipt, nothing else.
    expect(await runesHeld(testCharacter.id)).toBe(1);
    expect(await locationOf(testCharacter.id)).toBe(CRASH_SITE);
    expect(await receipts(testCharacter.id)).toHaveLength(1);
    expect(
      await db
        .select()
        .from(characterSkillXp)
        .where(eq(characterSkillXp.characterId, testCharacter.id)),
    ).toEqual(xpBefore);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);

    // The durable arrival, over the real destination, only once the world is whole.
    await expect(arrival(page)).toBeVisible();
    await expect(arrival(page).locator("[data-rune-arrival-place]")).toHaveText(/crash site/i);
    await expect(arrival(page)).toContainText("Welcome to Skatboll");
    // A refresh before it is acknowledged brings it back, and moves nothing.
    await page.reload();
    await expect(arrival(page)).toBeVisible();
    expect(await runesHeld(testCharacter.id)).toBe(1);
    await arrival(page).locator("[data-rune-arrival-continue]").click();
    await expect(arrival(page)).toHaveCount(0);
    await expect
      .poll(async () => (await receipts(testCharacter.id))[0]?.arrivalAcknowledgedAt)
      .toBeTruthy();
    await page.reload();
    await expect(page.locator("main h1").first()).toHaveText(/crash site/i);
    await expect(arrival(page)).toHaveCount(0);
    expect(await runesHeld(testCharacter.id)).toBe(1);
    expect(await receipts(testCharacter.id)).toHaveLength(1);
  });

  test("reduced motion gets a short fade: no flying panels, still fully black before the new world", async ({
    page,
    testCharacter,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setUp(testCharacter.id);
    await openTestCharacter(page, testCharacter.id);
    const departure = (await page.locator("main h1").first().textContent()) ?? "";
    const { details } = await runeDetails(page);

    await startSampler(page);
    await useRune(page, details);
    await finished(page);
    const { samples, poses } = await readSampler(page);

    expectNothingRevealedEarly(samples, departure, "Crash Site");
    // No region ever left its place or faded on its own.
    for (const pose of Object.values(poses)) {
      expect(pose.transform).toBe("none");
      expect(pose.opacity).toBe(1);
    }
    expect(samples.at(-1)!.at - samples[0]!.at).toBeLessThan(2_500);
    await expect(arrival(page)).toBeVisible();
    expect(await locationOf(testCharacter.id)).toBe(CRASH_SITE);
  });

  test("a stale tab's refused command recovers the view and spends nothing", async ({
    page,
    testCharacter,
  }) => {
    test.slow();
    await setUp(testCharacter.id);
    await openTestCharacter(page, testCharacter.id);
    const { surface, details } = await runeDetails(page);
    // Another tab walks the character to the destination meanwhile.
    await db
      .update(characters)
      .set({ currentLocationId: CRASH_SITE })
      .where(eq(characters.id, testCharacter.id));

    await useRune(page, details);
    await finished(page);

    await expect(surface.locator("[data-rune-teleport-notice]")).toContainText(
      "You are already there. The rune was not used.",
    );
    expect(await runesHeld(testCharacter.id)).toBe(2);
    expect(await receipts(testCharacter.id)).toHaveLength(0);
    await expect(page.locator("[data-teleport-scrim]")).toHaveCount(0);
    await expect(arrival(page)).toHaveCount(0);
    // The control is advisory-disabled now (already there), so focus lands on the
    // details rather than being lost to the page body.
    await expect(surface.locator("[data-rune-use]")).toBeDisabled();
    await expect(surface.locator("[data-rune-teleport-details]")).toBeFocused();
  });

  test("a busy activity is refused by the server without interrupting it", async ({
    page,
    testCharacter,
  }) => {
    test.slow();
    await setUp(testCharacter.id);
    await openTestCharacter(page, testCharacter.id);
    const { surface, details } = await runeDetails(page);
    // Resolved a long way ahead, so the server's lazy reconcile (which would stop
    // a Mining run this character has no cutter for) leaves it genuinely running.
    await db.insert(activeActions).values({
      characterId: testCharacter.id,
      actionId: ACTION_IDS.ferriteShaleMining,
      startedAt: new Date(),
      resolvedThroughAt: new Date(Date.now() + 3_600_000),
    });

    await useRune(page, details);
    await finished(page);

    await expect(surface.locator("[data-rune-teleport-notice]")).toContainText(
      "Finish what you are doing first.",
    );
    expect(await runesHeld(testCharacter.id)).toBe(2);
    expect(await locationOf(testCharacter.id)).toBe(DEPARTURE);
    const [action] = await db
      .select()
      .from(activeActions)
      .where(eq(activeActions.characterId, testCharacter.id));
    expect(action?.actionId).toBe(ACTION_IDS.ferriteShaleMining);
  });

  test("a command lost before the server never spends a rune, and the view recovers", async ({
    page,
    testCharacter,
  }) => {
    test.slow();
    await setUp(testCharacter.id);
    await openTestCharacter(page, testCharacter.id);
    const { surface, details } = await runeDetails(page);
    let dropped = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (
        request.method() === "POST" &&
        request.headers()["next-action"] &&
        (request.postData() ?? "").includes("intentId")
      ) {
        dropped += 1;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await useRune(page, details);
    await finished(page);

    expect(dropped).toBe(1);
    await expect(surface.locator("[data-rune-teleport-notice]")).toContainText("nothing was used");
    await expect(page.locator("[data-teleport-scrim]")).toHaveCount(0);
    expect(await runesHeld(testCharacter.id)).toBe(2);
    expect(await locationOf(testCharacter.id)).toBe(DEPARTURE);
    expect(await receipts(testCharacter.id)).toHaveLength(0);
  });

  test("a response lost after the server committed is settled from the server, once", async ({
    page,
    testCharacter,
  }) => {
    test.slow();
    await setUp(testCharacter.id);
    await openTestCharacter(page, testCharacter.id);
    const departure = (await page.locator("main h1").first().textContent()) ?? "";
    const { details } = await runeDetails(page);
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (
        request.method() === "POST" &&
        request.headers()["next-action"] &&
        (request.postData() ?? "").includes("intentId")
      ) {
        await route.fetch();
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await startSampler(page);
    await useRune(page, details);
    await finished(page);
    const { samples } = await readSampler(page);

    // The browser never heard the answer, yet the re-read finds the receipt: the
    // world is the destination, once, and the arrival is owed.
    expectNothingRevealedEarly(samples, departure, "Crash Site");
    await expect(arrival(page)).toBeVisible();
    expect(await runesHeld(testCharacter.id)).toBe(1);
    expect(await receipts(testCharacter.id)).toHaveLength(1);
    expect(await locationOf(testCharacter.id)).toBe(CRASH_SITE);
  });

  test("a refresh in the middle of the breakup never traps the player behind black", async ({
    page,
    testCharacter,
  }) => {
    test.slow();
    await setUp(testCharacter.id);
    await openTestCharacter(page, testCharacter.id);
    const { details } = await runeDetails(page);
    await useRune(page, details);
    await expect(page.locator("html")).toHaveAttribute("data-rs-teleport", "destabilize");
    await page.reload();
    await expect(page.locator("html")).not.toHaveAttribute("data-rs-teleport", /./);
    await expect(page.locator("[data-teleport-scrim]")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    // The command had not been issued yet: nothing was spent or moved.
    expect(await runesHeld(testCharacter.id)).toBe(2);
    expect(await locationOf(testCharacter.id)).toBe(DEPARTURE);
  });

  test("two tabs confirming together teleport once and spend one rune", async ({
    page,
    testCharacter,
  }) => {
    test.slow();
    await setUp(testCharacter.id, 3);
    await openTestCharacter(page, testCharacter.id);
    const other = await page.context().newPage();
    await other.setViewportSize({ width: 390, height: 844 });
    await openTestCharacter(other, testCharacter.id);

    const first = await runeDetails(page);
    const second = await runeDetails(other);
    await first.details.locator("[data-rune-use]").click();
    await second.details.locator("[data-rune-use]").click();
    await Promise.all([
      confirmation(page).locator("[data-rune-teleport-confirm]").click(),
      confirmation(other).locator("[data-rune-teleport-confirm]").click(),
    ]);
    await Promise.all([finished(page), finished(other)]);

    expect(await runesHeld(testCharacter.id)).toBe(2);
    expect(await locationOf(testCharacter.id)).toBe(CRASH_SITE);
    expect(await receipts(testCharacter.id)).toHaveLength(1);
    await other.close();
  });
});

for (const viewport of [
  {
    name: "tablet",
    width: 820,
    height: 1180,
    regions: ["header", "scene", "activity", "footer", "drawer"],
  },
  {
    name: "desktop",
    width: 1440,
    height: 900,
    regions: ["header", "scene", "activity", "rail", "workspace"],
  },
]) {
  test(`${viewport.name}: every major region breaks apart behind the same black`, async ({
    page,
    testCharacter,
  }) => {
    test.slow();
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await setUp(testCharacter.id);
    await openTestCharacter(page, testCharacter.id);
    expect(usesDesktopWorkspace(page)).toBe(viewport.name === "desktop");
    const departure = (await page.locator("main h1").first().textContent()) ?? "";
    const { details } = await runeDetails(page);

    await startSampler(page);
    await useRune(page, details);
    const black = page.locator("[data-teleport-black]");
    await expect(black).toHaveCSS("opacity", "1", { timeout: 10_000 });
    // Full-bleed: it covers the whole viewport, bars and Drawers included.
    const box = await black.boundingBox();
    expect(box).toMatchObject({ x: 0, y: 0, width: viewport.width, height: viewport.height });
    for (const [x, y] of [
      [4, 4],
      [viewport.width - 4, 4],
      [4, viewport.height - 4],
      [viewport.width - 4, viewport.height - 4],
      [viewport.width / 2, viewport.height / 2],
    ] as const) {
      expect(
        await page.evaluate(
          ([px, py]) =>
            document.elementFromPoint(px!, py!)?.closest("[data-teleport-scrim]") !== null,
          [x, y],
        ),
      ).toBe(true);
    }
    await finished(page);
    const { samples, poses } = await readSampler(page);

    expectNothingRevealedEarly(samples, departure, "Crash Site");
    for (const name of viewport.regions) {
      expect(poses[name], `${name} is part of the ${viewport.name} breakup`).toBeDefined();
      expect(poses[name]!.transform).not.toBe("none");
      expect(poses[name]!.opacity).toBeLessThan(1);
    }
    await expect(arrival(page)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  });
}

test("from Stillreach the rune lands at the very same Crash Site", async ({
  page,
  testCharacter,
}) => {
  test.slow();
  await page.setViewportSize({ width: 390, height: 844 });
  await setUp(testCharacter.id, 1, LOCATION_IDS.stillreachLandingStation);
  await openTestCharacter(page, testCharacter.id);
  const { details } = await runeDetails(page);
  await useRune(page, details);
  await finished(page);
  await expect(arrival(page).locator("[data-rune-arrival-place]")).toHaveText(/crash site/i);
  expect(await locationOf(testCharacter.id)).toBe(CRASH_SITE);
  expect(await runesHeld(testCharacter.id)).toBe(0);
});
