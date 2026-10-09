import type { Metadata } from "next";
import { PublicWikiItemsPage } from "@/features/public-site/PublicWikiItemPages";

export const metadata: Metadata = {
  title: "Items & Recipes — RuneSpace Wiki",
  description:
    "Every item in RuneSpace: what it is, how to get it, the recipes that make it, and what uses it.",
  alternates: { canonical: "/wiki/items" },
};

export default function WikiItemsRoute() {
  return <PublicWikiItemsPage />;
}
