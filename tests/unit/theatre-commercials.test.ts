import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { THEATRE_PRE_ROLL_AD_IDS } from "@/game/config/foundations";
import {
  PRE_ROLL_DURATION_MS,
  THEATRE_PRE_ROLL_SLOTS,
  theatreViewerReady,
} from "@/game/content/theatre";

/**
 * Issue #491, Stage D — the three finished pre-roll commercials, proven against the studio films
 * themselves: each slot names a registered Holo Film Studio film; each is exactly the designed
 * length; the owner-approved scripts are on screen word for word; the Skatboll spot pans real
 * approved location art; and nothing in any of them is audio or a claim nobody approved.
 *
 * The owner approves each spot individually before the stack that adds them merges; this file keeps
 * them from drifting from the approved scripts and timing in the meantime. Whether a gag is funny
 * and legible is judged by eye (the studio's contact-sheet review), never by a test.
 */

const ROOT = resolve(process.cwd());
const STUDIO = join(ROOT, "tools/holo-film-studio/src");

type Built = {
  markup: string;
  cues: { at: number; dur: number; target: string }[];
  duration: number;
  scenes: { id: string; caption: string; start: number; end: number }[];
};
type Film = {
  id: string;
  title: string;
  width: number;
  height: number;
  assets: string[];
  build(): Built;
};

async function loadStudioFilm(id: string): Promise<Film> {
  const url = pathToFileURL(join(STUDIO, "films", id, "index.js")).href;
  return ((await import(/* @vite-ignore */ url)) as { default: Film }).default;
}
async function loadConfig(id: string) {
  const url = pathToFileURL(join(STUDIO, "films", id, "config.js")).href;
  return (await import(/* @vite-ignore */ url)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const sourcesOf = (id: string) => {
  const dir = join(STUDIO, "films", id);
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"))
    .join("\n");
};
const text = (markup: string) =>
  [...markup.matchAll(/>([^<>]+)</g)].map((match) => match[1]!.replaceAll("&apos;", "'")).join(" ");

describe("the pre-roll slots and their commercials", () => {
  it("are all filled, so the viewer is offered", () => {
    expect(THEATRE_PRE_ROLL_SLOTS.every((slot) => slot.filmId !== undefined)).toBe(true);
    expect(theatreViewerReady()).toBe(true);
    expect(THEATRE_PRE_ROLL_SLOTS.map((slot) => slot.id)).toEqual([
      THEATRE_PRE_ROLL_AD_IDS.deWhat,
      THEATRE_PRE_ROLL_AD_IDS.visitSkatboll,
      THEATRE_PRE_ROLL_AD_IDS.fedhex,
    ]);
  });

  it("each name a registered studio film, once", () => {
    const registry = readFileSync(join(STUDIO, "films/index.js"), "utf8");
    const ids = [...registry.matchAll(/\{ id: '([a-z0-9-]+)'/g)].map((match) => match[1]);
    const filmIds = THEATRE_PRE_ROLL_SLOTS.map((slot) => slot.filmId!);
    expect(new Set(filmIds).size).toBe(3);
    for (const filmId of filmIds) {
      expect(ids.filter((id) => id === filmId)).toHaveLength(1);
      expect(registry).toMatch(new RegExp(`id: '${filmId}'[^\\n]*kind: 'commercial'`));
    }
  });

  for (const slot of THEATRE_PRE_ROLL_SLOTS) {
    describe(`${slot.title} (${slot.filmId})`, () => {
      it("is titled as the advertiser the owner locked, at the film's own size", async () => {
        const film = await loadStudioFilm(slot.filmId!);
        expect(film.id).toBe(slot.filmId);
        expect(film.title).toBe(slot.title);
        expect([film.width, film.height]).toEqual([1280, 720]);
      });

      it("runs exactly the designed length, in contiguous captioned scenes", async () => {
        const built = (await loadStudioFilm(slot.filmId!)).build();
        expect(PRE_ROLL_DURATION_MS).toBe(15_000);
        expect(built.duration).toBe(PRE_ROLL_DURATION_MS);
        let cursor = 0;
        for (const scene of built.scenes) {
          expect(scene.start).toBe(cursor);
          expect(scene.caption.trim().length).toBeGreaterThan(20);
          cursor = scene.end;
        }
        expect(cursor).toBe(PRE_ROLL_DURATION_MS);
        // Nothing is still moving after the spot is over.
        for (const cue of built.cues) expect(cue.at + cue.dur).toBeLessThanOrEqual(15_001);
      });

      it("is silent: no audio is requested anywhere in it", () => {
        expect(sourcesOf(slot.filmId!)).not.toMatch(
          /\bAudio\b|AudioContext|<audio|<video|\.mp3|\.ogg|\.wav|speechSynthesis/,
        );
      });

      it("keeps its art to approved RuneSpace assets that exist", async () => {
        const film = await loadStudioFilm(slot.filmId!);
        for (const asset of film.assets) {
          expect(asset).toMatch(/^\/(location-scenes|branding)\/[a-z0-9-]+\.webp$/);
          expect(existsSync(join(ROOT, "public", asset)), asset).toBe(true);
        }
        // Every image the markup draws is one it declares for preloading.
        const drawn = [...film.build().markup.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
        expect([...new Set(drawn)].sort()).toEqual([...film.assets].sort());
      });
    });
  }
});

describe("DeWHAT?: the approved script, with consistent capitals", () => {
  it("has the six-line escalating argument in the approved order, with its capitals", async () => {
    const { TEXT } = await loadConfig("commercial-dewhat");
    expect(TEXT.opening.join(" ")).toBe("Power's out! What do we do?!");
    expect(
      TEXT.lines.map((line: { who: number; lines: string[] }) => [line.who, line.lines.join(" ")]),
    ).toEqual([
      [2, "DeWhat."],
      [1, "That's what I'm asking! Do what?!"],
      [2, "No, DeWHAT!"],
      [1, "WHAT DO WE DO?!"],
      [2, "DeWHAT!"],
      [1, "I DON'T KNOW WHAT!"],
    ]);
  });

  it("ends on the exact approved slogan and the sign, and puts every line on screen", async () => {
    const { TEXT } = await loadConfig("commercial-dewhat");
    expect(`${TEXT.brand} ${TEXT.slogan.join(" ")}`).toBe(
      "DeWHAT? Sometimes you gotta DeWhat you wanna do™.",
    );
    expect(TEXT.sign).toEqual(["DeWHAT?", "EMERGENCY POWER ANNEX"]);
    // The logo is DeWHAT? (only the e lowercase, with its question mark); spoken DeWhat, shouted DeWHAT.
    expect(TEXT.brand).toBe("DeWHAT?");
    const spoken = JSON.stringify([TEXT.opening, TEXT.lines, TEXT.slogan]);
    expect(spoken).not.toMatch(/DeWh?at\?/i);
    expect(JSON.stringify(TEXT)).not.toMatch(/DEWHAT/);
    const shown = text((await loadStudioFilm("commercial-dewhat")).build().markup);
    for (const line of [
      "Power's out!",
      "DeWhat.",
      "No, DeWHAT!",
      "WHAT DO WE DO?!",
      "DeWHAT!",
      "DeWHAT?",
      "EMERGENCY POWER ANNEX",
      "Sometimes you gotta",
      "DeWhat you wanna do™.",
    ]) {
      expect(shown, line).toContain(line);
    }
  });

  it("invents no product, policy or guarantee for DeWHAT?", async () => {
    const built = (await loadStudioFilm("commercial-dewhat")).build();
    const everything = `${text(built.markup)} ${built.scenes.map((scene) => scene.caption).join(" ")}`;
    expect(everything).not.toMatch(
      /guarantee|warranty|free |% off|credits?\b|price|24\/7|always on/i,
    );
  });

  it("gives the slogan time to be read", async () => {
    const built = (await loadStudioFilm("commercial-dewhat")).build();
    const card = built.scenes.at(-1)!;
    expect(card.end - card.start).toBeGreaterThanOrEqual(2_500);
  });
});

describe("Visit Skatboll!: real approved art, the approved beats and ending", () => {
  it("pans actual RuneSpace location art for each segment", async () => {
    const { ART, TIMING, TEXT } = await loadConfig("commercial-visit-skatboll");
    expect(Object.values(ART).map((art) => (art as { src: string }).src)).toEqual([
      "/location-scenes/rusk-recovery.webp",
      "/location-scenes/processing-yard.webp",
      "/location-scenes/hh-bnb-exterior.webp",
      "/location-scenes/holo-drive-in.webp",
    ]);
    // Each one is a real location the game shows, not a file that merely exists.
    const locations =
      readFileSync(join(ROOT, "game/content/locations.ts"), "utf8") +
      readFileSync(join(ROOT, "game/content/local-places.ts"), "utf8");
    for (const art of Object.values(ART) as { src: string }[]) {
      expect(locations, art.src).toContain(
        art.src.replace("/location-scenes/", "location-scenes/").replace(/^/, ""),
      );
    }
    // The approved beats: 0-4 nightlife, 4-8 scenery, 8-12 hospitality, 12-15 the ending.
    expect(TIMING).toEqual({ nightlife: 4000, scenery: 4000, hospitality: 4000, finale: 3000 });
    expect(TEXT.nightlife.join(" ")).toBe("DAZZLING NIGHTLIFE!");
    expect(TEXT.scenery.join(" ")).toBe("BREATHTAKING SCENERY!");
    expect(TEXT.hospitality.join(" ")).toBe("UNFORGETTABLE HOSPITALITY!");
  });

  it("ends 'It's not all work.' with the small 'Mostly work.'", async () => {
    const { TEXT } = await loadConfig("commercial-visit-skatboll");
    expect(TEXT.finale.map((line: { t: string }) => line.t)).toEqual([
      "SKATBOLL",
      "IT'S NOT ALL WORK.",
    ]);
    expect(TEXT.stamp).toBe("MOSTLY WORK.");
    const shown = text((await loadStudioFilm("commercial-visit-skatboll")).build().markup);
    expect(shown).toContain("IT'S NOT ALL WORK.");
    expect(shown).toContain("MOSTLY WORK.");
  });
});

describe("FedHex: the approved nested-box story and one-off ending", () => {
  it("says EVERY PARCEL MATTERS and ends on the approved line, in the approved wordmark colours", async () => {
    const { TEXT } = await loadConfig("commercial-fedhex");
    expect(TEXT.matters).toBe("EVERY PARCEL MATTERS.");
    expect(`${TEXT.brand.join("")}. ${TEXT.line.join(" ")}`).toBe(
      "FedHex. We take the little things seriously.",
    );
    const world = readFileSync(join(STUDIO, "films/commercial-fedhex/world.js"), "utf8");
    expect(world).toContain("PURPLE = '#3d087f'");
    expect(world).toContain("ORANGE = '#fc5b00'");
  });

  it("closes on the real FedHex logo file, not a redraw", async () => {
    const { ART } = await loadConfig("commercial-fedhex");
    expect(ART.logo).toEqual({ src: "/branding/fedhex-logo.webp", w: 2172, h: 724 });
    expect(existsSync(join(ROOT, "public/branding/fedhex-logo.webp"))).toBe(true);
    // Every hexagonal e in the film is the real one, cropped from that logo, never a redraw.
    expect(ART.emblem).toEqual({ src: "/branding/fedhex-e.webp", w: 317, h: 362 });
    expect(existsSync(join(ROOT, "public/branding/fedhex-e.webp"))).toBe(true);
    const world = readFileSync(join(STUDIO, "films/commercial-fedhex/world.js"), "utf8");
    const emblemFn = world.slice(
      world.indexOf("export function hexE"),
      world.indexOf("/** A hex-head bolt"),
    );
    expect(emblemFn).toContain("ART.emblem.src");
    expect(emblemFn).not.toContain("<polygon");
    const film = await loadStudioFilm("commercial-fedhex");
    expect(film.assets).toContain(ART.logo.src);
    expect(film.build().markup).toContain(`href="${ART.logo.src}"`);
  });

  it("follows the approved beats in order: counter, boxes, delivery montage, unwrapping, ident", async () => {
    const { TIMING } = await loadConfig("commercial-fedhex");
    expect(Object.keys(TIMING)).toEqual([
      "counter",
      "boxes",
      "load",
      "fly",
      "arrive",
      "unwrap",
      "ident",
    ]);
    // 0-3 counter, 3-7 boxes, 7-11 delivery (three quick shots), 11-13 unwrap, 13-15 ident.
    const at = (keys: string[]) => keys.reduce((sum, key) => sum + TIMING[key], 0);
    expect(at(["counter"])).toBe(3_000);
    expect(at(["counter", "boxes"])).toBe(7_000);
    expect(at(["counter", "boxes", "load", "fly", "arrive"])).toBe(11_000);
    expect(at(["counter", "boxes", "load", "fly", "arrive", "unwrap"])).toBe(13_000);
  });

  it("invents no postage rate, transit promise, company slogan or player-shipping claim", async () => {
    const built = (await loadStudioFilm("commercial-fedhex")).build();
    const everything = `${text(built.markup)} ${built.scenes.map((scene) => scene.caption).join(" ")}`;
    expect(everything).not.toMatch(
      /\bcredits?\b|\brate\b|guarantee|overnight|same[- ]day|\bdays?\b|free shipping|player[- ]to[- ]player|wallet|tracking/i,
    );
  });
});
