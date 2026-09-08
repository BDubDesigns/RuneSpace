import type { Metadata } from "next";
import { PublicUpdatesPage } from "@/features/public-site/PublicUpdatesPage";

export const metadata: Metadata = {
  title: "Updates — RuneSpace",
  description:
    "Player-facing RuneSpace updates, release notes, and milestones from the playable Holo Hollow build.",
  alternates: { canonical: "/updates" },
};

export default function UpdatesPage() {
  return <PublicUpdatesPage />;
}
