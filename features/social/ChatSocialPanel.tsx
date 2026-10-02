"use client";

import { useEffect, type ReactNode } from "react";
import {
  UtilitySurface,
  type DockedUtilityRegion,
  type UtilityPresentation,
} from "@/components/ui/UtilitySurface";
import { ChatSocialSurface } from "./ChatSocialSurface";
import { useSocial } from "./SocialContext";

/**
 * Chat/Social as a Play utility (issues #245, #286): a Drawer over the current
 * Play state below the desktop breakpoint, a docked panel in the right rail at
 * it. Either way it is the one mounted instance, so the one realtime stream and
 * the Chat state in `ChatProvider` are shared; closing the Drawer returns focus
 * to the launcher and leaves Location, Map, or Journey exactly as it was, and
 * opening it never navigates or touches gameplay state.
 *
 * While mounted it reports `surfaceVisible`, the fact "decisions that depend on
 * the player having seen Chat" read — a desktop home shows Chat with no open
 * intent at all, and a Chat that is not mounted shows nothing and reads nothing.
 */
export function ChatSocialPanel({
  conversations,
  presentation,
  docked,
}: {
  conversations: ReactNode;
  presentation: UtilityPresentation;
  docked?: DockedUtilityRegion;
}) {
  const { cards, closeSocial, launcherRef, setSurfaceVisible } = useSocial();
  useEffect(() => {
    setSurfaceVisible(true);
    return () => setSurfaceVisible(false);
  }, [setSurfaceVisible]);
  return (
    <UtilitySurface
      docked={docked}
      eyebrow="Social"
      label="Chat"
      onClose={closeSocial}
      presentation={presentation}
      title="Chat"
      triggerRef={launcherRef}
    >
      <ChatSocialSurface cards={cards} conversations={conversations} />
    </UtilitySurface>
  );
}
