import { PublicUpdateSchema } from "@/game/schemas/public-updates";
import type { PublicUpdate } from "@/game/schemas/public-updates";

export type { PublicUpdate } from "@/game/schemas/public-updates";

const authoredUpdates = [
  {
    slug: "you-have-news",
    title: "You Have News",
    publishedAt: "2026-09-09T01:00:00-07:00",
    summary:
      "Signed-in accounts now get a quiet News indicator in the game shell whenever a new Update is waiting to be read.",
    body: [
      "Updates were previously something you had to remember to go check. Now every signed-in RuneSpace account gets a small News control next to Sign out at the top of the game — and it only calls attention to itself when there's actually something new.",
      "The indicator is account-level: it doesn't matter which of your characters you're playing, and you don't need to acknowledge the same release on each one separately. Opening News takes you to the Updates index and clears the indicator through whatever was newest at that moment. If another Update ships later, the indicator comes back on its own.",
      "It's a small addition, but it closes the loop the Updates page opened: the news doesn't just exist somewhere, it finds you.",
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "A News control in the authenticated game shell, next to Sign out, with an unread indicator that appears when a newer Update has been published than the account has acknowledged.",
          "Opening News navigates to the Updates index and clears the indicator for every character on the account.",
        ],
      },
    ],
  },
  {
    slug: "a-field-manual-for-holo-hollow",
    title: "A Field Manual for Holo Hollow",
    publishedAt: "2026-09-08T18:00:00-07:00",
    summary:
      "A new public Wiki lays out how travel, work, gear, and the current missions actually work — no account required.",
    body: [
      "Holo Hollow has a manual now. The new Wiki is a short, plain-language guide to what's actually playable today: how to get around, how the two work loops fit together, what your gear does, and what each current mission asks of you.",
      "It's built to answer the questions a new arrival actually has, in the order they come up. Getting Started opens with the loop; Travel & Scavenging, Mining & Refining, Inventory & Equipment, Power Cells, and Cargo Hold & Welding cover the mechanics one at a time; Missions and Holo Hollow tie the current jobs and locations together; Skills & Progression explains how Mining, Refining, and Welding actually track your progress.",
      "The Wiki only documents what's shipped and playable right now — it will grow the same way the game does, one real build at a time.",
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "A public /wiki manual with nine articles covering the current playable Holo Hollow loop: Getting Started, Travel & Scavenging, Mining & Refining, Inventory & Equipment, Power Cells, Cargo Hold & Welding, Missions, Holo Hollow, and Skills & Progression.",
          "A Wiki link in the shared public site navigation, alongside Home and Updates.",
        ],
      },
    ],
  },
  {
    slug: "runespace-is-starting-to-feel-like-a-game",
    title: "RuneSpace Is Starting to Feel Like a Game",
    publishedAt: "2026-09-08T12:00:00-07:00",
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
      "That world is built around three connected Play surfaces. Location is where you stop and decide what to do. Map shows the five connected places in Holo Hollow and the next legal walk. Journey is what you see while the walk is underway. A normal leg takes 24 seconds, and your progress survives a refresh or reconnect without replaying work you already completed.",
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
          "The new Updates section keeps the latest game news in one place, with the newest Update linked from the homepage.",
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
  // Keyed by parsed instant (not the raw string) so two different offset
  // representations of the same instant are still caught as a collision: the
  // account-level news read-through boundary (issue #156) orders and
  // compares Updates by this same parsed instant, so two Updates sharing one
  // instant would be indistinguishable to that boundary.
  const seenInstants = new Map<number, string>();

  for (const update of updates) {
    if (seenSlugs.has(update.slug)) {
      throw new Error(`Duplicate public Update slug: ${update.slug}`);
    }
    seenSlugs.add(update.slug);

    const instant = Date.parse(update.publishedAt);
    const collidingSlug = seenInstants.get(instant);
    if (collidingSlug !== undefined) {
      throw new Error(
        `Duplicate public Update publishedAt instant: ${update.slug} collides with ${collidingSlug}`,
      );
    }
    seenInstants.set(instant, update.slug);
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
  // Format the authored calendar date, not the UTC instant. Formatting the
  // original timestamp in UTC can move an early or late publication across a
  // calendar boundary visible to players.
  const authoredDate = publishedAt.slice(0, 10);
  return publicUpdateDateFormatter.format(new Date(`${authoredDate}T12:00:00Z`));
}
