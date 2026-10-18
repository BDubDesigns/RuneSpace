import type { EquipmentSlotIconKind } from "./equipment-loadout";

/**
 * Recessed industrial silhouettes for an EMPTY equipment slot (#364). These are
 * UI-category marks, not item art: they draw in `currentColor` so the tile
 * decides their strength. Gloves and boots are drawn ahead of their slots and
 * stay unreachable until the authoritative model ships those slots.
 */
const PATHS: Record<EquipmentSlotIconKind, string[]> = {
  // Handheld cutter: housing, emitter nozzle and trigger grip.
  tool: ["M6 20h22l6-4h14v8H34l-6 4H6z", "M48 18l6-3v14l-6-3", "M14 32l-2 12h8l3-12", "M16 22h8"],
  // Latched cargo container with a banded lid and corner brackets.
  container: [
    "M10 14h44v36H10z",
    "M10 24h44",
    "M26 24v8h12v-8",
    "M10 14l4-4h36l4 4",
    "M16 50v-6M48 50v-6",
  ],
  // Reinforced work glove: cuff, knuckle plates and a thumb.
  gloves: ["M20 54V40l-6-8 5-3 6 6V14h5v18h3V12h5v20h3V16h5v22l6-6 4 3-8 14v13z", "M20 46h24"],
  // Reinforced work boot: shaft, toe cap and lugged sole.
  boots: [
    "M20 10h16v22l14 6v10H14V10z",
    "M14 48h36v6H14z",
    "M20 18h16",
    "M40 38h8",
    "M18 54v3M26 54v3M34 54v3M42 54v3",
  ],
};

export function EquipmentSlotIcon({ kind }: { kind: EquipmentSlotIconKind }) {
  return (
    <svg
      aria-hidden="true"
      className="h-14 w-14 max-w-full"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinejoin="miter"
      strokeWidth={2.5}
      viewBox="0 0 64 64"
    >
      {PATHS[kind].map((d) => (
        <path d={d} key={d} />
      ))}
    </svg>
  );
}
