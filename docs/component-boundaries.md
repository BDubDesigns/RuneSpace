# Component & Module Boundaries

Practical extraction rules for RuneSpace. Goal: encourage reuse without turning
every repeated snippet into an abstraction, and keep game logic out of UI.

## Where does this belong?

### In `components/`
A **reusable visual primitive**: presentational React with no feature behavior
and no game rules. Examples the scaffold establishes: `ScaffoldScreen` (a styled
card). If a component needs feature behavior or domain logic, it belongs in
`features/` or `game/domain/`.

### In a feature module (`features/`)
Player-facing vertical behavior that **composes** UI from `components/` and wires
it to `server/` actions. A feature is a thin composition layer; it does not own
game rules or persistence. (No features exist yet.)

### In `game/domain/`
A **pure rule, calculation, state transition, or ID contract**: framework-free,
deterministic, side-effect free where possible. Examples for later: XP curves,
fuel costs, travel rules, inventory rules, quest requirements. This is the single
source of truth for computed values.

### In `game/schemas/`
**Zod validation** for content and request boundaries. Example established by the
scaffold: `ids.ts` (the stable content-ID contract). No game content is defined
here yet — only validation contracts other modules reuse.

### In `server/`
Orchestration: authenticated commands (later), persistence transactions, timer
resolution, and server-authoritative actions. Calls `game/domain/` and `db/`.
Never imports React.

### In `db/`
Drizzle schema, migrations, and narrowly scoped persistence code. One pool, owned
here.

## When to extract (the "second consumer" rule)
- Extract a shared visual primitive **only when a second real consumer** needs
  the same styling/behavior.
- Extract domain logic **only when a second real feature** needs the same rule.
- Split a module when one file gains **multiple distinct responsibilities**.

## Avoid both extremes
- **Duplication:** don't copy a rule or component across files. Search first,
  then reuse or extract.
- **Over-abstraction:** don't build universal abstractions from a single use or
  from superficial similarity. Build the smallest clear boundary now; generalize
  when a second real use case proves what is shared.

## Good vs bad extraction

Good:
- Three features all need a "panel card" with the same padding/border → extract
  `components/Panel`.
- Two skills need the same XP-from-level formula → put it once in
  `game/domain/xp.ts`.

Bad:
- One page uses a card once → immediately building a `ComponentLibrary` with
  speculative variants.
- Two components both render a heading → inventing a `HeadingFactory` with a
  config object no one else needs.
- Putting XP math inside a React component "because it's convenient".

## Game logic must not enter UI
If you find yourself computing rewards, fuel, or quest state in a component,
that code belongs in `game/domain/` and is invoked from `server/`. The component
only renders server-confirmed state.
