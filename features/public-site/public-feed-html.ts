import { resolveArticleArt } from "@/game/content/article-art";
import type { PublicUpdate, PublicUpdateParagraph } from "@/game/schemas/public-updates";
import { getWikiArticlePath } from "./public-wiki";

/**
 * Full article HTML for one public Update, for the RSS content:encoded body.
 * Mirrors the article page (PublicUpdatesPage + PublicUpdateBody) in plain,
 * sanitizer-safe HTML: hero image first, body blocks in order, then patch
 * notes. No classes, styles, scripts, or event handlers: Scapelikes strips
 * those on import. All links and image sources are absolute, and figure
 * sides are dropped: they are a page-layout hint the sanitizer would strip
 * anyway, so feed figures appear in body order.
 */
export function buildPublicUpdateFeedHtml(update: PublicUpdate, siteUrl: string): string {
  const base = siteUrl.replace(/\/$/, "");
  const parts: string[] = [];
  if (update.hero) {
    parts.push(
      `<img src="${absoluteUrl(base, update.hero.src)}" alt="${escapeHtmlAttr(update.hero.alt)}">`,
    );
  }
  for (const block of update.body) {
    if (typeof block === "object" && !Array.isArray(block)) {
      const art = resolveArticleArt(block.art);
      const caption = block.caption ?? art.displayName;
      parts.push(
        `<figure><img src="${absoluteUrl(base, art.src)}" alt="${escapeHtmlAttr(art.accessibleDescription)}"><figcaption>${escapeHtmlText(caption)}</figcaption></figure>`,
      );
    } else {
      parts.push(`<p>${renderParagraph(block, base)}</p>`);
    }
  }
  parts.push("<h2>Patch notes</h2>");
  for (const section of update.patchNotes) {
    parts.push(`<h3>${escapeHtmlText(section.heading)}</h3>`);
    parts.push(
      `<ul>${section.items.map((item) => `<li>${escapeHtmlText(item)}</li>`).join("")}</ul>`,
    );
  }
  return parts.join("\n");
}

function renderParagraph(paragraph: PublicUpdateParagraph, base: string): string {
  if (typeof paragraph === "string") return escapeHtmlText(paragraph);
  // Segment text is deliberately NOT trimmed: leading/trailing spaces are
  // load-bearing, they keep "See " + link + " for how..." from concatenating.
  return paragraph
    .map((segment) =>
      typeof segment === "string"
        ? escapeHtmlText(segment)
        : `<a href="${absoluteUrl(base, getWikiArticlePath({ slug: segment.articleSlug }))}">${escapeHtmlText(segment.text)}</a>`,
    )
    .join("");
}

function absoluteUrl(base: string, path: string): string {
  return `${base}${path}`;
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(value: string): string {
  return escapeHtmlText(value).replace(/"/g, "&quot;");
}

/**
 * Wrap HTML in a CDATA section, splitting any "]]>" in the content so the
 * section never terminates early. Rejoining the sections reproduces the
 * original HTML exactly.
 */
export function wrapCdata(html: string): string {
  return `<![CDATA[${html.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}
