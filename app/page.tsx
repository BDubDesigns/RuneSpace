import type { Metadata } from "next";
import { headers } from "next/headers";
import { PublicLandingPage } from "@/features/public-site/PublicLandingPage";
import { auth } from "@/server/auth";

export const metadata: Metadata = {
  title: "RuneSpace — Playable pre-alpha",
  description:
    "RuneSpace is a browser-first, low-fi sci-fi RPG with a playable early-game loop in Holo Hollow.",
};

export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() });

  return <PublicLandingPage signedIn={Boolean(session?.user)} />;
}
