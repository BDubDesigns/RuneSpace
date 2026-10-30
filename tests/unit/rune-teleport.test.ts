import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance, getItemDefinition } from "@/game/config/balance";
import { ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { adminGrantableItems } from "@/features/admin/admin-format";
import { ITEM_CATEGORY_BY_ITEM_ID } from "@/game/content/item-categories";
import { getItemPresentation, itemQuantityLabel } from "@/game/content/item-presentation";
import { getLocation } from "@/game/content/locations";
import { MERCHANTS } from "@/game/content/merchants";
import {
  getTeleportRune,
  teleportDestinationPresentation,
  TELEPORT_RUNES,
} from "@/game/content/rune-teleports";
import { isItemTransferable } from "@/game/domain/player-trade";
import { planRuneTeleport, RUNE_TELEPORT_REFUSALS } from "@/game/domain/rune-teleport";
import {
  RUNE_TELEPORT_ADVISORY_COPY,
  runeTeleportAdvisory,
} from "@/features/rune-teleport/availability";
import {
  outcomeOfAction,
  outcomeOfReread,
  teleportDurations,
  TELEPORT_DURATIONS,
  TELEPORT_REDUCED_DURATIONS,
} from "@/features/rune-teleport/teleport-timeline";
import type { PlayGameplayState } from "@/server/play";

/**
 * Issue #438 — the Skatboll TP Rune: an ordinary stackable, tradable consumable
 * with approved art and one fixed destination. Every expectation is the issue's
 * locked value; the rules for Use are proven against PostgreSQL in
 * tests/integration/rune-teleport.test.ts.
 */

// `sharp` is Next.js's own image dependency, resolved through `next` as the art scripts do.
const sharp = createRequire(createRequire(join(process.cwd(), "package.json")).resolve("next"))(
  "sharp",
) as (input: string | Buffer) => {
  metadata(): Promise<{ width?: number; height?: number; channels?: number; hasAlpha?: boolean }>;
};

const RUNE = ITEM_IDS.skatbollTpRune;
const balance = getEffectiveGameBalance();

describe("the Skatboll TP Rune item", () => {
  it("is exactly 1,100 g in a stack of five, with no equipment or Use fields", () => {
    const item = getItemDefinition(RUNE, balance)!;
    expect(item).toMatchObject({ massGrams: 1_100, stackLimit: 5 });
    expect(item).not.toHaveProperty("equipment");
  });

  it("is a components-and-supplies item with a clear TP description", () => {
    expect(ITEM_CATEGORY_BY_ITEM_ID[RUNE]).toBe("components-and-supplies");
    const presentation = getItemPresentation(RUNE)!;
    expect(presentation).toMatchObject({
      displayName: "Skatboll TP Rune",
      pluralName: "Skatboll TP Runes",
      textFallback: "TP",
      artworkSrc: "/item-art/skatboll-tp-rune.webp",
    });
    expect(presentation.description).toMatch(/teleport/i);
    expect(presentation.description).toMatch(/Crash Site/);
    expect(presentation.description).toMatch(/Cargo Hold/);
    expect(itemQuantityLabel(RUNE, 2, "Skatboll TP Rune")).toBe("2 Skatboll TP Runes");
  });

  it("is ordinary tradable stock: no NPC sells or buys it back", () => {
    expect(isItemTransferable(RUNE)).toBe(true);
    for (const merchant of MERCHANTS) expect(JSON.stringify(merchant)).not.toContain(RUNE);
  });

  it("is grantable by the existing Admin Console ADD ITEM with no special case", () => {
    expect(adminGrantableItems().map((item) => item.itemId)).toContain(RUNE);
  });

  it("ships the approved master byte-identical and a readable derivative", async () => {
    const master = readFileSync("assets/item-art/skatboll-tp-rune.png");
    expect(createHash("sha256").update(master).digest("hex")).toBe(
      "aeff8beb22a887ac360b39ea1f1ad3048ebfa3835e22b0746a40cc597e983644",
    );
    const masterInfo = await sharp(master).metadata();
    expect(masterInfo).toMatchObject({ width: 1284, height: 1225, channels: 4, hasAlpha: true });
    expect(existsSync("public/item-art/skatboll-tp-rune.webp")).toBe(true);
    const derivative = await sharp("public/item-art/skatboll-tp-rune.webp").metadata();
    expect(derivative).toMatchObject({ width: 640, height: 640, hasAlpha: true });
  });
});

describe("the rune's destination", () => {
  it("is the existing Crash Site on Skatboll, not a new location", () => {
    expect(TELEPORT_RUNES[RUNE]).toEqual({ destinationLocationId: LOCATION_IDS.crashSite });
    expect(getTeleportRune(RUNE)?.destinationLocationId).toBe(LOCATION_IDS.crashSite);
    expect(getLocation(LOCATION_IDS.crashSite)).toBeDefined();
    expect(getTeleportRune(ITEM_IDS.ferriteShale)).toBeUndefined();
    expect(getTeleportRune("constructor")).toBeUndefined();
  });

  it("is labelled with the location's own name and its planet", () => {
    expect(teleportDestinationPresentation(LOCATION_IDS.crashSite)).toEqual({
      locationId: LOCATION_IDS.crashSite,
      name: "Crash Site",
      planetName: "Skatboll",
    });
  });
});

describe("planRuneTeleport", () => {
  const base = {
    stack: { itemId: RUNE, quantity: 3 },
    expectedQuantity: 3,
    currentLocationId: LOCATION_IDS.stillreachLandingStation,
    hasActiveAction: false,
  };

  it("admits any carrier from anywhere else: no level, Rig, Mission or visit input exists", () => {
    expect(planRuneTeleport(base)).toEqual({
      ok: true,
      itemId: RUNE,
      destinationLocationId: LOCATION_IDS.crashSite,
    });
    expect(planRuneTeleport({ ...base, currentLocationId: LOCATION_IDS.theJag })).toMatchObject({
      ok: true,
    });
  });

  it("refuses every other case with a player-facing reason", () => {
    const refused = (override: Partial<typeof base>) => planRuneTeleport({ ...base, ...override });
    expect(refused({ stack: undefined })).toEqual({ ok: false, reason: "stack_not_found" });
    expect(refused({ stack: { itemId: RUNE, quantity: 0 } })).toEqual({
      ok: false,
      reason: "stack_not_found",
    });
    expect(refused({ stack: { itemId: ITEM_IDS.ferriteShale, quantity: 3 } })).toEqual({
      ok: false,
      reason: "not_a_teleport_rune",
    });
    expect(refused({ expectedQuantity: 4 })).toEqual({ ok: false, reason: "stack_changed" });
    expect(refused({ hasActiveAction: true })).toEqual({
      ok: false,
      reason: "another_action_active",
    });
    expect(refused({ currentLocationId: LOCATION_IDS.crashSite })).toEqual({
      ok: false,
      reason: "already_there",
    });
    for (const message of Object.values(RUNE_TELEPORT_REFUSALS)) expect(message).not.toBe("");
  });
});

describe("the advisory view", () => {
  const idle = {
    location: { currentLocationId: LOCATION_IDS.theJag },
    activeAction: undefined,
    travelState: undefined,
    ship: { flight: undefined },
    passenger: { journey: undefined },
  } as unknown as PlayGameplayState;

  it("offers USE RUNE only where it could work, and never decides for the server", () => {
    expect(runeTeleportAdvisory(idle, LOCATION_IDS.crashSite)).toBeUndefined();
    expect(
      runeTeleportAdvisory(
        { ...idle, location: { currentLocationId: LOCATION_IDS.crashSite } },
        LOCATION_IDS.crashSite,
      ),
    ).toBe("already_there");
    expect(
      runeTeleportAdvisory({ ...idle, activeAction: {} as never }, LOCATION_IDS.crashSite),
    ).toBe("activity");
    expect(
      runeTeleportAdvisory({ ...idle, ship: { flight: {} } as never }, LOCATION_IDS.crashSite),
    ).toBe("in_transit");
    for (const copy of Object.values(RUNE_TELEPORT_ADVISORY_COPY)) expect(copy).not.toBe("");
  });
});

describe("the cinematic's timing and outcome rules", () => {
  const stateWith = (arrivalIntent?: string) =>
    ({
      runeTeleport: {
        runes: {},
        ...(arrivalIntent ? { arrival: { intentId: arrivalIntent } } : {}),
      },
    }) as unknown as PlayGameplayState;

  it("keeps the authored phases inside the approved windows", () => {
    expect(TELEPORT_DURATIONS.destabilize).toBeGreaterThanOrEqual(900);
    expect(TELEPORT_DURATIONS.destabilize).toBeLessThanOrEqual(1_500);
    expect(TELEPORT_DURATIONS.collapse).toBeGreaterThanOrEqual(300);
    expect(TELEPORT_DURATIONS.collapse).toBeLessThanOrEqual(500);
    expect(TELEPORT_DURATIONS.reveal).toBeGreaterThanOrEqual(400);
    expect(TELEPORT_DURATIONS.reveal).toBeLessThanOrEqual(700);
  });

  it("gives reduced motion no breakup and only short fades", () => {
    expect(teleportDurations(true)).toBe(TELEPORT_REDUCED_DURATIONS);
    expect(teleportDurations(false)).toBe(TELEPORT_DURATIONS);
    expect(TELEPORT_REDUCED_DURATIONS.destabilize).toBe(0);
    expect(TELEPORT_REDUCED_DURATIONS.collapse).toBeLessThanOrEqual(250);
    expect(TELEPORT_REDUCED_DURATIONS.reveal).toBeLessThanOrEqual(250);
  });

  it("takes the server's ruling for a command it answered", () => {
    const state = stateWith();
    expect(
      outcomeOfAction({
        state,
        teleport: { status: "teleported", intentId: "i", alreadySettled: false },
      }),
    ).toEqual({ kind: "teleported", state });
    expect(
      outcomeOfAction({
        state,
        teleport: { status: "refused", reason: "already_there", message: "No." },
      }),
    ).toEqual({ kind: "refused", message: "No.", state });
    // A plain `{ error }` is not a ruling: the caller re-reads before it believes anything.
    expect(outcomeOfAction({ error: "Your ship is in flight." })).toBeUndefined();
  });

  it("decides an uncertain command only from the durable receipt of its own intent", () => {
    expect(outcomeOfReread(stateWith("mine"), "mine").kind).toBe("teleported");
    // Another intent's arrival, or none, is not this command succeeding: nothing is assumed.
    expect(outcomeOfReread(stateWith("someone-else"), "mine").kind).toBe("unchanged");
    expect(outcomeOfReread(stateWith(), "mine").kind).toBe("unchanged");
    expect(outcomeOfReread(undefined, "mine").kind).toBe("unknown");
  });
});
