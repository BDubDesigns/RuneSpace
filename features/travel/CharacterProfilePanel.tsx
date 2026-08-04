"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { StatusMeter } from "@/components/ui/StatusMeter";
import type { CharacterProfile } from "@/game/domain/character-profile";

/**
 * Neutral temporary portrait (issue #64). Portrait asset generation and
 * player portrait selection are explicitly deferred to a later issue; this
 * narrow presentation boundary keeps a stable square aspect ratio and
 * intrinsic dimensions so a later issue can supply a selected asset here
 * without redesigning the profile panel.
 *
 * The placeholder is a simple decorative person silhouette drawn with the
 * repository's inline-SVG technique — deliberately NOT a first-letter glyph,
 * which read like a numeric stat. It is fully decorative (`aria-hidden`):
 * the adjacent identity text carries the accessible name.
 */
function CharacterPortrait() {
  return (
    <div
      aria-hidden="true"
      className="grid h-20 w-20 shrink-0 place-items-center border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-raised)]"
      data-character-portrait
    >
      <svg
        aria-hidden="true"
        className="h-10 w-10 text-[color:var(--rs-text-muted)]"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" />
      </svg>
    </div>
  );
}

/**
 * One compact, mobile-first profile panel for a selected same-location
 * character (issue #64).
 *
 * - The panel is a non-modal inline region (deliberately not the modal Drawer:
 *   the #62 character-name list must stay interactive so selecting another
 *   character updates the same panel rather than stacking panels). It has an
 *   accessible name, an explicit Close control, Escape support, and returns
 *   focus to the list button that opened the current view.
 * - Every open, every target switch, and every accepted authoritative
 *   gameplay revision re-reads the narrow server boundary: the server
 *   rechecks same-location visibility on each read, so a target that is no
 *   longer visible yields the generic refusal and a safe error state. A
 *   request-generation token discards completions that raced a newer one.
 * - Only the approved public identity and progression fields are rendered;
 *   the panel never displays emails, account IDs, or internal IDs.
 */
export function CharacterProfilePanel({
  activeCharacterId,
  targetName,
  refreshKey,
  openerRef,
  panelRef,
  onClose,
}: {
  activeCharacterId: string;
  targetName: string | undefined;
  /** Accepted authoritative gameplay state identity; revalidates the profile. */
  refreshKey: unknown;
  /** The list button that opened the current view; focus returns here on close. */
  openerRef: RefObject<HTMLButtonElement | null>;
  /** The panel section element; the owner uses it for focus-recovery checks. */
  panelRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState<CharacterProfile | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [liveMessage, setLiveMessage] = useState<string | undefined>();
  const requestToken = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openedFor = useRef<string | undefined>(undefined);

  // Focus the panel heading when it first opens so the new context is
  // announced and the panel scrolls into view on mobile. While the panel is
  // open, switching targets keeps focus on the newly activated list button
  // instead of stealing it back into the panel.
  useEffect(() => {
    if (targetName && openedFor.current === undefined) {
      headingRef.current?.focus();
    }
    openedFor.current = targetName ?? undefined;
  }, [targetName]);

  // Escape closes, consistent with the shared overlay system.
  useEffect(() => {
    if (!targetName) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [targetName, onClose]);

  // Fresh authoritative read on every open/switch and on every accepted
  // authoritative gameplay revision (the same revalidation approach as the
  // #62 population read — no polling, presence, or real-time system).
  useEffect(() => {
    const name = targetName;
    const token = requestToken.current + 1;
    requestToken.current = token;
    if (!name) {
      setProfile(undefined);
      setError(undefined);
      setLoading(false);
      setLiveMessage(undefined);
      return;
    }
    setLoading(true);
    setProfile(undefined);
    setError(undefined);
    setLiveMessage(`Loading profile for ${name}`);
    fetch(
      `/api/character-profile?characterId=${encodeURIComponent(activeCharacterId)}&targetName=${encodeURIComponent(name)}`,
      { headers: { accept: "application/json" } },
    ).then(
      async (response) => {
        // Read the body first, then check the generation token: a superseded
        // request must never write state for a newer target, not even after
        // its headers arrived before a target switch.
        const body = (await response.json().catch(() => null)) as {
          profile?: CharacterProfile;
          error?: string;
        } | null;
        if (token !== requestToken.current) return;
        setLoading(false);
        if (!response.ok || !body?.profile) {
          setProfile(undefined);
          setError(body?.error ?? "This character's profile could not be loaded.");
          setLiveMessage("Profile unavailable");
          return;
        }
        setError(undefined);
        setProfile(body.profile);
        setLiveMessage(`Profile for ${body.profile.displayName} loaded`);
      },
      // A transport interruption of this read is non-fatal but stays visible:
      // the panel shows the safe unavailable state; the next accepted
      // gameplay revision (or a reopen) revalidates.
      () => {
        if (token !== requestToken.current) return;
        setLoading(false);
        setProfile(undefined);
        setError("The profile could not be loaded.");
        setLiveMessage("Profile unavailable");
      },
    );
    // `refreshKey` identity changes exactly when accepted authoritative
    // gameplay state arrives, so every accepted revision revalidates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetName, activeCharacterId, refreshKey]);

  return (
    <section
      aria-busy={loading}
      aria-label="Character profile"
      className="mt-4 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
      data-character-profile-panel
      hidden={!targetName}
      id="character-profile-panel"
      ref={panelRef}
    >
      {!targetName ? null : (
        <>
          <div className="flex items-start justify-between gap-3">
            <h3
              ref={headingRef}
              className="rs-focus font-display text-sm font-bold text-[color:var(--rs-text-primary)] outline-none"
              tabIndex={-1}
            >
              Character profile
            </h3>
            <ActionButton
              aria-label="Close character profile"
              className="shrink-0 px-3"
              intent="secondary"
              onClick={onClose}
            >
              Close
            </ActionButton>
          </div>
          <p aria-live="polite" className="sr-only">
            {liveMessage}
          </p>

          {loading ? (
            <p className="mt-3 text-sm text-[color:var(--rs-text-secondary)]">Loading profile…</p>
          ) : null}
          {error && !profile ? (
            <div className="mt-3">
              <Feedback tone="muted">{error}</Feedback>
            </div>
          ) : null}

          {profile ? (
            <>
              <div className="mt-3 flex gap-3">
                <CharacterPortrait />
                <div className="min-w-0">
                  <p className="break-words font-display text-sm font-bold text-[color:var(--rs-text-primary)]">
                    {profile.displayName}
                  </p>
                  <p className="break-words text-xs text-[color:var(--rs-text-secondary)]">
                    Player: {profile.ownerName}
                  </p>
                  <p className="mt-1 font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
                    Overall level {profile.overallLevel}
                  </p>
                </div>
              </div>

              {/* Reusable skill list: skills and their player-facing names come
                  from the server's authoritative projection; no per-skill
                  component conditional exists here. */}
              <ul className="mt-4 space-y-3">
                {profile.skills.map((skill) => (
                  <li className="min-w-0" data-character-skill key={skill.displayName}>
                    <p className="font-display text-sm font-bold text-[color:var(--rs-text-primary)]">
                      {skill.displayName} — Level {skill.level}
                    </p>
                    {skill.xpToNextLevel === undefined ? (
                      <p className="mt-1 text-xs text-[color:var(--rs-text-muted)]">
                        Maximum level reached — {skill.totalXp.toLocaleString()} total XP
                      </p>
                    ) : (
                      <div className="mt-1">
                        <StatusMeter
                          detail={`${skill.xpToNextLevel} XP to next level`}
                          label={`${skill.displayName} XP`}
                          value={Math.min(
                            100,
                            (skill.xpIntoLevel / (skill.xpIntoLevel + skill.xpToNextLevel)) * 100,
                          )}
                        />
                        <p className="mt-1 text-xs text-[color:var(--rs-text-muted)]">
                          {skill.totalXp.toLocaleString()} total XP · {skill.xpIntoLevel} XP into
                          this level
                        </p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
