import { EXPRESSION_IDS } from "@/game/config/foundations";
import { getItemPresentation } from "@/game/content/item-presentation";
import { getNpc, resolveNpcExpression } from "@/game/content/npcs";
import type { ArticleArt } from "@/game/schemas/article-art";

export type ArticleArtPresentation = {
  src: string;
  displayName: string;
  accessibleDescription: string;
  kind: ArticleArt["kind"];
};

/** Shared by validation and presentation; no placeholder or alternate lookup. */
export function resolveArticleArt(art: ArticleArt): ArticleArtPresentation {
  if (art.kind === "item") {
    const item = getItemPresentation(art.itemId);
    if (!item?.artworkSrc) {
      throw new Error(`Article item has no canonical artwork: ${art.itemId}`);
    }
    return {
      kind: art.kind,
      src: item.artworkSrc,
      displayName: item.displayName,
      accessibleDescription: item.accessibleDescription,
    };
  }

  const npc = getNpc(art.npcId);
  if (!npc) throw new Error(`Unknown article NPC: ${art.npcId}`);
  const expressionId = art.expressionId ?? EXPRESSION_IDS.neutral;
  const src = resolveNpcExpression(art.npcId, expressionId);
  if (!src) {
    throw new Error(
      `Article NPC has no canonical expression artwork: ${art.npcId}/${expressionId}`,
    );
  }
  return {
    kind: art.kind,
    src,
    displayName: npc.displayName,
    accessibleDescription: `${npc.displayName}, ${npc.role}, ${expressionId} expression`,
  };
}
