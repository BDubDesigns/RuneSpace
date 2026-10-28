"use client";

import { useEffect, useRef } from "react";
import { usePlay } from "@/features/play/PlayContext";
import { trackAnalyticsEvent } from "./analytics-client";
import {
  ANALYTICS_EVENTS,
  FIRST_XP_GAINED_MILESTONE,
  observeFirstXpGain,
  totalSkillXp,
} from "./analytics-events";

/**
 * Play-session analytics (issue #413). Rendered only inside `PlayProvider`,
 * whose server component has already authenticated the session, checked
 * gameplay access, and verified character ownership before this mounts.
 *
 * - `gameplay_entered` fires once per mount: a real Play entry or navigation.
 *   Panels, map changes, polling and state updates never re-run it.
 * - `gameplay_milestone_reached` fires when server-confirmed state shows total
 *   skill XP going from zero to positive during this session. A character that
 *   already has XP when Play opens never fires it.
 */
export function PlayAnalytics() {
  const { state } = usePlay();
  const entered = useRef(false);
  const milestoneReached = useRef(false);
  const previousXp = useRef(totalSkillXp(state.skillTotalXp));
  const characterId = useRef(state.characterId);

  useEffect(() => {
    if (entered.current) return;
    entered.current = true;
    trackAnalyticsEvent(ANALYTICS_EVENTS.gameplayEntered);
  }, []);

  useEffect(() => {
    if (state.characterId !== characterId.current) {
      // A different character's snapshot is never a progression observation.
      characterId.current = state.characterId;
      previousXp.current = totalSkillXp(state.skillTotalXp);
      return;
    }
    const nextXp = totalSkillXp(state.skillTotalXp);
    if (!milestoneReached.current && observeFirstXpGain(previousXp.current, nextXp)) {
      milestoneReached.current = true;
      trackAnalyticsEvent(ANALYTICS_EVENTS.gameplayMilestoneReached, {
        milestone: FIRST_XP_GAINED_MILESTONE,
      });
    }
    previousXp.current = nextXp;
  }, [state.characterId, state.skillTotalXp]);

  return null;
}
