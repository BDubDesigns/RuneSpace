# components

Reusable visual primitives only (presentational React components with no
feature-specific behavior and no game rules).

If a component needs feature behavior or domain logic, that belongs in
`features/` or `game/domain/`. Extract a shared primitive here only when a second
real consumer needs the same styling/behavior — not from a single use.

See `docs/component-boundaries.md`.
