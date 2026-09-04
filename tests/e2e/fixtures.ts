import { test as base, expect, type Page } from "@playwright/test";
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

/**
 * The ordinary authenticated browser contract:
 * one Better Auth account/session per Playwright worker, with a storage-state
 * file that sibling workers can never overwrite. The auth-schema account is
 * created directly with Better Auth's own password hash, then Better Auth's
 * server API issues the signed browser session cookie. This avoids both the
 * signup and sign-in IP limiters when several workers start together;
 * registration and character creation remain covered by their dedicated
 * special-journey specs.
 */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  workerAuth: [
    async ({ browser }, use, workerInfo) => {
      assertDisposableE2EDatabase();
      const port = process.env.PLAYWRIGHT_PORT ?? "3000";
      const baseURL = process.env.BASE_URL ?? `http://127.0.0.1:${port}`;
      if (!baseURL) throw new Error("Playwright base URL is required for worker authentication");

      const runId = runIdFor();
      const storageStatePath = resolve(
        process.cwd(),
        ".playwright",
        "workers",
        runId,
        `worker-${workerInfo.workerIndex}.json`,
      );
      await mkdir(dirname(storageStatePath), { recursive: true });

      const userId = randomUUID();
      const password = "sup3r-secret-password";
      const email = workerEmail(runId, workerInfo.workerIndex);
      const now = new Date();
      await db.insert(authSchema.user).values({
        id: userId,
        name: `E2E Worker ${workerInfo.workerIndex}`,
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
        throw new Error("Better Auth worker sign-in did not return a session cookie");
      }

      const context = await browser.newContext({ baseURL });
      try {
        await context.addCookies([
          { name: sessionCookie[0], value: sessionCookie[1].value, url: baseURL },
        ]);
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
  await page.waitForURL(new RegExp(`/play/${characterId}$`));
  return characterId;
}
