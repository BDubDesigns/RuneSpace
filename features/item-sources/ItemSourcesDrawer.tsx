"use client";

import { useState, type RefObject } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { CreditsAmount } from "@/components/ui/CreditsAmount";
import { Drawer } from "@/components/ui/Drawer";
import { Feedback } from "@/components/ui/Feedback";
import { ItemVisual } from "@/components/items/ItemVisual";
import {
  extendItemSourcePath,
  resolveItemSources,
  type ItemSourceFacts,
} from "@/game/domain/item-sources";
import {
  describeItemSources,
  itemName,
  type ItemSourceDescription,
} from "./item-source-presentation";

function SourceEntry({
  description,
  onInspect,
  inspectable,
}: {
  description: ItemSourceDescription;
  onInspect: (itemId: string) => void;
  inspectable: (itemId: string) => boolean;
}) {
  const locked = description.locked !== undefined;
  return (
    <li
      className={`border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] px-3 py-3 ${locked ? "opacity-80" : ""}`}
      data-item-source={description.key}
      data-item-source-kind={description.kind}
      data-item-source-locked={locked ? "true" : "false"}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="font-display text-sm font-bold uppercase tracking-wide">
          {description.title}
        </h4>
        {locked ? (
          <span
            className="border border-[color:var(--rs-border-structural)] px-1.5 py-0.5 font-display text-[0.65rem] uppercase tracking-wide text-[color:var(--rs-text-muted)]"
            data-item-source-badge="locked"
          >
            Locked
          </span>
        ) : null}
      </div>
      {description.where ? (
        <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">
          {description.where}
          {description.requirement ? ` · ${description.requirement}` : ""}
        </p>
      ) : null}
      {description.locked ? (
        <p className="mt-1 text-xs text-[color:var(--rs-text-muted)]" data-item-source-gate>
          {description.locked}
        </p>
      ) : null}
      {description.price !== undefined ? (
        <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">
          <CreditsAmount
            amount={description.price}
          >{`${description.price} Credits each`}</CreditsAmount>
        </p>
      ) : null}
      {description.notes.map((note) => (
        <p className="mt-1 text-xs text-[color:var(--rs-text-muted)]" key={note}>
          {note}
        </p>
      ))}
      {description.inputs ? (
        <div className="mt-2">
          <p className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">Needs</p>
          <ul className="mt-1 space-y-1" data-item-source-inputs>
            {description.inputs.map((input) => (
              <li
                className="flex items-center justify-between gap-2 text-sm"
                data-item-source-input={input.itemId}
                key={input.itemId}
              >
                <span className="text-[color:var(--rs-text-secondary)]">{input.label}</span>
                {inspectable(input.itemId) ? (
                  <button
                    aria-label={`How to get ${itemName(input.itemId)}`}
                    className="rs-focus min-h-[var(--rs-touch-target)] px-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--rs-accent-primary)] underline-offset-2 hover:underline"
                    data-item-source-inspect={input.itemId}
                    onClick={() => onInspect(input.itemId)}
                    type="button"
                  >
                    Sources
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {description.yields ? (
        <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">{description.yields}</p>
      ) : null}
    </li>
  );
}

/**
 * The details for the last item on `path`: its ways of getting it, each recipe
 * ingredient inspectable in turn (#326). Presentational — the path belongs to
 * the caller, so it can be rendered and tested without the modal shell.
 *
 * Every step is the same item-source projection, and an ingredient already on
 * the path is shown without a Sources control, so a future recipe cycle cannot
 * trap the player in a loop of details.
 */
export function ItemSourcesDetails({
  path,
  facts,
  onDrill,
  onBack,
}: {
  path: readonly string[];
  facts: ItemSourceFacts;
  onDrill: (itemId: string) => void;
  onBack: () => void;
}) {
  const currentId = path[path.length - 1] ?? "";
  const previousId = path.length > 1 ? path[path.length - 2] : undefined;
  const descriptions = describeItemSources(currentId, resolveItemSources(currentId, facts), facts);
  return (
    <div data-item-sources={currentId}>
      <div className="flex items-start gap-3">
        <ItemVisual className="w-28 shrink-0" itemId={currentId} name={itemName(currentId)} />
        {previousId ? (
          <ActionButton data-item-sources-back intent="secondary" onClick={onBack} type="button">
            Back to {itemName(previousId)}
          </ActionButton>
        ) : null}
      </div>
      {descriptions.length === 0 ? (
        <Feedback tone="muted">No known way to get this yet.</Feedback>
      ) : (
        <ul aria-label={`Ways to get ${itemName(currentId)}`} className="mt-3 space-y-2">
          {descriptions.map((description) => (
            <SourceEntry
              description={description}
              inspectable={(inputId) => extendItemSourcePath(path, inputId) !== undefined}
              key={description.key}
              onInspect={onDrill}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * "How can I get this?" for one item as a modal (#326). A read-only reference:
 * opening it never touches Mission state, guidance, or the character, and it
 * has no commands. Reusable on any surface that shows an item.
 */
export function ItemSourcesDrawer({
  itemId,
  facts,
  onClose,
  triggerRef,
}: {
  itemId: string;
  facts: ItemSourceFacts;
  onClose: () => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [path, setPath] = useState<readonly string[]>([itemId]);
  const currentId = path[path.length - 1] ?? itemId;
  return (
    <Drawer
      eyebrow="How to get"
      label={`How to get ${itemName(currentId)}`}
      onClose={onClose}
      title={itemName(currentId)}
      triggerRef={triggerRef}
    >
      <ItemSourcesDetails
        facts={facts}
        onBack={() => setPath((current) => current.slice(0, -1))}
        onDrill={(next) => setPath((current) => extendItemSourcePath(current, next) ?? current)}
        path={path}
      />
    </Drawer>
  );
}
