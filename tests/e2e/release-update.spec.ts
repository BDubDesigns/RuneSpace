import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import type { Page, Route } from "@playwright/test";
import { db } from "@/db";
import {
  activeActions,
  characterMiningState,
  characterScavengeReveals,
  characters,
} from "@/db/rune-space";
import { LOCATION_IDS } from "@/game/config/foundations";
import { expect, openTestCharacter, test, type TestCharacter } from "./fixtures";
import { seedLegacyStarterCutter } from "./legacy-starter";

/**
 * Issue #412: an already-open tab receives a new deployment, and the Play fault
 * screen's Retry connection really retries.
 *
 * Two real production builds of this tree are made once, the way Coolify makes
 * them: no release id at build time, so the browser has no build-time identity.
 * Build B differs in its client bundle (it drops the E2E Play-fault trigger),
 * so its chunk set is genuinely different. A "deploy" stops the running server
 * and starts the other build on the same origin with the next runtime
 * RUNESPACE_RELEASE_ID, exactly the swap a rollout performs; the browser tab
 * and its session cookie stay open across it. Both servers use this run's
 * disposable database, so a persisted activity is the same row before and after.
 */

const PORT = Number(process.env.RUNESPACE_E2E_RELEASE_PORT ?? 3290);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ROOT = process.cwd();
const BUILD_DIRS = { a: ".next-e2e/a", b: ".next-e2e/b" } as const;
type Build = keyof typeof BUILD_DIRS;

test.use({ baseURL: ORIGIN });
test.describe.configure({ mode: "serial", timeout: 120_000 });

let server: ChildProcess | undefined;
let releaseCounter = 0;

function buildEnv(extra: Record<string, string>) {
  const env: Record<string, string | undefined> = { ...process.env };
  // Coolify configures the release at runtime only, so the build never has one
  // and a server has only the one a deployment gives it.
  delete env.RUNESPACE_RELEASE_ID;
  return { ...env, ...extra } as NodeJS.ProcessEnv;
}

function nextBin() {
  return resolve(ROOT, "node_modules/next/dist/bin/next");
}

async function stopServer() {
  const child = server;
  server = undefined;
  if (!child || child.exitCode !== null) return;
  await new Promise<void>((done) => {
    child.once("exit", () => done());
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
  });
}

async function buildInfo(): Promise<string | undefined> {
  try {
    const response = await fetch(`${ORIGIN}/api/build-info`, { cache: "no-store" });
    return ((await response.json()) as { releaseId?: string }).releaseId;
  } catch {
    return undefined;
  }
}

/** A deployment: the old server goes away, the new build answers on the same origin. */
async function deploy(build: Build, release: string | null = `e2e-release-${++releaseCounter}`) {
  await stopServer();
  const env = buildEnv({
    RUNESPACE_E2E_DIST_DIR: BUILD_DIRS[build],
    PORT: String(PORT),
    ...(release ? { RUNESPACE_RELEASE_ID: release } : {}),
  });
  server = spawn(process.execPath, [nextBin(), "start", "-p", String(PORT)], {
    cwd: ROOT,
    env,
    stdio: "ignore",
  });
  const deadline = Date.now() + 60_000;
  const expected = release ?? "unknown";
  while ((await buildInfo()) !== expected) {
    if (Date.now() > deadline) throw new Error(`build ${build} did not come up as ${expected}`);
    await new Promise((done) => setTimeout(done, 250));
  }
  return expected;
}

test.beforeAll(async () => {
  test.setTimeout(15 * 60_000);
  if ((await buildInfo()) !== undefined) {
    throw new Error(`port ${PORT} is busy; set RUNESPACE_E2E_RELEASE_PORT to a free port`);
  }
  // `next build` rewrites tsconfig.json when given a custom distDir; put it back.
  const tsconfigPath = resolve(ROOT, "tsconfig.json");
  const tsconfig = readFileSync(tsconfigPath, "utf8");
  try {
    for (const [build, flag] of [
      ["a", "true"],
      ["b", ""],
    ] as const) {
      execFileSync(process.execPath, [nextBin(), "build"], {
        cwd: ROOT,
        env: buildEnv({
          RUNESPACE_E2E_DIST_DIR: BUILD_DIRS[build],
          RUNESPACE_E2E_PLAY_ERROR: flag,
        }),
        stdio: "ignore",
      });
    }
  } finally {
    writeFileSync(tsconfigPath, tsconfig);
  }
});

test.afterAll(async () => {
  await stopServer();
  if (existsSync(resolve(ROOT, ".next-e2e")))
    rmSync(resolve(ROOT, ".next-e2e"), { recursive: true });
});

/** The tab's own JavaScript: an in-page marker a document reload destroys. */
async function markDocument(page: Page) {
  // Hydrated, so the release watcher's listeners are attached.
  await page.waitForFunction(() =>
    Boolean((window as unknown as { next?: { router?: unknown } }).next?.router),
  );
  await page.evaluate(() => {
    (window as unknown as { __tabA?: boolean }).__tabA = true;
  });
}
const isStillMarked = (page: Page) =>
  page.evaluate(() => (window as unknown as { __tabA?: boolean }).__tabA === true);
const scriptChunks = (page: Page) =>
  page.evaluate(() =>
    [...document.scripts]
      .map((script) => script.src)
      .filter((src) => src.includes("/_next/static/"))
      .sort(),
  );

/** Emulates a tab the browser backgrounded, and one the player came back to. */
async function setVisibility(page: Page, state: "hidden" | "visible") {
  await page.evaluate((next) => {
    Object.defineProperty(document, "visibilityState", { value: next, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

async function openMining(page: Page, character: TestCharacter) {
  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.theJag })
    .where(eq(characters.id, character.id));
  await seedLegacyStarterCutter(character.id);
  await openTestCharacter(page, character.id);
}

async function persistedMining(characterId: string) {
  const [action] = await db
    .select()
    .from(activeActions)
    .where(eq(activeActions.characterId, characterId));
  const [run] = await db
    .select()
    .from(characterMiningState)
    .where(eq(characterMiningState.characterId, characterId));
  return { startedAt: action?.startedAt.toISOString(), actionId: action?.actionId, run };
}

test.describe("an open tab receives a new deployment", () => {
  test("after the tab returns from the background, without disturbing a running activity", async ({
    page,
    testCharacter,
  }) => {
    await deploy("a");
    await openMining(page, testCharacter);
    await page.getByRole("button", { name: "Start Mining" }).click();
    await expect(page.getByRole("button", { name: "Stop Mining" })).toBeVisible();
    await markDocument(page);
    const before = await persistedMining(testCharacter.id);
    const chunksBefore = await scriptChunks(page);
    let checks = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/build-info")) checks += 1;
    });

    // Hidden while the deployment lands: a background tab asks nothing.
    await setVisibility(page, "hidden");
    const nextRelease = await deploy("b");
    await setVisibility(page, "hidden");
    await page.waitForTimeout(1_500);
    expect(checks).toBe(0);
    expect(await isStillMarked(page)).toBe(true);

    // Back in front of the player: one check, then a real document reload.
    const reloaded = page.waitForEvent("load");
    await setVisibility(page, "visible");
    await reloaded;
    expect(await isStillMarked(page)).toBe(false);
    expect(await buildInfo()).toBe(nextRelease);
    expect(await scriptChunks(page)).not.toEqual(chunksBefore);

    // The server-persisted activity is the same one, still running, not restarted.
    await expect(page.getByRole("button", { name: "Stop Mining" })).toBeVisible();
    const after = await persistedMining(testCharacter.id);
    expect(after.startedAt).toBe(before.startedAt);
    expect(after.actionId).toBe(before.actionId);
    expect(after.run?.runAttempts).toBeGreaterThanOrEqual(before.run?.runAttempts ?? 0);
    expect(after.run?.runSuccesses ?? 0).toBeLessThanOrEqual(after.run?.runAttempts ?? 0);
  });

  test("on the next poll of a visible tab", async ({ page, testCharacter }) => {
    await deploy("a");
    await page.clock.install();
    await openTestCharacter(page, testCharacter.id);
    await markDocument(page);
    await deploy("b");
    const reloaded = page.waitForEvent("load");
    await page.clock.fastForward(61_000);
    await reloaded;
    expect(await isStillMarked(page)).toBe(false);
  });

  test("ignores a server that is down or has no release identity, then loads the real one", async ({
    page,
    testCharacter,
  }) => {
    const release = await deploy("a");
    await openTestCharacter(page, testCharacter.id);
    await markDocument(page);
    const documents: string[] = [];
    page.on("request", (request) => {
      if (request.isNavigationRequest()) documents.push(request.url());
    });

    await stopServer();
    await setVisibility(page, "visible");
    await page.waitForTimeout(1_500);

    await deploy("a", null);
    await setVisibility(page, "visible");
    await page.waitForTimeout(1_500);

    // The same release back again is not a deployment either.
    await deploy("a", release);
    await setVisibility(page, "visible");
    await page.waitForTimeout(1_500);
    expect(await isStillMarked(page)).toBe(true);
    expect(documents).toEqual([]);

    await deploy("b");
    const reloaded = page.waitForEvent("load");
    await setVisibility(page, "visible");
    await reloaded;
    expect(await isStillMarked(page)).toBe(false);
  });

  test("waits for an in-flight command, then loads the new build", async ({
    page,
    testCharacter,
  }) => {
    await deploy("a");
    await openMining(page, testCharacter);
    await expect(page.getByRole("button", { name: "Refresh status" })).toBeVisible();
    await markDocument(page);

    // Hold the first Server Action the click sends, so the command stays in flight.
    let armed = false;
    let held: Route | undefined;
    let heldSeen: (() => void) | undefined;
    const holding = new Promise<void>((done) => (heldSeen = done));
    await page.route("**/play/**", async (route) => {
      const request = route.request();
      if (armed && request.method() === "POST" && request.headers()["next-action"]) {
        armed = false;
        held = route;
        heldSeen?.();
        return;
      }
      await route.continue();
    });
    armed = true;
    await page.getByRole("button", { name: "Refresh status" }).click();
    await holding;

    await deploy("b");
    await setVisibility(page, "visible");
    await page.waitForTimeout(3_000);
    expect(await isStillMarked(page)).toBe(true);

    const reloaded = page.waitForEvent("load");
    await held!.continue();
    await reloaded;
    expect(await isStillMarked(page)).toBe(false);
  });

  test("tries a release once, so a rollout that never converges cannot loop", async ({
    page,
    testCharacter,
  }) => {
    await deploy("a");
    // Every check says "B" while every document still comes from A.
    await page.route("**/api/build-info", (route) =>
      route.fulfill({ json: { releaseId: "e2e-release-never-served" } }),
    );
    const documents: string[] = [];
    page.on("request", (request) => {
      if (request.isNavigationRequest()) documents.push(request.url());
    });
    await openTestCharacter(page, testCharacter.id);
    await markDocument(page);
    const reloaded = page.waitForEvent("load");
    await setVisibility(page, "visible");
    await reloaded;
    expect(await isStillMarked(page)).toBe(false);
    const reloadedDocuments = documents.length;

    await setVisibility(page, "visible");
    await page.waitForTimeout(1_500);
    await setVisibility(page, "visible");
    await page.waitForTimeout(1_500);
    expect(documents.length).toBe(reloadedDocuments);
    await expect(page.locator("[data-location-surface]")).toBeVisible();
  });
});

test.describe("Retry connection after a transient server failure", () => {
  // A persisted row the Play read cannot interpret (an unknown Scavenge outcome)
  // fails only this character's route, the way a table a deploy ran ahead of
  // fails every route; deleting it is the recovery. The fault is the server's, not the tab's, so the tab holds no
  // stale build.
  const fault = async (characterId: string) => {
    await repair(characterId);
    await db
      .insert(characterScavengeReveals)
      .values({ characterId, outcomeId: "e2e-unreadable-outcome", awardQuantity: 0 });
  };
  const repair = async (characterId: string) => {
    await db
      .delete(characterScavengeReveals)
      .where(eq(characterScavengeReveals.characterId, characterId));
  };

  test("a fresh document load recovers once the fault clears", async ({ page, testCharacter }) => {
    await deploy("a");
    await openMining(page, testCharacter);
    const before = await persistedMining(testCharacter.id);
    await fault(testCharacter.id);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Play terminal interrupted" })).toBeVisible();

    // Still failing: Retry connection asks the server again and says so again.
    await page.getByRole("button", { name: "Retry connection" }).click();
    await expect(page.getByRole("heading", { name: "Play terminal interrupted" })).toBeVisible();

    await repair(testCharacter.id);
    const asked = page.waitForRequest(
      (request) => request.isNavigationRequest() && request.url().includes("/play/"),
    );
    await page.getByRole("button", { name: "Retry connection" }).click();
    await asked;
    await expect(page.locator("[data-location-surface]")).toBeVisible();
    expect(await persistedMining(testCharacter.id)).toEqual(before);
  });

  test("a route navigation into Play that failed recovers the same way", async ({
    page,
    testCharacter,
  }) => {
    await deploy("a");
    await openMining(page, testCharacter);
    await page.goto("/characters");
    await expect(page.getByRole("link", { name: "New character" })).toBeVisible();
    await fault(testCharacter.id);
    await page.locator(`a[href="/play/${testCharacter.id}"]`).click();
    await expect(page.getByRole("heading", { name: "Play terminal interrupted" })).toBeVisible();

    await repair(testCharacter.id);
    await page.getByRole("button", { name: "Retry connection" }).click();
    await expect(page.locator("[data-location-surface]")).toBeVisible();
  });
});
