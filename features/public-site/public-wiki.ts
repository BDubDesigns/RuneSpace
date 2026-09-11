import { WikiArticleSchema } from "@/game/schemas/public-wiki";
import type { WikiArticle, WikiParagraph } from "@/game/schemas/public-wiki";

export type { WikiArticle } from "@/game/schemas/public-wiki";

/**
 * The initial player manual. Articles are authored in the order the index
 * displays them — a small, deliberately grouped set rather than a per-topic
 * encyclopedia. Every fact here must match currently shipped behavior; do not
 * publish approved-but-unshipped design (see docs/public-wiki.md).
 */
const authoredWikiArticles = [
  {
    slug: "getting-started",
    title: "Getting Started",
    summary:
      "What RuneSpace is right now, and how Location, Map, Journey, Inventory, and Missions fit together.",
    sections: [
      {
        paragraphs: [
          "RuneSpace is a browser-first, low-fi sci-fi RPG. You're stranded on Holo Hollow with a wrecked ship and a short list of people who know how to make the situation less permanent.",
          "You start at the Crash Site. Wade Rusk, who runs recovery and salvage out here, is the first person worth talking to.",
        ],
      },
      {
        heading: "The three views",
        paragraphs: [
          "Play moves between three connected surfaces. Location is where you stand and decide what to do. Map shows the connected places in Holo Hollow and lets you choose where to walk next. Journey is what you see while a walk is underway.",
        ],
      },
      {
        heading: "The early loop",
        paragraphs: ["A normal session looks like this:"],
        list: [
          [
            "Check the Map and walk to a location that has work — The Jag for ",
            { text: "Mining", articleSlug: "mining-and-refining" },
            ", the Abandoned Processing Yard for Refining.",
          ],
          "Do the work, then walk back when you have something worth bringing home.",
          [
            "Talk to Wade Rusk or Tansy Rusk — they hand out the ",
            { text: "current jobs", articleSlug: "missions" },
            ", react to your progress, and have other things worth asking about.",
          ],
          [
            "Put Refined Ferrite and Slag toward the ",
            { text: "Cargo Hold repair", articleSlug: "cargo-hold-and-welding" },
            " back at the Crash Site.",
          ],
        ],
      },
      {
        heading: "Where to go next",
        paragraphs: [
          [
            "See ",
            { text: "Travel & Scavenging", articleSlug: "travel-and-scavenging" },
            " for how walking works, ",
            { text: "Mining & Refining", articleSlug: "mining-and-refining" },
            " for the two work loops, and ",
            { text: "Missions", articleSlug: "missions" },
            " for the full job list.",
          ],
        ],
      },
    ],
  },
  {
    slug: "travel-and-scavenging",
    title: "Travel & Scavenging",
    summary: "How to move between Holo Hollow's locations, and what you can find along the way.",
    sections: [
      {
        paragraphs: [
          "Holo Hollow currently has six connected locations. You can only walk between locations that are directly connected — there's no fast travel or shortcut.",
        ],
      },
      {
        heading: "The local map",
        list: [
          "Crash Site — connects to the Abandoned Processing Yard, the DeWhat? Emergency Power Annex, The Long Scramble, and the town of Holo Hollow.",
          "Abandoned Processing Yard — connects to Crash Site and the Power Annex.",
          "DeWhat? Emergency Power Annex — connects to Crash Site, the Abandoned Processing Yard, and the town of Holo Hollow.",
          "The Long Scramble — connects to Crash Site, The Jag, and the town of Holo Hollow. It has no work of its own; it's just the way through.",
          "The Jag — only connects to The Long Scramble. There's no direct route between Crash Site and The Jag.",
          [
            "Holo Hollow — the ",
            { text: "town", articleSlug: "holo-hollow" },
            " connects to Crash Site, the Power Annex, and The Long Scramble. There's no direct route between the town and The Jag or the Processing Yard.",
          ],
        ],
      },
      {
        heading: "Selecting and confirming a walk",
        paragraphs: [
          "Select a location on the Map to look at it, then use the separate confirmation control to actually start walking there. Each leg between two connected locations takes about 24 seconds, and your progress is safe if you refresh or lose connection partway through.",
        ],
      },
      {
        heading: "Scavenging while you walk",
        paragraphs: [
          "Every ordinary walk gives you one chance to scavenge along the way. The opportunity opens at some point during the walk and stays open for a few seconds before it's gone for good — there's no way to trigger it early or get a second chance on the same leg.",
          [
            "Claiming it can turn up a little Ferrite Shale, a ",
            { text: "Power Cell", articleSlug: "power-cells" },
            " or two, some Refined Ferrite, or nothing at all. It never costs you anything to try, and it never slows down or speeds up your arrival.",
          ],
        ],
      },
    ],
  },
  {
    slug: "mining-and-refining",
    title: "Mining & Refining",
    summary: "Turning Holo Hollow's exposed ferrite into Refined Ferrite, one attempt at a time.",
    sections: [
      {
        paragraphs: [
          "Working material into something useful is a two-step loop: mine Ferrite Shale at The Jag, then refine it into Refined Ferrite at the Abandoned Processing Yard.",
        ],
      },
      {
        heading: "Mining at The Jag",
        paragraphs: [
          [
            "Mining is only available at The Jag, and only while you have a Salvage Cutter equipped. Each attempt takes about six seconds; a success gives you one or two Ferrite Shale. Your chance of success improves as your Mining skill grows, and Mining stops on its own if you run out of room to carry more shale. A charged ",
            { text: "Power Cell", articleSlug: "power-cells" },
            " can speed this up.",
          ],
        ],
      },
      {
        heading: "Refining at the Abandoned Processing Yard",
        paragraphs: [
          "Refining is only available at the Abandoned Processing Yard. Each attempt consumes two Ferrite Shale and takes a little over four seconds. A success produces one Refined Ferrite; a failed attempt still produces one Slag, which isn't wasted — the Cargo Hold repair needs both. Your chance of success improves as your Refining skill grows.",
        ],
      },
      {
        heading: "Practical tips",
        list: [
          "Keep a Salvage Cutter equipped before you try to start Mining — it won't start without one.",
          "Refining needs Ferrite Shale on hand; stock up at The Jag before heading to the Processing Yard.",
          "Both activities stop cleanly if you start walking somewhere else — whatever you've already finished is kept.",
        ],
      },
    ],
  },
  {
    slug: "inventory-and-equipment",
    title: "Inventory & Equipment",
    summary: "What you're carrying, what you're wearing, and how much room you have for more.",
    sections: [
      {
        heading: "Stacks and unique items",
        paragraphs: [
          "Ordinary material — Ferrite Shale, Refined Ferrite, Slag, Power Cells — stacks together in a single Inventory tile up to that item's stack limit. Gear like your Salvage Cutter is a unique item: it gets its own tile and remembers its own state, such as how much charge it has left.",
        ],
      },
      {
        heading: "How much you can carry",
        paragraphs: [
          "You start with one container, a beat-up MYKEA SCHLEPPRAUM-8 with eight slots, and a starting weight limit for everything you're carrying. Equipped gear — including containers — counts toward that weight limit but doesn't take up an Inventory slot itself.",
        ],
      },
      {
        heading: "Equipping gear",
        paragraphs: [
          [
            "Open Inventory or Equipment to equip an item, such as your ",
            { text: "Salvage Cutter", articleSlug: "mining-and-refining" },
            ", into its matching slot. Equipped items disappear from the Inventory grid while they're worn — they're not gone, just equipped.",
          ],
        ],
      },
      {
        heading: "Dropping items",
        paragraphs: [
          "Dropping a stack asks you to confirm the exact quantity first. In the current build, dropped items are permanently destroyed — there's no ground pickup yet, so only drop what you're sure you don't need.",
        ],
      },
    ],
  },
  {
    slug: "power-cells",
    title: "Power Cells",
    summary: "Claiming Power Cells at the Annex and using one to charge your Salvage Cutter.",
    sections: [
      {
        heading: "Claiming your daily cells",
        paragraphs: [
          "Travel to the DeWhat? Emergency Power Annex and claim your allotment of five Power Cells. You can claim once per Pacific-time day; the allotment resets at local midnight.",
        ],
      },
      {
        heading: "Charging the Salvage Cutter",
        paragraphs: [
          "Load one carried Power Cell into an equipped, empty Salvage Cutter from Inventory or Equipment. This sets the Cutter's charge to ten uses and consumes the cell completely — a Cutter that already has charge can't be topped up early.",
          [
            "While the Cutter has charge, each ",
            { text: "Mining", articleSlug: "mining-and-refining" },
            " attempt takes about three seconds instead of six — everything else about Mining (chance of success, what you find, XP) stays the same. Once the charge runs out, Mining automatically goes back to its normal speed.",
          ],
        ],
      },
    ],
  },
  {
    slug: "credits-and-trading",
    title: "Credits & Trading",
    summary:
      "Your character's Credits, and buying and selling at Bix Weller's shop in Holo Hollow.",
    sections: [
      {
        paragraphs: [
          "Credits are your character's money. Each character has their own balance — Credits aren't shared between the characters on your account. Every character starts with 10 Credits.",
          [
            "You can see your balance in your ",
            { text: "Inventory", articleSlug: "inventory-and-equipment" },
            ", and it's shown while you're trading.",
          ],
        ],
      },
      {
        heading: "Trading with Bix",
        paragraphs: [
          [
            "Bix Weller runs Holo Hollow Souvenirs + Mining Supplies, in the ",
            { text: "town of Holo Hollow", articleSlug: "holo-hollow" },
            ". Step into his shop and choose Trade. Talking to Bix and trading with him are separate — you can do either without the other.",
          ],
          "Pick Buy or Sell, choose a quantity with the minus, plus, and Max controls, check the total, and confirm with a single Buy or Sell. You stay in the shop afterwards, with your Credits and Inventory updated straight away.",
          "When buying, Max is the most you can actually take away — it accounts for your Credits and for the room left in your Inventory. When selling, Max is everything you're carrying of that item.",
        ],
      },
      {
        heading: "What Bix pays",
        list: [
          "Ferrite Shale — 2 Credits each",
          "Refined Ferrite — 10 Credits each",
          "Slag — 1 Credit each",
          "Power Cell — 3 Credits each",
        ],
      },
      {
        heading: "What Bix sells",
        paragraphs: [
          [
            { text: "Power Cells", articleSlug: "power-cells" },
            " cost 8 Credits each. That's more than he pays for them, which he'll explain if you ask him about Power Cells. He doesn't stock anything else at the moment.",
          ],
          "A purchase has to fit: if your Inventory doesn't have room for the whole amount, or you can't afford it, nothing is bought and nothing is charged.",
        ],
      },
    ],
  },
  {
    slug: "cargo-hold-and-welding",
    title: "Cargo Hold & Welding",
    summary: "Repairing the ship's Cargo Hold and what it gives you once it's welded shut.",
    sections: [
      {
        paragraphs: [
          "Your ship's Cargo Hold at the Crash Site is damaged. Repairing it is a two-part job: install the right materials, then weld it back together.",
        ],
      },
      {
        heading: "Unlocking the repair",
        paragraphs: [
          [
            "The repair opens up once Wade Rusk puts you on the ",
            { text: "Hold It Together", articleSlug: "missions" },
            " job, which arrives automatically after you finish Waste Not. Until then, the Cargo Hold just shows as damaged.",
          ],
        ],
      },
      {
        heading: "The material recipe",
        paragraphs: [
          [
            "The repair needs exactly 15 ",
            { text: "Refined Ferrite and 6 Slag", articleSlug: "mining-and-refining" },
            ". You can contribute materials across more than one visit, but the game asks you to confirm the exact amount each time — once installed, materials can't be taken back out.",
          ],
        ],
      },
      {
        heading: "Welding it shut",
        paragraphs: [
          "Once both materials are complete, Welding becomes available while you're stationary at the Crash Site. It takes twelve separate welding passes, each about three seconds, to finish the repair.",
        ],
      },
      {
        heading: "What you get",
        paragraphs: [
          "A repaired Cargo Hold gives you 32 slots of on-site storage at the Crash Site. You can deposit or withdraw a single item or a whole stack while you're stationary there — it's separate from what you're carrying in Inventory.",
        ],
      },
    ],
  },
  {
    slug: "missions",
    title: "Missions",
    summary: "The jobs Wade Rusk and Tansy Rusk hand out, and how the Mission Log tracks them.",
    sections: [
      {
        paragraphs: [
          "The Mission Log keeps track of every job you've accepted: what's left to do, what's ready to turn in, and what you've already finished.",
        ],
      },
      {
        heading: "The current chain",
        list: [
          [
            "Walk It Off — reach The Jag and talk to Tansy Rusk. Wade can also send you on your way from the Crash Site. Finishing this hands you a ",
            { text: "Salvage Cutter", articleSlug: "inventory-and-equipment" },
            ".",
          ],
          [
            "Cut Your Teeth — equip your Salvage Cutter, make five ",
            { text: "Mining attempts", articleSlug: "mining-and-refining" },
            ", then show Tansy a full stack of Ferrite Shale.",
          ],
          [
            "Waste Not — make five ",
            { text: "Refining attempts", articleSlug: "mining-and-refining" },
            " at the Abandoned Processing Yard, then report back to Wade at the Crash Site.",
          ],
          [
            "Hold It Together — ",
            { text: "repair the Cargo Hold", articleSlug: "cargo-hold-and-welding" },
            ", then report the finished repair to Wade.",
          ],
        ],
      },
      {
        heading: "How missions work in practice",
        paragraphs: [
          "Objectives update live as you meet them, and the current one is always clear in the Mission Log. Finishing Walk It Off, Cut Your Teeth, or Waste Not hands you the next job in the chain automatically — there's nothing extra to accept. Hold It Together is currently the last job in the chain. When every objective on a job is met, talk to the NPC named in it to turn it in.",
        ],
      },
      {
        heading: "Talking to people",
        paragraphs: [
          "Talk opens a list of the conversations you can have with that person right now, rather than a single fixed exchange.",
        ],
        list: [
          "Anything tied to a job comes first, marked Available, Active, Turn in, or Completed. Available and Turn in are highlighted the same way they are out in the world.",
          "Below that, Talk about lists subjects you can bring up any time. They're always replayable, and a few only appear once you've finished the work that would make the two of you talk about them.",
          "Back on the first line of a conversation, and Finish at the end, both return you to that person's list. Close leaves the conversation entirely.",
        ],
      },
    ],
  },
  {
    slug: "holo-hollow",
    title: "Holo Hollow",
    summary:
      "The six connected locations that make up the current playable world, the town itself, and who you'll meet there.",
    sections: [
      {
        paragraphs: [
          [
            "Holo Hollow is the wrecked stretch of ground you're stranded in, and also the name of the settlement at the middle of it. It currently has six connected locations — see ",
            { text: "Travel & Scavenging", articleSlug: "travel-and-scavenging" },
            " for how they connect.",
          ],
        ],
      },
      {
        heading: "The locations",
        list: [
          [
            "Crash Site — your wrecked ship, half-sunk in mud and scrap. Home to the ",
            { text: "Cargo Hold repair", articleSlug: "cargo-hold-and-welding" },
            " and Wade Rusk.",
          ],
          [
            "Abandoned Processing Yard — rusted conveyors and a refurbished hopper where ",
            {
              text: "Ferrite Shale is refined into Refined Ferrite and Slag",
              articleSlug: "mining-and-refining",
            },
            ".",
          ],
          [
            "DeWhat? Emergency Power Annex — a mostly intact emergency-supply depot that dispenses ",
            { text: "Power Cells", articleSlug: "power-cells" },
            ".",
          ],
          "The Long Scramble — a steep, barren stretch of fractured stone with nothing to stop for. It's just the way through to The Jag.",
          [
            "The Jag — an exposed ferrite seam, home to ",
            { text: "Ferrite Shale Mining", articleSlug: "mining-and-refining" },
            " and Tansy Rusk.",
          ],
          [
            "Holo Hollow — the town itself, a declining mining settlement built on the remains of a holo-tourism economy. It connects to the Crash Site, the Power Annex, and The Long Scramble, and it's where you can ",
            { text: "spend Credits", articleSlug: "credits-and-trading" },
            ".",
          ],
        ],
      },
      {
        heading: "In town",
        paragraphs: [
          "Standing in Holo Hollow, you can step into the places that are open. Going inside is instant: it isn't a journey, it doesn't interrupt anything, and the map still shows you in Holo Hollow.",
        ],
        list: [
          [
            "Holo Hollow Souvenirs + Mining Supplies — Bix Weller's shop, where you can ",
            { text: "buy and sell", articleSlug: "credits-and-trading" },
            ".",
          ],
          "Holo Hollow Community Assistance Center — the old Visitor Center, now handling local assistance and rations. Renn Calder is usually here.",
          "HH B&B — visible from the street, but its rooms are held for locals and regular working crews rather than outside guests, so you can't go in yet.",
        ],
      },
      {
        heading: "Who's here",
        paragraphs: [
          "Wade Rusk, a Holo Hollow recovery and salvage operator, is based at the Crash Site. Tansy Rusk, a field mechanic and miner, is based at The Jag.",
          "In town, Bix Weller runs the souvenir and mining-supply shop, and Renn Calder, a Ferrite miner, is found at the Community Assistance Center. Each of them is only there when you're actually inside their building — you won't find them standing in the street. Other player characters can also be around.",
          "This is an early, playable build — check the Updates page for what's new in Holo Hollow.",
        ],
      },
    ],
  },
  {
    slug: "skills-and-progression",
    title: "Skills & Progression",
    summary:
      "How Mining, Refining, and Welding track your progress, and what leveling them up gets you.",
    sections: [
      {
        paragraphs: [
          "Three skills currently track your progress: Mining, Refining, and Welding. Each has its own experience (XP) total and level, earned separately.",
        ],
      },
      {
        heading: "How you earn XP",
        list: [
          "Mining — a successful Mining attempt at The Jag grants Mining XP.",
          "Refining — a Refining attempt at the Abandoned Processing Yard grants Refining XP, whether it succeeds or not.",
          "Welding — each completed welding pass on the Cargo Hold repair grants Welding XP.",
        ],
      },
      {
        heading: "Mission rewards",
        paragraphs: [
          [
            "The current missions also grant skill XP when you complete them: ",
            { text: "Cut Your Teeth", articleSlug: "missions" },
            " grants +100 Mining XP, ",
            { text: "Waste Not", articleSlug: "missions" },
            " grants +100 Refining XP, and ",
            { text: "Hold It Together", articleSlug: "missions" },
            " grants +100 Welding XP.",
          ],
        ],
      },
      {
        heading: "What leveling up does",
        paragraphs: [
          "Higher Mining and Refining levels raise your chance of success on each attempt, up to a level where success is guaranteed. Levels have a cap, and every skill shows its current level and XP right where you use it — open Mining, Refining, or the Cargo Hold repair to see your current progress.",
        ],
      },
    ],
  },
] as const;

/**
 * Validate the complete repository-authored Wiki collection. Kept small and
 * explicit so bad metadata fails at build/import time instead of becoming a
 * missing or ambiguously ordered public page.
 */
export function validatePublicWikiArticles(input: readonly unknown[]): readonly WikiArticle[] {
  const articles = WikiArticleSchema.array().min(1).parse(input);
  const seenSlugs = new Set<string>();

  for (const article of articles) {
    if (seenSlugs.has(article.slug)) {
      throw new Error(`Duplicate Wiki article slug: ${article.slug}`);
    }
    seenSlugs.add(article.slug);
  }

  const assertKnownLinkTargets = (article: WikiArticle, entries: readonly WikiParagraph[]) => {
    for (const entry of entries) {
      if (typeof entry === "string") continue;
      for (const segment of entry) {
        if (typeof segment === "string") continue;
        if (!seenSlugs.has(segment.articleSlug)) {
          throw new Error(
            `Wiki article "${article.slug}" links to unknown article slug: ${segment.articleSlug}`,
          );
        }
      }
    }
  };

  for (const article of articles) {
    for (const section of article.sections) {
      assertKnownLinkTargets(article, section.paragraphs ?? []);
      assertKnownLinkTargets(article, section.list ?? []);
    }
  }

  return articles;
}

/** The single validated repository-authored source for Wiki articles, in index order. */
export const wikiArticles = validatePublicWikiArticles(authoredWikiArticles);

export function getWikiArticles(): readonly WikiArticle[] {
  return wikiArticles;
}

export function getWikiArticle(slug: string): WikiArticle | undefined {
  return wikiArticles.find((article) => article.slug === slug);
}

/** The canonical route projection used by index, article, and static-param generation. */
export function getWikiArticlePath(article: Pick<WikiArticle, "slug">): string {
  return `/wiki/${article.slug}`;
}
