# Holo Hollow Architecture Audit — Owner Review Decisions

**Status: Owner-reviewed clarification for the non-normative Holo Hollow architecture research.**

This companion note records product-owner decisions made while reviewing `docs/research/holo-hollow-architecture-audit.md` on branch `research/holo-hollow-architecture-audit`.

It does **not** make the architecture audit canonical implementation architecture. `docs/holo-hollow.md` remains the approved product/design direction, current shipped code remains authoritative for existing behavior, and implementation details must still be carried into properly scoped issues and canonical docs before implementation.

## Existing-character Credits

Existing pre-beta characters should receive the same **10 starting Credits** as newly created characters when Credits are introduced.

The proposed migration default of 10 is therefore intentional. There is no product requirement to distinguish characters created before Credits existed from characters created afterward, and no separate legacy-character compatibility behavior or special backfill is needed unless implementation inspection reveals a concrete reason.

This resolves the first owner question in §13 of the architecture audit.

## Mara Kells foundation scope

Mara Kells should exist as a stable NPC/content identity in the Holo Hollow foundation and be associated with **HH B&B**, even though HH B&B initially remains visible but locked.

During the foundation slice:

- Mara exists in content as one of the three approved early Holo Hollow residents: Bix Weller, Mara Kells, and Renn Calder.
- HH B&B is visible but locked.
- Mara is not yet an ordinary interactable resident because the player has not been introduced to her and cannot enter the B&B.
- Mara does not require her full portrait/expression set or the enterable HH B&B interior during the foundation asset pass.

The follow-up Wade apprentice Mission introduces Mara naturally during the authored Bix-shop conversation. She appears there as a dialogue/cutscene participant, **not** as a persistent second resident NPC in Bix's shop.

The existing dialogue system's per-beat speaker support should be reused for this appearance. This does not create a requirement for simultaneous multi-NPC interaction UI or a generic multi-NPC scene framework.

On successful completion of the Wade apprentice Mission:

- HH B&B becomes enterable;
- Mara becomes the resident ordinary **Talk** interaction inside HH B&B.

This is the intended progression:

**Wade apprentice Mission → visit/interact with Bix → Mara is introduced during the Bix-shop dialogue → complete the Power Cell errand → HH B&B unlocks → Mara becomes available to talk to inside HH B&B.**

This resolves the second owner question in §13 of the architecture audit and clarifies the intended boundary between foundation content and the follow-up Mission.

## Implementation sequencing

These decisions do not authorize Holo Hollow implementation yet and do not change the current one-active-issue/PR workflow.

The intended transition is:

1. Finish and merge the currently active RuneSpace PR.
2. Finish/approve the Holo Hollow art required by the first implementation slice.
3. Re-read the architecture audit together with this owner-decision note.
4. Scope the first Holo Hollow implementation issue from the approved design plus the reviewed audit conclusions.
5. Carry any accepted normative architecture into the appropriate canonical docs in the implementation issue rather than treating the raw research audit as authoritative by itself.
