import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { parseSetCookieHeader } from "better-auth/cookies";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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
 */
export async function establishAuthenticatedSession(
  browser: Browser,
  displayName: string,
  email: string,
): Promise<{ context: BrowserContext; userId: string }> {
  assertDisposableE2EDatabase();
  const baseURL = resolveBaseURL();
  const userId = randomUUID();
  const password = "sup3r-secret-password";
  const now = new Date();
  await db.insert(authSchema.user).values({
    id: userId,
    name: displayName,
    email,
    emailVerified: false,
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

/** Open the shared Inventory/Equipment drawer directly on its Equipment tab. */
export async function openEquipmentTab(page: Page) {
  await page.getByRole("button", { name: /Inventory/ }).click();
  const dialog = page.getByRole("dialog", { name: "Inventory" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "Equipment", exact: true }).click();
  const equipmentDialog = page.getByRole("dialog", { name: "Equipment" });
  await expect(equipmentDialog).toBeVisible();
  return equipmentDialog;
}

/** Open Equipment through the active mission's contextual Play entry point. */
export async function openEquipmentFromMissionGuidance(page: Page) {
  await page.getByRole("button", { name: "Open Equipment", exact: true }).click();
  const equipmentDialog = page.getByRole("dialog", { name: "Equipment" });
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
 * Prove a Mission-guided beveled control really paints its exterior halo.
 *
 * The guidance state lives on the button, but the button's own `.rs-bevel`
 * clip-path clips anything painted outside it, so the glow must live on an
 * unclipped wrapper. This regression previously passed semantic assertions
 * while rendering no halo, so it checks computed paint, not class names.
 */
export async function expectExteriorMissionHalo(
  control: import("@playwright/test").Locator,
  guidance: "available" | "active",
) {
  await expect(control).toHaveAttribute("data-mission-guidance", guidance);
  const halo = control.locator("xpath=..");
  await expect(halo).toHaveAttribute(
    "data-halo",
    guidance === "active" ? "mission-active" : "mission-available",
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
}
