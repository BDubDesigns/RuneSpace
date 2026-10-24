"use client";

import { useState, useTransition } from "react";
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
import { echoRewardLostLine, echoWrongReadingLine } from "./echo-copy";

/**
 * The result of a Seeker reading (#393), as a stored receipt rather than a
 * toast: a reading that finished while the player was away, across a refresh or
 * on another device still says what happened. A wrong reading gives its
 * directions from the hex it was taken at; a discovery shows its Runeworking XP
 * and the item it gave — or names the item that slipped back into RuneSpace for
 * want of room. Dismissing it changes nothing else.
 */
export function EchoReadingNotice() {
  const { acceptState, enqueueForeground, foregroundBusy, releaseCommand, state } = usePlay();
  const notice = state.echoHunt.notice;
  const [dismissing, setDismissing] = useState(false);
  const [message, setMessage] = useState<string>();
  const [, startTransition] = useTransition();

  if (!notice) return null;
  const noticeId = notice.noticeId;

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
  const runeworkingName = getSkillPresentation(SKILL_IDS.runeworking)?.displayName ?? "Runeworking";
  const reward = notice.rewardItemId;
  const rewardDefinition = reward ? getItemDefinition(reward) : undefined;
  return (
    <Panel
      className={
        found ? "rs-result-feedback-success !border-[color:var(--rs-accent-success)] !p-4" : "!p-4"
      }
      data-echo-notice={notice.outcome}
      role="status"
      tone="raised"
    >
      <p className="font-display text-lg font-bold tracking-wide" data-echo-notice-title>
        {found ? "Resonance Echo discovered!" : "The Seeker trembles, then goes still."}
      </p>
      <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">
        {found
          ? "The Seeker flares with impossible light. For an instant, something slips through the boundary between worlds."
          : notice.eastWest && notice.northSouth
            ? echoWrongReadingLine(notice.eastWest, notice.northSouth)
            : null}
      </p>
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
  );
}
