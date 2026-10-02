import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { parseSetCookieHeader } from "better-auth/cookies";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { dirname, resolve } from "node:path";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import * as rune from "@/db/rune-space";
import { PORTRAIT_IDS } from "@/game/config/foundations";
import { auth } from "@/server/auth";
import * as characters from "@/server/characters";
import * as ownership from "@/server/ownership";
import {
  cleanupTestCharacter,
  cleanupTestUser,
  createCharacterForUser,
  grantFixtureEarlyAccess,
  testPlayerIdentity,
} from "../integration/fixtures";
import { assertDisposableE2EDatabase } from "./test-database";

export type WorkerAuth = {
  email: string;
  storageStatePath: string;
  userId: string;
  runId: string;
};

export type TestCharacter = {
  id: string;
  displayName: string;
};

type TestFixtures = {
  testCharacter: TestCharacter;
};

type WorkerFixtures = {
  workerAuth: WorkerAuth;
};

function safeToken(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "local";
}

function runIdFor() {
  return safeToken(
    process.env.RUNESPACE_E2E_RUN_ID ?? process.env.RUNESPACE_DISPOSABLE_TEST_DB ?? "local",
  );
}

function workerEmail(runId: string, workerIndex: number) {
  return `e2e-${runId}-w${workerIndex}-${randomUUID().slice(0, 8)}@example.com`;
}

function resolveBaseURL(): string {
  const port = process.env.PLAYWRIGHT_PORT ?? "3000";
  const baseURL = process.env.BASE_URL ?? `http://127.0.0.1:${port}`;
  if (!baseURL) throw new Error("Playwright base URL is required for session establishment");
  return baseURL;
}

/**
 * Establish a real authenticated browser session for a fresh Better Auth
 * user, bypassing the real `/register` and `/sign-in` HTTP forms entirely.
 *
 * Better Auth's default rate limit specially restricts `/sign-in`, `/sign-up`,
 * `/change-password`, and `/change-email` to 3 requests per rolling 10-second
 * window (see `better-auth`'s `rate-limiter` module), keyed globally across
 * every Playwright worker on this one local test run (all traffic shares one
 * loopback IP). Two or three specs submitting the real registration form
 * concurrently is enough to exceed that budget and silently strand a test on
 * `/register`. The auth-schema account is created directly with Better Auth's
 * own password hash, then Better Auth's server API issues the signed browser
 * session cookie directly — indistinguishable to the app from a real sign-in,
 * without touching the rate-limited path. Callers that specifically need to
 * exercise the registration or sign-in *form* itself (not just an
 * authenticated session) must not use this helper.
 *
 * The account receives fixture Early Access (issue #223) by default, so
 * ordinary gameplay journeys play regardless of the global public-gameplay
 * switch that the serial gameplay-access spec toggles. Journeys that prove the
 * closed gate pass `{ earlyAccess: false }`.
 */
export async function establishAuthenticatedSession(
  browser: Browser,
  displayName: string,
  email: string,
  options: { earlyAccess?: boolean } = {},
): Promise<{ context: BrowserContext; userId: string }> {
  assertDisposableE2EDatabase();
  const baseURL = resolveBaseURL();
  const userId = randomUUID();
  const password = "sup3r-secret-password";
  const now = new Date();
  // An explicitly verified account (issue #221): sign-in requires a verified
  // email, exactly as it does for real players.
  await db.insert(authSchema.user).values({
    id: userId,
    ...testPlayerIdentity(userId, displayName),
    email,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(authSchema.account).values({
    id: randomUUID(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: await hashPassword(password),
  });
  if (options.earlyAccess !== false) await grantTestEarlyAccess(userId);

  const signIn = await auth.api.signInEmail({
    headers: new Headers({ host: new URL(baseURL).host }),
    body: { email, password },
    returnHeaders: true,
  });
  const sessionCookie = [
    ...parseSetCookieHeader(signIn.headers.get("set-cookie") ?? "").entries(),
  ].find(([name, cookie]) => name.endsWith("session_token") && cookie.value);
  if (!sessionCookie) {
    throw new Error("Better Auth sign-in did not return a session cookie");
  }

  const context = await browser.newContext({ baseURL });
  await context.addCookies([
    { name: sessionCookie[0], value: sessionCookie[1].value, url: baseURL },
  ]);
  return { context, userId };
}

/**
 * The ordinary authenticated browser contract:
 * one Better Auth account/session per Playwright worker, with a storage-state
 * file that sibling workers can never overwrite. Session establishment goes
 * through `establishAuthenticatedSession` (see its docstring for why this
 * avoids the signup/sign-in rate limiters when several workers start
 * together); registration and character creation remain covered by their
 * dedicated special-journey specs.
 */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  workerAuth: [
    async ({ browser }, use, workerInfo) => {
      assertDisposableE2EDatabase();
      const runId = runIdFor();
      const storageStatePath = resolve(
        process.cwd(),
        ".playwright",
        "workers",
        runId,
        `worker-${workerInfo.workerIndex}.json`,
      );
      await mkdir(dirname(storageStatePath), { recursive: true });

      const email = workerEmail(runId, workerInfo.workerIndex);
      const { context, userId } = await establishAuthenticatedSession(
        browser,
        `E2E Worker ${workerInfo.workerIndex}`,
        email,
      );
      try {
        const page = await context.newPage();
        try {
          await page.goto("/characters");
          await page.waitForURL(/\/characters$/, { timeout: 15_000 });
        } catch (error) {
          const body = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
          throw new Error(
            `Worker authentication did not reach /characters (at ${page.url()}): ${body}`,
            { cause: error },
          );
        }
        await expect(page.getByRole("link", { name: "New character" })).toBeVisible();
        await context.storageState({ path: storageStatePath });
      } finally {
        await context.close();
      }

      await use({ email, storageStatePath, userId, runId });
      await cleanupTestUser(db, authSchema, rune, userId);
    },
    { scope: "worker" },
  ],

  storageState: async ({ workerAuth }, use) => {
    await use(workerAuth.storageStatePath);
  },

  testCharacter: async ({ workerAuth }, use, testInfo) => {
    const characterName = `E2E ${testInfo.testId.slice(-12)} ${randomUUID().slice(0, 4)}`;
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      workerAuth.userId,
      characterName,
      PORTRAIT_IDS.evaSalvageWelder,
      { seedLegacyStarterCutter: false },
    );

    try {
      await use({ id: character.id, displayName: character.displayName });
    } finally {
      // Characters are test-owned and the schema intentionally limits an
      // account to three slots. Removing only this character lets one worker
      // safely service more than three independent tests without touching a
      // sibling worker's account or state.
      await cleanupTestCharacter(db, rune, character.id);
    }
  },
});

export { expect };

/**
 * Fixture Early Access for a test account (issue #223): ensures its player
 * account and grants account-level Early Access directly in the disposable
 * database. Registration journeys call it after verification so their
 * reservation → Play flow is independent of the global public-gameplay switch.
 */
export async function grantTestEarlyAccess(userId: string) {
  assertDisposableE2EDatabase();
  const account = await ownership.ensurePlayerAccount(userId);
  await grantFixtureEarlyAccess(db, rune, account.id);
}

/** Resolve a fixture account id by its (unique) email address. */
export async function userIdForEmail(email: string): Promise<string> {
  const rows = await db
    .select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(eq(authSchema.user.email, email))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("No fixture account exists for that email address");
  return row.id;
}

/** Navigate directly to the exact test-owned character, never the first row in a list. */
export async function openTestCharacter(page: Page, characterId: string) {
  await page.goto(`/play/${characterId}`);
  await page.waitForURL(new RegExp(`/play/${characterId}(?:\\?[^#]*)?$`));
  return characterId;
}

/** Navigate to the dedicated, route-backed Map surface inside Play. */
export async function openMapSurface(page: Page) {
  if (new URL(page.url()).searchParams.get("surface") !== "map") {
    await page.getByRole("link", { name: "Map" }).click();
    await page.waitForURL(/\/play\/[^/?]+\?surface=map$/);
  }
  await expect(page.getByRole("group", { name: "Local map" })).toBeVisible();
}

/**
 * Play has two compositions (#286): below 1280px the phone/tablet one, where a
 * utility is a modal Drawer reached from the bottom navigation or the floating
 * Chat launcher, and from 1280px the desktop workspace, where the same four
 * utilities are docked panels reached from a tab list in the right rail. A spec
 * that is about a feature, not about the composition, uses these helpers so one
 * script drives either; a spec about the composition itself says so and sets
 * its own viewport.
 */
export const DESKTOP_WORKSPACE_MIN_WIDTH = 1280;

/**
 * The widest viewport that still gets the phone/tablet composition: for a spec
 * about a modal Drawer's geometry at a wide desktop-sized screen, which at 1280px
 * and beyond is no longer a Drawer but the docked workspace.
 */
export const WIDEST_COMPACT_VIEWPORT = {
  width: DESKTOP_WORKSPACE_MIN_WIDTH - 1,
  height: 900,
} as const;

export function usesDesktopWorkspace(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= DESKTOP_WORKSPACE_MIN_WIDTH;
}

export type PlayUtility = "chat" | "inventory" | "character" | "missions";

/** The control that reaches Chat: the docked Chat tab, or the phone's floating launcher. */
export function chatEntry(page: Page): Locator {
  return usesDesktopWorkspace(page)
    ? page.getByRole("tablist", { name: "Play utilities" }).getByRole("tab", { name: /^Chat/ })
    : page.locator("[data-chat-social-launcher]");
}

/** The count badge on that control, when anything needs attention. */
export function chatAttentionBadge(page: Page): Locator {
  return usesDesktopWorkspace(page)
    ? page.locator('[data-utility-tab-badge="chat"]')
    : page.locator("[data-chat-social-attention]");
}

/**
 * A utility's container as the active composition presents it: its docked
 * panel at desktop width, its modal dialog below it. `name` is the label the
 * panel carries — "Chat", "Inventory", "Equipment" (the Inventory panel's other
 * tab), "Character", or "Mission Log".
 */
export function utilitySurface(
  page: Page,
  name: "Chat" | "Inventory" | "Equipment" | "Character" | "Mission Log",
): Locator {
  return usesDesktopWorkspace(page)
    ? page.locator(`[data-docked-utility="${name}"]`)
    : page.getByRole("dialog", { name });
}

/** Open a utility the way a player does in the active composition. */
export async function openUtility(page: Page, utility: PlayUtility): Promise<void> {
  if (usesDesktopWorkspace(page)) {
    const labels = {
      chat: /^Chat/,
      inventory: /^Inventory/,
      character: /^Character/,
      missions: /^Missions/,
    } as const;
    const tab = page
      .getByRole("tablist", { name: "Play utilities" })
      .getByRole("tab", { name: labels[utility] });
    if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    return;
  }
  if (utility === "chat") {
    await page.locator("[data-chat-social-launcher]").click();
    return;
  }
  const names = { inventory: /Inventory/, character: "Character", missions: /Missions/ } as const;
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: names[utility] })
    .click();
}

/** Open Chat and return its container (a modal dialog below desktop width, the docked panel above). */
export async function openChatSurface(page: Page): Promise<Locator> {
  await openUtility(page, "chat");
  const surface = utilitySurface(page, "Chat");
  await expect(surface).toBeVisible();
  return surface;
}

/**
 * A phone's Chat Drawer is dismissed with its Close; the desktop dock is not
 * modal and has nothing to dismiss, so Chat simply stays where it is and the
 * page has no dialog.
 */
export async function dismissChat(page: Page, surface: Locator): Promise<void> {
  if (usesDesktopWorkspace(page)) {
    await expect(surface).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    return;
  }
  await surface.getByRole("button", { name: "Close chat" }).click();
  await expect(surface).toHaveCount(0);
}

/**
 * Make `utility` this character's desktop home for every page of `context`,
 * before any page script runs (the saved preference is per character and per
 * browser, in `localStorage`). With Chat as the home it is the visible utility
 * from the moment Play loads and reads what it shows, so a journey about
 * *attention* — a mention, a Whisper arriving while the player is busy elsewhere —
 * starts its observer on another home. Below desktop width it is harmless: the
 * preference only chooses what the dock shows.
 */
export async function preferHomeUtility(
  context: BrowserContext,
  characterId: string,
  utility: PlayUtility,
): Promise<void> {
  await context.addInitScript(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [`runespace:play-home-utility:${characterId}`, utility],
  );
}

/**
 * Get another utility on screen in place of Chat's home, so Chat is not the
 * visible one — what a player using Inventory looks like to the Chat tab's
 * attention badge. At phone width Chat is never visible until opened, so this
 * does nothing.
 */
export async function stepAwayFromChat(page: Page): Promise<void> {
  if (usesDesktopWorkspace(page)) await openUtility(page, "inventory");
}

/**
 * Dismiss the open utility the way the active composition does: Escape closes
 * a phone's modal Drawer; at desktop width a docked utility is not modal, so
 * "closing" it is its Back-to-home control (nothing is open when the home is).
 */
export async function closeUtility(page: Page): Promise<void> {
  if (!usesDesktopWorkspace(page)) {
    await page.keyboard.press("Escape");
    return;
  }
  const back = page.locator("[data-utility-return-home]");
  if (await back.isVisible()) await back.click();
}

/** Open the shared Inventory/Equipment surface directly on its Equipment tab. */
export async function openEquipmentTab(page: Page) {
  await openUtility(page, "inventory");
  const inventory = utilitySurface(page, "Inventory");
  await expect(inventory).toBeVisible();
  await inventory.getByRole("tab", { name: "Equipment", exact: true }).click();
  const equipmentDialog = utilitySurface(page, "Equipment");
  await expect(equipmentDialog).toBeVisible();
  return equipmentDialog;
}

/** Open Equipment through the active mission's contextual Play entry point. */
export async function openEquipmentFromMissionGuidance(page: Page) {
  await page.getByRole("button", { name: "Open Equipment", exact: true }).click();
  const equipmentDialog = utilitySurface(page, "Equipment");
  await expect(equipmentDialog).toBeVisible();
  await expect(
    equipmentDialog.getByRole("tab", { name: "Equipment", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  return equipmentDialog;
}

/**
 * Open one NPC's canonical conversation hub (#164). `Talk to <NPC>` no longer
 * commits to a single winning sequence — it presents the conversations that are
 * currently available with that NPC.
 */
export async function openNpcConversation(page: Page, npcName: string) {
  await page.getByRole("button", { name: new RegExp(`Talk to ${npcName}`) }).click();
  const conversation = page.getByRole("dialog", { name: `${npcName} conversation` });
  await expect(conversation).toBeVisible();
  await expect(conversation.locator("[data-conversation-hub]")).toBeVisible();
  return conversation;
}

/** Select one hub entry and play its authored dialogue sequence. */
export async function openConversationEntry(
  conversation: import("@playwright/test").Locator,
  entryName: string | RegExp,
) {
  await conversation.getByRole("button", { name: entryName }).click();
  await expect(conversation.locator("[data-dialogue-text]")).toBeVisible();
  return conversation;
}

/** Open the NPC's conversation and go straight into one entry's dialogue. */
export async function openNpcDialogue(page: Page, npcName: string, entryName: string | RegExp) {
  const conversation = await openNpcConversation(page, npcName);
  return openConversationEntry(conversation, entryName);
}

/**
 * Resolve a `--rs-*` custom property to its computed color, the way
 * `expectExteriorMissionHalo`'s neutral-surface probe does: exact token hex
 * values are not a durable contract, but this lets a test compare what an
 * element actually painted against the canonical token it's supposed to
 * carry (see issue #215's skill-accent coverage).
 */
export async function resolvedCssVarColor(page: Page, cssVar: string): Promise<string> {
  return page.evaluate((varName) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${varName})`;
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, cssVar);
}

/**
 * Prove a Mission-guided beveled control really paints its exterior halo.
 *
 * The guidance state lives on the button, but the button's own `.rs-bevel`
 * clip-path clips anything painted outside it, so the glow must live on an
 * unclipped wrapper. This regression previously passed semantic assertions
 * while rendering no halo, so it checks computed paint, not class names.
 */
export async function expectExteriorMissionHalo(
  control: import("@playwright/test").Locator,
  guidance: "available" | "active" | "turn_in",
) {
  await expect(control).toHaveAttribute("data-mission-guidance", guidance);
  const halo = control.locator("xpath=..");
  await expect(halo).toHaveAttribute(
    "data-halo",
    { active: "mission-active", available: "mission-available", turn_in: "mission-turn-in" }[
      guidance
    ],
  );
  const paint = await halo.evaluate((element) => {
    const haloStyle = getComputedStyle(element);
    const button = element.firstElementChild;
    return {
      haloClipPath: haloStyle.clipPath,
      haloOverflow: haloStyle.overflow,
      haloFilter: haloStyle.filter,
      buttonClipPath: button ? getComputedStyle(button).clipPath : "missing",
    };
  });
  // The button is clipped, so it cannot paint its own halo...
  expect(paint.buttonClipPath).not.toBe("none");
  expect(paint.buttonClipPath).not.toBe("missing");
  // ...and the halo is painted by an element that is not clipped.
  expect(paint.haloClipPath).toBe("none");
  expect(paint.haloOverflow).toBe("visible");
  expect(paint.haloFilter).toContain("drop-shadow");
  // The Mission colour lives on the edge ring and the exterior halo, never
  // inside: the control sits on the ordinary dark control surface (a tinted or
  // translucent fill lets the halo wash through) with no blurred inset glow.
  const interior = await control.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--rs-surface-control)";
    document.body.append(probe);
    const neutral = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const style = getComputedStyle(element);
    const blurredInset = style.boxShadow.split(/,(?![^(]*\))/).some((layer) => {
      const lengths = layer.match(/-?\d+(?:\.\d+)?px/g) ?? [];
      return layer.includes("inset") && parseFloat(lengths[2] ?? "0") > 0;
    });
    return { background: style.backgroundColor, neutral, blurredInset };
  });
  expect(interior.background).toBe(interior.neutral);
  expect(interior.blurredInset).toBe(false);
}

type ScreenshotDiff = {
  width: number;
  height: number;
  /** Clearly changed pixels anywhere in the element. */
  changed: number;
  /** Clearly changed pixels within the outer band of each side: top, right, bottom, left. */
  sides: [number, number, number, number];
};

/** Width, in CSS pixels, of the outer band of each side that a focus ring must reach. */
const FOCUS_RING_BAND_CSS_PX = 12;

async function clearFocus(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/**
 * Center the control in the viewport. An element screenshot captures whatever
 * is painted over the element's box, so a control left under the fixed bottom
 * navigation would compare the navigation with itself.
 */
async function centerInViewport(control: import("@playwright/test").Locator) {
  await control.evaluate((element) => element.scrollIntoView({ block: "center" }));
}

/**
 * Compare two screenshots of the same element by decoding them in the browser
 * (no image dependency), counting pixels whose color clearly changed.
 */
async function diffElementScreenshots(
  page: Page,
  before: Buffer,
  after: Buffer,
): Promise<ScreenshotDiff> {
  const scale = await page.evaluate(() => window.devicePixelRatio);
  return page.evaluate(
    async ({ before, after, band }) => {
      const decode = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d")!;
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [a, b] = await Promise.all([decode(before), decode(after)]);
      if (a.width !== b.width || a.height !== b.height) {
        throw new Error(`Screenshot size changed: ${a.width}x${a.height} → ${b.width}x${b.height}`);
      }
      const sides: [number, number, number, number] = [0, 0, 0, 0];
      let changed = 0;
      for (let y = 0; y < a.height; y += 1) {
        for (let x = 0; x < a.width; x += 1) {
          const i = (y * a.width + x) * 4;
          let delta = 0;
          for (let channel = 0; channel < 3; channel += 1) {
            delta += Math.abs((a.data[i + channel] ?? 0) - (b.data[i + channel] ?? 0));
          }
          if (delta <= 60) continue;
          changed += 1;
          if (y < band) sides[0] += 1;
          if (x >= a.width - band) sides[1] += 1;
          if (y >= a.height - band) sides[2] += 1;
          if (x < band) sides[3] += 1;
        }
      }
      return { width: a.width, height: a.height, changed, sides };
    },
    {
      before: before.toString("base64"),
      after: after.toString("base64"),
      band: Math.ceil(FOCUS_RING_BAND_CSS_PX * scale),
    },
  );
}

/**
 * Prove a beveled control's keyboard focus ring really paints (#173).
 *
 * `.rs-bevel`'s clip-path once clipped the focus outline away while
 * `getComputedStyle()` still reported it, so this compares real screenshots of
 * the control at rest and keyboard-focused. The focused control must change
 * along every side — a ring, not a tint — including on top of Mission
 * guidance, which proves focus stays a separate mark from the green/blue
 * treatment.
 */
export async function expectKeyboardFocusRingPaints(control: import("@playwright/test").Locator) {
  const page = control.page();
  await centerInViewport(control);
  await clearFocus(page);
  const resting = await control.screenshot({ animations: "disabled" });
  // Keyboard modality, so a scripted focus matches :focus-visible like Tab does.
  await page.keyboard.press("Shift");
  await control.focus();
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  const focused = await control.screenshot({ animations: "disabled" });
  await clearFocus(page);

  const diff = await diffElementScreenshots(page, resting, focused);
  expect(diff.changed).toBeGreaterThanOrEqual(diff.width + diff.height);
  const [top, right, bottom, left] = diff.sides;
  expect(top).toBeGreaterThanOrEqual(diff.width / 2);
  expect(bottom).toBeGreaterThanOrEqual(diff.width / 2);
  expect(left).toBeGreaterThanOrEqual(diff.height / 2);
  expect(right).toBeGreaterThanOrEqual(diff.height / 2);
}

/**
 * Prove pointer focus does not show the keyboard focus ring (#173).
 *
 * Presses on the control and releases off it, so the control takes pointer
 * focus without being activated, then compares it to its resting pixels.
 */
export async function expectPointerFocusWithoutRing(control: import("@playwright/test").Locator) {
  const page = control.page();
  await centerInViewport(control);
  await clearFocus(page);
  await page.mouse.move(0, 0);
  const resting = await control.screenshot({ animations: "disabled" });
  const box = (await control.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(false);
  const pointerFocused = await control.screenshot({ animations: "disabled" });
  await clearFocus(page);

  const diff = await diffElementScreenshots(page, resting, pointerFocused);
  expect(diff.changed).toBeLessThanOrEqual(Math.ceil(diff.width * diff.height * 0.002));
}
