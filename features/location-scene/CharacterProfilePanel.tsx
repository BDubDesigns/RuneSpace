"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { CharacterPortrait } from "@/components/portraits/CharacterPortrait";
import { CharacterSkillList } from "@/features/shared/CharacterSkillList";
import { useChat } from "@/features/chat/ChatContext";
import { SafetyFlow, type SafetyOutcome } from "@/features/chat/SafetyFlow";
import { ProfileTradeAction } from "@/features/player-trade/ProfileTradeAction";
import type { CharacterProfile } from "@/game/domain/character-profile";
import { GAMEPLAY_ACCESS_REQUIRED_CODE } from "@/game/domain/gameplay-access";

/** Public same-location profile presentation. The server remains the authority
 * for visibility and only returns the approved public projection.
 *
 * It is also a character-facing social surface (#247): Whisper opens the
 * conversation inside Chat/Social without leaving the Location, and Report and
 * Block act on this character's account by its public name only. Trade (#268)
 * leads the row and sends a trade request; for another character on the
 * player's own account — which the server says, never a name comparison — the
 * row is Trade alone, since Whisper, Report, and Block could only refuse. */
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
  const router = useRouter();
  const [profile, setProfile] = useState<CharacterProfile | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [liveMessage, setLiveMessage] = useState<string | undefined>();
  const requestToken = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openedFor = useRef<string | undefined>(undefined);
  const { startWhisper } = useChat();
  const [safety, setSafety] = useState<"report" | "block">();
  const [socialFeedback, setSocialFeedback] = useState<SafetyOutcome>();
  const [whispering, setWhispering] = useState(false);

  // A different profile never inherits the last one's open flow or outcome.
  useEffect(() => {
    setSafety(undefined);
    setSocialFeedback(undefined);
  }, [targetName]);

  async function whisper(name: string) {
    setWhispering(true);
    setSocialFeedback(undefined);
    const error = await startWhisper({ name });
    setWhispering(false);
    if (error) setSocialFeedback({ tone: "danger", text: error });
  }

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
          code?: string;
        } | null;
        if (token !== requestToken.current) return;
        // Issue #223: gameplay access was revoked or closed since this page
        // loaded; the server refused the read, so recover to Characters.
        if (body?.code === GAMEPLAY_ACCESS_REQUIRED_CODE) {
          router.replace("/characters");
          return;
        }
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
                  {profile.ownerName ? (
                    <p className="break-words text-xs text-[color:var(--rs-text-secondary)]">
                      Player: {profile.ownerName}
                    </p>
                  ) : null}
                  <p className="mt-1 font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
                    Character level {profile.characterLevel}
                  </p>
                </div>
              </div>
              <ProfileTradeAction targetName={profile.displayName}>
                {profile.sameAccount ? null : (
                  <>
                    <ActionButton
                      className="min-h-9 px-3 py-1 text-xs"
                      loading={whispering}
                      onClick={() => void whisper(profile.displayName)}
                    >
                      Whisper
                    </ActionButton>
                    <ActionButton
                      className="min-h-9 px-3 py-1 text-xs"
                      intent="secondary"
                      onClick={() => {
                        setSocialFeedback(undefined);
                        setSafety("report");
                      }}
                    >
                      Report
                    </ActionButton>
                    <ActionButton
                      className="min-h-9 px-3 py-1 text-xs"
                      intent="danger"
                      onClick={() => {
                        setSocialFeedback(undefined);
                        setSafety("block");
                      }}
                    >
                      Block
                    </ActionButton>
                  </>
                )}
              </ProfileTradeAction>
              {safety ? (
                <div className="mt-3">
                  <SafetyFlow
                    mode={safety}
                    onDone={(outcome) => {
                      setSafety(undefined);
                      setSocialFeedback(outcome);
                    }}
                    subject={{ name: profile.displayName, target: { name: profile.displayName } }}
                  />
                </div>
              ) : null}
              {socialFeedback ? (
                <Feedback tone={socialFeedback.tone}>{socialFeedback.text}</Feedback>
              ) : null}
              <CharacterSkillList className="mt-4" skills={profile.skills} />
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
