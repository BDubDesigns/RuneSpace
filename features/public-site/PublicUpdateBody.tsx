import Image from "next/image";
import { resolveArticleArt } from "@/game/content/article-art";
import type { PublicUpdate, PublicUpdateFigure } from "@/game/schemas/public-updates";
import { WikiLinkedText } from "./WikiLinkedText";

function UpdateFigure({ figure }: { figure: PublicUpdateFigure }) {
  const art = resolveArticleArt(figure.art);
  return (
    <figure
      className={`rs-update-figure rs-update-figure--${art.kind} rs-update-figure--${figure.side} overflow-hidden border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-raised)]`}
    >
      <Image
        alt={art.accessibleDescription}
        className="block h-auto w-full object-contain p-3"
        // Sizing hints follow the existing item/portrait presentation. CSS uses
        // intrinsic aspect ratio, never a fixed-height crop or stretched frame.
        width={art.kind === "item" ? 480 : 400}
        height={art.kind === "item" ? 480 : 500}
        sizes={art.kind === "item" ? "224px" : "192px"}
        src={art.src}
      />
      <figcaption className="border-t border-[color:var(--rs-border-structural)] px-3 py-2 text-center text-xs leading-5 text-[color:var(--rs-text-muted)]">
        {figure.caption ?? art.displayName}
      </figcaption>
    </figure>
  );
}

export function PublicUpdateBody({ body }: { body: PublicUpdate["body"] }) {
  return (
    <div className="rs-update-body mt-10 flow-root max-w-3xl text-base leading-8 text-[color:var(--rs-text-secondary)]">
      {body.map((block, index) =>
        typeof block === "object" && !Array.isArray(block) ? (
          <UpdateFigure key={index} figure={block} />
        ) : (
          <p key={index}>
            <WikiLinkedText paragraph={block} />
          </p>
        ),
      )}
    </div>
  );
}
