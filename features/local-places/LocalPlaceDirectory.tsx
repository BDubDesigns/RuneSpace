"use client";

import { Lock } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ActionButton } from "@/components/ui/ActionButton";
import { MissionActionLink } from "@/components/ui/MissionActionLink";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { usePlay } from "@/features/play/PlayContext";
import { getLocalPlacesForLocation } from "@/game/content/local-places";
import {
  deriveLocalPlaceAccess,
  deriveLocalPlaceSurface,
  type LocalPlaceSurface,
} from "@/game/domain/local-places";
import { deriveCompletedRepairTargetIds } from "@/game/domain/welding-repair";
import {
  deriveCompletedMissionIds,
  deriveMissionGuidanceTargets,
  localPlaceGuidanceMeaning,
} from "@/game/domain/missions";
import { localPlaceHref } from "./navigation";

/**
 * The places inside one World Location.
 *
 * Generic over the registry: a location with no authored Local Places renders
 * nothing, and a locked place stays listed with its in-world reason. Nothing
 * here tests for a particular building — entry is decided entirely by the
 * derived access result.
 *
 * An open place offers two affordances that lead to the same place: the whole
 * card and an explicit Enter control. They are sibling links rather than a
 * control nested inside a link, which would be invalid markup. Enter is the one
 * link exposed to keyboard and assistive-technology users; the card-sized link
 * beneath it is a pointer convenience hidden from both.
 */
export function LocalPlaceDirectory({ locationId }: { locationId: string }) {
  const pathname = usePathname();
  const { state } = usePlay();
  const places = getLocalPlacesForLocation(locationId);
  if (places.length === 0) return null;
  // A place whose door opens on Mission completion reads that authoritative
  // state here, so the world visibly changes as soon as the Mission is done.
  const completedMissionIds = deriveCompletedMissionIds(state.missions);
  // An accepted Mission whose target NPC lives inside one of these places
  // guides that place's entrance — green for remaining work, blue when that NPC
  // is the turn-in; the NPC takes over once the player is inside.
  const guidance = deriveMissionGuidanceTargets(state.missions);
  // A place something inside it can permanently change shows its repaired copy
  // and artwork here too, so the town listing never disagrees with the place.
  const completedRepairTargetIds = deriveCompletedRepairTargetIds(Object.values(state.repairs));

  return (
    <div data-local-place-directory>
      <SectionHeader eyebrow="Around town">Places</SectionHeader>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {places.map((place) => {
          const access = deriveLocalPlaceAccess(place, completedMissionIds);
          const surface = deriveLocalPlaceSurface(place, completedRepairTargetIds);
          const href = localPlaceHref(pathname, place.id);
          const reasonId = `local-place-reason-${place.id}`;
          const guided = localPlaceGuidanceMeaning(guidance, place.id);

          return (
            <li className="flex" key={place.id}>
              {access.available ? (
                <article
                  className="relative flex w-full flex-col overflow-hidden border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] transition-colors focus-within:border-[color:var(--rs-accent-primary)] hover:border-[color:var(--rs-accent-primary)]"
                  data-local-place={place.id}
                  data-local-place-access="available"
                >
                  <Link
                    aria-hidden="true"
                    className="absolute inset-0"
                    data-local-place-card-link
                    href={href}
                    tabIndex={-1}
                  />
                  {/* Pointer events fall through the summary to the card link. */}
                  <div className="pointer-events-none">
                    <PlaceSummary surface={surface} />
                  </div>
                  <div className="relative mt-auto p-3 pt-0">
                    <MissionActionLink
                      aria-label={`Enter ${surface.displayName}`}
                      data-local-place-enter
                      guidance={guided}
                      haloClassName="w-full"
                      href={href}
                      intent="primary"
                    >
                      Enter
                    </MissionActionLink>
                  </div>
                </article>
              ) : (
                <article
                  className="flex w-full flex-col overflow-hidden border border-dashed border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)]"
                  data-local-place={place.id}
                  data-local-place-access="locked"
                >
                  <PlaceSummary dimmed surface={surface} />
                  <p
                    className="px-3 pb-3 text-xs leading-relaxed text-[color:var(--rs-text-muted)]"
                    data-local-place-locked-reason
                    id={reasonId}
                  >
                    {access.reason}
                  </p>
                  <div className="mt-auto p-3 pt-0">
                    <ActionButton
                      aria-describedby={reasonId}
                      className="w-full"
                      data-local-place-locked
                      disabled
                      intent="secondary"
                    >
                      <Lock aria-hidden="true" className="h-4 w-4" />
                      Locals only
                    </ActionButton>
                  </div>
                </article>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PlaceSummary({
  surface,
  dimmed = false,
}: {
  surface: LocalPlaceSurface;
  dimmed?: boolean;
}) {
  const scene = surface.presentation.scene;
  return (
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
            opacity: dimmed ? 0.55 : 1,
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
          {surface.displayName}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-[color:var(--rs-text-secondary)]">
          {surface.description}
        </p>
      </div>
    </>
  );
}
