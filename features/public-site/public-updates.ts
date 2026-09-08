import { PublicUpdateSchema } from "@/game/schemas/public-updates";
import type { PublicUpdate } from "@/game/schemas/public-updates";

export type { PublicUpdate } from "@/game/schemas/public-updates";

const authoredUpdates = [
  {
    slug: "runespace-is-starting-to-feel-like-a-game",
    title: "RuneSpace Is Starting to Feel Like a Game",
    publishedAt: "2026-09-07T12:00:00-07:00",
    summary:
      "The crash-site loop is taking shape: travel through Holo Hollow, find useful material, learn the work, and make the wreck more capable one job at a time.",
    hero: {
      src: "/landing/location-crash-site.webp",
      alt: "RuneSpace Location view showing the Crash Site and its derelict ship",
      width: 892,
      height: 572,
    },
    body: [
      "The ship is down on Holo Hollow, and RuneSpace is starting to feel like more than a collection of screens. There is a place to stand, a route to walk, work to learn, and a reason to bring the next useful thing home.",
      "The early game begins at the Crash Site with a damaged ship and a short list of people who know how to make the situation less permanent. Wade Rusk and Tansy Rusk turn that problem into a run of practical jobs: Walk It Off, Cut Your Teeth, Waste Not, and Hold It Together. Each mission points back into the same world instead of sending you through an isolated menu.",
      "That world is built around three connected Play surfaces. Location is where you stop and decide what to do. Map shows the five connected places in Holo Hollow and the next legal walk. Journey is what you see while the walk is underway. A normal leg takes 24 seconds, and the server resolves arrival and any completed work when the character state is read or changed.",
      "The work loop now has a clear shape. At The Jag, an equipped Salvage Cutter turns Ferrite Shale out of the exposed seam into a reliable source of material. At the Abandoned Processing Yard, two pieces of shale go into each refining attempt and come back as Refined Ferrite or Slag. Back at the Crash Site, 15 Refined Ferrite and 6 Slag open the Cargo Hold repair, then twelve Welding passes restore it and its storage.",
      "Inventory and Equipment keep the carried side of that loop visible: stacks have weight and limits, unique gear keeps its state, and the Salvage Cutter can be charged with Power Cells from the Emergency Power Annex. The finished Cargo Hold gives the ship a place to keep material while you head back out. It is a small loop, but it has decisions, movement, work, and progress that belong to the same character.",
      "This is still a playable pre-alpha. The edges are rough and Holo Hollow is intentionally small, but the foundation is here: make a plan, walk there, do the job, and see the ship become a little more useful.",
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "A public-facing early-game path through the Crash Site, Abandoned Processing Yard, DeWhat? Emergency Power Annex, The Long Scramble, and The Jag.",
          "Server-authoritative walking, Journey status, and optional route scavenging between adjacent Holo Hollow locations.",
          "Stationary Location presentation, a connected local Map, and the in-transit Journey surface as the three parts of the Play loop.",
          "Ferrite Shale Mining, Processing Yard Refining, Cargo Hold material installation, and deterministic Welding progression.",
          "Carried Inventory, Equipment, Power Cell charging for the Salvage Cutter, and repaired Cargo Hold storage.",
          "Authored early missions and NPC interactions that connect Wade and Tansy to the playable work loop.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "The opening progression now connects travel, scavenging, material work, missions, and ship repair as one character journey.",
          "The public landing page now points to the current game through a reusable Updates page and the latest published Update.",
        ],
      },
      {
        heading: "Fixed",
        items: [
          "Action timing, travel arrival, inventory changes, rewards, and progression resolve on the server, so refreshing or reconnecting cannot replay completed work or invent progress.",
        ],
      },
    ],
  },
] as const;

/**
 * Validate and order the complete public collection. This function is kept
 * small and explicit so bad metadata fails at build/import time instead of
 * becoming a missing or ambiguously ordered public page.
 */
export function validatePublicUpdates(input: readonly unknown[]): readonly PublicUpdate[] {
  const updates = PublicUpdateSchema.array().min(1).parse(input);
  const seenSlugs = new Set<string>();

  for (const update of updates) {
    if (seenSlugs.has(update.slug)) {
      throw new Error(`Duplicate public Update slug: ${update.slug}`);
    }
    seenSlugs.add(update.slug);
  }

  return [...updates].sort((left, right) => {
    const publishedDifference = Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
    return publishedDifference !== 0 ? publishedDifference : left.slug.localeCompare(right.slug);
  });
}

/** The single validated repository-authored source for published Updates. */
export const publicUpdates = validatePublicUpdates(authoredUpdates);

export function getPublishedUpdates(): readonly PublicUpdate[] {
  return publicUpdates;
}

export function getLatestPublishedUpdate(): PublicUpdate {
  const latest = publicUpdates[0];
  if (!latest) throw new Error("At least one public Update must be authored");
  return latest;
}

export function getPublicUpdate(slug: string): PublicUpdate | undefined {
  return publicUpdates.find((update) => update.slug === slug);
}

/** The canonical route projection used by index, article, and homepage links. */
export function getPublicUpdatePath(update: Pick<PublicUpdate, "slug">): string {
  return `/updates/${update.slug}`;
}

const publicUpdateDateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeZone: "UTC",
});

export function formatPublicUpdateDate(publishedAt: string): string {
  return publicUpdateDateFormatter.format(new Date(publishedAt));
}
