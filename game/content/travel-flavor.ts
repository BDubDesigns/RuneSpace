/** A small authored line used only for Journey presentation. */
export type TravelFlavorLine = {
  id: string;
  text: string;
};

/** Lines that are valid on any Travel leg. */
export const GENERAL_TRAVEL_FLAVOR = [
  { id: "general-gear-creak", text: "A strap creaks each time you settle your gear." },
  { id: "general-steady-rhythm", text: "Your boots find a steady rhythm against the ground." },
  { id: "general-footsteps", text: "For a while, the only sound is your own footsteps." },
  {
    id: "general-distant-motion",
    text: "A faint sound comes from somewhere beyond the route.",
  },
  {
    id: "general-pack-shift",
    text: "The pack's weight shifts; you tighten it without breaking stride.",
  },
] as const satisfies readonly TravelFlavorLine[];

/** Lines valid for Travel within the current Holo Hollow region. */
export const HOLO_HOLLOW_TRAVEL_FLAVOR = [
  { id: "holo-shale-ticks", text: "A few loose stones tick against the ground as you pass." },
  { id: "holo-hardpan", text: "Hardpan gives slightly underfoot, then firms up again." },
  {
    id: "holo-salvage-route",
    text: "Old salvage debris marks a route no map bothers to name.",
  },
  {
    id: "holo-service-infrastructure",
    text: "Broken service infrastructure surfaces where the dust thins.",
  },
  {
    id: "holo-sound-carries",
    text: "The hollow holds sound strangely; a small noise travels far.",
  },
] as const satisfies readonly TravelFlavorLine[];

/**
 * Lines for a paid Crew Hauler ride (#172).
 *
 * A ride is not a walk, so it never draws from the walking pools: nothing here
 * describes boots, stride, or footing. The player is a passenger on somebody
 * else's working vehicle, which is the whole point of the fare.
 */
export const CREW_HAULER_TRAVEL_FLAVOR = [
  {
    id: "crew-hauler-bench",
    text: "The bench seat is somebody's spare coat and a folded tarp. Nobody moves it for you.",
  },
  {
    id: "crew-hauler-shift-talk",
    text: "Two of the crew argue about a seam grade the whole way. Neither asks your opinion.",
  },
  {
    id: "crew-hauler-road-noise",
    text: "The haul road comes up through the frame, steady and unlovely.",
  },
  {
    id: "crew-hauler-window",
    text: "The route slides past the window faster than your boots have ever managed it.",
  },
  {
    id: "crew-hauler-nod",
    text: "Somebody nods at you without looking up. That is the whole conversation.",
  },
] as const satisfies readonly TravelFlavorLine[];

/**
 * Optional directed beats for a specifically authored route. Reverse travel
 * must have its own entry; the presentation layer never mirrors one silently.
 */
export const DIRECTED_ROUTE_TRAVEL_FLAVOR: Readonly<Record<string, TravelFlavorLine>> = {
  "crash_site:abandoned_processing_yard": {
    id: "route-crash-yard-outbound",
    text: "The old service route cuts through wet scrap and collapsed fencing.",
  },
  "crash_site:emergency_power_annex": {
    id: "route-crash-annex-outbound",
    text: "The emergency route follows a line of half-buried marker lights.",
  },
  "crash_site:the_long_scramble": {
    id: "route-crash-scramble-outbound",
    text: "The ground rises into loose stone and a long, exposed climb.",
  },
  "abandoned_processing_yard:emergency_power_annex": {
    id: "route-yard-annex-outbound",
    text: "Rust flakes from the yard as the route bends toward the intact depot.",
  },
  "the_long_scramble:the_jag": {
    id: "route-scramble-jag-outbound",
    text: "The ridge narrows before the ferrite seam comes into view.",
  },
};
