# Gameplay Foundations

This is the authoritative design record for the server-authoritative foundations
introduced in issue #16. It defines contracts, not unfinished balance values or
playable activities.

## Time and actions

- A game tick is exactly 600 milliseconds.
- An action is an ongoing character activity. An attempt is one server-resolved
  outcome after its whole-tick duration elapses.
- Activities define base attempt durations in whole ticks. Speed modifiers reduce
  duration and round upward to a whole tick.
- A character may have only one active action.
- The server resolves actions lazily when a character is loaded or a
  state-changing command runs. There is no client tick loop, worker, or timer.
- Standard accounts resolve only the latest one hour of unresolved time. The
  durable cursor advances atomically, including past capped older time, so it
  cannot be replayed later.
- Every state-changing character command must lock, resolve pending action work,
  persist its outcome and cursor, then validate and apply the requested command
  in the same transaction. Retried or concurrent requests must not duplicate an
  outcome.

## Progression

- Total skill XP is authoritative persisted character state. Level is always
  derived from total XP and a supplied authoritative threshold source.
- Every future award must use `grantSkillXp`; activities must not implement XP
  arithmetic or level checks themselves.
- The final XP curve and activity award amounts remain deliberately undecided.

## Inventory and equipment

- Fungible items are carried as positive-quantity stacks. Unique items are
  individual instances and may contain mutable state such as current charge.
- A stack and each carried unique instance consume one inventory slot. Compatible
  partial stacks fill before new stacks are created.
- Slot capacity is the sum of equipped container capacities. Carry capacity is
  independently derived from supplied Strength, buff, and equipment
  contributions. Neither derived capacity is persisted.
- Equipped gear, including containers, counts toward carried weight but occupies
  no inventory slot. Containers are unique equipped items assigned through the
  dedicated container-slot namespace; future content supplies stable slot IDs.
  They cannot contain containers.
- Item names, weights, stack limits, maximum charges, container capacities, and
  equipment classification belong to validated typed content, not player rows.

## Approved identities and boundaries

Near-term stable skills are Mining, Metallurgy, Welding, and Strength. Stable
opening item identities are Ferrite Shale, Refined Ferrite, Slag, Crash-Grade
Structural Alloy, Salvage Cutter, and Power Cell. These identities establish no
weights, capacities, charge behavior, rewards, starter loadout, or action.

Mining extracts raw material. Metallurgy refines material and forms alloys.
Welding joins material and repairs structures. Salvage dismantles and recovers
components. Fabrication assembles finished objects. Machining creates precise
components. Salvage, Fabrication, Machining, Speeder Piloting, and Ship Piloting
are documented future skill directions only; they have no persistence
initialization or gameplay in this foundation.
