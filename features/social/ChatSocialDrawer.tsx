"use client";

import type { ReactNode } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { ChatSocialSurface } from "./ChatSocialSurface";
import { useSocial } from "./SocialContext";

/**
 * Chat/Social presented as a Drawer over the current Play state (issue #245).
 * Closing returns focus to the launcher and leaves Location, Map, or Journey
 * exactly as it was; opening it never navigates or touches gameplay state.
 */
export function ChatSocialDrawer({ conversations }: { conversations: ReactNode }) {
  const { cards, closeSocial, launcherRef, open } = useSocial();
  if (!open) return null;
  return (
    <Drawer
      eyebrow="Social"
      label="Chat"
      onClose={closeSocial}
      title="Chat"
      triggerRef={launcherRef}
    >
      <ChatSocialSurface cards={cards} conversations={conversations} />
    </Drawer>
  );
}
