import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LOCATION_IDS, REPAIR_TARGET_IDS } from "@/game/config/foundations";
import { getLocation, LOCATIONS } from "@/game/content/locations";
import { resolveLocationState } from "@/game/domain/location-state";
import { LocationSceneSchema } from "@/game/schemas/locations";
import { SceneComposition } from "@/features/location-scene/SceneComposition";

const crashSite = getLocation(LOCATION_IDS.crashSite)!;
const crashedScene = resolveLocationState(crashSite).scene;
const repairedScene = resolveLocationState(crashSite, {
  acceptedMissionIds: new Set(),
  completedRepairTargetIds: new Set([REPAIR_TARGET_IDS.propulsionSystem]),
}).scene;
// The no-ship state (#351): the same background and framing with the layer omitted.
// No game state reaches it yet — the later flight slice owns when a ship has left —
// so it is authored here as presentation only, through the real schema.
const emptyScene = LocationSceneSchema.parse({
  asset: crashedScene.asset,
  width: crashedScene.width,
  height: crashedScene.height,
  alt: "The Crash Site muddy ground under heavy cloud, a mesa and a spired outpost beyond",
  focal: crashedScene.focal,
});

function render(scene: typeof crashedScene) {
  return renderToStaticMarkup(
    createElement(SceneComposition, {
      scene,
      sizes: "100vw",
      stageWidthHint: 1008,
      priority: true,
    }),
  );
}

describe("layered scene composition (issue #351)", () => {
  it("composes crashed, repaired and empty as three distinct states of one background", () => {
    const [crashed, repaired, empty] = [crashedScene, repairedScene, emptyScene].map(render);
    const overlaySrc = (html: string) =>
      /data-scene-layer="overlay"/.test(html) ? html.match(/rivet-(crashed|repaired)/)?.[1] : null;
    expect(overlaySrc(crashed!)).toBe("crashed");
    expect(overlaySrc(repaired!)).toBe("repaired");
    expect(overlaySrc(empty!)).toBeNull();
    // One stage, one background in every state; only the ship layer differs.
    for (const html of [crashed!, repaired!, empty!]) {
      expect(html.match(/data-scene-layer="background"/g)).toHaveLength(1);
      expect(html.match(/data-scene-stage/g)).toHaveLength(1);
      expect(html).toContain("crash-site-empty.webp");
    }
    expect(empty!.match(/<img/g)).toHaveLength(1);
    expect(crashed!.match(/<img/g)).toHaveLength(2);
    // Debris belongs to the crashed overlay alone: the repaired and empty states
    // reference no crashed art at all.
    expect(repaired).not.toContain("rivet-crashed");
    expect(empty).not.toContain("rivet-");
  });

  it("puts background and overlay in one stage that reproduces cover + focal", () => {
    const html = render(crashedScene);
    const stage = html.match(/<div class="absolute" style="([^"]*)" data-scene-stage/)?.[1];
    // Same cover maths as object-fit: cover / object-position: focal, in container units.
    expect(stage).toContain("width:max(100cqw, calc(100cqh * 4))");
    expect(stage).toContain("aspect-ratio:1536 / 384");
    expect(stage).toContain("left:50%");
    expect(stage).toContain("transform:translate(-50%, -50%)");
    expect(html).toContain("container-type:size");
    // The overlay is placed in stage percentages: no px offsets, no breakpoint split.
    const overlay = html.match(/<img[^>]*data-scene-layer="overlay"[^>]*>/)![0];
    const placement = crashedScene.overlay!.placement;
    expect(overlay).toContain(`left:${placement.left}%`);
    expect(overlay).toContain(`top:${placement.top}%`);
    expect(overlay).toContain(`width:${placement.width}%`);
    expect(overlay).not.toMatch(/left:[\d.]+px/);
  });

  it("describes the composed scene once: the overlay is decorative, never a second alt", () => {
    for (const scene of [crashedScene, repairedScene, emptyScene]) {
      const html = render(scene);
      const images = html.match(/<img[^>]*>/g)!;
      expect(images[0]).toContain(`alt="${scene.alt}"`);
      expect(scene.alt).not.toMatch(/\bempty\b/i);
      for (const overlay of images.slice(1)) {
        expect(overlay).toContain('alt=""');
        expect(overlay).toContain('aria-hidden="true"');
      }
    }
  });

  it("preloads only the background", () => {
    const html = render(crashedScene);
    const [background, overlay] = html.match(/<img[^>]*>/g)!;
    // Neither image is authored lazy: the ship arrives with the scene. Only the
    // background is `priority` (a preload); that is asserted structurally in
    // location-scene.test.ts, since static markup does not carry the preload hint.
    expect(background).not.toContain('loading="lazy"');
    expect(overlay).not.toContain('loading="lazy"');
    expect(overlay).not.toContain("fetchPriority");
  });

  it("authors placement as source-canvas percent that keeps each ship inside the scene", () => {
    const canvasRatio = crashedScene.width / crashedScene.height;
    for (const scene of [crashedScene, repairedScene]) {
      const { overlay } = scene;
      const { placement } = overlay!;
      // Height as percent of the canvas height follows the overlay's own aspect.
      const heightPercent = (placement.width * canvasRatio * overlay!.height) / overlay!.width;
      expect(placement.left + placement.width).toBeLessThanOrEqual(100);
      expect(placement.top + heightPercent).toBeLessThanOrEqual(100);
    }
    // A shared landing mark: the two ships share a left edge and ground contact line,
    // so crashed -> repaired moves nothing but the ship.
    const contact = (scene: typeof crashedScene) => {
      const o = scene.overlay!;
      return o.placement.top + (o.placement.width * canvasRatio * o.height) / o.width;
    };
    expect(
      Math.abs(crashedScene.overlay!.placement.left - repairedScene.overlay!.placement.left),
    ).toBeLessThan(1);
    // The crashed hull rests lower than the repaired gear's contact line by its debris
    // and settling shadow, which is intended; both must stay on the same ground band.
    expect(contact(crashedScene)).toBeGreaterThan(80);
    expect(contact(repairedScene)).toBeGreaterThan(80);
  });

  it("leaves every other location a plain background with no overlay", () => {
    for (const location of LOCATIONS) {
      const states = [location.presentation.scene, ...location.stateVariants.map((v) => v.scene)];
      for (const scene of states) {
        if (!scene) continue;
        // A ship overlay belongs only to the places a ship can be: the Crash Site
        // and, once a Rivet lands, Holo Hollow Landing (#358) or Stillreach
        // Landing Station (#375). The landings' base scenes stay empty; only
        // their berthed variants carry one.
        const shipPlace =
          location.id === LOCATION_IDS.crashSite ||
          location.id === LOCATION_IDS.holoHollowLanding ||
          location.id === LOCATION_IDS.stillreachLandingStation;
        if (!shipPlace) expect(scene.overlay, `${location.id} overlay`).toBeUndefined();
      }
    }
  });

  it("rejects an overlay that escapes its canvas or names a remote asset", () => {
    const valid = {
      asset: "/location-scenes/x.webp",
      width: 100,
      height: 50,
      placement: { left: 10, top: 10, width: 30 },
    };
    const scene = { ...emptyScene, overlay: valid };
    expect(LocationSceneSchema.safeParse(scene).success).toBe(true);
    for (const bad of [
      { ...valid, asset: "https://example.com/x.webp" },
      { ...valid, placement: { ...valid.placement, left: -1 } },
      { ...valid, placement: { ...valid.placement, width: 0 } },
      { ...valid, placement: { ...valid.placement, width: 101 } },
    ]) {
      expect(LocationSceneSchema.safeParse({ ...scene, overlay: bad }).success).toBe(false);
    }
  });
});
