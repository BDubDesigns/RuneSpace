import { useId } from "react";
import type { PlanetId } from "@/game/config/foundations";
import { getPlanetPresentation, type PlanetPresentation } from "@/game/content/planets";

/**
 * One planet drawn as a body in native SVG (#375), from its authored
 * presentation (`game/content/planets`) and nothing else. Generic: a ring is
 * drawn because the data authors one, a halo because the data authors one, and
 * no colour or feature is chosen by planet ID here.
 *
 * Layers, back to front: atmospheric halo, the far half of the ring, the body
 * (lit by a single off-centre light, so it reads as a sphere), faint surface
 * bands clipped to the disc, a thin limb light on the lit edge, then the near
 * half of the ring crossing in front. It is static: nothing animates, so
 * reduced motion needs no special case.
 */
export function PlanetBody({
  planetId,
  cx,
  cy,
  r,
}: {
  planetId: PlanetId;
  cx: number;
  cy: number;
  r: number;
}) {
  const presentation = getPlanetPresentation(planetId);
  // Gradient and clip IDs are per instance; React's IDs carry colons, which
  // `url(#…)` references do not tolerate.
  const id = `planet-${planetId}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { palette, banding, ring, halo } = presentation;

  return (
    <g data-planet-body={planetId}>
      <defs>
        <radialGradient cx="34%" cy="30%" id={`${id}-surface`} r="78%">
          <stop offset="0" stopColor={palette.highlight} />
          <stop offset="0.42" stopColor={palette.surface} />
          <stop offset="1" stopColor={palette.shadow} />
        </radialGradient>
        <linearGradient id={`${id}-rim`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor={palette.rim} stopOpacity="0.9" />
          <stop offset="0.45" stopColor={palette.rim} stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
        {halo ? (
          <radialGradient
            cx={cx}
            cy={cy}
            gradientUnits="userSpaceOnUse"
            id={`${id}-halo`}
            r={r * halo.reach}
          >
            <stop offset="0" stopColor={halo.inner} />
            <stop offset={1 / halo.reach} stopColor={halo.inner} />
            <stop offset="1" stopColor={halo.outer} />
          </radialGradient>
        ) : null}
      </defs>
      {halo ? (
        <circle cx={cx} cy={cy} data-planet-halo fill={`url(#${id}-halo)`} r={r * halo.reach} />
      ) : null}
      {ring ? <RingHalf cx={cx} cy={cy} r={r} ring={ring} side="far" /> : null}
      <circle cx={cx} cy={cy} data-planet-surface fill={`url(#${id}-surface)`} r={r} />
      {banding ? (
        <g clipPath={`url(#${id}-clip)`} data-planet-banding opacity={banding.opacity}>
          {banding.bands.map((band) => (
            <ellipse
              cx={cx}
              cy={cy - r + band.at * 2 * r}
              fill={banding.color}
              key={band.at}
              rx={r * 1.15}
              ry={band.thickness * r}
            />
          ))}
        </g>
      ) : null}
      <circle
        cx={cx}
        cy={cy}
        fill="none"
        r={r - r * 0.03}
        stroke={`url(#${id}-rim)`}
        strokeWidth={r * 0.06}
      />
      {ring ? <RingHalf cx={cx} cy={cy} r={r} ring={ring} side="near" /> : null}
    </g>
  );
}

/**
 * Half of a tilted ring: the far (upper) half passes behind the body and the
 * near (lower) half in front of it, which is what makes the ring read as
 * circling the planet rather than lying on top of it.
 */
function RingHalf({
  cx,
  cy,
  r,
  ring,
  side,
}: {
  cx: number;
  cy: number;
  r: number;
  ring: NonNullable<PlanetPresentation["ring"]>;
  side: "far" | "near";
}) {
  const half = (rx: number, ry: number) =>
    side === "far"
      ? `M ${-rx} 0 A ${rx} ${ry} 0 0 1 ${rx} 0`
      : `M ${rx} 0 A ${rx} ${ry} 0 0 1 ${-rx} 0`;
  const rx = ring.radiusX * r;
  const ry = ring.radiusY * r;
  return (
    <g
      data-planet-ring={side}
      fill="none"
      strokeLinecap="round"
      transform={`translate(${cx} ${cy}) rotate(${ring.tiltDegrees})`}
    >
      <path
        d={half(rx * 0.86, ry * 0.86)}
        stroke={ring.innerColor}
        strokeOpacity="0.55"
        strokeWidth={r * ring.width * 0.45}
      />
      <path
        d={half(rx, ry)}
        stroke={ring.color}
        strokeOpacity={side === "far" ? 0.55 : 0.9}
        strokeWidth={r * ring.width}
      />
    </g>
  );
}
