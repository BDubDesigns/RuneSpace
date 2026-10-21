import { PLANET_IDS, type PlanetId } from "@/game/config/foundations";

/**
 * How each planet looks when it is drawn as a body (#375): on the Rivet's
 * interplanetary flight chart today, and on any later view that draws worlds.
 *
 * This is presentation only. A planet's identity and membership live in
 * `game/config/foundations` (`PLANET_IDS`) and on each World Location
 * (`planetId`); nothing here says where a planet is, how far apart two are, or
 * what can be reached. Renderers read this data and stay generic: a planet with
 * a `ring` gets a ring and one with a `halo` gets a halo, so a new world is a
 * new entry here, never a new branch in a component or a CSS override.
 *
 * Every size is a multiple of the body's own radius, so the same appearance
 * draws at any scale. Colours are plain CSS colours for SVG gradient stops.
 */
export type PlanetPalette = {
  /** The lit face's dominant colour. */
  surface: string;
  /** The night side the surface shades into. */
  shadow: string;
  /** The sub-solar highlight. */
  highlight: string;
  /** The thin limb light on the lit edge. */
  rim: string;
};

/** Faint latitude bands across the face, each a fraction of the diameter from the top. */
export type PlanetBanding = {
  color: string;
  opacity: number;
  bands: readonly { at: number; thickness: number }[];
};

/** A thin tilted planetary ring. Back half drawn behind the body, front half over it. */
export type PlanetRing = {
  /** Outer semi-axis, in body radii. */
  radiusX: number;
  /** Apparent depth of the ring ellipse, in body radii. */
  radiusY: number;
  /** Clockwise tilt in degrees. */
  tiltDegrees: number;
  color: string;
  /** A fainter inner ringlet, for a little structure. */
  innerColor: string;
  /** Stroke width of the main ring, in body radii. */
  width: number;
};

/** A soft luminous atmosphere around the body, brightest at the limb. */
export type PlanetHalo = {
  /** How far the glow reaches, in body radii from the centre. */
  reach: number;
  /** The glow at the limb and the colour it shifts to as it fades. */
  inner: string;
  outer: string;
};

export type PlanetPresentation = {
  displayName: string;
  palette: PlanetPalette;
  /**
   * Where a flight leaves and lands on the drawn body: the landing station's
   * marker, in body radii from the disc centre (+x right, +y down), inside the
   * disc (not the ring or halo). A presentation anchor only: not a latitude,
   * an orbit, a navigation fact or a gameplay location.
   */
  flightAnchor: { x: number; y: number };
  banding?: PlanetBanding;
  ring?: PlanetRing;
  halo?: PlanetHalo;
};

export const PLANET_PRESENTATIONS: Readonly<Record<PlanetId, PlanetPresentation>> = {
  // Industrial slate blue and steel grey, faint banding, a thin elegant tilted
  // ring and a restrained cold rim light.
  [PLANET_IDS.skatboll]: {
    displayName: "Skatboll",
    // Upper right of the disc (owner-approved placement).
    flightAnchor: { x: 0.45, y: -0.35 },
    palette: {
      surface: "#5d6f82",
      shadow: "#151c26",
      highlight: "#b7c6d5",
      rim: "#d8ecff",
    },
    banding: {
      color: "#2c3846",
      opacity: 0.38,
      bands: [
        { at: 0.3, thickness: 0.05 },
        { at: 0.44, thickness: 0.09 },
        { at: 0.6, thickness: 0.04 },
        { at: 0.72, thickness: 0.07 },
      ],
    },
    ring: {
      radiusX: 1.72,
      radiusY: 0.36,
      tiltDegrees: -16,
      color: "#c3cfdb",
      innerColor: "#7f8e9e",
      width: 0.07,
    },
  },
  // Deep violet with teal and iridescent blue accents, layered shading, and a
  // soft aurora-like atmospheric halo. No ring.
  [PLANET_IDS.stillreach]: {
    displayName: "Stillreach",
    // Centre left of the disc (owner-approved placement).
    flightAnchor: { x: -0.55, y: 0 },
    palette: {
      surface: "#563191",
      shadow: "#140a2a",
      highlight: "#a88af0",
      rim: "#7ff0e4",
    },
    banding: {
      color: "#3fd0d6",
      opacity: 0.22,
      bands: [
        { at: 0.24, thickness: 0.06 },
        { at: 0.5, thickness: 0.03 },
        { at: 0.66, thickness: 0.08 },
      ],
    },
    halo: {
      reach: 1.38,
      inner: "rgb(110 236 220 / 0.55)",
      outer: "rgb(170 120 255 / 0)",
    },
  },
};

export function getPlanetPresentation(planetId: PlanetId): PlanetPresentation {
  return PLANET_PRESENTATIONS[planetId];
}

/**
 * A body's flight anchor in the drawing's own coordinates, for a body drawn at
 * `center` with `radius`. The one resolver every view uses, so the anchor keeps
 * its proportional place on the disc at any size.
 */
export function planetAnchorPoint(
  presentation: PlanetPresentation,
  center: { x: number; y: number },
  radius: number,
): { x: number; y: number } {
  return {
    x: center.x + presentation.flightAnchor.x * radius,
    y: center.y + presentation.flightAnchor.y * radius,
  };
}

/**
 * How far a body's drawing reaches from its centre, horizontally, in body
 * radii: its ring's horizontal extent, its halo, or the body itself. Layouts
 * use it to keep routes and labels clear of the art.
 */
export function planetHorizontalReach(presentation: PlanetPresentation): number {
  const ring = presentation.ring;
  const ringReach = ring
    ? Math.hypot(
        ring.radiusX * Math.cos((ring.tiltDegrees * Math.PI) / 180),
        ring.radiusY * Math.sin((ring.tiltDegrees * Math.PI) / 180),
      )
    : 1;
  return Math.max(1, ringReach, presentation.halo?.reach ?? 1);
}

/** How far a body's drawing reaches above or below its centre, in body radii. */
export function planetVerticalReach(presentation: PlanetPresentation): number {
  const ring = presentation.ring;
  const ringReach = ring
    ? Math.hypot(
        ring.radiusX * Math.sin((ring.tiltDegrees * Math.PI) / 180),
        ring.radiusY * Math.cos((ring.tiltDegrees * Math.PI) / 180),
      )
    : 1;
  return Math.max(1, ringReach, presentation.halo?.reach ?? 1);
}
