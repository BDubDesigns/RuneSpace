"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { getLocalPlacesForLocation } from "@/game/content/local-places";
import { deriveLocalPlaceAccess } from "@/game/domain/local-places";
import { localPlaceHref } from "./navigation";

/**
 * The places inside one World Location.
 *
 * This is generic over the registry: a location with no authored Local Places
 * renders nothing at all, and a locked place is listed with its in-world reason
 * rather than hidden. Nothing here tests for a particular building — entry is
 * decided entirely by the derived access result.
 */
export function LocalPlaceDirectory({ locationId }: { locationId: string }) {
  const pathname = usePathname();
  const places = getLocalPlacesForLocation(locationId);
  if (places.length === 0) return null;

  return (
    <div data-local-place-directory>
      <SectionHeader eyebrow="Around town">Places</SectionHeader>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {places.map((place) => {
          const access = deriveLocalPlaceAccess(place);
          const scene = place.presentation.scene;
          const body = (
            <>
              <div className="relative h-[72px] w-full overflow-hidden sm:h-[84px]">
                <Image
                  alt={scene.alt}
                  className="h-full w-full object-cover"
                  height={scene.height}
                  sizes="(max-width: 640px) 100vw, 420px"
                  src={scene.asset}
                  style={{
                    objectPosition: `${scene.focal?.x ?? 50}% ${scene.focal?.y ?? 45}%`,
                    opacity: access.available ? 1 : 0.55,
                  }}
                  width={scene.width}
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-[var(--rs-scene-scrim-bottom)]"
                />
              </div>
              <div className="p-3">
                <p className="font-display text-sm font-bold text-[color:var(--rs-text-primary)]">
                  {place.displayName}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[color:var(--rs-text-secondary)]">
                  {place.description}
                </p>
                {access.available ? null : (
                  <p
                    className="mt-2 text-xs leading-relaxed text-[color:var(--rs-text-muted)]"
                    data-local-place-locked-reason
                  >
                    {access.reason}
                  </p>
                )}
              </div>
            </>
          );

          return (
            <li key={place.id}>
              {access.available ? (
                <Link
                  className="rs-focus block overflow-hidden border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] transition-colors hover:border-[color:var(--rs-accent-primary)]"
                  data-local-place={place.id}
                  data-local-place-access="available"
                  href={localPlaceHref(pathname, place.id)}
                >
                  {body}
                </Link>
              ) : (
                <div
                  aria-disabled="true"
                  className="block overflow-hidden border border-dashed border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)]"
                  data-local-place={place.id}
                  data-local-place-access="locked"
                >
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
