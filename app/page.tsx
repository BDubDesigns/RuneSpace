import type { Metadata } from "next";
import { headers } from "next/headers";
import { PublicLandingPage } from "@/features/public-site/PublicLandingPage";
import { auth } from "@/server/auth";
import { loadRuneSpaceLaunchState } from "@/server/gameplay-access";

export const metadata: Metadata = {
  title: "RuneSpace — Playable pre-alpha",
  description:
    "RuneSpace is a browser-first, low-fi sci-fi RPG with a playable early-game loop in Holo Hollow.",
};

export default async function HomePage() {
  const [session, launch] = await Promise.all([
    auth.api.getSession({ headers: await headers() }),
    loadRuneSpaceLaunchState(),
  ]);

  return (
    <PublicLandingPage
      signedIn={Boolean(session?.user)}
      launch={{
        publicGameplayOpen: launch.publicGameplayOpen,
        launchTargetAt: launch.launchTargetAt?.toISOString() ?? null,
        serverNow: new Date().toISOString(),
      }}
    />
  );
}
