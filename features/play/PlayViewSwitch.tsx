"use client";

import { Crosshair, Map as MapIcon, Navigation } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { mapReturnLabel } from "@/features/travel/LocalMapPanel";

const CELL_WIDTH = "7.25rem";

/**
 * Each side's hit area reaches the housing's edge — over its padding and the scale
 * ticks — so no part of the switch is dead. Each extends only outward from its own
 * half, so the two meet exactly at the middle.
 */
const hereHit = "after:absolute after:-bottom-1 after:-left-1 after:-top-1 after:right-0";
const mapHit = "after:absolute after:-bottom-1 after:-right-1 after:-top-1 after:left-0";

const labelClass =
  "rs-focus relative z-10 flex h-9 items-center justify-center gap-2 font-display text-[11px] font-bold uppercase tracking-[0.16em] transition-[color,text-shadow,filter] duration-[var(--rs-duration-standard)] ease-out motion-reduce:transition-none";

/** The lit label's light, faded in and out with the colour so it never pops. */
const litClass =
  "text-[color:var(--rs-accent-primary)] [text-shadow:0_0_8px_rgb(75_216_245_/_0.75)] [&>svg]:[filter:drop-shadow(0_0_4px_rgb(75_216_245_/_0.8))]";
const dimClass =
  "text-[color:var(--rs-text-muted)] [text-shadow:0_0_0_rgb(75_216_245_/_0)] [&>svg]:[filter:drop-shadow(0_0_0_rgb(75_216_245_/_0))] hover:text-[color:var(--rs-text-primary)]";

/**
 * The desktop Location | Map control in Play's top bar, left of News and Sign out
 * (#286): a two-position slide switch. A lit thumb rides a recessed track with a
 * scale along its lower edge; the label it leaves loses its light as the label it
 * arrives at gains it, so the change reads as one movement. Both destinations are
 * always on screen and the labels never change; the current one is the thumb's.
 * Under reduced motion the change is instant.
 *
 * It opens the same route-backed Map surface — there is no second Map — and from
 * the Map the other side is the way back to the Location (or the Journey, in
 * transit), with the `router.replace` and the accessible name the panel's own Back
 * control has on a phone. It stays available in transit, as the footer's does. It
 * is a Play-only header action, not account navigation, and is hidden below
 * desktop width by its caller.
 */
export function PlayViewSwitch({
  mapActive,
  inTransit,
  onMapExit,
}: {
  mapActive: boolean;
  inTransit: boolean;
  onMapExit: () => void;
}) {
  const pathname = usePathname();
  const here = inTransit ? "Journey" : "Location";
  const HereIcon = inTransit ? Navigation : Crosshair;

  return (
    <div
      aria-label="View"
      className="rs-bevel relative flex items-center border border-[color:var(--rs-border-structural)] bg-[#06101a] p-1 shadow-[inset_0_2px_6px_rgb(0_0_0_/_0.55)]"
      data-view-switch={mapActive ? "map" : "here"}
      role="group"
      style={{
        backgroundImage:
          "repeating-linear-gradient(90deg, transparent 0 7px, rgb(75 216 245 / 0.12) 7px 8px)",
        backgroundSize: "100% 5px",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "0 calc(100% - 3px)",
      }}
    >
      <span
        aria-hidden="true"
        className="rs-bevel pointer-events-none absolute inset-y-1 left-1 border border-[color:var(--rs-accent-primary)] bg-[linear-gradient(180deg,rgb(75_216_245_/_0.3),rgb(75_216_245_/_0.1))] shadow-[inset_0_0_12px_rgb(75_216_245_/_0.45),inset_0_1px_0_rgb(255_255_255_/_0.25)] transition-transform duration-[var(--rs-duration-standard)] ease-out motion-reduce:transition-none"
        data-view-switch-thumb=""
        style={{ width: CELL_WIDTH, transform: mapActive ? "translateX(100%)" : "translateX(0)" }}
      />
      {/* Each side is one element for the life of the page and only its classes
          change, so the light has something to fade on. The current side is marked
          `aria-current` and does nothing when pressed. */}
      <button
        aria-current={mapActive ? undefined : "page"}
        aria-label={mapActive ? mapReturnLabel(inTransit) : undefined}
        className={`${labelClass} ${hereHit} ${mapActive ? dimClass : litClass}`}
        data-map-return={mapActive ? "" : undefined}
        data-view-here=""
        onClick={mapActive ? onMapExit : undefined}
        style={{ width: CELL_WIDTH }}
        type="button"
      >
        <HereIcon aria-hidden="true" className="h-4 w-4" />
        {here}
      </button>
      <Link
        aria-current={mapActive ? "page" : undefined}
        aria-label="Map"
        className={`${labelClass} ${mapHit} ${mapActive ? litClass : dimClass}`}
        data-map-open={mapActive ? undefined : ""}
        data-view-map=""
        href={`${pathname}?surface=map`}
        onClick={mapActive ? (event) => event.preventDefault() : undefined}
        style={{ width: CELL_WIDTH }}
      >
        <MapIcon aria-hidden="true" className="h-4 w-4" />
        Map
      </Link>
    </div>
  );
}
