/**
 * The crafting stations' one duration format (#232, #391): "7.2 sec", never a
 * bare "s". The space is non-breaking so a narrow tile never strands the unit
 * on a line of its own. Shared by the Fabrication Station and the Resonance Rig.
 */
export function seconds(ticks: number, tickMs: number): string {
  const value = (ticks * tickMs) / 1000;
  return `${Number.isInteger(value) ? value : value.toFixed(1)}\u00a0sec`;
}
