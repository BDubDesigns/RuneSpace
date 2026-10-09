import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicWikiItemPage } from "@/features/public-site/PublicWikiItemPages";
import {
  buildWikiItemPage,
  getWikiItemBySlug,
  getWikiItems,
} from "@/features/public-site/public-item-wiki";

export const dynamicParams = false;

export function generateStaticParams() {
  return getWikiItems().map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const entry = getWikiItemBySlug(slug);
  const page = entry ? buildWikiItemPage(entry.itemId) : undefined;
  if (!page) return { title: "Page not found — RuneSpace", robots: { index: false } };

  return {
    title: `${page.name} — RuneSpace Wiki`,
    description: page.summary,
    alternates: { canonical: page.path },
  };
}

export default async function WikiItemRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entry = getWikiItemBySlug(slug);
  const page = entry ? buildWikiItemPage(entry.itemId) : undefined;
  if (!page) notFound();

  return <PublicWikiItemPage page={page} />;
}
