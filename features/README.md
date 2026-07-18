# features

Player-facing vertical features (exploration, mining, welding, quests, inventory,
travel, ships, etc.) composed from `components/`, `game/domain/`, and `server/`.

Each feature should stay a thin composition layer: it wires UI to server actions
and renders shared primitives; it does not own game rules or persistence.

No features are implemented yet. See `docs/architecture.md`.
