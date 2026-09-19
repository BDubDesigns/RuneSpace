"use client";

import type { RefObject } from "react";
import { ActionLink } from "@/components/ui/ActionLink";
import { Drawer } from "@/components/ui/Drawer";
import { CharacterPortrait } from "@/components/portraits/CharacterPortrait";
import { CharacterSkillList } from "@/features/shared/CharacterSkillList";
import type { CharacterPortraitPresentation } from "@/game/domain/character-portrait";
import type { PlayGameplayState } from "@/server/play";

/**
 * The current character's profile and progression (#213).
 *
 * A sibling of Inventory, not a page: it is the same shared `Drawer` overlay,
 * so near-full-screen mobile sizing, scrolling, the backdrop, Escape, focus
 * capture and focus return are the ones every RuneSpace overlay already has.
 *
 * Everything shown is server-authoritative projection. The Character Level and
 * the skill list come from `state.progression`, which is the same canonical
 * cross-skill boundary the same-location player inspector reads, so the two
 * surfaces cannot drift and a newly defined skill appears here on its own.
 * Credits are the same authoritative balance Inventory shows — deliberately
 * visible in both places, since a player asks for it while managing cargo and
 * while inspecting the character.
 *
 * There is no overall-character XP bar: Character Level is derived from skill
 * levels and has no XP track of its own.
 *
 * Switch Character is a sticky footer action rather than the last thing after
 * the skills, so it never scrolls out of reach as the game gains skills. It
 * links to the existing character selection screen; this slice adds no second
 * selection or management experience.
 */
export function CharacterPanel({
  characterName,
  portrait,
  state,
  onClose,
  triggerRef,
}: {
  characterName: string;
  portrait: CharacterPortraitPresentation;
  state: PlayGameplayState;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Drawer
      eyebrow="Current character"
      label="Character"
      onClose={onClose}
      title="Character"
      triggerRef={triggerRef}
    >
      <div className="mt-4 flex gap-3">
        <CharacterPortrait className="h-20 w-20" presentation={portrait} sizes="80px" />
        <div className="min-w-0">
          <p className="break-words font-display text-sm font-bold text-[color:var(--rs-text-primary)]">
            {characterName}
          </p>
          <p className="mt-1 font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
            Character level {state.progression.characterLevel}
          </p>
          <p
            className="mt-1 font-display text-sm font-bold text-[color:var(--rs-accent-primary)]"
            data-character-credits
          >
            {state.credits} Credits
          </p>
        </div>
      </div>
      <h3 className="mt-5 font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-text-secondary)]">
        Skills
      </h3>
      <CharacterSkillList className="mt-3" skills={state.progression.skills} />
      {/* Sticky inside the Drawer's own scroll container, so it stays reachable
          however long the skill list grows. The negative inline margins let the
          bar span the panel's horizontal padding, and its opaque surface keeps
          scrolling skills behind it rather than beside it. No negative bottom
          margin: `bottom-0` already resolves against the scrollport's padding
          edge, and cancelling the panel's bottom padding here would push the
          bar below the visible edge on a device with a safe-area inset. */}
      <div className="sticky bottom-0 -mx-4 mt-4 border-t border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-raised)] px-4 pb-3 pt-3">
        <ActionLink className="flex w-full" href="/characters">
          Switch Character
        </ActionLink>
      </div>
    </Drawer>
  );
}
