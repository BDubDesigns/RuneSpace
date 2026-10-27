// RSS 2.0 news feed for the public Updates, served at /feed.xml.
//
// It renders the same repository-authored updates the /updates pages already
// show, newest first, one item per update: title, /updates/<slug> link,
// summary as the description, and the authored publishedAt as pubDate.
// No new data source: new updates flow into the feed on the next deploy,
// which is why this route needs no force-dynamic (the data ships with the
// build, same as the /updates pages themselves). Consumed by the Scapelikes
// developer dashboard's game news feed import, and any feed reader.

import { getPublishedUpdates, getPublicUpdatePath } from "@/features/public-site/public-updates";

const SITE_URL = "https://runespace.qcfailed.com";

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildFeed(): string {
  const updates = getPublishedUpdates();
  const items = updates
    .map((update) => {
      const url = `${SITE_URL}${getPublicUpdatePath(update)}`;
      const pubDate = new Date(update.publishedAt).toUTCString();
      return [
        "    <item>",
        `      <title>${escapeXml(update.title)}</title>`,
        `      <link>${url}</link>`,
        `      <guid isPermaLink="true">${url}</guid>`,
        `      <description>${escapeXml(update.summary)}</description>`,
        `      <pubDate>${pubDate}</pubDate>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");
  const lastBuildDate =
    updates.length > 0 ? new Date(updates[0]!.publishedAt).toUTCString() : new Date().toUTCString();
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    "    <title>RuneSpace Updates</title>",
    `    <link>${SITE_URL}/updates</link>`,
    "    <description>Official news and updates for RuneSpace, the blue-collar sci-fi browser RPG from QC Failed.</description>",
    "    <language>en-us</language>",
    `    <lastBuildDate>${lastBuildDate}</lastBuildDate>`,
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

export function GET(): Response {
  return new Response(buildFeed(), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
