import { getImageProps } from "next/image";
import {
  getFlightCinematic,
  type FlightCinematic,
  type FlightCinematicBackdrop,
} from "@/game/content/flight-cinematics";

/**
 * The flight cinematic's images, as the exact optimized responsive variants its
 * components render (#359), and a client warm-up that fetches and decodes them
 * before a launch is sent.
 *
 * The components and the warm-up read the same props from here, so the warm-up
 * always fetches the URL the frame will ask for — never a master, never the
 * unoptimized source, never a size the frame would not choose.
 *
 * Warming is presentation only. It never decides whether a launch is allowed;
 * at worst it delays sending the ordinary launch command by `FLIGHT_VISUALS_WAIT_MS`,
 * after which the flight goes ahead with whatever has loaded.
 */
export const FLIGHT_BACKDROP_SIZES = "(max-width: 640px) 100vw, 56rem";
/** A 15:8 frame at its widest (56rem) is ~896px wide. */
export const FLIGHT_STAGE_WIDTH_HINT = 896;
/** The chart miniature's width in chart units. */
export const FLIGHT_CHART_GLYPH_WIDTH = 76;
/** The longest a launch waits for its visuals before flying without them. */
export const FLIGHT_VISUALS_WAIT_MS = 6_000;
/**
 * The image optimizer's responses are cacheable for 60 seconds and then
 * revalidated, so a warm-up older than this is refreshed at Launch: on a fresh
 * cache that is a quick revalidation, and the frame never meets an expired copy.
 */
export const FLIGHT_VISUALS_FRESH_MS = 45_000;

export type FlightImageVariant = { src: string; srcSet?: string; sizes?: string };

export function flightBackdropImageProps(backdrop: FlightCinematicBackdrop): FlightImageVariant {
  const { props } = getImageProps({
    src: backdrop.scene.asset,
    alt: "",
    width: backdrop.scene.width,
    height: backdrop.scene.height,
    sizes: FLIGHT_BACKDROP_SIZES,
  });
  return { src: props.src, srcSet: props.srcSet, sizes: props.sizes };
}

export function flightShipSizes(backdrop: FlightCinematicBackdrop): string {
  return `${Math.ceil((FLIGHT_STAGE_WIDTH_HINT * backdrop.ship.placement.width) / 100)}px`;
}

export function flightShipImageProps(backdrop: FlightCinematicBackdrop): FlightImageVariant {
  const { props } = getImageProps({
    src: backdrop.ship.asset,
    alt: "",
    width: backdrop.ship.width,
    height: backdrop.ship.height,
    sizes: flightShipSizes(backdrop),
  });
  return { src: props.src, srcSet: props.srcSet, sizes: props.sizes };
}

export function flightChartGlyph(content: FlightCinematic): {
  src: string;
  width: number;
  height: number;
} {
  const { ship } = content.departure;
  const height = (FLIGHT_CHART_GLYPH_WIDTH * ship.height) / ship.width;
  // Twice the drawn size for sharp high-DPR rendering, still far below the overlay's own.
  const { props } = getImageProps({
    src: ship.asset,
    alt: "",
    width: FLIGHT_CHART_GLYPH_WIDTH * 2,
    height: Math.round(height * 2),
  });
  return { src: props.src, width: FLIGHT_CHART_GLYPH_WIDTH, height };
}

/** Every image a flight's cinematic shows, in the order it shows them. */
export function flightCinematicImageVariants(content: FlightCinematic): FlightImageVariant[] {
  const variants = [
    flightBackdropImageProps(content.departure),
    flightShipImageProps(content.departure),
    { src: flightChartGlyph(content).src },
    flightBackdropImageProps(content.arrival),
    flightShipImageProps(content.arrival),
  ];
  // The two backdrops' ships are the same file; the browser fetches each URL once.
  const seen = new Set<string>();
  return variants.filter((variant) => {
    const key = `${variant.src}|${variant.srcSet ?? ""}|${variant.sizes ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type FlightVisualsStatus = "loading" | "ready" | "failed";

type Warmup = {
  status: FlightVisualsStatus;
  settled: Promise<FlightVisualsStatus>;
  startedAt: number;
  /** Held so the decoded images stay in the page's memory cache until used. */
  images: HTMLImageElement[];
};
const warmups = new Map<string, Warmup>();

function decodeVariant(variant: FlightImageVariant, images: HTMLImageElement[]): Promise<void> {
  const image = new window.Image();
  images.push(image);
  image.decoding = "async";
  // sizes and srcset before src, so the browser picks the candidate the frame will.
  if (variant.sizes) image.sizes = variant.sizes;
  if (variant.srcSet) image.srcset = variant.srcSet;
  image.src = variant.src;
  return image.decode();
}

/**
 * Fetch and decode a route's cinematic images once per page. Repeated calls share
 * the same work. Resolves to "failed" (never rejects) if any image cannot load.
 */
export function warmFlightCinematic(
  routeId: string,
  options: { refreshAfterMs?: number } = {},
): Warmup | undefined {
  if (typeof window === "undefined") return undefined;
  const existing = warmups.get(routeId);
  const stale =
    existing !== undefined &&
    existing.status === "ready" &&
    options.refreshAfterMs !== undefined &&
    Date.now() - existing.startedAt > options.refreshAfterMs;
  if (existing && !stale) return existing;
  const content = getFlightCinematic(routeId);
  if (!content) return undefined;
  const images: HTMLImageElement[] = [];
  const warmup: Warmup = {
    status: "loading",
    startedAt: Date.now(),
    images,
    settled: Promise.all(
      flightCinematicImageVariants(content).map((variant) => decodeVariant(variant, images)),
    ).then(
      () => "ready" as const,
      () => "failed" as const,
    ),
  };
  void warmup.settled.then((status) => {
    warmup.status = status;
  });
  warmups.set(routeId, warmup);
  return warmup;
}

/**
 * Wait, at most `timeoutMs`, for a route's visuals before launching. Never
 * rejects: a failure or the timeout simply lets the launch go ahead.
 */
export function waitForFlightVisuals(
  routeId: string,
  timeoutMs = FLIGHT_VISUALS_WAIT_MS,
): Promise<FlightVisualsStatus | "timeout"> {
  const warmup = warmFlightCinematic(routeId, { refreshAfterMs: FLIGHT_VISUALS_FRESH_MS });
  if (!warmup) return Promise.resolve("ready");
  if (warmup.status !== "loading") return Promise.resolve(warmup.status);
  return Promise.race([
    warmup.settled,
    new Promise<"timeout">((resolve) => window.setTimeout(() => resolve("timeout"), timeoutMs)),
  ]);
}

/**
 * Whether a route's visuals are settled and fresh, so a launch needs no wait at
 * all. A route without a cinematic never waits.
 */
export function flightVisualsSettled(routeId: string): boolean {
  const warmup = warmups.get(routeId);
  if (warmup === undefined) return getFlightCinematic(routeId) === undefined;
  if (warmup.status === "loading") return false;
  return warmup.status === "failed" || Date.now() - warmup.startedAt <= FLIGHT_VISUALS_FRESH_MS;
}
