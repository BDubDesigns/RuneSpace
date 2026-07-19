# Gameplay Foundations

This is the authoritative design record for the server-authoritative foundations
introduced in issue #16. It defines contracts, not unfinished balance values or
playable activities.

## Time and actions

- A game tick is exactly 600 milliseconds.
- An action is an ongoing character activity. An attempt is one server-resolved
  outcome after its whole-tick duration elapses.
- Activities define base attempt durations in whole ticks. Player-facing speed
  multipliers divide duration and round upward to a whole tick: 2x speed makes a
  10-tick attempt take 5 ticks.
- A character may have only one active action.
- The server resolves actions lazily when a character is loaded or a
  state-changing command runs. There is no client tick loop, worker, or timer.
- Standard accounts resolve only the latest one hour of unresolved time. The
  durable cursor advances atomically past capped older time, then only through
  ticks an action resolver actually consumed; partial attempt progress remains.
- Every state-changing character command must lock, resolve pending action work,
  persist its outcome and cursor, then validate and apply the requested command
  in the same transaction. Retried or concurrent requests must not duplicate an
  outcome.
- Resolution loads action-specific authoritative state under that same lock,
  passes an immutable snapshot to pure deterministic resolution, and gives the
  following command the reloaded final action state after continuing, stopping,
  or replacing an action. Replacement resolvers provide only their action ID and
  start time; orchestration remains the sole owner of durable resolution cursors.

## Progression

- Total skill XP is authoritative persisted character state. Level is always
  derived from total XP and a supplied authoritative threshold source.
- Every future award must use `grantSkillXp`; activities must not implement XP
  arithmetic or level checks themselves.
- The initial Mining curve and Crash Site award are approved in the slice below;
  other skills and activities remain deliberately undecided.

## Crash Site Mining slice

The first playable action is infinite Crash Site Ferrite Shale Mining. Its concrete
values live only in `game/config/balance.ts` behind `getEffectiveGameBalance()`:
10 ticks (six seconds) per attempt; 15 Mining XP on success; 1 or 2 shale per
success; 100 g shale units with a 10-unit stack limit; and the approved level-1
35% to level-30 guaranteed-success basis-point formula. Failures grant neither
shale nor XP. Server-generated randomness is resolved in the locked action
transaction, so refreshes and retries cannot replay an outcome.

Mining stops before a roll when the minimum yield cannot fit, when its equipped
Salvage Cutter is missing, when manually stopped, or when replaced. The starter
loadout is provisioned once transactionally: a 5 kg Salvage Cutter, one 10 kg
MYKEA SCHLEPPRAUM-8 eight-slot container, and the approved 50 kg carry capacity.
No quest state is associated with the damaged-ship guidance.

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
