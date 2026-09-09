import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicWikiArticlePage } from "@/features/public-site/PublicWikiPage";
import {
  getWikiArticle,
  getWikiArticlePath,
  getWikiArticles,
} from "@/features/public-site/public-wiki";

export const dynamicParams = false;

export function generateStaticParams() {
  return getWikiArticles().map((article) => ({ slug: [article.slug] }));
}

function resolveSlug(slug: readonly string[]): string | undefined {
  return slug.length === 1 ? slug[0] : undefined;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const articleSlug = resolveSlug(slug);
  const article = articleSlug ? getWikiArticle(articleSlug) : undefined;
  if (!article) return { title: "Page not found — RuneSpace", robots: { index: false } };

  return {
    title: `${article.title} — RuneSpace Wiki`,
    description: article.summary,
    alternates: { canonical: getWikiArticlePath(article) },
  };
}

export default async function WikiArticleRoute({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const articleSlug = resolveSlug(slug);
  const article = articleSlug ? getWikiArticle(articleSlug) : undefined;
  if (!article) notFound();

  return <PublicWikiArticlePage article={article} />;
}
