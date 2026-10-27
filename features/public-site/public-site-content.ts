import { COMMUNITY_RULES_PATH, SAFETY_PRIVACY_PATH } from "./policy-links";

export const publicSiteNavigation = [
  { href: "/", label: "Home" },
  { href: "/updates", label: "Updates" },
  { href: "/wiki", label: "Wiki" },
  { href: "/high-scores", label: "High Scores" },
] as const;

/** The published player policies, linked from every public page's footer (issue #248). */
export const publicSiteFooterLinks = [
  { href: COMMUNITY_RULES_PATH, label: "Community Rules" },
  { href: SAFETY_PRIVACY_PATH, label: "Safety & Privacy" },
] as const;

export const publicLandingContent = {
  hero: {
    eyebrow: "Low-fi sci-fi RPG / Skatboll + Stillreach",
    title: "Your ship crashed. The engines are dead. But you’re not. Yet.",
  },
  // Issue #223: the only landing copy whose truth depends on the persisted
  // public-gameplay switch. `closed` is the locked Soft Alpha reservation
  // state; everything outside this block reads true in both states.
  gameplayState: {
    closed: {
      heroStatus: "SOFT ALPHA — OCTOBER 27",
      heroDescription:
        "Create your account, verify your email, and reserve up to three globally unique character names before RuneSpace Soft Alpha opens October 27.",
      primaryAction: "Reserve your characters",
      buildSignalBadge: "RESERVATIONS OPEN",
      buildSignalStatus: "Reservations open",
      finalCallToAction: "Reserve your crew before Soft Alpha opens October 27.",
    },
    open: {
      heroStatus: "SOFT ALPHA — LIVE",
      heroDescription:
        "Create your account, verify your email, and start playing RuneSpace. You can create up to three globally unique characters.",
      primaryAction: "Start playing",
      buildSignalBadge: "PLAYABLE",
      buildSignalStatus: "Soft Alpha",
      finalCallToAction: "Create your account and start putting the wreck back together.",
    },
  },
  buildSignal: [
    { label: "Planets", value: "Skatboll + Stillreach" },
    { label: "Loop", value: "Salvage / work / repair" },
  ],
  currentBuild: {
    eyebrow: "Current build",
    title: "Two planets of ground under it",
    description:
      "The current build spans two planets — 11 locations on Skatboll and 8 on Stillreach. Move between locations, find useful material, put it through the right work, and make the wreck more capable one job at a time.",
  },
  capabilitiesHeader: {
    eyebrow: "The current build",
    title: "What RuneSpace already supports",
  },
  showcase: [
    {
      src: "/landing/dialogue-wise-old-enby.webp",
      alt: "Story dialogue with the Wise Old Enby at Hilltop Workshop on Stillreach",
      label: "Story",
      detail: "The Wise Old Enby",
      width: 1280,
      height: 800,
    },
    {
      src: "/landing/map-skatboll.webp",
      alt: "RuneSpace local Map view showing the eleven connected Skatboll locations",
      label: "Map",
      detail: "Skatboll — 11 locations",
      width: 864,
      height: 739,
    },
    {
      src: "/landing/map-stillreach.webp",
      alt: "RuneSpace local Map view showing the eight connected Stillreach locations",
      label: "Map",
      detail: "Stillreach — 8 locations",
      width: 847,
      height: 735,
    },
    {
      src: "/landing/character-skills.webp",
      alt: "Character panel showing all five skills beside the Crash Site on Skatboll",
      label: "Character",
      detail: "Five ways to progress",
      width: 1280,
      height: 800,
    },
    {
      video: "/landing/flight-takeoff-landing.mp4",
      poster: "/landing/flight-poster.webp",
      alt: "The Rivet lifting off from the Crash Site and touching down at Holo Hollow Landing",
      label: "Journey",
      detail: "Takeoff → touchdown",
      width: 918,
      height: 540,
    },
    {
      src: "/landing/mining-the-jag.webp",
      alt: "Mining Ferrite Shale at The Jag while other players talk in chat",
      label: "Work",
      detail: "Mining at The Jag",
      width: 1280,
      height: 800,
    },
    {
      src: "/landing/runeworking-attunement.webp",
      alt: "Attuning a Beginner Echo Seeker at the Resonance Rig with a mission card pinned",
      label: "Runeworking",
      detail: "Resonance Rig attunement",
      width: 1280,
      height: 800,
    },
    {
      src: "/landing/work-orders.webp",
      alt: "Work Order board at Rusk Recovery showing three posted jobs",
      label: "Work orders",
      detail: "Rusk Recovery job board",
      width: 1280,
      height: 800,
    },
    {
      src: "/landing/trade-channel.webp",
      alt: "Trade chat channel with player listings and a promoted trade ad",
      label: "Trade",
      detail: "Player-run market",
      width: 1280,
      height: 800,
    },
  ],
  mobileShowcase: {
    eyebrow: "Mobile + desktop",
    title: "Same game. Pocket size.",
    description:
      "RuneSpace runs in the browser on your phone and your desktop — same character, same wreck, no install. The interface rearranges; nothing is cut.",
    views: [
      {
        src: "/landing/mobile-flight.webp",
        alt: "Rivet flight to Stillreach shown on a phone",
        label: "Journey",
        detail: "In flight",
        width: 390,
        height: 844,
      },
      {
        src: "/landing/mobile-refining.webp",
        alt: "Refining on a phone with a chat mention badge lit",
        label: "Work",
        detail: "Refining, with company",
        width: 390,
        height: 844,
      },
      {
        src: "/landing/mobile-work-orders.webp",
        alt: "Work Order board on a phone with an Accept Job button",
        label: "Work orders",
        detail: "Rusk Recovery",
        width: 390,
        height: 844,
      },
      {
        src: "/landing/mobile-map-skatboll.webp",
        alt: "Skatboll local Map on a phone, centered on the Crash Site",
        label: "Map",
        detail: "Skatboll",
        width: 390,
        height: 844,
      },
    ],
  },
  capabilities: [
    {
      number: "01",
      title: "Explore",
      copy: "Travel between locations across two planets — 11 hexes on Skatboll, 8 big ones on Stillreach — read the local Map, follow your Journey, and scavenge along the route.",
    },
    {
      number: "02",
      title: "Work",
      copy: "Mine Ferrite Shale at The Jag, refine it at the Abandoned Processing Yard, take paying work orders at Rusk Recovery, and weld the Cargo Hold back into service.",
    },
    {
      number: "03",
      title: "Gear up",
      copy: "Keep your carried material in order, equip the Salvage Cutter, and manage the ship’s Inventory, Equipment, and Cargo Hold.",
    },
    {
      number: "04",
      title: "Progress",
      copy: "Take on authored missions, meet Wade, Tansy, and the Wise Old Enby, attune Echo Seekers at the Resonance Rig, and hunt hidden Echoes across two planets while progressing in five skills: Mining, Refining, Welding, Fabrication, and Runeworking.",
    },
    {
      number: "05",
      title: "Connect",
      copy: "The game stays alive between runs: game-wide chat channels, 1:1 Whispers, and trade requests that land as pinned cards.",
    },
  ],
  adventure: {
    eyebrow: "Holo Hollow / Crash Site",
    title: "Make the wreck worth keeping.",
    paragraphs: [
      "You came down hard at the Crash Site, in the mud at the edge of Holo Hollow. The ship is damaged, the ground is unfamiliar, and the useful parts are scattered between a few rough locations.",
      "Wade Rusk knows recovery and field repairs. His niece Tansy knows ferrite and the local work. Between them, there is a route from salvage to material to a ship that can hold together.",
    ],
  },
  status: {
    eyebrow: "Development status",
    title: "Under active development. Expanding regularly.",
    body: "RuneSpace is under active development. The current build is a focused early-game slice, so expect rough edges, frequent changes, balance shifts, and occasional resets as Skatboll and Stillreach grow.",
  },
} as const;
