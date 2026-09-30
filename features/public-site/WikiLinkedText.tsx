import Link from "next/link";
import type { WikiParagraph } from "@/game/schemas/public-wiki";
import { getWikiArticlePath } from "./public-wiki";

const wikiLinkClassName =
  "rs-focus rounded-sm underline decoration-[color:var(--rs-accent-primary)] decoration-2 underline-offset-2 hover:text-[color:var(--rs-accent-primary)]";

/**
 * One run of authored prose with its deliberate Wiki links. Shared by Wiki
 * articles and Update bodies (issue #248), which use the same segment shape.
 */
export function WikiLinkedText({ paragraph }: { paragraph: WikiParagraph }) {
  if (typeof paragraph === "string") return <>{paragraph}</>;

  return (
    <>
      {paragraph.map((segment, index) =>
        typeof segment === "string" ? (
          <span key={index}>{segment}</span>
        ) : (
          <Link
            className={wikiLinkClassName}
            href={getWikiArticlePath({ slug: segment.articleSlug })}
            key={index}
          >
            {segment.text}
          </Link>
        ),
      )}
    </>
  );
}
