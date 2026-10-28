import { describe, expect, it } from "vitest";
import { GET } from "@/app/feed.xml/route";
import { getPublishedUpdates, getPublicUpdatePath } from "@/features/public-site/public-updates";

const SITE_URL = "https://runespace.qcfailed.com";

// Same escaping the route applies to title and description XML elements.
function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function feedText(): Promise<string> {
  return await GET().text();
}

function itemBlocks(feed: string): string[] {
  return feed
    .split("<item>")
    .slice(1)
    .map((block) => block.split("</item>")[0]!);
}

function contentHtml(item: string): string {
  const encoded = item.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/)![1]!;
  return [...encoded.matchAll(/<!\[CDATA\[(.*?)\]\]>/gs)].map((match) => match[1]).join("");
}

describe("GET /feed.xml", () => {
  it("serves RSS with the content namespace and channel fields", async () => {
    const response = GET();
    expect(response.headers.get("Content-Type")).toBe("application/rss+xml; charset=utf-8");
    const feed = await response.text();
    expect(feed.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(feed).toContain(
      '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    );
    expect(feed).toContain("<title>RuneSpace Updates</title>");
    expect(feed).toContain(`<link>${SITE_URL}/updates</link>`);
  });

  it("emits one full-content item per update, newest first", async () => {
    const feed = await feedText();
    const updates = getPublishedUpdates();
    const items = itemBlocks(feed);
    expect(items).toHaveLength(updates.length);
    items.forEach((item, index) => {
      const update = updates[index]!;
      const url = `${SITE_URL}${getPublicUpdatePath(update)}`;
      expect(item).toContain(`<title>${escapeXml(update.title)}</title>`);
      expect(item).toContain(`<link>${url}</link>`);
      expect(item).toContain(`<guid isPermaLink="true">${url}</guid>`);
      expect(item).toContain(`<description>${escapeXml(update.summary)}</description>`);
      expect(item).toContain("<category>update</category>");
      expect(item).toContain(`<pubDate>${new Date(update.publishedAt).toUTCString()}</pubDate>`);
      const html = contentHtml(item);
      expect(html).toContain("<h2>Patch notes</h2>");
      expect(html).toContain("<p>");
    });
  });

  it("derives GUIDs from slugs alone, so title or content edits cannot change identity", async () => {
    const feed = await feedText();
    const updates = getPublishedUpdates();
    const items = itemBlocks(feed);
    items.forEach((item, index) => {
      const update = updates[index]!;
      expect(item).toContain(`<guid isPermaLink="true">${SITE_URL}/updates/${update.slug}</guid>`);
    });
  });

  it("stays within the Scapelikes feed limits", async () => {
    const feed = await feedText();
    const items = itemBlocks(feed);
    expect(items.length).toBeLessThanOrEqual(500);
    expect(Buffer.byteLength(feed, "utf8")).toBeLessThan(4 * 1024 * 1024);
    for (const item of items) {
      expect(Buffer.byteLength(contentHtml(item), "utf8")).toBeLessThan(200_000);
    }
  });

  it("keeps CDATA sections balanced", async () => {
    const feed = await feedText();
    const opens = (feed.match(/<!\[CDATA\[/g) ?? []).length;
    const closes = (feed.match(/\]\]>/g) ?? []).length;
    expect(opens).toBeGreaterThanOrEqual(itemBlocks(feed).length);
    expect(opens).toBe(closes);
  });
});
