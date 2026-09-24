export const publicSiteNavigation = [
  { href: "/", label: "Home" },
  { href: "/updates", label: "Updates" },
  { href: "/wiki", label: "Wiki" },
] as const;

export const publicLandingContent = {
  // Issue #223: the locked Soft Alpha reservation state.
  hero: {
    eyebrow: "Low-fi sci-fi RPG / Holo Hollow",
    status: "SOFT ALPHA — OCTOBER 27",
    title: "Your ship crashed. The engines are dead. But you’re not. Yet.",
    description:
      "Create your account, verify your email, and reserve up to three globally unique character names before RuneSpace Soft Alpha opens October 27.",
    reserveAction: "Reserve your characters",
  },
  buildSignal: [
    { label: "Region", value: "Holo Hollow" },
    { label: "Loop", value: "Salvage / work / repair" },
    { label: "Status", value: "Pre-alpha" },
  ],
  currentBuild: {
    eyebrow: "Current build",
    title: "A playable slice with real ground under it",
    description:
      "The early game is live: move between locations, find useful material, put it through the right work, and make the wreck more capable one job at a time.",
  },
  showcase: [
    {
      src: "/landing/location-crash-site.webp",
      alt: "RuneSpace Location view showing the Crash Site and its derelict ship",
      label: "Location",
      detail: "Crash Site",
      width: 892,
      height: 572,
    },
    {
      src: "/landing/local-map.webp",
      alt: "RuneSpace local Map view showing the connected Holo Hollow locations",
      label: "Map",
      detail: "Holo Hollow",
      width: 892,
      height: 587,
    },
    {
      src: "/landing/journey.webp",
      alt: "RuneSpace Journey view showing travel progress and journey events",
      label: "Journey",
      detail: "On the move",
      width: 892,
      height: 302,
    },
  ],
  capabilities: [
    {
      number: "01",
      title: "Explore",
      copy: "Travel between Holo Hollow locations, read the local Map, follow your Journey, and scavenge along the route.",
    },
    {
      number: "02",
      title: "Work",
      copy: "Mine Ferrite Shale at The Jag, refine it at the Abandoned Processing Yard, and weld the Cargo Hold back into service.",
    },
    {
      number: "03",
      title: "Gear up",
      copy: "Keep your carried material in order, equip the Salvage Cutter, and manage the ship’s Inventory, Equipment, and Cargo Hold.",
    },
    {
      number: "04",
      title: "Progress",
      copy: "Take on authored missions, meet Wade and Tansy, and build Mining, Refining, Welding, and Strength as the work gets harder.",
    },
  ],
  adventure: {
    eyebrow: "Holo Hollow / Crash Site",
    title: "Make the wreck worth keeping.",
    paragraphs: [
      "You came down hard on Holo Hollow. The ship is damaged, the ground is unfamiliar, and the useful parts are scattered between a few rough locations.",
      "Wade Rusk knows recovery and field repairs. His niece Tansy knows ferrite and the local work. Between them, there is a route from salvage to material to a ship that can hold together.",
    ],
  },
  status: {
    eyebrow: "Development status",
    title: "Playable now. Expanding regularly.",
    body: "RuneSpace is a playable pre-alpha under active development. The current build is a focused early-game loop, so expect rough edges, new work, and frequent changes as Holo Hollow grows.",
  },
} as const;
