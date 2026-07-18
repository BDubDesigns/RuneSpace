# minigames

Isolated Phaser experiences, added later.

Each minigame must be a self-contained client-side boundary that communicates
with the app only through small, typed contracts (defined in `game/schemas/` or a
feature module). The browser must never become the trusted source of progression;
any score/reward result is validated server-side.

No minigames exist yet. See `docs/architecture.md`.
