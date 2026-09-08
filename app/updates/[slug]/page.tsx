import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicUpdateArticlePage } from "@/features/public-site/PublicUpdatesPage";
import {
  getPublicUpdate,
  getPublicUpdatePath,
  getPublishedUpdates,
} from "@/features/public-site/public-updates";

export const dynamicParams = false;

export function generateStaticParams() {
  return getPublishedUpdates().map((update) => ({ slug: update.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const update = getPublicUpdate(slug);
  if (!update) return { title: "Update not found — RuneSpace", robots: { index: false } };

  return {
    title: `${update.title} — RuneSpace`,
    description: update.summary,
    alternates: { canonical: getPublicUpdatePath(update) },
  };
}

export default async function UpdateArticleRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const update = getPublicUpdate(slug);
  if (!update) notFound();

  return <PublicUpdateArticlePage update={update} />;
}
