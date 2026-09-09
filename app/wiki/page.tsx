import type { Metadata } from "next";
import { PublicWikiIndexPage } from "@/features/public-site/PublicWikiPage";

export const metadata: Metadata = {
  title: "Wiki — RuneSpace",
  description:
    "A compact player manual for the currently playable RuneSpace Holo Hollow build: travel, work, gear, and missions.",
  alternates: { canonical: "/wiki" },
};

export default function WikiPage() {
  return <PublicWikiIndexPage />;
}
