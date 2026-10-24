"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowUp, Circle } from "lucide-react";
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
  const noticeId = notice?.noticeId;

  // Focus and scroll only for a reading the player just finished in the mobile
  // Inventory. A saved receipt restored on reload stays visible but does not
  // unexpectedly move the viewport or seize focus.
  useEffect(() => {
    if (!spotlight || !noticeId) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>("[data-echo-result-focus]");
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
    <Panel
      aria-labelledby="echo-reading-result-heading"
      className="scroll-mt-24 !border-[color:var(--rs-skill-runeworking)] !p-4"
      data-echo-notice={notice.outcome}
      data-echo-result-focus
      role="status"
      tabIndex={-1}
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
        Reading taken at {notice.locationName}, {notice.planetName}.
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
  );
}

/** Two existing Lucide SVG primitives, not a bitmap or new art asset. */
function EchoCompass({
  eastWest,
  northSouth,
}: {
  eastWest: "east" | "west" | "aligned";
  northSouth: "north" | "south" | "aligned";
}) {
  const angle = echoCompassDegrees(eastWest, northSouth);
  return (
    <div aria-hidden="true" className="relative h-28 w-28 shrink-0" data-echo-compass-angle={angle}>
      <Circle
        className="absolute left-2 top-2 h-24 w-24 text-[color:var(--rs-skill-runeworking)] opacity-50"
        strokeWidth={1}
      />
      <span className="absolute inset-0 grid place-items-center" style={{ rotate: `${angle}deg` }}>
        <ArrowUp
          className="rs-echo-compass-needle h-14 w-14 text-[color:var(--rs-skill-runeworking)]"
          strokeWidth={2.8}
        />
      </span>
      <span className="absolute left-1/2 top-0 -translate-x-1/2 text-[10px] text-[color:var(--rs-text-secondary)]">
        N
      </span>
      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[10px] text-[color:var(--rs-text-secondary)]">
        S
      </span>
      <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[10px] text-[color:var(--rs-text-secondary)]">
        E
      </span>
      <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[10px] text-[color:var(--rs-text-secondary)]">
        W
      </span>
    </div>
  );
}
