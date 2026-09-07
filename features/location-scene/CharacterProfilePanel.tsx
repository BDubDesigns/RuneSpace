"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { CharacterPortrait } from "@/components/portraits/CharacterPortrait";
import type { CharacterProfile } from "@/game/domain/character-profile";

/** Public same-location profile presentation. The server remains the authority
 * for visibility and only returns the approved public projection. */
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
  refreshKey: unknown;
  openerRef: RefObject<HTMLButtonElement | null>;
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

  useEffect(() => {
    if (targetName && openedFor.current === undefined) headingRef.current?.focus();
    openedFor.current = targetName ?? undefined;
  }, [targetName]);

  useEffect(() => {
    if (!targetName) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [targetName, onClose]);

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
      () => {
        if (token !== requestToken.current) return;
        setLoading(false);
        setProfile(undefined);
        setError("The profile could not be loaded.");
        setLiveMessage("Profile unavailable");
      },
    );
    // Accepted gameplay state identity is the authoritative revalidation key.
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
                <CharacterPortrait
                  className="h-20 w-20"
                  presentation={profile.portrait}
                  sizes="80px"
                />
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
