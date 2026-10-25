"use client";

import Image from "next/image";
import { TypewriterText } from "@/features/dialogue/TypewriterText";
import { cabinAnnouncementAt } from "@/game/domain/cabin-announcements";

/** A booking's greeting is typed as the journey begins; a reload past this shows it whole. */
const FRESH_DEPARTURE_MS = 3_000;

/**
 * Milky Waymo's cabin assistant (#404): one compact, noninteractive panel under
 * the galaxy chart that speaks the journey's preauthored announcements in the
 * dialogue typewriter treatment. No model, no chat, no history: each new line
 * replaces the last.
 *
 * What it says is derived from the journey's own recorded start and arrival
 * instants and the clock (`cabinAnnouncementAt`), never from state it keeps, so
 * a reload, a reopened panel or a second device shows the line the journey is on
 * now, in full, rather than restarting, reshuffling or replaying what it missed.
 * Only a line that begins while it is on screen types itself, and a fresh
 * booking's greeting. Reduced motion shows every line whole, and a screen reader
 * hears the full line once, not each character.
 */
export function CabinAssistant({
  journey,
  now,
  destinationName,
}: {
  journey: { routeId: string; startedAt: string; arrivesAt: string };
  now: number;
  destinationName: string;
}) {
  const announcement = cabinAnnouncementAt(journey, now, destinationName);
  const freshDeparture =
    announcement.phase === "departure" &&
    now - new Date(journey.startedAt).getTime() < FRESH_DEPARTURE_MS;
  return (
    <section
      aria-label="Milky Waymo cabin assistant"
      className="mw-cabin"
      data-cabin-assistant
      data-cabin-phase={announcement.phase}
    >
      <header className="mw-cabin__header">
        <Image
          alt=""
          className="mw-cabin__mark"
          height={179}
          src="/branding/milky-waymo-mark.webp"
          width={640}
        />
        <h3 className="mw-cabin__title" data-cabin-title>
          Milky Waymo — Cabin Assistant
        </h3>
      </header>
      {/* Not keyed by the line: the same live region sees its text change, so a screen
          reader announces the new line, and only the first line is ever "late". */}
      <TypewriterText
        className="mw-cabin__line"
        initiallyComplete={!freshDeparture}
        text={announcement.text}
      />
    </section>
  );
}
