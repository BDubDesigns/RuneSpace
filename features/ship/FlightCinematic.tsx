"use client";

import Image, { getImageProps } from "next/image";
import { useEffect, useState, type CSSProperties } from "react";
import { preload } from "react-dom";
import { SceneComposition } from "@/features/location-scene/SceneComposition";
import {
  flightCinematicFrame,
  flightCountdown,
  type FlightCinematicFrame,
  type FlightCinematicPhase,
} from "@/features/ship/flight";
import {
  clampChartLabelX,
  FLIGHT_CHART_VIEWBOX,
  flightChartGeometry,
  pointOnFlightChart,
  type ChartPoint,
} from "@/features/ship/flight-chart";
import {
  getFlightCinematic,
  type FlightCinematic as FlightCinematicContent,
  type FlightCinematicBackdrop,
} from "@/game/content/flight-cinematics";

const BACKDROP_SIZES = "(max-width: 640px) 100vw, 56rem";

type Flight = {
  routeId: string;
  originLocationId: string;
  destinationLocationId: string;
  startedAt: string;
  arrivesAt: string;
};

/**
 * The Rivet's flight cinematic (#359): takeoff over the approved 15:8 departure
 * backdrop, a small local nav chart, and touchdown over the arrival backdrop.
 *
 * It is a replaceable presentation layer over the server's recorded flight and
 * nothing else. The phase, how far into it the ship is, and the countdown are all
 * derived from the flight's own start and arrival instants (`flightCinematicFrame`),
 * so a reload, a reopened panel or a dropped connection resumes exactly where the
 * flight is instead of restarting the takeoff. It adds no time: the landing pose
 * is reached at the scheduled arrival, and past it the frame simply holds while
 * the panel says touchdown is pending. It never lands, refuels or completes
 * anything; the next authoritative read does, and the Play surface then shows
 * the arrived location and the durable arrival notice.
 *
 * Motion is CSS only. Each phase mounts its own keyframe animation with a
 * negative delay equal to the time already spent in that phase, so resuming
 * mid-phase is a single computed offset. With `prefers-reduced-motion` the ship
 * rests on the pad, the chart shows the leg without a moving marker, and the
 * factual progress and countdown below carry the flight.
 */
export function FlightCinematic({
  flight,
  now,
  originName,
  destinationName,
}: {
  flight: Flight;
  now: number;
  originName: string;
  destinationName: string;
}) {
  // The frame depends on the browser clock, so it is rendered only after mount:
  // server markup and the first client render agree on an empty 15:8 frame.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const content = getFlightCinematic(flight.routeId);
  if (!content) return null;
  const frame = flightCinematicFrame(flight, now);
  const caption = phaseCaption(frame.phase, originName, destinationName);
  // The same countdown the panel states in full below, from the same instants.
  const { remainingSeconds } = flightCountdown(flight, now);
  const remaining = frame.arrivalPending
    ? "Touchdown pending"
    : `${remainingSeconds}s to touchdown`;

  return (
    <figure
      className="relative m-0 aspect-[15/8] min-h-56 w-full overflow-hidden border border-[color:var(--rs-border-structural)] bg-black sm:min-h-72"
      data-flight-cinematic={flight.routeId}
      data-flight-phase={mounted ? frame.phase : undefined}
    >
      {mounted ? (
        frame.phase === "travel" ? (
          <FlightChart
            content={content}
            destinationName={destinationName}
            flight={flight}
            frame={frame}
            key="travel"
            originName={originName}
          />
        ) : (
          <FlightBackdrop
            backdrop={frame.phase === "takeoff" ? content.departure : content.arrival}
            frame={frame}
            key={frame.phase}
          />
        )
      ) : null}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-t from-black/45 via-transparent to-black/15"
      />
      <figcaption
        className="rs-map-plate rs-flight-cinematic__plate left-3 top-3 max-w-[calc(100%-1.5rem)] truncate px-2 py-1 font-display text-xs uppercase tracking-[0.14em]"
        data-flight-cinematic-caption
      >
        {caption}
      </figcaption>
      <p
        aria-hidden="true"
        className="rs-map-plate rs-flight-cinematic__plate bottom-3 right-3 px-2 py-1 font-display text-xs uppercase tracking-[0.14em]"
        data-flight-cinematic-remaining
      >
        {remaining}
      </p>
      {/* One polite announcement per phase, not per countdown tick. */}
      <span aria-atomic="true" aria-live="polite" className="sr-only">
        {mounted ? caption : ""}
      </span>
    </figure>
  );
}

function phaseCaption(
  phase: FlightCinematicPhase,
  originName: string,
  destinationName: string,
): string {
  switch (phase) {
    case "takeoff":
      return `Takeoff · ${originName}`;
    case "travel":
      return `En route · ${destinationName}`;
    case "landing":
      return `Touchdown · ${destinationName}`;
  }
}

/** Resume a phase's keyframes from where the flight already is. */
function useResumedAnimation(frame: FlightCinematicFrame): CSSProperties {
  // Captured once per phase mount: re-deriving the delay on every countdown tick
  // would restart the animation.
  const [style] = useState<CSSProperties>(() => ({
    animationDuration: `${Math.max(1, Math.round(frame.phaseDurationMs))}ms`,
    animationDelay: `-${Math.round(frame.phaseElapsedMs)}ms`,
  }));
  return style;
}

/**
 * The approved shipless backdrop on the shared scene stage, with the canonical
 * repaired Rivet as its own animated layer on the backdrop's authored mark.
 */
function FlightBackdrop({
  backdrop,
  frame,
}: {
  backdrop: FlightCinematicBackdrop;
  frame: FlightCinematicFrame;
}) {
  const motion = frame.phase === "takeoff" ? "takeoff" : "landing";
  const animation = useResumedAnimation(frame);
  const { ship } = backdrop;

  return (
    <div className="rs-flight-cinematic__phase absolute inset-0" data-flight-backdrop={motion}>
      <SceneComposition
        scene={backdrop.scene}
        sizes={BACKDROP_SIZES}
        // A 15:8 frame at its widest (56rem) is ~896px wide.
        stageWidthHint={896}
        priority
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute"
          data-flight-ship-mark
          style={{
            left: `${ship.placement.left}%`,
            top: `${ship.placement.top}%`,
            width: `${ship.placement.width}%`,
            aspectRatio: `${ship.width} / ${ship.height}`,
          }}
        >
          {/* The contact shadow stays on the ground while the ship rises off it. */}
          <span
            className="rs-flight-cinematic__shadow absolute"
            data-flight-motion={motion}
            style={animation}
          />
          <div
            className="rs-flight-cinematic__ship absolute inset-0"
            data-flight-motion={motion}
            style={animation}
          >
            <Image
              src={ship.asset}
              alt=""
              width={ship.width}
              height={ship.height}
              sizes={`${Math.ceil((896 * ship.placement.width) / 100)}px`}
              className="block h-full w-full"
              data-flight-ship
              loading="eager"
            />
          </div>
        </div>
      </SceneComposition>
    </div>
  );
}

/**
 * The local nav chart: the leg's two real places, the route between them, and a
 * miniature of the approved Rivet flying it. The marker's position is the
 * flight's own progress through the chart phase, eased between countdown ticks.
 */
function FlightChart({
  content,
  flight,
  frame,
  originName,
  destinationName,
}: {
  content: FlightCinematicContent;
  flight: Flight;
  frame: FlightCinematicFrame;
  originName: string;
  destinationName: string;
}) {
  // Warm the touchdown backdrop while the chart plays, so it is there at 12 s.
  const arrival = getImageProps({
    src: content.arrival.scene.asset,
    alt: "",
    width: content.arrival.scene.width,
    height: content.arrival.scene.height,
    sizes: BACKDROP_SIZES,
  }).props;
  preload(arrival.src, {
    as: "image",
    imageSrcSet: arrival.srcSet,
    imageSizes: BACKDROP_SIZES,
  });
  const geometry = flightChartGeometry(flight.originLocationId, flight.destinationLocationId);
  const marker = pointOnFlightChart(geometry, frame.travelProgress);
  const percent = Math.round(frame.travelProgress * 100);
  const shipAsset = content.departure.ship;
  // The ship art faces left. Heading right, it is mirrored first so it never flies upside down.
  const headingRight = Math.abs(marker.headingDegrees) <= 90;
  const glyphTransform = headingRight
    ? `rotate(${marker.headingDegrees.toFixed(1)}deg) scaleX(-1)`
    : `rotate(${(marker.headingDegrees - 180).toFixed(1)}deg)`;
  const glyphWidth = 76;
  const glyphHeight = (glyphWidth * shipAsset.height) / shipAsset.width;
  // The same optimizer next/image uses, sized for the miniature, so the chart does
  // not fetch the full-size overlay.
  const glyphSrc = getImageProps({
    src: shipAsset.asset,
    alt: "",
    width: glyphWidth * 2,
    height: Math.round(glyphHeight * 2),
  }).props.src;

  return (
    <div className="rs-flight-cinematic__phase rs-flight-chart absolute inset-0" data-flight-chart>
      <svg
        aria-label={`${content.chartTitle}: ${originName} to ${destinationName}, ${percent}% of the way.`}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        viewBox={`0 0 ${FLIGHT_CHART_VIEWBOX.width} ${FLIGHT_CHART_VIEWBOX.height}`}
      >
        <defs>
          <pattern height="40" id="rs-flight-chart-grid" patternUnits="userSpaceOnUse" width="40">
            <path className="rs-flight-chart__grid" d="M 40 0 L 0 0 0 40" fill="none" />
          </pattern>
        </defs>
        <rect
          fill="url(#rs-flight-chart-grid)"
          height={FLIGHT_CHART_VIEWBOX.height}
          width={FLIGHT_CHART_VIEWBOX.width}
        />
        <text className="rs-flight-chart__title" x="24" y={FLIGHT_CHART_VIEWBOX.height - 20}>
          {content.chartTitle.toUpperCase()}
        </text>
        <path className="rs-flight-chart__route" d={geometry.path} fill="none" />
        <path
          className="rs-flight-chart__flown"
          d={geometry.path}
          data-flight-chart-flown
          fill="none"
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={1 - frame.travelProgress}
        />
        <ChartPlace label={originName} point={geometry.origin} />
        <ChartPlace label={destinationName} point={geometry.destination} />
        <g
          className="rs-flight-chart__marker"
          data-flight-chart-marker
          style={{ transform: `translate(${marker.x.toFixed(1)}px, ${marker.y.toFixed(1)}px)` }}
        >
          <g style={{ transform: glyphTransform }}>
            <image
              height={glyphHeight}
              href={glyphSrc}
              width={glyphWidth}
              x={-glyphWidth / 2}
              y={-glyphHeight / 2}
            />
          </g>
        </g>
      </svg>
    </div>
  );
}

function ChartPlace({ label, point }: { label: string; point: ChartPoint }) {
  const fontSize = 18;
  const text = label.toUpperCase();
  // Labels sit on the outside of the leg: above an upper end, below a lower one.
  const above = point.y <= FLIGHT_CHART_VIEWBOX.height / 2;
  return (
    <g data-flight-chart-place={label}>
      <circle className="rs-flight-chart__place" cx={point.x} cy={point.y} r="7" />
      <text
        className="rs-flight-chart__label"
        textAnchor="middle"
        x={clampChartLabelX(point.x, text, fontSize)}
        y={above ? point.y - 18 : point.y + 32}
      >
        {text}
      </text>
    </g>
  );
}
