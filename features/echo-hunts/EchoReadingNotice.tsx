"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { SkillXpTile } from "@/components/items/SkillXpTile";
import { StackItemVisual } from "@/components/items/StackItemVisual";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { usePlay } from "@/features/play/PlayContext";
import { getItemDefinition } from "@/game/config/balance";
import { SKILL_IDS } from "@/game/config/foundations";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { getSkillPresentation } from "@/game/content/skill-presentation";
import { acknowledgeEchoReadingAction } from "@/server/actions";
import {
  echoCompassDegrees,
  echoDirectionsCopy,
  echoRewardLostLine,
  echoWrongReadingLine,
} from "./echo-copy";

/**
 * The result of a Seeker reading (#393), as a stored receipt rather than a
 * toast: a reading that finished while the player was away, across a refresh or
 * on another device still says what happened. A wrong reading gives its
 * directions from the hex it was taken at; a discovery shows its Runeworking XP
 * and the item it gave — or names the item that slipped back into RuneSpace for
 * want of room. Dismissing it changes nothing else.
 */
export function EchoReadingNotice({ spotlight = false }: { spotlight?: boolean }) {
  const { acceptState, enqueueForeground, foregroundBusy, releaseCommand, state } = usePlay();
  const notice = state.echoHunt.notice;
  const [dismissing, setDismissing] = useState(false);
  const [message, setMessage] = useState<string>();
  const [, startTransition] = useTransition();
  const resultRef = useRef<HTMLDivElement>(null);
  const noticeId = notice?.noticeId;

  // Focus and scroll only for a reading the player just finished in the mobile
  // Inventory. A saved receipt restored on reload stays visible but does not
  // unexpectedly move the viewport or seize focus.
  useEffect(() => {
    if (!spotlight || !noticeId) return;
    const frame = window.requestAnimationFrame(() => {
      const target = resultRef.current;
      if (!target) return;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [spotlight, noticeId]);

  if (!notice) return null;

  function dismiss() {
    if (dismissing) return;
    enqueueForeground(() => {
      setDismissing(true);
      setMessage(undefined);
      startTransition(async () => {
        try {
          const result = await acknowledgeEchoReadingAction({
            characterId: state.characterId,
            noticeId,
          });
          if (result.error) setMessage(result.error);
          else if (result.state) acceptState(result.state);
        } catch {
          setMessage("Comms interruption. The result is still here; try again.");
        } finally {
          setDismissing(false);
          releaseCommand();
        }
      });
    });
  }

  const found = notice.outcome === "found";
  const hasClue = !found && !!notice.eastWest && !!notice.northSouth;
  const runeworkingName = getSkillPresentation(SKILL_IDS.runeworking)?.displayName ?? "Runeworking";
  const reward = notice.rewardItemId;
  const rewardDefinition = reward ? getItemDefinition(reward) : undefined;
  return (
    <div
      aria-labelledby="echo-reading-result-heading"
      className="scroll-mt-24 outline-none"
      data-echo-result-focus
      ref={resultRef}
      role="group"
      tabIndex={-1}
    >
      <Panel
        className="!border-[color:var(--rs-skill-runeworking)] !p-4"
        data-echo-notice={notice.outcome}
        role="status"
        tone="raised"
      >
        <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-skill-runeworking)]">
          {found ? "Runeworking · Echo recovered" : "Runeworking · Resonance reading"}
        </p>
        <p
          className="mt-2 font-display text-lg font-bold tracking-wide"
          data-echo-notice-title
          id="echo-reading-result-heading"
        >
          {found ? "Resonance Echo discovered!" : "The Seeker trembles, then goes still."}
        </p>
        {hasClue ? (
          <div
            className="mt-3 flex items-center gap-3"
            data-echo-compass={echoDirectionsCopy(notice.eastWest!, notice.northSouth!)}
          >
            <EchoCompass eastWest={notice.eastWest!} northSouth={notice.northSouth!} />
            <div className="min-w-0 flex-1">
              <p className="font-display text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
                Signal direction
              </p>
              <p
                className="mt-1 font-display text-xl font-bold uppercase text-[color:var(--rs-skill-runeworking)]"
                data-echo-compass-direction
              >
                {echoDirectionsCopy(notice.eastWest!, notice.northSouth!)}
              </p>
              <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">
                {echoWrongReadingLine(notice.eastWest!, notice.northSouth!)}
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
            The Seeker flares with impossible light. For an instant, something slips through the
            boundary between worlds.
          </p>
        )}
        <p className="mt-1 text-xs text-[color:var(--rs-text-muted)]" data-echo-notice-where>
          Reading taken at {notice.locationName}, {notice.planetName}. 1 Seeker consumed
          {found ? "." : " · 0 Runeworking XP."}
        </p>
        {found ? (
          <div className="mt-3 flex flex-wrap items-start gap-3">
            <SkillXpTile
              amount={notice.xpAwarded}
              className="h-28 w-28"
              skillId={SKILL_IDS.runeworking}
              skillName={runeworkingName}
            />
            {reward && notice.rewardKept ? (
              <div className="h-28 w-28" data-echo-notice-reward={reward}>
                <StackItemVisual
                  itemId={reward}
                  name={resolveItemPresentation(reward, reward).displayName}
                  quantity={1}
                  stackLimit={rewardDefinition?.kind === "stack" ? rewardDefinition.stackLimit : 1}
                />
              </div>
            ) : null}
          </div>
        ) : null}
        {found && reward && notice.rewardKept === false ? (
          <p
            className="mt-2 text-sm text-[color:var(--rs-accent-danger)]"
            data-echo-notice-lost={reward}
          >
            {echoRewardLostLine(reward)}
          </p>
        ) : null}
        <div className="mt-3">
          <ActionButton
            data-echo-notice-dismiss
            intent={found ? "success" : "secondary"}
            loading={foregroundBusy && dismissing}
            onClick={dismiss}
          >
            DISMISS
          </ActionButton>
        </div>
        {message ? <Feedback tone="danger">{message}</Feedback> : null}
      </Panel>
    </div>
  );
}

/** One lightweight SVG: a fixed eight-direction clue with an occasional tiny wobble. */
function EchoCompass({
  eastWest,
  northSouth,
}: {
  eastWest: "east" | "west" | "aligned";
  northSouth: "north" | "south" | "aligned";
}) {
  const angle = echoCompassDegrees(eastWest, northSouth);
  return (
    <svg
      aria-hidden="true"
      className="h-28 w-28 shrink-0"
      data-echo-compass-angle={angle}
      viewBox="0 0 120 120"
    >
      <circle
        cx="60"
        cy="60"
        r="44"
        fill="none"
        stroke="var(--rs-skill-runeworking)"
        strokeOpacity="0.45"
        strokeWidth="1.5"
      />
      <circle
        cx="60"
        cy="60"
        r="31"
        fill="none"
        stroke="var(--rs-skill-runeworking)"
        strokeOpacity="0.17"
      />
      <path
        d="M60 10v8 M60 102v8 M10 60h8 M102 60h8"
        fill="none"
        stroke="var(--rs-skill-runeworking)"
        strokeOpacity="0.65"
        strokeWidth="2"
      />
      <g fill="var(--rs-text-secondary)" fontFamily="monospace" fontSize="9" textAnchor="middle">
        <text x="60" y="8">N</text>
        <text x="60" y="119">S</text>
        <text x="114" y="63">E</text>
        <text x="6" y="63">W</text>
      </g>
      <g transform={`rotate(${angle} 60 60)`}>
        <g className="rs-echo-compass-needle">
          <path d="M60 24 L69 65 L60 57 L51 65 Z" fill="var(--rs-skill-runeworking)" />
          <path d="M60 96 L51 55 L60 63 L69 55 Z" fill="var(--rs-border-structural)" />
        </g>
      </g>
      <circle
        cx="60"
        cy="60"
        r="4.5"
        fill="var(--rs-surface-raised)"
        stroke="var(--rs-skill-runeworking)"
        strokeWidth="1.8"
      />
    </svg>
  );
}
