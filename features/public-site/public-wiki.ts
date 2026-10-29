import { WIKI_CATEGORIES, WikiArticleSchema } from "@/game/schemas/public-wiki";
import { missionGuideArticles } from "./public-wiki-mission-guides";
import { COMMUNITY_RULES_SLUG, SAFETY_PRIVACY_SLUG } from "./policy-links";
import type { WikiArticle, WikiCategoryId, WikiParagraph } from "@/game/schemas/public-wiki";

export type { WikiArticle, WikiCategoryId } from "@/game/schemas/public-wiki";

/**
 * The player manual. Every fact here must match currently shipped behavior; do
 * not publish approved-but-unshipped design (see docs/public-wiki.md).
 *
 * Authored order is still the only ordering mechanism — there is no sort key
 * and no second ordering source. The index groups articles under their
 * `category` in the category order declared by `WIKI_CATEGORIES`, and within a
 * category articles keep the exact order they appear in below. Reorder this
 * array to reorder a category.
 *
 * Character articles are written only from the `Public-Wiki-safe facts` on
 * that NPC's page in the Notion Canon (linked from docs/npc-canon.md), which is
 * internal and spoiler-complete. Do not copy from the rest of it.
 */
const authoredWikiArticles = [
  {
    slug: "lapidary",
    title: "Lapidary",
    category: "work",
    summary:
      "Shape Stone, cut Quartz, Topaz and Sapphire, and earn authorization to use Werner's Lapidary Workbench on Stillreach.",
    sections: [
      {
        heading: "Authorization at Werner's Lab",
        paragraphs: [
          [
            "The workbench is visible at Werner's Lab, reached on foot from the Prospecting Quarry or Harmonic Workings. Speak to Werner for ",
            { text: "They're Minerals, Marie!", articleSlug: "mission-theyre-minerals-marie" },
            ". Before acceptance the bench is locked. The Mission permits one supervised Stone lesson, then a conversation, one supervised Quartz lesson, and a final examination. Graduation permanently opens normal runs. Talk and Trade remain open throughout.",
          ],
        ],
      },
      {
        heading: "Stone and the cut gems",
        list: [
          "Shape Stone — Lapidary 1. Consumes one Stone in 12 seconds for 15 Lapidary XP. Practice produces no item.",
          "Cut Quartz — Lapidary 1. Consumes one Uncut Quartz in 18 seconds for one Cut Quartz and 75 Lapidary XP. Both recipes always succeed.",
          "Cut Topaz — Lapidary 5. Consumes one Uncut Topaz in 30 seconds for one Cut Topaz and 150 Lapidary XP.",
          "Cut Sapphire — Lapidary 8. Consumes one Uncut Sapphire in 45 seconds for one Cut Sapphire and 300 Lapidary XP.",
          "Every cut always succeeds. Cut Quartz, Cut Topaz and Cut Sapphire each weigh 100g and stack two to a tile. You can carry, stash, sell or trade them. Werner buys Cut Quartz for 16 Credits, Cut Topaz for 36 and Cut Sapphire for 70, twice what he pays for the uncut gem. He does not sell any gem.",
        ],
        paragraphs: [
          "Once you have graduated from Werner's Mission, the only thing standing between you and Topaz or Sapphire is your Lapidary level: there is no further lesson or permission. A technique appears in your Techniques list and on the Work tab once your level reaches it, so Topaz and Sapphire stay out of both until Lapidary 5 and 8. At Lapidary 8, Werner has one more thing to say; ask him about Beyond the Basics.",
        ],
      },
      {
        heading: "After graduation",
        paragraphs: [
          "Choose a number of pieces or Max. A number attempts that many; Max continues until materials or capacity stop the run. Each next piece checks the inventory left by the last. A started piece reserves its material and must finish; Stop After This Piece ends a longer run after that piece. Completed work resolves when you return, including while you were away, within the ordinary one-hour offline window.",
        ],
      },
    ],
  },
  {
    slug: "getting-started",
    title: "Getting Started",
    category: "getting-started",
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
    category: "places-and-travel",
    summary: "How to move between Holo Hollow's locations, and what you can find along the way.",
    sections: [
      {
        paragraphs: [
          "Holo Hollow currently has eleven connected locations, though one of them is shut when you arrive. You can only walk between locations that are directly connected — there's no fast travel or shortcut. There is one paid ride, on a single fixed route, once you've earned it.",
        ],
      },
      {
        heading: "The local map",
        list: [
          "Crash Site — connects to the Abandoned Processing Yard, the DeWhat? Emergency Power Annex, The Long Scramble, the South Access Track, Holo Hollow Landing, and the town of Holo Hollow.",
          "Abandoned Processing Yard — connects to Crash Site, the Power Annex and Holo Hollow Landing.",
          "DeWhat? Emergency Power Annex — connects to Crash Site, the Abandoned Processing Yard, and the town of Holo Hollow.",
          "The Long Scramble — connects to Crash Site, The Jag, and the town of Holo Hollow. It has no work of its own; it's just the way through.",
          "The Jag — connects to The Long Scramble and, below it, Deep Jag. There's no direct route between Crash Site and The Jag.",
          [
            "Holo Hollow — the ",
            { text: "town", articleSlug: "holo-hollow" },
            " connects to Crash Site, the Power Annex, The Long Scramble, and Rusk Recovery. There's no direct route between the town and The Jag or the Processing Yard.",
          ],
          [
            "Rusk Recovery — ",
            { text: "Wade Rusk's", articleSlug: "wade-rusk" },
            " own yard, on the northwest edge of town. It only connects to Holo Hollow, so the town is the way in and the way out.",
          ],
          [
            "Deep Jag — the lower workings, southwest of The Jag and reachable only from it. It shows on your map from the start, marked CAVE-IN, and you cannot walk into it: the passage is blocked by fallen rock until you reopen it during ",
            { text: "Brace Yourself", articleSlug: "mission-brace-yourself" },
            ". After that it is an ordinary walk, and the map reads MINING.",
          ],
          "South Access Track — a muddy service road running south out of the Crash Site. It connects to Crash Site, The South Cut and Holo Hollow Landing, has no work, shop or workstation of its own, and is just the way through.",
          "The South Cut — an Oil Shale mine cut into black layered shale, at the far end of the South Access Track. It only connects to the Track, so reaching it from the Crash Site is two ordinary walks, about 48 seconds each way. Mining Oil Shale here needs Mining 5.",
          [
            "Holo Hollow Landing — Skatboll's landing pad, a worn industrial apron with a weathered H.H. painted across it, east of the Crash Site. It is an ordinary place on foot, open from the start: it connects to Crash Site, the Abandoned Processing Yard and the South Access Track, each a normal 24-second walk, and does not connect to The South Cut. Walking there moves nothing but you; your ship only lands here when you fly it (see Move Along). Last Leg Trading is here; see ",
            { text: "Credits & Trading", articleSlug: "credits-and-trading" },
            ".",
          ],
        ],
      },
      {
        heading: "Selecting and confirming a walk",
        paragraphs: [
          "Select a location on the Map to look at it, then use the separate confirmation control to actually start walking there. Each leg between two connected locations takes about 24 seconds, and your progress is safe if you refresh or lose connection partway through.",
          "Selecting a location opens a small panel just above the navigation bar with its name, what's there, the walking time, and the Walk button, so you never have to scroll away from the map to leave. Details shows the location's full description in the same panel; select Details again to put it away. Selecting where you're standing says You are here, and a location with no path from where you are says No route from here — neither offers a walk. Select another location to switch, or tap an empty part of the map (or press Escape) to close the panel.",
        ],
      },
      {
        heading: "The Crew Hauler",
        paragraphs: [
          [
            "Once you've repaired the Crew Stop for Renn Calder in ",
            { text: "Out of the Weather", articleSlug: "mission-out-of-the-weather" },
            ", the mining crews will let you ride their shift hauler out from Holo Hollow to The Jag.",
          ],
          "It costs 5 Credits every ride — it isn't a one-time unlock that makes travel free. The ride takes about 12 seconds, where walking the same trip is two legs through The Long Scramble plus the stop in between.",
          "It runs one way: out to The Jag only. There is room for you heading out, but the hauler comes back loaded with shale, so you walk home through The Long Scramble like everybody else. You board it at the repaired Crew Stop in town. It's a real journey, not a teleport: you arrive when it gets there. There's nothing to scavenge on the back of a hauler, so walking is still the only way to find something along the route.",
        ],
      },
      {
        heading: "Flying the Rivet to Stillreach",
        paragraphs: [
          [
            "Once your repaired Rivet has made its first hop to Holo Hollow Landing (see ",
            { text: "Move Along", articleSlug: "mission-move-along" },
            "), its Ship panel there offers a second flight: to Stillreach Landing Station, on the planet Stillreach. It costs 120 Fuel Units and takes 4 minutes 20 seconds, and the flight back costs and takes exactly the same. You launch standing beside the ship where it is parked, with nothing else on the go, and you need to have reported Thrust Issues to Wade.",
          ],
          "The Flight Controls open on a star chart: the world your ship is on, marked You are here, and the world you can fly to, with the route between them. Tap a planet to choose it; with only one place to fly, it is already chosen. Choosing does nothing until you press LAUNCH. If the flight is not possible yet, for example with too little fuel, the planet is dimmed, marked Unavailable, and the reason is shown.",
          "Before you launch, the Flight Controls show the cost, your fuel now and your fuel after landing. If you would land with less than the 120 FU the flight back needs, they warn you. You can still go: nothing refuels the ship for free on the other side and there is no automatic return, so plan to load fuel you have bought, traded or made before you fly home.",
          "Once launched, the flight cannot be cancelled and the fuel is spent. You watch the Rivet lift off, cross a chart from Skatboll to Stillreach for most of the trip, and touch down. You can minimize the flight and still browse your Inventory, Equipment and Missions, but you cannot walk, mine, refine, trade or move anything until you land. The flight keeps going if you close the game; come back early and it picks up where it is, come back late and you have already landed.",
          "You, the ship and everything in its Cargo Hold arrive together. Stillreach has its own map of nine locations, walked exactly like Skatboll's; you cannot walk from one planet to the other. Walking away from the Landing Station leaves the Rivet parked in the mushroom ring, and its Cargo Hold is only open beside it. Flying back lands you at Holo Hollow Landing, never the Crash Site.",
          "Flying the Rivet is not the only way across. Milky Waymo, a fully automated passenger shuttle, runs between Holo Hollow Landing and Stillreach Landing Station once you have flown your own Rivet to Stillreach for the first time. See Riding Milky Waymo below.",
          [
            "Two walks from the Landing Station, by way of Windward Track, is Hilltop Workshop, where ",
            { text: "the Wise Old Enby", articleSlug: "the-wise-old-enby" },
            " lives and works. Anyone who gets there can talk to them.",
          ],
        ],
      },
      {
        heading: "Riding Milky Waymo",
        paragraphs: [
          "Milky Waymo keeps a check-in at Holo Hollow Landing and another at Stillreach Landing Station, listed among each landing's places. A ticket is 200 Credits one way and the ride takes 3 minutes, in both directions. It unlocks the first time your own Rivet lands at Stillreach, and stays unlocked after that, even once you have flown home. Before then you can walk in and look, but the kiosk says the service is not yet available.",
          "The kiosk shows your destination, the fare, the trip time and your Credits. Booking Passage opens a confirmation, and only CONFIRM & BOARD charges you. If you do not have 200 Credits it says so and charges nothing. You must be standing still with nothing else on the go, and Milky Waymo works wherever your Rivet is parked.",
          "You, your carried Inventory and your equipped items make the trip. Your Rivet, its fuel and everything in its Cargo Hold stay exactly where they were, so if you ride home you will have to go back for the ship the same way. The journey cannot be cancelled. While it lasts you cannot walk, mine, refine, trade or fly, though your Inventory, Equipment and Missions can still be browsed.",
          "The shuttle crosses the same chart the Rivet does. Under it, a cabin assistant greets you, speaks a new line every thirty seconds and signs off when you arrive; it is a recording, not a conversation. Closing the game does not stop the ride: you land on schedule and the cabin assistant's sign-off, with a DISEMBARK button, is waiting for you.",
        ],
      },
      {
        heading: "Scavenging while you walk",
        paragraphs: [
          "Every ordinary walk gives you one chance to scavenge along the way — unless you recently turned back from one (see Turning back, below). The opportunity opens at some point during the walk and stays open for a few seconds before it's gone for good — there's no way to trigger it early or get a second chance on the same leg. Riding the Crew Hauler gives you none at all.",
          "The Journey lists the newest thing that happened first, marked Latest, with the rest of the walk below it — so when something catches your eye, the Scavenge button is at the top rather than under the rest of the trip.",
          [
            "Claiming it can turn up a little Ferrite Shale, a ",
            { text: "Power Cell", articleSlug: "power-cells" },
            " or two, some Refined Ferrite, or nothing at all. It never costs you anything to try, and it never slows down or speeds up your arrival.",
          ],
        ],
      },
      {
        heading: "Turning back",
        paragraphs: [
          "Changed your mind? Turn Back on the Journey ends the trip on the spot and leaves you idle where you set out. You don't end up partway along the route, and there's no trip home to wait for. If you arrive first, you've arrived: you stay at the destination.",
          "Turning back from a walk isn't a free reroll of Scavenge. After you turn back from a walk, walks stop offering Scavenge — through reloading, reconnecting and logging out and in — until you complete a walk by arriving. Another Turn Back doesn't clear it, and neither does a Crew Hauler ride. The Journey tells you when Scavenge is unavailable. Anything you had already scavenged stays yours, and an opportunity you hadn't claimed is gone with the trip.",
          "You can turn back from the Crew Hauler too, and it never gets you the 5 Credits back. Turning back from a ride doesn't affect Scavenge either way.",
        ],
      },
    ],
  },
  {
    slug: "mining-and-refining",
    title: "Mining & Refining",
    category: "work",
    summary:
      "Turning Holo Hollow's exposed ferrite — and Deep Jag's harder ore — into refined material, one attempt at a time.",
    sections: [
      {
        paragraphs: [
          "Working material into something useful is a two-step loop: mine ore, then refine it at the Abandoned Processing Yard, or on Stillreach at Refiner-To-Go. There are two places to mine, three things you can refine, and — from Refining 5 — two ways to turn ore into Slag on purpose.",
        ],
      },
      {
        heading: "Mining at The Jag",
        paragraphs: [
          [
            "The Jag gives Ferrite Shale, and Mining needs a Mining Cutter equipped. With the starter Salvage Cutter each attempt takes about six seconds; a success gives you one or two shale. Your chance of success improves as your Mining skill grows, and Mining stops on its own if you run out of room to carry more. A charged ",
            { text: "Power Cell", articleSlug: "power-cells" },
            " can speed this up.",
          ],
        ],
      },
      {
        heading: "The Loadsteel Cutter",
        paragraphs: [
          [
            "The Loadsteel Cutter is a second Mining tool, made at Fabrication 5 on the ",
            { text: "Fabrication Station", articleSlug: "fabrication-and-tinkering" },
            ". It is its own tool rather than an improved Salvage Cutter, and it needs Mining 5 to equip or use. It is heavier, at 8 kg.",
          ],
          "It mines faster whether or not it is charged: a Ferrite Shale attempt takes about 4.8 seconds instead of six, and a Galvanite attempt about 7.2 instead of nine.",
          "A Power Cell does something different for it than for the Salvage Cutter. A charged Salvage Cutter mines faster; a charged Loadsteel Cutter mines at the same speed, but every attempt that gives any ore gives one more than usual — two or three instead of one or two from a Ferrite Shale success. An attempt that gives nothing still gives nothing. If you only have room for the usual amount, you still get the usual amount. Your chance of success and the XP an attempt pays stay the same.",
          "One Power Cell gives it ten charged attempts, used up one per attempt whether it succeeds or not, just like the Salvage Cutter. A new Loadsteel Cutter comes off the machine with no charge. Once its charge runs out it keeps its faster base speed and loses only the extra ore.",
        ],
      },
      {
        heading: "Mining Galvanite at Deep Jag",
        paragraphs: [
          [
            "Deep Jag, the lower workings southwest of The Jag, gives Galvanite once you have reopened it — see ",
            { text: "Brace Yourself", articleSlug: "mission-brace-yourself" },
            ". It is harder rock and slower going: about nine seconds an attempt, with a lower chance of success that keeps improving until Mining 40. A success gives one or two Galvanite and noticeably more Mining experience than shale does.",
          ],
          "Galvanite is unusually conductive, but it does not generate power on its own. Your starter Salvage Cutter handles it, and a charged Power Cell speeds it up the same way. So does a Loadsteel Cutter.",
        ],
      },
      {
        heading: "Oil Shale at The South Cut",
        paragraphs: [
          [
            "The South Cut is reached over the South Access Track, two walks south of the Crash Site (see ",
            { text: "Travel & Scavenging", articleSlug: "travel-and-scavenging" },
            "), and you need Mining 5 to mine there. Oil Shale is heavy — 600g a piece, five to a tile — and each attempt takes a full minute, before your Cutter and any Power Cell change that. Your chance of success starts at 35% at Mining 1, the same as everywhere, and climbs until Mining 50, where it is certain; at Mining 5 it is 40.30%.",
          ],
          "A successful attempt gives two, three or four Oil Shale, equally likely, and 100 Mining experience. An attempt that misses the success chance is not wasted: it still gives one Oil Shale and 20 Mining experience. A charged Loadsteel Cutter adds one more Oil Shale to either outcome, so three to five on a success and two on a low yield, as long as there is room for it; with room for only the usual amount you still get the usual amount, and the experience is the same.",
          "A success can also turn up a find: about one success in twenty gives an Uncut Sapphire, and about one in a hundred gives a Motherlode Slab. An attempt never gives both, and a missed attempt never finds either. A Sapphire adds its usual 30 Mining experience, so the attempt is 130 in all; a Motherlode Slab adds 150, so it is 250. The Slab is a single unbroken 12kg specimen of layered shale with an amber seam, it does not stack, and it is Ultra Rare: its tile shimmers wherever you carry it, and finding one posts an ULTRA RARE FIND System line in General saying who found it and where. A Sapphire from The South Cut is not announced, and a low-yield attempt never finds anything.",
        ],
      },
      {
        heading: "Oil Shale at The Dry Seam",
        paragraphs: [
          [
            "Stillreach has an Oil Shale mine of its own: The Dry Seam, at the far end of the Survey Line from the Landing Station, four ordinary 24-second walks in all (see ",
            { text: "Flying the Rivet to Stillreach", articleSlug: "travel-and-scavenging" },
            "). Mining there needs Mining 5 and a Cutter, and nothing else: no Mission or Rune Fragment is needed to walk in.",
          ],
          "It is exactly the same work as The South Cut, on the same numbers: a full minute an attempt before your Cutter and any Power Cell change that, a 40.30% chance of success at Mining 5 climbing to certain at Mining 50, two, three or four Oil Shale and 100 Mining experience on a success, and one Oil Shale and 20 experience on a low yield. A charged Loadsteel Cutter, Prioritize primary resources and the finds all work the same way: about one success in six gives a Rune Fragment, one in twenty an Uncut Sapphire and one in a hundred a Motherlode Slab, never more than one of them, and never on a low yield.",
          "A Motherlode Slab found at The Dry Seam posts an ULTRA RARE FIND line in General that names The Dry Seam. Fragments and Sapphires are not announced. Oil Shale carried back to Stillreach Landing Station sells to Last Leg Trading's terminal at 6 Credits a piece, the same as at Toll's counter.",
        ],
      },
      {
        heading: "Stone at the Prospecting Quarry",
        paragraphs: [
          [
            "Stillreach's Prospecting Quarry is open to anyone who can stand in it: Mining 1 and a Cutter are all it asks, and no Rune Fragment, Mission or Mining level beyond that. You have to fly there first (see ",
            { text: "Flying the Rivet to Stillreach", articleSlug: "travel-and-scavenging" },
            "). Stone is heavy and not worth much — 1kg a piece, five to a tile — and an attempt takes 19.8 seconds, before your Cutter and any Power Cell change that. Your chance of success starts at 35% at Mining 1 and climbs to certain at Mining 30.",
          ],
          "A successful attempt gives one or two Stone, equally likely, and 45 Mining experience. A miss gives nothing at all: no Stone, no find and no experience. A charged Loadsteel Cutter adds one more Stone to a success, as long as there is room for it.",
          "A success can also turn up one find, and never more than one: about one success in four gives a Rune Fragment, one in six an Uncut Quartz, one in twelve an Uncut Topaz and, once in about two hundred, a Boulder. The bonus experience is the same as anywhere else: 20 for a Fragment, 10 for Quartz, 20 for Topaz and 150 for a Boulder. At Mining 1 that is roughly sixteen Rune Fragments an hour before you stop to carry anything; it is a way to replace a lost Fragment, not the best place to look for them.",
          "A Boulder is a single 5kg rock that does not stack, and it is Ultra Rare: its tile shimmers wherever you carry it, and finding one posts an ULTRA RARE FIND System line in General saying who found it and where. It cannot be broken up, bought or sold to anyone, and it does nothing. A Quarry Fragment, Quartz or Topaz is not announced.",
          "Prioritize primary resources works here as everywhere: with it Off, Mining needs room for one Stone and for any one find, the 5kg Boulder included; with it On, one Stone is enough and a find without room is lost for good, even a Boulder, with no experience and no announcement.",
          "Werner's Lab is a short walk from the Quarry, and Werner there buys Stone at 2 Credits and sells it at 5, up to 12 a day; he also buys the Quarry's uncut gems. See Credits & Trading.",
        ],
      },
      {
        heading: "Rune Fragments at Harmonic Workings",
        paragraphs: [
          [
            "Harmonic Workings, on Stillreach, is a working mine for Rune Fragments. Reach it along The Survey Line from Stillreach Landing Station (see ",
            { text: "Flying the Rivet to Stillreach", articleSlug: "travel-and-scavenging" },
            "). You need Mining 8 and a Cutter; below Mining 8 the rock face is out of reach. An attempt takes 45 seconds, before your Cutter and any Power Cell change that. Your chance of success starts at 35% at Mining 1, is about 46.66% at Mining 8 and climbs to certain at Mining 40.",
          ],
          "A successful attempt gives one or two Rune Fragments, equally likely, and 130 Mining experience. That experience is the same whether you get one Fragment or two. A miss gives nothing at all. A charged Loadsteel Cutter adds one more Fragment to a success, as long as there is room for it.",
          "A success can also turn up one find, and never more than one: about one success in eight gives an Intact Runestone, and about one in twenty an Uncut Sapphire. An Intact Runestone is not announced, but a kept one is worth 130 Mining experience of its own, paid once when it is in your Inventory. An Uncut Sapphire adds its usual 30 experience and posts a RARE FIND line in General that names Harmonic Workings, but only when one is actually kept in your Inventory.",
          "Prioritize primary resources works here as everywhere: with it Off, Mining needs room for one Fragment and for a find, including an Intact Runestone's weight; with it On, one Fragment is enough and a find without room is lost, with no experience and no announcement.",
        ],
      },
      {
        heading: "Prioritize primary resources",
        paragraphs: [
          "Mining has one setting for what happens when your Inventory is nearly full, and it belongs to each character separately. It is Off by default, which is the safe choice: Mining will not start an attempt unless you have room for its smallest full success and for any one find it could turn up — at The South Cut, that is two Oil Shale and room for either a Sapphire or the 12kg Slab — so you never lose a find. The cost is that Mining stops sooner.",
          "Turn Prioritize primary resources On and Mining keeps going as long as there is room for one ore. A success keeps as much of its ore as fits, down to one, and still counts as a full success with its full experience. A find is then only kept if there is room left after the ore. If there is not, it is lost for good — even an Ultra Rare one — with no experience, no announcement and no way to claim it later. Nothing is rerolled or swapped for something that would fit. A low-yield attempt is always exactly one Oil Shale. The setting applies to every kind of Mining, and changing it never rewrites an attempt that has already resolved.",
        ],
      },
      {
        heading: "Rare finds",
        paragraphs: [
          "Now and then a successful attempt turns up something extra in the rock: a rough, uncut gemstone. It comes in addition to your ore, never instead of it, and a failed attempt never finds one. A gem is rare — you can mine for a long while without seeing one — and an attempt turns up at most one find of any kind.",
          "The Jag can give Uncut Quartz or Uncut Topaz. Deep Jag can give Uncut Topaz or Uncut Sapphire. The South Cut can give Uncut Sapphire or, far more rarely, a Motherlode Slab. A find shows on the attempt's result as a purple-framed tile beside your ore — the gems keep that purple frame in your Inventory too — and the Mining experience on that result is one total: the ore's usual amount plus a bonus for the gem. Quartz adds 10, Topaz 20 and Sapphire 30, wherever you find them.",
          "The Jag, Deep Jag and The South Cut can also turn up a Rune Fragment: about one success in twenty-five at The Jag, one in eight at Deep Jag and one in six at The South Cut. It is one of the same single find an attempt can turn up, so an attempt never gives both a Rune Fragment and a gem or a Slab, and it comes on top of your ore and its experience. A Rune Fragment adds 20 Mining experience wherever it is found. It is an ordinary 200g material that stacks ten to a tile — no purple frame — and finding one is not announced in General.",
          "Uncut gems stack only two to a tile, and Bix will buy them, as will Werner at Werner's Lab on Stillreach — see Credits & Trading. A Loadsteel Cutter's extra ore is only ever extra ore; it does not turn up more gems or Rune Fragments, and a low-yield attempt never finds one.",
          "Unless you turn on Prioritize primary resources, Mining only starts, and keeps going, while you have room for your ore and for a find — a Rune Fragment is 200g, so that includes room for its weight. If your Inventory is that tight when one turns up, the find is always kept; it is the ore that may come up short.",
          "Some finds are announced. When someone finds Uncut Topaz at The Jag or Uncut Sapphire at Deep Jag or Harmonic Workings, a System line appears in General chat saying who found it and where; a Motherlode Slab at The South Cut or The Dry Seam gets an ULTRA RARE FIND line. The other finds are yours alone to know about.",
          "The Prospecting Quarry on Stillreach can give a Rune Fragment, Uncut Quartz, Uncut Topaz or, very rarely, a Boulder; see Stone at the Prospecting Quarry.",
        ],
      },
      {
        heading: "Where to refine",
        paragraphs: [
          "Refining happens at the Abandoned Processing Yard, or at Refiner-To-Go, a patched-together refinery beside the fuel terminal at Stillreach Landing Station (step into it from the station's places). Refiner-To-Go refines every recipe the Yard does, with the same materials, chances and experience, but each attempt takes three times as long. It uses what you are carrying, never your Cargo Hold, so move what you need out of the hold first. Refine lists what you can refine right now with what you are carrying — plus any recipe a Mission is pointing you at, with what it is still missing. Recipes, beside it, lists every recipe your Refining level knows, whether or not you have the materials. The recipes below show what is still to come.",
          "A failed attempt says so: any Slag it makes, or any input a failed Galvaferrite pour or fuel attempt hands back, is shown as what the failure left, not as something you refined.",
          "The Slag a failed Refined Ferrite or Galvanic Stock attempt makes is a bonus, never a requirement. You do not need room for it to start or keep refining; the attempt still finishes, spends its ore and pays its Refining XP. Slag is kept for as long as you have room, and whatever will not fit is thrown out. Turn Auto-discard Slag on and every bit of it is thrown out instead. It is the same setting as the Practice Welding bench's, so changing it in one place changes it in the other, and it stays until you change it. The result and history say when Slag was discarded, so it is never counted as something you are carrying.",
          "Auto-discard Slag only covers Slag from a failure. A pour that makes Slag on purpose still puts it in your Inventory and needs room for it, and a failed Galvaferrite pour or fuel attempt always gives back what it returns. The product you are actually refining still needs room too, and Slag you keep can use up that room.",
        ],
        list: [
          "Refined Ferrite — two Ferrite Shale, a little over four seconds. A failure still produces one Slag, which isn't wasted: the Cargo Hold repair needs both.",
          "Galvanic Stock — two Galvanite, about six seconds. Needs Refining 5. A failed pour leaves two Slag.",
          "Galvaferrite — one Refined Ferrite and one Galvanic Stock, about seven seconds. Needs Refining 8. A failed alloy hands back one of the two inputs and loses the other.",
          "Slag from Ferrite Shale — two Ferrite Shale into one Slag, a little under four seconds. Needs Refining 5. It never fails, and it pays the same small Refining XP a failed Refined Ferrite attempt does.",
          "Slag from Galvanite — two Galvanite into two Slag, a little under five seconds. Needs Refining 5. It never fails, and it pays what a failed Galvanic Stock pour does.",
          "Full Small Fuel Canister — ten Oil Shale and one Empty Small Fuel Canister, 36 seconds. Needs Refining 8. See Fuel canisters, below.",
        ],
      },
      {
        heading: "Fuel canisters",
        paragraphs: [
          [
            "The Abandoned Processing Yard can turn Oil Shale into fuel, but only into a canister. An Empty Small Fuel Canister is made from one Galvanic Stock at the ",
            { text: "Fabrication Station", articleSlug: "fabrication-and-tinkering" },
            " (Fabrication 8). Refining then takes ten Oil Shale and one Empty canister for 36 seconds. It needs Refining 8, and owning the ingredients does not get around that.",
          ],
          "The chance of success follows the same climb as Galvanic Stock and Galvaferrite: 35% at Refining 1, rising to certain at Refining 30. Reaching Refining 8 does not reset it, so at Refining 8 it is 50.68%. The attempt takes the full 36 seconds whether it succeeds or not; at Refiner-To-Go on Stillreach it takes 108 seconds, with the same chances and rewards.",
          "A success gives one Full Small Fuel Canister, holding 50 Fuel Units, and 100 Refining experience. A failure is not total: it pays 20 Refining experience and gives back five of the ten Oil Shale and the same Empty canister, so you can try again without making another. The other five Oil Shale are lost. A failed fuel attempt never makes Slag, and Auto-discard Slag never touches what comes back.",
          "A Full canister weighs 6kg and stacks two to a slot; an Empty one weighs 800g and stacks five. Both are ordinary items: you can carry, stash and trade them, and they work the same for someone who never refined or fabricated anything. Nothing in the game uses Fuel Units yet. Toll Kade at Last Leg Trading buys and sells canisters once you have reported Thrust Issues to Wade; see Credits & Trading.",
        ],
      },
      {
        heading: "Choosing how many batches",
        paragraphs: [
          "Before you start, pick how many batches to run. It starts at one, and the minus and plus buttons change it by one, up to as many as your carried material pays for. Or press Max to keep refining until there is no material or no room for another batch. The console shows what one batch takes and how long it lasts, and for a recipe that never fails, what the whole run adds up to.",
          "A batch counts whether it succeeds or fails, so a run of five is five attempts, not five guaranteed results, and Refining stops by itself once the last batch you chose is done. A Max run has no number to reach: it keeps going while the next batch can start, so a failed Galvaferrite pour that hands back one of its inputs just leaves more to pour. Either way, if there is no room or no material for the next batch, the run ends there and says why.",
          "If your inventory changes before you press Start and the number you picked no longer fits, Refining will not quietly run fewer — it tells you the new most you can start, and you choose again.",
        ],
      },
      {
        heading: "Practical tips",
        list: [
          "Keep a Mining Cutter you can use equipped before you try to start Mining — it won't start without one.",
          "Swapping Cutters stops a Mining run; start it again to mine with the one you just equipped.",
          "Refining needs its inputs on hand; stock up before heading to the Processing Yard.",
          "Galvanite is heavy — 400g a piece against shale's 100g — so a full trip out of Deep Jag is a much shorter one.",
          "Leave a spare slot while you mine, so a rare find always has somewhere to go — or turn on Prioritize primary resources if you would rather keep mining and accept losing a find that has no room.",
          "Oil Shale is 600g a piece, and a Motherlode Slab is 12kg: check your carrying weight before a long run at The South Cut. A fuel attempt takes ten Oil Shale, and a Full canister is 6kg.",
          "Both activities stop cleanly if you start walking somewhere else — whatever you've already finished is kept.",
        ],
      },
    ],
  },
  {
    slug: "inventory-and-equipment",
    title: "Inventory & Equipment",
    category: "gear-and-credits",
    summary: "What you're carrying, what you're wearing, and how much room you have for more.",
    sections: [
      {
        heading: "Stacks and unique items",
        paragraphs: [
          "Ordinary material — Ferrite Shale, Refined Ferrite, Slag, Power Cells — stacks together in a single Inventory tile up to that item's stack limit. Gear like your Salvage Cutter is a unique item: it gets its own tile and remembers its own state, such as how much charge it has left. Selecting a piece of gear shows what it does — the slots a container adds, or the Mining level a Cutter needs and how it changes Mining.",
        ],
      },
      {
        heading: "How much you can carry",
        paragraphs: [
          "You start with one container, a beat-up MYKEA SCHLEPPRAUM-8 with eight slots, and a starting weight limit for everything you're carrying. Equipped gear — including containers — counts toward that weight limit but doesn't take up an Inventory slot itself.",
          [
            "You have two container attachments. A ",
            { text: "Scrap Box", articleSlug: "fabrication-and-tinkering" },
            " you fabricate yourself fits either one and adds three more slots, at a heavy 5 kg. A Freight Harness, made at Fabrication 8, fits either one too and adds six slots — but it weighs 9 kg, and that weight counts toward your limit like any other gear.",
          ],
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
          [
            "There is one Mining tool slot, which takes either the Salvage Cutter or the ",
            { text: "Loadsteel Cutter", articleSlug: "mining-and-refining" },
            ". The Loadsteel Cutter needs Mining 5; below that, Equipment lists it but will not equip it, and says why.",
          ],
        ],
      },
      {
        heading: "Gloves and Boots",
        paragraphs: [
          [
            "Gloves and Boots are real equipment slots beside the Mining tool, one piece each: the Legendary Miner's Gloves go on your hands and the Legendary Miner's Boots on your feet. Each worn piece counts as one extra Mining level for your success chance only, so a full pair is two. Neither needs a Mining level to wear, and your real ",
            { text: "Mining", articleSlug: "mining-and-refining" },
            " level does not change: they never unlock a mine, a recipe or a tool, and do not change how long an attempt takes, the XP, the ore or the finds. You can carry spares, swap the worn one, and trade a spare once it is carried and unequipped.",
          ],
          "Gloves weigh 1 kg and Boots 2 kg, and like any gear they count toward your weight limit while worn.",
        ],
      },
      {
        heading: "Breaking a Runestone apart",
        paragraphs: [
          "Select a Runestone and Item details shows Break Apart. After you confirm, it destroys one Runestone and gives you exactly five Rune Fragments, with nothing else needed — no tool, no place and no timer. It cannot be undone, and Rune Fragments cannot be put back together. It works on one stone at a time, even from a stack of several.",
          "The five Fragments have to fit in your Inventory once the stone is gone. They top up any partly filled Rune Fragment stacks first; the Runestone's own tile only frees up when it was your last stone. If they would not fit, nothing happens: the Runestone stays exactly as it was, and the message says whether you were short of slots or weight. The same 1 kg is carried either way.",
        ],
      },
      {
        heading: "Items that offer a Mission",
        paragraphs: [
          [
            "A carried Rune Fragment or intact Runestone glows blue, and its picture hops now and then, while you have not started the Mission it offers. Select the stack and Item details shows an Inspect action; it opens a short New mission offer, and you can choose Start mission or Not now, which changes nothing. Starting it begins ",
            { text: "Not From Around Here", articleSlug: "mission-not-from-around-here" },
            ". Starting it is the same from either item, and it uses nothing up: your Fragments and Runestones stay in your Inventory, yours to carry, trade or break down for any other purpose. Once it is started, both stop glowing.",
          ],
        ],
      },
      {
        heading: "Dropping items",
        paragraphs: [
          "Dropping a stack asks you to confirm the exact quantity first. In the current build, dropped items are permanently destroyed — there's no ground pickup yet, so only drop what you're sure you don't need.",
          [
            "Materials set aside for a piece on the ",
            { text: "Fabrication Station", articleSlug: "fabrication-and-tinkering" },
            " can't be dropped until that piece is finished, and neither can the Rune Fragment set aside for an attunement on the ",
            { text: "Resonance Rig", articleSlug: "runeworking" },
            ".",
          ],
        ],
      },
    ],
  },
  {
    slug: "power-cells",
    title: "Power Cells",
    category: "gear-and-credits",
    summary:
      "Claiming Power Cells at the Annex, making them at Fabrication 5, and using one to charge your Mining Cutter.",
    sections: [
      {
        heading: "Claiming your daily cells",
        paragraphs: [
          "Travel to the DeWhat? Emergency Power Annex and claim your allotment of five Power Cells. You can claim once per Pacific-time day; the allotment resets at local midnight.",
        ],
      },
      {
        heading: "Making your own",
        paragraphs: [
          [
            "From Fabrication 5 the ",
            { text: "Fabrication Station", articleSlug: "fabrication-and-tinkering" },
            " makes two ordinary, ready-to-use Power Cells from one Galvanic Stock. The station charges them as part of making them, so there is nothing more to do before they go into a Cutter.",
          ],
        ],
      },
      {
        heading: "Why the Annex gives them away",
        paragraphs: [
          [
            "The Annex is left over from the years when ",
            { text: "Holo Hollow", articleSlug: "holo-hollow" },
            " was a tourist town. With families and travellers coming out to the projector shows, the Settled Systems Authority required the settlement to keep a public emergency power depot, so anyone stranded out here could keep the essentials running until help arrived.",
          ],
          "DeWhat? won that contract and installed the automated Annex. Then the tourism dried up — and the contract didn't. The depot is still public infrastructure, and it still hands out its daily allotment.",
          "Five per person, per day, is about fair access rather than generosity: enough portable power to keep heat, comms or a tool alive in an emergency, and not enough for one person to empty the rack for everybody else.",
        ],
      },
      {
        heading: "Why Bix still sells them",
        paragraphs: [
          [
            "The free allotment is personal and capped, so it doesn't stock a shop for a whole town. People who have already used today's five, or who need more than five, or who would simply rather not wait for the reset, can buy a cell from ",
            { text: "Bix Weller", articleSlug: "credits-and-trading" },
            " instead. He also buys spare cells from anyone who would rather have the Credits.",
          ],
        ],
      },
      {
        heading: "Charging a Cutter",
        paragraphs: [
          "Load one carried Power Cell into your equipped, empty Mining Cutter from Inventory or Equipment. This sets the Cutter's charge to ten uses and consumes the cell completely — a Cutter that already has charge can't be topped up early.",
          [
            "While a Salvage Cutter has charge, each ",
            { text: "Mining", articleSlug: "mining-and-refining" },
            " attempt at The Jag takes about three seconds instead of six — everything else about Mining (chance of success, what you find, XP) stays the same. Once the charge runs out, Mining automatically goes back to its normal speed.",
          ],
          [
            "A charged ",
            { text: "Loadsteel Cutter", articleSlug: "mining-and-refining" },
            " is not sped up. Instead, every successful attempt while it has charge gives one more ore than usual.",
          ],
        ],
      },
    ],
  },
  {
    slug: "credits-and-trading",
    title: "Credits & Trading",
    category: "gear-and-credits",
    summary:
      "Your character's Credits, buying and selling at Bix Weller's shop, Wade's scrap counter at Rusk Recovery, Toll Kade's fuel counter at Holo Hollow Landing, Werner's Stone and gem counter at Werner's Lab on Stillreach, and trading with other players.",
    sections: [
      {
        paragraphs: [
          "Credits are your character's money. Each character has their own balance — Credits aren't shared between the characters on your account. Every character starts with 10 Credits.",
          [
            "You can also hand Credits and items to another player — or to another of your own characters — by meeting them and ",
            { text: "trading directly", articleSlug: "player-trading" },
            ".",
          ],
          [
            "You can see your balance on your ",
            { text: "Character screen", articleSlug: "skills-and-progression" },
            " and in your ",
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
          "Pick Buy or Sell, choose a quantity with the minus, plus, and Max controls, check the total, and confirm with a single Buy or Sell. You stay in the shop afterwards, with your Credits and Inventory updated straight away. A trader who only goes one way simply has no choice to make.",
          "When buying, Max is the most you can actually take away — it accounts for your Credits, the room left in your Inventory, and anything left of a daily limit. When selling, Max is everything you're carrying of that item.",
        ],
      },
      {
        heading: "What Bix pays",
        list: [
          "Ferrite Shale — 2 Credits each",
          "Refined Ferrite — 10 Credits each",
          "Slag — 1 Credit each",
          "Power Cell — 4 Credits each",
          "Galvanite — 4 Credits each",
          "Galvanic Stock — 18 Credits each",
          "Uncut Quartz — 8 Credits each",
          "Uncut Topaz — 18 Credits each",
          "Uncut Sapphire — 35 Credits each",
        ],
      },
      {
        heading: "What Bix sells",
        paragraphs: [
          [
            { text: "Power Cells", articleSlug: "power-cells" },
            " cost 12 Credits each. That's more than he pays for them, which he'll explain if you ask him about Power Cells. He doesn't stock anything else at the moment.",
          ],
          "He sells each character at most 12 Power Cells a day. The counter shows how many are left for you today, and the count starts again at midnight Pacific time. Selling cells back to him doesn't give you more for the day, and cells you get anywhere else never count against it.",
          "A purchase has to fit: if your Inventory doesn't have room for the whole amount, or you can't afford it, nothing is bought and nothing is charged.",
        ],
      },
      {
        heading: "Trading with Wade",
        paragraphs: [
          [
            "Wade Rusk sells Scrap Metal at 4 Credits a piece out of his own yard at Rusk Recovery, once he has put you on the ",
            { text: "workbench", articleSlug: "practice-welding" },
            ". It works exactly like Bix's counter, out in the yard rather than inside a shop.",
          ],
          "He sells each character at most 12 Scrap Metal a day, counted and reset exactly like Bix's Power Cells: the counter shows what's left today, it starts again at midnight Pacific time, and selling scrap back doesn't add to it. Scrap stacks up to three to an inventory slot.",
          "He buys spare Scrap Metal back at 1 Credit a piece, and structural material at the same prices Bix pays where they both buy the same thing: Refined Ferrite at 10 Credits, Galvanic Stock at 18, and Galvaferrite at 45. He still leaves Slag to Bix.",
        ],
      },
      {
        heading: "Trading with Toll at Last Leg Trading",
        paragraphs: [
          [
            "Tolliver “Toll” Kade works the counter at Last Leg Trading, a freight and fuel shop on ",
            { text: "Holo Hollow Landing", articleSlug: "travel-and-scavenging" },
            ". Open the Landing from the Map, step into the shop, and you can talk to him straight away: his Skatboll, Stillreach and Fuel topics are there from the start and can be read again any time. Talking and trading are separate, and reading a topic changes nothing about your trade.",
          ],
          [
            "Trading opens only after you have reported the completed Thrust Issues repair to Wade at Rusk Recovery (see ",
            { text: "Thrust Issues", articleSlug: "mission-thrust-issues" },
            "). Repairing the ship is not enough; the report is what counts. It is each character's own, so another character on your account has to do it for themselves, and until then the counter stays shut for both buying and selling. It does not wait for the ship to have flown.",
          ],
          "Toll sells Full Small Fuel Canisters at 225 Credits and Empty Small Fuel Canisters at 40 Credits. He buys a Full one back at 160, an Empty one at 25, and Oil Shale at 6 Credits a piece. He does not sell Oil Shale.",
          "He sells each character at most 5 Full and 5 Empty canisters a day, counted separately and reset at midnight Pacific time. Selling a canister back to him does not give you more for the day. A purchase has to fit your Credits and your Inventory, or nothing is bought and nothing is charged.",
        ],
      },
      {
        heading: "Last Leg Trading's terminal on Stillreach",
        paragraphs: [
          [
            "At Stillreach Landing Station, Last Leg Trading runs an unmanned automated fuel terminal, listed among the station's places (see ",
            { text: "Flying the Rivet to Stillreach", articleSlug: "travel-and-scavenging" },
            "). It is the same business as Toll's counter, with the same prices, the same Thrust Issues requirement for both buying and selling, and the same daily limits: canisters you buy at either place count toward one shared allowance of 5 Full and 5 Empty a day, so buying at one leaves less for the other.",
          ],
          "Step into it from the Landing Station; anyone can, and until your Thrust Issues report is in it shows Access restricted. It cannot be used from anywhere else on Stillreach, from Skatboll, or while you are in flight, and there is nobody to talk to there.",
          "The terminal also buys Stone from you at 2 Credits a piece, from what you are carrying. It does not sell Stone, and it does not buy Boulders. Toll's counter on Skatboll does not buy Stone, and selling Stone does not change the daily canister limits.",
        ],
      },
      {
        heading: "Trading with Werner at Werner's Lab",
        paragraphs: [
          [
            "Werner runs a parked mineral laboratory at Werner's Lab on Stillreach, one walk from the Prospecting Quarry and from Harmonic Workings (see ",
            { text: "Flying the Rivet to Stillreach", articleSlug: "travel-and-scavenging" },
            "). Anyone who reaches it can trade with him straight away: no Mission, level or conversation comes first. Talking and trading are separate, and reading one of his topics changes nothing about your trade.",
          ],
          "Werner sells Stone at 5 Credits a piece, and buys it back at 2. He sells each character at most 12 Stone a day, counted and reset exactly like Bix's Power Cells: the counter shows how many are left today, the count starts again at midnight Pacific time, and selling Stone back to him does not give you more for the day. Stone stacks five to a tile, and a purchase has to fit your Credits and your Inventory, or nothing is bought and nothing is charged.",
          "He buys Uncut Quartz at 8 Credits, Uncut Topaz at 18 and Uncut Sapphire at 35, the same prices Bix pays. He also buys Cut Quartz for 16 Credits. He does not sell gems. His supervised Lapidary lessons and workbench authorization are separate from trading.",
        ],
      },
    ],
  },
  {
    // Issue #268 — direct player trading. Player-facing behaviour only: never
    // publish request limits, escalation thresholds, or how trades are
    // recorded internally.
    slug: "player-trading",
    title: "Player Trading",
    category: "gear-and-credits",
    summary:
      "Meet another player at the same location and swap Credits and items directly: request, offer, Ready, Confirm — and nothing moves until you both confirm.",
    sections: [
      {
        paragraphs: [
          "You can trade directly with another player's character. There's no auction house, mail, or trading from across the map: you both have to be standing at the same location, and the trade happens there and then.",
          "Two characters on the same account can trade with each other too, exactly the same way. It's how you move Credits or gear between your own characters.",
        ],
      },
      {
        heading: "Starting a trade",
        paragraphs: [
          "Open the list of characters at your location, choose the character you want to trade with to open their profile, and choose Trade. Your character waits for an answer while the request is open, so you can't start anything else — Cancel Request withdraws it at any time.",
          "A request only lasts about 20 seconds. If it isn't answered by then it simply ends, and you're free again. It also ends if either of you leaves the location.",
          "Trade won't work if you've blocked that player, if one of you has moved on, or while you're busy doing something. A moderation restriction on your account can stop you starting trades too, though you can still accept one. If you send a lot of requests in a short time, you'll be asked to wait a moment before sending another.",
        ],
      },
      {
        heading: "Getting a request",
        paragraphs: [
          "An incoming request never interrupts you. It appears as a card at the top of the Chat/Social panel, and the Chat/Social button — or, on a wide screen, the Chat tab in the sidebar — lights up so you know it's there. You can keep doing whatever you were doing and answer when you're ready — or let it run out.",
          [
            "Choose Accept to start trading or Decline to turn it down. Several requests can wait at once; accepting one ends the others. If one player keeps sending you requests, the card offers Decline & Block, which ",
            { text: "blocks them", articleSlug: COMMUNITY_RULES_SLUG },
            " the same way Block does everywhere else. They aren't told you blocked them.",
          ],
          "You need to be idle to accept: if you're in the middle of something, Accept tells you to finish it first.",
        ],
      },
      {
        heading: "Building the offers",
        paragraphs: [
          "Accepting opens the trade screen for both of you. Your side is You offer; theirs is They offer, which you can see but never change. While the trade is open, neither of you can travel, work, or start anything else.",
        ],
        list: [
          "Credits — any whole amount up to what your character has.",
          "Stackable items you're carrying, in any quantity you have.",
          "Gear and other unique items you're carrying, such as a spare Cutter or a container. Each one moves as the same item, so a Cutter keeps exactly the charge it has — the trade screen shows it.",
        ],
      },
      {
        paragraphs: [
          [
            "Only what's in your carried ",
            { text: "Inventory", articleSlug: "inventory-and-equipment" },
            " can be offered. Unequip gear and take things out of the ",
            { text: "Cargo Hold", articleSlug: "cargo-hold-and-welding" },
            " before the trade if you want to offer them. A gift is fine: one side can offer nothing at all, as long as somebody offers something.",
          ],
        ],
      },
      {
        heading: "Ready, then Confirm",
        paragraphs: [
          "When you're happy with both offers, choose Ready. Your side locks; Change Offer unlocks it. Any change to either offer clears both players' Ready, so nobody can agree to one deal and be held to another.",
          "Once you're both Ready, the offers freeze into a final You Give / You Receive review. Check it, then choose Confirm Trade. The first player to confirm waits for the other, and can still Cancel Trade until the second confirmation goes through.",
          "Nothing moves until both of you have confirmed. Then everything moves at once, for both of you, and the trade screen shows what you gave and received.",
          "If either offer holds an Ultra Rare or Legendary item, both of you see a note on the trade screen, while you build the offers and again in the final review: Very rare item! Check recent player-to-player prices in Trade chat before confirming. Trades are final. It is only a reminder. It never stops a trade, shows no price and adds no extra step.",
        ],
      },
      {
        heading: "When a trade can't finish",
        paragraphs: [
          "At the final Confirm, RuneSpace checks the whole trade again. If either Inventory wouldn't have room or would end up too heavy, if a trade would leave either character without a usable Mining Cutter, or if something offered is no longer there, nothing moves. Both players see what went wrong, both lose Ready, and you can fix the offers and try again.",
          "A container you receive doesn't add room until you equip it, so it can't make space for the rest of the same trade.",
          "Either of you can Cancel Trade at any time before it completes, and nothing moves. A trade that sits for five minutes without anyone doing anything ends on its own, also with nothing moved.",
        ],
      },
      {
        heading: "Refreshing and reconnecting",
        paragraphs: [
          "A trade isn't tied to your browser tab. If you refresh, lose your connection, or come back on another device, you return to the same trade with the same offers — never a second copy of it.",
          [
            "RuneSpace keeps a record of every completed trade — which characters and accounts traded, where, when, and what each side gave — so trades can be looked into if something goes wrong. ",
            { text: "Safety & Privacy", articleSlug: SAFETY_PRIVACY_SLUG },
            " has the details.",
          ],
        ],
      },
    ],
  },
  {
    slug: "cargo-hold-and-welding",
    title: "Cargo Hold & Welding",
    category: "work",
    summary:
      "Repairing the ship's Cargo Hold, Landing Gear and Propulsion System, what the Cargo Hold gives you once it's welded shut, what else you can weld, and the stashes you can build at your work sites.",
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
            { text: "Hold It Together", articleSlug: "mission-hold-it-together" },
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
            ". You can contribute materials across more than one visit, and the install button names the exact amount it will take — once installed, materials can't be taken back out.",
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
          "A repaired Cargo Hold gives you 32 slots of storage on your ship. You can deposit or withdraw a single item or a whole stack while you're stationary at the ship, from the Ship panel's Board Ship control — it's separate from what you're carrying in Inventory. The Hold is part of the ship: it stays at the Crash Site until your ship flies, and from then on it is wherever your ship is berthed.",
        ],
      },
      {
        heading: "Welding other things",
        paragraphs: [
          [
            "Welding isn't a one-off button for your ship. Once you've learned it, it's something your character knows how to do, and there are other jobs that need it — starting with the Crew Stop in town, which you can repair during ",
            { text: "Out of the Weather", articleSlug: "mission-out-of-the-weather" },
            ".",
          ],
          "Every welding job works the same way and uses the same skill: install its materials, then weld it in passes of about three seconds each, with each finished pass earning the same Welding XP. What changes from job to job is what material it needs and how many passes it takes. The Crew Stop needs 20 Refined Ferrite and ten passes.",
          [
            "The biggest job so far is the collapsed passage at Deep Jag: 25 Refined Ferrite and 5 ",
            { text: "Power Cells", articleSlug: "power-cells" },
            " to build Tansy's brace out of, then fifteen passes to weld it together. The Cells go into the jack that lifts the roof and are spent doing it — like every other installed material, they don't come back.",
          ],
          [
            "Back at the Crash Site, the ship has a second repair after the Cargo Hold: the Landing Gear. It is part of ",
            { text: "Wheel Be Right Back", articleSlug: "mission-wheel-be-right-back" },
            ', and it sits beside the Cargo Hold from the start as a damaged system. Its repair opens up once you have taken that job from Wade. It takes 2 Wheel Assemblies, 2 Mounting Brackets and 1 Galvanic Wire Spool, then twelve passes. You do the welding yourself, but you can buy or trade for any of the parts — you don\'t need Fabrication or Refining levels to install them. Once it is done, the Landing Gear panel reads "Landing gear restored." The ship looks just as wrecked as before, and nothing about it lets you fly.',
          ],
          [
            "The last major repair is the ship's Propulsion System, and it sits beside the Cargo Hold and Landing Gear from the start as another damaged system. It belongs to ",
            { text: "Thrust Issues", articleSlug: "mission-thrust-issues" },
            ", and its repair opens up once you have taken that job from Wade. You need Welding level 8 to take the job and to do the work. It takes 2 Drive Mounts, 1 Galvaferrite, 2 Mounting Brackets and 1 Galvanic Wire Spool, then sixteen passes. You can buy or trade for any of the parts, and you don't need Fabrication or Refining levels to install them, but the welding is always yours.",
          ],
          'The moment the sixteenth pass lands the ship is physically restored: the Crash Site shows it repaired, and the Propulsion System panel reads "Propulsion restored. Report to Wade." Report to him and it reads "Propulsion restored. Ship flight-ready." The sixteen passes pay their usual Welding XP and Wade adds nothing on top. A repaired ship can be fuelled and flown from the Ship panel; see Move Along for the first flight.',
          [
            "You can also weld with nothing at stake at all. Wade's workbench at Rusk Recovery lets you ",
            { text: "practice as much as you like", articleSlug: "practice-welding" },
            ", for scrap rather than for a repair.",
          ],
          [
            "Once you are good enough with a torch, there is paying work too. ",
            { text: "Work Orders", articleSlug: "work-orders" },
            " run on the same Workbench and the same welding, for real client jobs and Credits rather than practice.",
          ],
        ],
      },
      {
        heading: "Site stashes",
        paragraphs: [
          "A few of your work sites let you build a stash of your own: somewhere to leave what you were about to carry back and forth. It takes two separate things — a mount welded down at the site, then a container you install in it. Carrying a container to a site never gives you free storage by itself.",
          "You build one mount per site, and it is yours alone. Each site asks for its own Welding level, and nothing else: you never need Mining, Refining or Fabrication levels of your own to build one, and every material can be bought or traded for. Nothing about a stash shows up at a site until you are able to build it.",
        ],
        list: [
          "The Jag — Welding 1. 6 Refined Ferrite and 3 Slag, six welding passes.",
          "Rusk Recovery — Welding 5. 3 Galvanic Stock and 2 Mounting Brackets, ten welding passes.",
          "Abandoned Processing Yard — Welding 5. The same 3 Galvanic Stock and 2 Mounting Brackets, ten welding passes.",
          "Deep Jag — Welding 8, and only once the collapsed passage has been braced open. 2 Galvaferrite, 2 Mounting Brackets and 1 Galvanic Stock, fifteen welding passes.",
        ],
      },
      {
        heading: "Building a mount, then installing a container",
        paragraphs: [
          [
            "You build a mount the same way as any other welding job: install the materials, then weld it in passes of about three seconds each. Every pass pays the usual Welding XP, and ",
            { text: "Clean Pass", articleSlug: "cargo-hold-and-welding" },
            " works as it always does. There is no bonus for finishing. Once it is built, it stays built.",
          ],
          [
            "To use a built mount, install a ",
            { text: "container", articleSlug: "inventory-and-equipment" },
            " you are carrying and are not wearing. Any container works — your starting MYKEA, a Scrap Box or a Freight Harness — and the stash gets exactly as many slots as that container has. Items stored there have no weight limit. The container leaves your Inventory while it is installed, so it stops giving you carrying slots until you take it back out.",
          ],
        ],
      },
      {
        heading: "Using a stash",
        paragraphs: [
          "You can put things in and take things out only while you are standing at that site, and what you leave there stays there: it does not follow you to another site or to the Cargo Hold. Each site has a separate stash, and every character has their own. You have to stop whatever you are doing to use one, the same as the Cargo Hold.",
          "Stored items keep their identity, so a Cutter keeps its charge. Moving things back follows the same rules as everything else: whatever you take out has to fit your carried slots and weight.",
        ],
        list: [
          "Remove Container — only when the stash is completely empty. The container comes back to your Inventory, if it fits.",
          "Swap Container — replace the container with a different kind, without emptying the stash. The new one needs enough slots for everything stored there, and the old one has to fit in your Inventory afterwards, weight included. Swapping for another of the same kind is not allowed. Everything stored stays where it is.",
          "An installed container cannot be traded, worn, taken apart, or stored in the Cargo Hold while it is installed.",
        ],
      },
      {
        heading: "Clean Pass",
        paragraphs: [
          [
            "During any welding job — a repair, a practice weld, or a ",
            { text: "Work Order", articleSlug: "work-orders" },
            " — moments open up where the bead is running clean and you can lay one in. How many you get depends on how long the job is: a short one might not get any at all, and a longer one can get more than one — roughly one for every five sections of welding, starting once a job reaches six sections. A Clean Pass control appears next to the normal controls for about three seconds when one comes up.",
          ],
          "Take it in time and the work jumps forward a whole extra pass, and pays that pass's XP. Miss it and absolutely nothing happens: it costs no material, no progress, and no time, so there is never a reason not to let one go by. Every chance is decided before the job starts, and stopping and resuming never moves them or gives you another go at one you were in the middle of.",
        ],
      },
    ],
  },
  {
    slug: "practice-welding",
    title: "Practice Welding",
    category: "work",
    summary:
      "Wade's workbench at Rusk Recovery, the scrap it runs on, and how practising Welding actually works.",
    sections: [
      {
        paragraphs: [
          [
            "Rusk Recovery is Wade Rusk's recovery yard, one ordinary walk northwest of Holo Hollow. Once he has put you on the bench there, you can practise ",
            { text: "Welding", articleSlug: "cargo-hold-and-welding" },
            " as much as you have scrap for — no job, no client, and nothing that has to be finished.",
          ],
        ],
      },
      {
        heading: "Getting on the bench",
        paragraphs: [
          [
            "Finish ",
            { text: "Keep the Change", articleSlug: "mission-keep-the-change" },
            " and Wade moves back to his own yard. Walk in and he will offer you ",
            { text: "10,000 Hours", articleSlug: "mission-10000-hours" },
            "; accepting it hands you six Scrap Metal and opens the workbench.",
          ],
          "He hands over all six pieces or none. Scrap stacks three to a slot, so six pieces take two inventory slots — if you have not got room for all six he will tell you to make room and come back, and nothing is handed over or started until you do. Those six are his to give and don't count against what he'll sell you in a day.",
        ],
      },
      {
        heading: "How a practice weld works",
        list: [
          "Each fresh weld takes 2 Scrap Metal, spent the moment it starts.",
          "A weld is ten sections, each about three seconds, the same cadence as any other welding.",
          "Each finished section pays 10 Welding XP — a fraction of what a repair section pays, because nothing is actually being repaired — so a whole weld is worth 100.",
          "Finishing a weld produces up to 2 Slag.",
        ],
      },
      {
        heading: "Starting, stopping, and coming back",
        paragraphs: [
          "Before you start, pick how many welds to run: it starts at one, and the minus and plus buttons change it by one, up to as many as your scrap pays for. Or press Max to keep welding until the scrap runs out. A number of welds means whole welds — ten sections each — and the bench shows the scrap, time, and Welding XP the run adds up to. If a half-finished weld is waiting on the bench, it counts as the first of them.",
          "As each weld finishes the next one you chose begins, taking two more scrap, and the bench stops on its own after the last. It keeps going while you are away from the screen, the same as any other work. If your scrap changes before you press Start and the number you picked no longer fits, the bench tells you how many it can run now rather than quietly running fewer.",
          "Stop whenever you like. The half-finished weld stays exactly as it is, and so does the scrap you already spent on it — resuming continues that same weld and costs nothing, even with no scrap left at all. Walking away from the yard stops the bench the same way; you cannot weld from the road.",
          "If the scrap somehow runs short before the run is done, the bench finishes the weld in progress and stops on its own, saying so. Getting more does not start it again — that is your call.",
          "If you would rather the weld on the bench finish without another one starting after it, use Stop After Current Weld instead of an ordinary Stop, even partway through a run of several. It lets that weld run to completion — full XP and output, same as always — then leaves the bench clear instead of spending scrap on the next one. It works whether the weld is currently running or already Stopped partway through.",
        ],
      },
      {
        heading: "One bench, one job",
        paragraphs: [
          [
            "There is only one Workbench, and it holds one piece of work at a time. An unfinished practice weld — one whose scrap is already spent — counts as occupying it, even after you have Stopped it. Take on a paying ",
            { text: "Work Order", articleSlug: "work-orders" },
            " and you will be asked to finish that weld first, or to clear the bench with Stop After Current Weld. It works the other way too: a client's job on the bench means no fresh practice weld until that job is finished.",
          ],
        ],
      },
      {
        heading: "Scrap and slag",
        paragraphs: [
          [
            "Wade sells Scrap Metal at 4 Credits a piece out of the yard, up to 12 a day, and buys spare scrap back at 1 — see ",
            { text: "Credits and trading", articleSlug: "credits-and-trading" },
            ".",
          ],
          [
            "Slag is yours to keep or throw out: the Auto-discard Slag setting decides, applied as each weld finishes. It is the same setting Refining uses, so changing it at the bench changes it at the Yard too. Bix pays 1 Credit apiece for ",
            { text: "Slag", articleSlug: "mining-and-refining" },
            " in town, so an 8-Credit weld can return 2 if you keep both and sell them. If you keep Slag and run out of room for it, the overflow is thrown out rather than stopping the weld. Scrap stacks three to a slot, so using two pieces only frees a slot for Slag when it empties a stack.",
          ],
        ],
      },
      {
        heading: "Work Orders",
        paragraphs: [
          [
            "Once Tansy opens the ",
            { text: "Fabrication Station", articleSlug: "fabrication-and-tinkering" },
            " beside it, the yard shows two work areas; the bench and the terminal are both under the Welding Workshop.",
          ],
          [
            "There is a beaten-up terminal in the corner of the yard, and it is not just scenery any more. Once you are good enough with a torch, it is where the paying jobs come in — see ",
            { text: "Work Orders", articleSlug: "work-orders" },
            " for how the board works.",
          ],
        ],
      },
    ],
  },
  {
    slug: "work-orders",
    title: "Work Orders",
    category: "work",
    summary:
      "The paying jobs on Wade Rusk's terminal at Rusk Recovery — how the board opens up, how a job works, and what it pays.",
    sections: [
      {
        paragraphs: [
          [
            "There is a beaten-up terminal in the corner of ",
            { text: "Wade Rusk's", articleSlug: "wade-rusk" },
            " yard at Rusk Recovery, right beside the Workbench. Finishing 10,000 Hours turns it from scenery into something real — though at that point it is still empty. Paying work does not actually start coming through it until you are ready for it.",
          ],
        ],
      },
      {
        heading: "Opening the board",
        paragraphs: [
          [
            "Two things have to be true before Wade will put a customer's property in front of you: Welding level 5, and his own say-so. Once both hold, he offers you ",
            { text: "10,001 Hours", articleSlug: "mission-10001-hours" },
            " at Rusk Recovery. Accept it, and the board is yours for good — you do not need to turn the job in first. Turning it in afterward is Wade looking at the finished work and handing over some shop stock; the board keeps working the whole time either way. See ",
            { text: "Missions", articleSlug: "missions" },
            " for where this sits among the other jobs.",
          ],
        ],
      },
      {
        heading: "Three jobs, one at a time",
        paragraphs: [
          "The board always shows three jobs at once. You can only have one underway at a time, so pick whichever one you want and leave the other two — they will still be posted when you are free to look again.",
        ],
      },
      {
        heading: "Taking a job",
        paragraphs: [
          "Taking a job hands over its materials right away — Refined Ferrite or Galvanic Stock, and sometimes a Power Cell or two — straight out of your Inventory. Make sure you are carrying everything it asks for before you accept, because the materials do not come back once you have. There is no way to abandon a job either: once it is on the bench, finishing it is the only way it leaves.",
        ],
      },
      {
        heading: "Working it at the Workbench",
        paragraphs: [
          [
            "Accepting a job does not start the clock — it just puts the work on Wade's Workbench, waiting. Head over and start it yourself, the same way you would start a ",
            { text: "practice weld", articleSlug: "practice-welding" },
            ". If an unfinished practice weld is already sitting on the bench, you will need to finish that first — the bench only holds one piece of work at a time.",
          ],
        ],
      },
      {
        heading: "Getting paid",
        paragraphs: [
          [
            "Finish a job and it pays out immediately — real ",
            { text: "Credits", articleSlug: "credits-and-trading" },
            ", plus Welding XP for every section you completed. The moment it is done, a new job takes its place on the board, so there are always three to choose from.",
          ],
        ],
      },
      {
        heading: "Refining 5 and ForceSales",
        paragraphs: [
          [
            "Reach Refining level 5 and eight more jobs join the board's rotation, built around ",
            { text: "Galvanic Stock", articleSlug: "mining-and-refining" },
            " instead of Refined Ferrite. They go to the same eight clients you already know — Wade's yard has not found any new customers, just second jobs for the old ones.",
          ],
          "Refining 5 also switches on ForceSales Free's daily refresh: once a day, RuneSpace Pacific time, you can replace every unaccepted posting on the board at once. A job you already have on the bench is never touched by a refresh, and nothing about the board changes automatically — no reroll at midnight, no reroll for reaching Refining 5. It only moves when you finish a job or spend the day's refresh yourself.",
        ],
      },
    ],
  },
  {
    slug: "fabrication-and-tinkering",
    title: "Fabrication & Tinkering",
    category: "work",
    summary:
      "Making parts, containers and tools from processed stock at Rusk Recovery's Fabrication Station, the Manual Override control, and taking finished pieces apart again.",
    sections: [
      {
        paragraphs: [
          [
            "Fabrication is making the piece you need out of processed stock — a bracket, a container, a tool. It is its own skill with its own level, and it happens at the Fabrication Station in Wade Rusk's yard at Rusk Recovery, right beside his welding workshop. Tansy Rusk teaches it: after ",
            { text: "10,000 Hours", articleSlug: "mission-10000-hours" },
            " she comes out to the yard, and taking on her job opens the station.",
          ],
          "Once the station is open, the yard shows two work areas to choose between — the Welding Workshop, with the practice bench and the Work Orders terminal, and the Fabrication Station. Only the one you pick is laid out on screen; Wade and Tansy stay where they are either way.",
        ],
      },
      {
        heading: "What you can make",
        list: [
          "Mounting Bracket — 2 Refined Ferrite. 7.2 seconds, 25 Fabrication XP. Installation hardware; it stacks five to a slot.",
          [
            "Scrap Metal — 2 Refined Ferrite into 1 Scrap Metal. 6 seconds, 10 Fabrication XP. A way to make ",
            { text: "practice scrap", articleSlug: "practice-welding" },
            " yourself; it is not meant as training.",
          ],
          [
            "Scrap Box — 1 Mounting Bracket, 2 Scrap Metal and 3 Refined Ferrite. 21.6 seconds, 81 Fabrication XP. A crude, heavy container that adds three ",
            { text: "Inventory", articleSlug: "inventory-and-equipment" },
            " slots when you equip it as a container.",
          ],
          [
            "Salvage Cutter — 5 Refined Ferrite and 1 Power Cell. 12 seconds, 65 Fabrication XP. Another ordinary ",
            { text: "Salvage Cutter", articleSlug: "mining-and-refining" },
            ". The Power Cell goes into building it, so it comes off the machine uncharged like any Cutter.",
          ],
        ],
        paragraphs: [
          "These four need only Fabrication level 1. Fabricate lists what you can make right now with what you are carrying — plus any recipe a job is pointing you at, with what it is still missing. Recipes, beside it, lists every recipe you know, whether or not you have the materials. When a piece finishes, the station tells you what you made and the XP it paid.",
        ],
      },
      {
        heading: "Fabrication 5 and 8",
        paragraphs: [
          [
            "More recipes open as your Fabrication level rises — nothing else unlocks them. They use ",
            { text: "Galvanic Stock and Galvaferrite", articleSlug: "mining-and-refining" },
            ", but you do not need any Refining level of your own to use them: stock you bought or were given works just as well as stock you refined.",
          ],
        ],
        list: [
          "Scrap Metal from Galvanic Stock (Fabrication 5) — 1 Galvanic Stock into 2 Scrap Metal. 8.4 seconds, 15 Fabrication XP. Another way to make scrap, not meant as training.",
          "Galvanic Wire Spool (Fabrication 5) — 1 Galvanic Stock. 14.4 seconds, 45 Fabrication XP. Wiring for bigger builds; it weighs 1 kg and stacks only three to a slot.",
          [
            "Power Cells (Fabrication 5) — 1 Galvanic Stock into 2 ",
            { text: "Power Cells", articleSlug: "power-cells" },
            ". 18 seconds, 75 Fabrication XP. One batch always makes two ready-to-use cells, so the tile shows two however many batches you choose — four batches make eight.",
          ],
          [
            "Loadsteel Cutter (Fabrication 5) — 2 Galvaferrite, 1 Galvanic Wire Spool and 1 Power Cell. 27 seconds, 180 Fabrication XP. A second, faster ",
            { text: "Mining tool", articleSlug: "mining-and-refining" },
            " that needs Mining 5 to use. The Power Cell goes into building it, so it comes off the machine with no charge.",
          ],
          [
            "Wheel Assembly (Fabrication 5) — 3 Refined Ferrite, 1 Galvanic Stock and 1 Mounting Bracket. 21.6 seconds, 100 Fabrication XP. A rebuilt wheel for the ship's ",
            { text: "Landing Gear", articleSlug: "cargo-hold-and-welding" },
            "; it weighs 1.55 kg and stacks only two to a slot. You can sell, trade or hand one to somebody who never touched the station, and it works the same for them.",
          ],
          [
            "Drive Mount (Fabrication 8) — 2 Galvaferrite and 1 Galvanic Wire Spool. 28.8 seconds, 200 Fabrication XP. A reinforced powered mount that secures the ship's drive to its frame; you need two for the ship's ",
            { text: "Propulsion System", articleSlug: "cargo-hold-and-welding" },
            ". It weighs 2.9 kg and stacks only two to a slot. Nobody sells one, but you can trade one, and it works the same for somebody who never touched the station.",
          ],
          [
            "Freight Harness (Fabrication 8) — 4 Galvaferrite and 2 Mounting Brackets. 36 seconds, 270 Fabrication XP. An advanced container that adds six ",
            { text: "Inventory", articleSlug: "inventory-and-equipment" },
            " slots in either container attachment, at a hefty 9 kg.",
          ],
          [
            "Empty Small Fuel Canister (Fabrication 8) — 1 Galvanic Stock. 18 seconds, 75 Fabrication XP. One Stock makes one canister, never two. It weighs 800g and stacks five to a slot, and it is the shell the Processing Yard's Refining fills with fuel (see ",
            { text: "Fuel canisters", articleSlug: "mining-and-refining" },
            "). It cannot be taken apart again in Tinkering.",
          ],
          "Resonance Core (Fabrication 12) — 1 Runestone, 2 Galvaferrite and 1 Galvanic Wire Spool. 48 seconds, 400 Fabrication XP. A Runestone suspended in a wired Galvaferrite frame, built as the heart of a larger resonance system. It weighs 3.9 kg and stacks only two to a slot. Nobody sells one, but you can trade one, and it works the same for somebody who never touched the station.",
        ],
      },
      {
        heading: "Choosing a run",
        paragraphs: [
          "Pick how many batches to make before you start, the same way Refining and the practice bench work: it starts at one, and the minus and plus buttons change it up to as many as your materials pay for. The station shows what the whole run will take and give you — materials, pieces, time and Fabrication XP. Or press Max to keep going until the next piece cannot be started; Max shows what each batch takes, because how many it makes depends on what you have left as it goes.",
        ],
      },
      {
        heading: "Once a piece is on the machine",
        paragraphs: [
          "Starting a piece commits you to it. Its materials stay in your Inventory until it is finished — still counting toward your weight and slots — but they are set aside for it: you cannot drop them, sell them or use them for anything else, and you cannot walk away from the station until the piece is done. Only the piece on the machine sets anything aside; the materials for later batches are still yours until each one starts.",
          "When a piece finishes, its materials are used up and the finished piece lands in your Inventory at the same moment. Room for it is judged after its own materials are gone, so a full Inventory can still finish a piece whose materials free the slot it needs.",
          "There is no cancel. Stop After This Workpiece lets the piece on the machine finish and ends the run there. Closing the game or losing your connection changes nothing: the piece keeps going, and when you come back it is exactly where it would have been.",
        ],
      },
      {
        heading: "Manual Override",
        paragraphs: [
          "Fabrication never fails on its own. Manual Override is a control on the station for when you want to push your luck: switch it on and the piece on the machine gets a Load between 2 and 9, a Trend of Higher or Lower, and a multiplier on the Fabrication XP it will pay, starting at 1.00×.",
          "To push, pick a Feed from 1 to 10. The Load then moves in the direction the Trend showed — Higher lands anywhere above it up to 10, Lower anywhere below it down to 1 — and you do not know how far until it moves. A Feed within two of the new Load multiplies the XP by 1.20; a Feed exactly on it, by 1.30. Anything else wrecks the piece: its materials are gone, nothing is made, and it pays no XP.",
          "You can push up to five times on one piece, and the fifth locks it in on its own. Lock In whenever you are happy with the multiplier. If the timer is still running, the piece finishes normally at that multiplier; if it has already run out, it finishes straight away. There is no rush: a piece whose timer runs out while Manual Override is still working just holds on the machine until you decide. Switching Manual Override off locks in whatever you have earned so far, and the next piece starts at 1.00× again.",
        ],
      },
      {
        heading: "Tinkering",
        paragraphs: [
          "Tinkering is the other half of the station: taking a finished piece apart for Fabrication XP. Tansy shows it to you, and it is available from then on.",
          "Taking a piece apart pays its full Fabrication XP, takes twice as long as making it, and gives back Scrap Metal — one piece for every two things that went into making it, rounded up. It never gives back the original materials.",
        ],
        list: [
          "Salvage Cutter — 65 Fabrication XP, 24 seconds, 3 Scrap Metal.",
          "Scrap Box — 81 Fabrication XP, 43.2 seconds, 3 Scrap Metal.",
          "Mounting Bracket — 25 Fabrication XP, 14.4 seconds, 1 Scrap Metal.",
          "Galvanic Wire Spool (Fabrication 5) — 45 Fabrication XP, 28.8 seconds, 1 Scrap Metal.",
          "Power Cells (Fabrication 5) — a pair at a time, never one alone: 75 Fabrication XP, 36 seconds, 1 Scrap Metal.",
          "Loadsteel Cutter (Fabrication 5) — 180 Fabrication XP, 54 seconds, 2 Scrap Metal.",
          "Wheel Assembly (Fabrication 5) — 100 Fabrication XP, 43.2 seconds, 3 Scrap Metal.",
          "Drive Mount (Fabrication 8) — 200 Fabrication XP, 57.6 seconds, 2 Scrap Metal.",
          "Freight Harness (Fabrication 8) — 270 Fabrication XP, 72 seconds, 3 Scrap Metal.",
          "Resonance Core (Fabrication 12) — 400 Fabrication XP, 96 seconds, 2 Scrap Metal.",
        ],
      },
      {
        heading: "How Tinkering runs",
        paragraphs: [
          "Tinkering uses the same run control: a number of pieces, or Max until there is nothing left to take apart. Only pieces you are carrying and not wearing can be taken apart, and only those are listed — unequip something first if you want to Tinker it.",
          "The piece is gone the moment its Tinkering starts. Stop keeps that piece exactly where it was, and Resume carries on with it without taking another; walking away from the yard does the same. Finish Current Item finishes it — full XP and Scrap — and then stops.",
          "By default Tinkering keeps its Scrap, and a piece will not start if there is no room for the Scrap it gives back. Turn on Auto-discard Scrap to keep going regardless: the piece is still taken apart and still pays its XP, but the Scrap is thrown away. The setting stays until you change it.",
          "Tinkering will not take apart your last Mining Cutter you can use — Salvage or Loadsteel. Cutters you are wearing or have stored in the Cargo Hold count, so you can take one apart as long as you have another somewhere — otherwise make or get another Cutter first. A Loadsteel Cutter only counts once you are Mining 5, because before then you cannot mine with it.",
        ],
      },
    ],
  },
  {
    // Issue #391 — the fifth skill and its one station.
    slug: "runeworking",
    title: "Runeworking",
    category: "work",
    summary:
      "Attuning rune material at the Wise Old Enby's Resonance Rig on Hilltop Workshop, Stillreach — the Beginner Echo Seeker, how a run works, when the Rig opens, and hunting Resonance Echoes with Seekers.",
    sections: [
      {
        paragraphs: [
          [
            "Runeworking is attuning rune material into something useful. It is its own skill with its own level, starting at 1, and it happens at the Resonance Rig: the Wise Old Enby's own machine at Hilltop Workshop on Stillreach. The Rig sits below the Wise Old Enby themselves, and using it never means talking to them first.",
          ],
          [
            "The Rig opens once you have finished ",
            { text: "Not From Around Here", articleSlug: "mission-not-from-around-here" },
            " and stays yours from then on, whatever you do with ",
            {
              text: "Seeker? I Hardly Know Her!",
              articleSlug: "mission-first-runeworking-lesson",
            },
            ". Before that there is nothing to use there.",
          ],
        ],
      },
      {
        heading: "What you can attune",
        list: [
          [
            "Beginner Echo Seeker — 1 ",
            { text: "Rune Fragment", articleSlug: "mining-and-refining" },
            ". 20.4 seconds, 25 Runeworking XP, Runeworking 1. It always succeeds. It weighs 200g, the same as the Fragment it was made from, and stacks five to a slot.",
          ],
        ],
        paragraphs: [
          "A Beginner Echo Seeker is attuned to detect hidden disturbances in RuneSpace. Use one from your Inventory to hunt for a Resonance Echo (below).",
          "The Rig has two modes: Attune, where you start and watch a run, and Recipes, a list of every Runeworking recipe you know. A recipe stays listed in both even when you are not carrying what it needs, and in Attune, Sources beside its ingredient shows where to get more.",
        ],
      },
      {
        heading: "Runs",
        paragraphs: [
          "Choose how many to make with − and +, or Max to keep going until the next one cannot start. Each one is checked when it starts: that you still have the Rune Fragment, and that the finished Seeker will fit once the Fragment is gone — a part-full Seeker stack is topped up first. Max stops as soon as one of those runs out, however many that turns out to be.",
          "A started attunement is committed. Its Rune Fragment stays in your Inventory until it finishes, set aside for it, and you cannot walk away from the Rig until it is done. Only the attunement on the Rig sets anything aside; the Fragments for later ones are still yours until each one starts.",
          "When an attunement finishes, the Fragment is used up and the Seeker lands in your Inventory at the same moment, with its XP. There is no cancel: Stop After This Attunement lets the one on the Rig finish and ends the run there. Closing the game or losing your connection changes nothing; the Rig keeps going, and when you come back it is exactly where it would have been.",
        ],
      },
      {
        // Issue #393 — Beginner Resonance Echo hunts.
        heading: "Hunting Resonance Echoes",
        paragraphs: [
          [
            "Select a Beginner Echo Seeker in your Inventory and choose Use. You stand still for 4.8 seconds while it listens, and one Seeker is used up, whatever it finds. ",
            { text: "First Resonance Echo", articleSlug: "mission-first-resonance-echo" },
            " is the Wise Old Enby's lesson in it, but any Seeker you hold works, however you came by it.",
          ],
          "A Seeker searches the planet you are standing on. Skatboll and Stillreach each hide their own Echo, and each keeps its own search: your last reading there stays put while you are away. On Skatboll the Echo is somewhere among its ordinary places, never in Deep Jag; on Stillreach, anywhere on its map.",
          "If the Echo is not where you stand, the reading says which way it lies from that spot: east or west, and north or south, or due north (say) when you are already lined up. A wrong reading pays no XP. The Seeker's details show the planet you are searching and your last reading there, and whether the spot you are standing on now has been ruled out by it. Not ruled out does not mean the Echo is there.",
          "Finding the Echo pays 50 Runeworking XP and gives up one item, and your next reading on that planet starts a new search. Your very first reading on a planet can find it right where you are.",
          "Leave room before you look. The item is checked against your Inventory after the Seeker is used up, so the Seeker's own slot and weight count; if it still does not fit, it slips back into RuneSpace and is gone, though you keep the XP. The one exception is a Legendary: it is never lost, and is sent to FedHex for you to collect at the FedHex pickup at Holo Hollow Landing or Stillreach Landing Station.",
        ],
      },
      {
        heading: "What an Echo can give",
        paragraphs: ["Exactly one item per Echo, rolled from the planet you found it on:"],
        list: [
          "Skatboll: Rune Fragment 30%, Uncut Quartz 24%, Uncut Topaz 16%, Refined Ferrite 12%, Uncut Sapphire 10%, Galvanic Stock 5%, intact Runestone 2.8%, and a Legendary, Miner's Boots, at 0.2% (about one Echo in five hundred).",
          "Stillreach: Rune Fragment 30%, Uncut Quartz 26%, Uncut Topaz 20%, Uncut Sapphire 10%, Empty Small Fuel Canister 10%, intact Runestone 3.8%, and a Legendary, Miner's Gloves, at 0.2% (about one Echo in five hundred).",
        ],
      },
    ],
  },
  {
    slug: "missions",
    title: "Missions",
    category: "getting-started",
    summary:
      "How the Mission Log tracks your Missions, and a guide to each one: where it starts, what it needs, and what it pays.",
    sections: [
      {
        paragraphs: [
          "The Mission Log keeps track of every Mission you've accepted: what's left to do, what's ready to turn in, and what you've already finished. Each active Mission shows whether it's Active or ready to Turn in, and opening one leads with its Current Objective before the full list of what it needs, with your progress on each requirement.",
          "RuneSpace's Missions are not one straight list. There is a starter chain, branches that open up from it, Missions that wait on a skill level, and a few commissions that are genuinely optional. Every Mission below has its own guide covering where it starts, what it needs, what it pays and when. The order here is a reading order, not a requirement.",
        ],
      },
      {
        heading: "Getting Established",
        list: [
          [
            { text: "Walk It Off", articleSlug: "mission-walk-it-off" },
            " — reach The Jag and talk to Tansy Rusk. The first Mission, with nothing needed first; it hands you a Salvage Cutter.",
          ],
          [
            { text: "Cut Your Teeth", articleSlug: "mission-cut-your-teeth" },
            " — equip the Cutter, make five Mining attempts and show a full stack of Ferrite Shale. Starts by itself after Walk It Off.",
          ],
          [
            { text: "Waste Not", articleSlug: "mission-waste-not" },
            " — make five Refining attempts at the Abandoned Processing Yard, then report to Wade. Starts by itself after Cut Your Teeth.",
          ],
          [
            { text: "Hold It Together", articleSlug: "mission-hold-it-together" },
            " — repair the Cargo Hold at the Crash Site. Starts by itself after Waste Not.",
          ],
          [
            { text: "Keep the Change", articleSlug: "mission-keep-the-change" },
            " — Wade's apprenticeship Mission: meet Bix Weller and get three Power Cells to Tansy. Take it from Wade once Hold It Together is done.",
          ],
          [
            { text: "10,000 Hours", articleSlug: "mission-10000-hours" },
            " — three practice welds at Wade's Workbench in Rusk Recovery. Take it from Wade there after Keep the Change.",
          ],
        ],
      },
      {
        heading: "Learning Fabrication",
        list: [
          [
            { text: "Return the Favor", articleSlug: "mission-return-the-favor" },
            " — fabricate a Salvage Cutter and hand Tansy one. Take it from her at Rusk Recovery after 10,000 Hours.",
          ],
          [
            { text: "Break It Down", articleSlug: "mission-break-it-down" },
            " — Tinker one piece and tell Tansy. Starts by itself after Return the Favor.",
          ],
        ],
      },
      {
        heading: "Deep Jag & Ship Restoration",
        list: [
          [
            { text: "Brace Yourself", articleSlug: "mission-brace-yourself" },
            " — reopen the cave-in at Deep Jag. Offered by Tansy at The Jag after Break It Down, at Mining 5 and Welding 5. This is a progression Mission, not an optional one: it leads on to three others.",
          ],
          [
            { text: "Wheel Be Right Back", articleSlug: "mission-wheel-be-right-back" },
            " — rebuild the ship's landing gear. Take it from Wade at Rusk Recovery after Brace Yourself.",
          ],
          [
            { text: "Thrust Issues", articleSlug: "mission-thrust-issues" },
            " — repair the ship's drive. Take it from Wade after Wheel Be Right Back, at Welding 8.",
          ],
          [
            { text: "Move Along", articleSlug: "mission-move-along" },
            " — fly your repaired ship from the Crash Site to Holo Hollow Landing. Take it from Wade after Thrust Issues.",
          ],
        ],
      },
      {
        heading: "Other Jobs & Opportunities",
        list: [
          [
            { text: "10,001 Hours", articleSlug: "mission-10001-hours" },
            " — Wade's paying Work Orders, and not side work: it is how the board becomes yours. Needs 10,000 Hours and Welding 5, but not Return the Favor or Break It Down.",
          ],
          [
            { text: "Out of the Weather", articleSlug: "mission-out-of-the-weather" },
            " — optional. Renn Calder offers a Crew Stop repair after Hold It Together.",
          ],
          [
            { text: "A Cut Above", articleSlug: "mission-a-cut-above" },
            " — a separate advanced Fabrication Mission: show Tansy a Loadsteel Cutter. Needs Brace Yourself and Fabrication 5.",
          ],
          [
            { text: "Cutting Costs", articleSlug: "mission-cutting-costs" },
            " — optional. Renn pays 500 Credits for a Loadsteel Cutter once Brace Yourself is done. A Cut Above is not required.",
          ],
          [
            { text: "Curly Must-Stash", articleSlug: "mission-curly-must-stash" },
            " — an optional paid commission from Curly at HH B&B, once Keep the Change has opened the inn.",
          ],
        ],
      },
      {
        heading: "A Mystery in the Rock",
        list: [
          [
            { text: "Not From Around Here", articleSlug: "mission-not-from-around-here" },
            " — offered by a Rune Fragment or intact Runestone you carry (through Inventory Inspect), or in person by the Wise Old Enby on Stillreach (Show strange mineral). Ask around about it on Skatboll, or go straight to the Wise Old Enby at Hilltop Workshop on Stillreach, who finishes it. Nothing is needed first, and it pays nothing.",
          ],
          [
            { text: "Seeker? I Hardly Know Her!", articleSlug: "mission-first-runeworking-lesson" },
            " — starts by itself when you finish Not From Around Here (or ask the Wise Old Enby for it if you finished that before the lesson existed). Attune three Beginner Echo Seekers at the Resonance Rig and return to them for 150 Runeworking XP.",
          ],
          [
            { text: "First Resonance Echo", articleSlug: "mission-first-resonance-echo" },
            " — starts by itself when you complete Seeker? I Hardly Know Her!, with two Seekers from the Wise Old Enby if you have room for them (otherwise ask them for it once you do). Find one Resonance Echo on either planet and return to them for 300 Runeworking XP.",
          ],
        ],
      },
      {
        heading: "Werner’s supervised lessons",
        list: [
          [
            { text: "They're Minerals, Marie!", articleSlug: "mission-theyre-minerals-marie" },
            " — speak to Werner at Werner’s Lab. Complete the two supervised lessons and their required conversations to unlock unrestricted Lapidary workbench use, with 150 Lapidary XP at graduation.",
          ],
        ],
      },
      {
        heading: "How Missions Connect",
        list: [
          "The starter chain runs from Walk It Off to Hold It Together, then through Keep the Change to 10,000 Hours.",
          "After Hold It Together, Out of the Weather is open to you whether or not you have started Keep the Change.",
          "10,000 Hours leads in two independent directions. One is Tansy's Fabrication chapter — Return the Favor, then Break It Down, then Brace Yourself and what it opens. The other is 10,001 Hours and the Work Orders board. Neither needs the other.",
          "Brace Yourself opens three Missions: Wheel Be Right Back, which leads on to Thrust Issues, plus A Cut Above and Cutting Costs.",
          "Not From Around Here stands apart from all of them: it needs no earlier Mission, and the Rune Fragment you carry offers it. Finishing it hands you Seeker? I Hardly Know Her!, and finishing that hands you First Resonance Echo.",
        ],
      },
      {
        heading: "Starting and Completing Missions",
        paragraphs: [
          "Some Missions start by themselves: finishing one hands you the next, and there's nothing extra to accept. Everything else you take from the person who offers it — walk to them, talk to them, and choose the Mission from their list. A Mission that waits on a skill level isn't offered until you've reached it.",
          "Objectives update live as you meet them. When every objective on a Mission is met, talk to the person named in it to turn it in.",
          "Rewards and unlocks arrive at different points, depending on the Mission. Some hand you Credits or materials the moment you accept; some pay XP as you do the work itself; some pay out when you turn them in; and some open something up once the work is done. A few pay nothing at turn-in: Keep the Change's Credits come when you accept it, and Thrust Issues' only reward is the Welding XP from the repair itself. Each guide says what arrives when.",
        ],
      },
      {
        heading: "Pinning Missions",
        paragraphs: [
          "Every Mission you accept starts pinned: it gets its own strip at the top of the screen, on the Map and while travelling too — green while there's still work to do, blue once it's ready to hand in — and the Mission Log keeps the full checklist. Tap the pin on a strip to unpin it when you don't need to see it for a while: the strip and the Mission's green and blue highlights on the Map and around the game go quiet together. The Mission stays accepted and keeps counting your progress, and everything you'd normally do (talking to people, the Map, handing it in) still works. Highlights for Missions you haven't taken yet stay on, and if another pinned Mission points at the same place it stays lit. Pin it back from the Mission Log at any time.",
        ],
      },
      {
        heading: "Following Mission Objectives",
        paragraphs: [
          "Once you've accepted a Mission, green and blue highlights point you toward whatever's next, wherever that actually is — the place on the Map, a building's Enter, a person, a piece of equipment, or an action control.",
          "Green means work still to do: the destination on the Map, a building's Enter once you've arrived, the person to talk to, the equipment to equip, or the action to start. Blue means a conversation — either someone has a new Mission for you, or a finished Mission is ready to hand in. The moment every objective on a Mission is met, it turns blue: the person you hand it in to lights up blue instead of green, and the Map labels their location TURN IN in plain text, even before you've arrived there. An accepted Mission's own destination is labeled MISSION the same way.",
          "If that destination is scrolled out of view, the arrow at the edge of the Map pointing toward it turns green or blue to match, and goes back to normal once the place is on screen. A Mission someone is only offering never lights up the Map.",
          "When a Mission can be finished more than one legitimate way — three Power Cells can come from your Inventory, the Annex, or Bix's shelf — nothing gets highlighted for that step. It's your call.",
        ],
      },
      {
        heading: "Talking to people",
        paragraphs: [
          "Talk opens a list of the conversations you can have with that person right now, rather than a single fixed exchange.",
        ],
        list: [
          "Anything tied to a Mission comes first, marked Available, Active, Turn in, or Completed. Available and Turn in are highlighted the same way they are out in the world.",
          "Below that, Talk about lists subjects you can bring up any time. They're always replayable, and a few only appear once you've finished the work that would make the two of you talk about them.",
          "Back on the first line of a conversation, and Finish at the end, both return you to that person's list. Close leaves the conversation entirely.",
        ],
      },
    ],
  },
  ...missionGuideArticles,
  {
    slug: "holo-hollow",
    title: "Holo Hollow",
    category: "places-and-travel",
    summary:
      "The seven connected locations that make up the current playable world, the town itself, and who you'll meet there.",
    sections: [
      {
        paragraphs: [
          [
            "Holo Hollow is the wrecked stretch of ground you're stranded in, and also the name of the settlement at the middle of it. It currently has seven connected locations — see ",
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
            "DeWhat? Emergency Power Annex — an automated public depot, left over from the tourism years, that still hands out ",
            { text: "Power Cells", articleSlug: "power-cells" },
            " every day.",
          ],
          "The Long Scramble — a steep, barren stretch of fractured stone with nothing to stop for. It's just the way through to The Jag.",
          [
            "The Jag — an exposed ferrite seam, home to ",
            { text: "Ferrite Shale Mining", articleSlug: "mining-and-refining" },
            " and Tansy Rusk.",
          ],
          [
            "Holo Hollow — the town itself, a declining mining settlement built on the remains of a holo-tourism economy. It connects to the Crash Site, the Power Annex, The Long Scramble, and Rusk Recovery, and it's where you can ",
            { text: "spend Credits", articleSlug: "credits-and-trading" },
            ".",
          ],
          [
            "Rusk Recovery — Wade Rusk's recovery yard on the northwest edge of town: racked salvage, stripped components, damaged work vehicles, and a workbench you can ",
            { text: "practise Welding", articleSlug: "practice-welding" },
            " at once he puts you on it.",
          ],
        ],
      },
      {
        heading: "In town",
        paragraphs: [
          "Standing in Holo Hollow, you can step into the places that are open. Going inside is instant: it isn't a journey, it doesn't interrupt anything, and the map still shows you in Holo Hollow. Inside, the Back to Holo Hollow button under the description takes you straight back out to the town.",
        ],
        list: [
          [
            "Holo Hollow Souvenirs + Mining Supplies — Bix Weller's shop, where you can ",
            { text: "buy and sell", articleSlug: "credits-and-trading" },
            ".",
          ],
          "Holo Hollow Community Assistance Center — the old Visitor Center, now handling local assistance and rations. Renn Calder is usually here.",
          [
            "Crew Stop — a covered roadside shelter on the haul road where the mining crews wait for the shift hauler out to The Jag. It starts out falling apart; you can ",
            { text: "repair it", articleSlug: "mission-out-of-the-weather" },
            " with ",
            { text: "Welding", articleSlug: "cargo-hold-and-welding" },
            ", and afterwards the crews will give you a ",
            { text: "ride", articleSlug: "travel-and-scavenging" },
            ".",
          ],
          [
            "HH B&B — a family bed-and-breakfast from the tourism years, now the town's working inn. Its rooms are held for locals and regular working crews, so the door stays shut to you until you've finished ",
            { text: "Keep the Change", articleSlug: "mission-keep-the-change" },
            " and the town knows who you are.",
          ],
        ],
      },
      {
        heading: "Who's here",
        paragraphs: [
          [
            { text: "Wade Rusk", articleSlug: "wade-rusk" },
            ", who runs recovery and salvage, is at the Crash Site to begin with and at his own yard at Rusk Recovery once you finish ",
            { text: "Keep the Change", articleSlug: "mission-keep-the-change" },
            ". His niece ",
            { text: "Tansy Rusk", articleSlug: "tansy-rusk" },
            ", a field mechanic and miner, is based out at The Jag, though after ",
            { text: "10,000 Hours", articleSlug: "mission-10000-hours" },
            " she spends a while at Rusk Recovery teaching ",
            { text: "Fabrication", articleSlug: "fabrication-and-tinkering" },
            ".",
          ],
          [
            "In town, ",
            { text: "Bix Weller", articleSlug: "bix-weller" },
            " runs the souvenir and mining-supply shop, and ",
            { text: "Renn Calder", articleSlug: "renn-calder" },
            ", a ferrite miner, is usually at the Community Assistance Center. ",
            { text: "Mara Kells", articleSlug: "mara-kells" },
            " owns the HH B&B, and you'll meet her in town before its door is open to you. Once you're inside, you'll also find one of her guests, ",
            { text: "Curly", articleSlug: "curly" },
            ", an offworld backpacker.",
          ],
          "Each of them is only there when you're actually inside their building — you won't find them standing in the street. Other player characters can also be around.",
          "This is an early, playable build — check the Updates page for what's new in Holo Hollow.",
        ],
      },
    ],
  },
  {
    slug: "skills-and-progression",
    title: "Skills & Progression",
    category: "getting-started",
    summary:
      "How Mining, Refining, Welding, Fabrication, Runeworking, and Lapidary track your progress, what your Character Level means, and what leveling up gets you.",
    sections: [
      {
        paragraphs: [
          "Six skills currently track your progress: Mining, Refining, Welding, Fabrication, Runeworking, and Lapidary. Each has its own experience (XP) total and level, earned separately.",
        ],
      },
      {
        heading: "Your Character screen",
        paragraphs: [
          "Character, on the far left of the bottom bar (a tab in the right-hand sidebar on a wide screen), is the character you're currently playing. It shows your portrait and name, your Character Level, your Credits, and every skill in the game with its current level and how far you are through that level.",
          "Switch Character is always there at the bottom of that screen, however long the skill list gets, and takes you to the same character selection you already use.",
        ],
      },
      {
        heading: "Character Level",
        paragraphs: [
          "Your Character Level is a single number for everything you've trained. You start at Level 1, and every skill level you earn adds one to it.",
          "So a character with Mining 4, Refining 2 and Welding 1 is Character Level 5: three levels earned in Mining, one in Refining, and none yet in Welding. A brand-new character with every skill at Level 1 is Character Level 1.",
          "Skills start at Level 1, so a skill you've never touched adds nothing. That also means adding a new skill to RuneSpace won't change anyone's Character Level until they actually train it. There's no separate Character XP to earn — the number simply follows your skills.",
        ],
      },
      {
        heading: "How you earn XP",
        list: [
          "Mining — a successful Mining attempt at The Jag grants Mining XP.",
          [
            "Lapidary — finished Stone shaping and Quartz cutting at Werner’s ",
            { text: "Lapidary Workbench", articleSlug: "lapidary" },
            " grant Lapidary XP. Both always succeed.",
          ],
          "Refining — a Refining attempt at the Abandoned Processing Yard grants Refining XP, whether it succeeds or not.",
          "Welding — each completed welding pass grants Welding XP, whether you are repairing the Cargo Hold, the Landing Gear, the Propulsion System or the Crew Stop, building a Stash Mount, or practising at Wade's workbench. A practice pass pays a reduced share, because nothing is actually being repaired.",
          [
            "Fabrication — each finished piece at the ",
            { text: "Fabrication Station", articleSlug: "fabrication-and-tinkering" },
            " grants Fabrication XP, more if you pushed it with Manual Override, and taking a finished piece apart by Tinkering grants the same XP making it did. A piece wrecked by Manual Override grants none.",
          ],
          [
            "Runeworking — each finished attunement at the ",
            { text: "Resonance Rig", articleSlug: "runeworking" },
            " grants Runeworking XP. Runeworking never fails.",
          ],
        ],
      },
      {
        heading: "Mission rewards",
        paragraphs: [
          [
            "Some missions also grant skill XP when you complete them: ",
            { text: "Cut Your Teeth", articleSlug: "mission-cut-your-teeth" },
            " grants +100 Mining XP, ",
            { text: "Waste Not", articleSlug: "mission-waste-not" },
            " grants +100 Refining XP, ",
            { text: "Hold It Together", articleSlug: "mission-hold-it-together" },
            " grants +100 Welding XP, and ",
            { text: "Out of the Weather", articleSlug: "mission-out-of-the-weather" },
            " grants +250 Welding XP on top of what the welding itself paid. ",
            { text: "Return the Favor", articleSlug: "mission-return-the-favor" },
            " grants +100 Fabrication XP, ",
            { text: "Break It Down", articleSlug: "mission-break-it-down" },
            " +250, and ",
            { text: "A Cut Above", articleSlug: "mission-a-cut-above" },
            " +500. Not every mission pays in XP — ",
            { text: "10,000 Hours", articleSlug: "mission-10000-hours" },
            " pays 50 Credits instead, because its practice welds already earned their own Welding XP as you did them. ",
            { text: "Seeker? I Hardly Know Her!", articleSlug: "mission-first-runeworking-lesson" },
            " grants +150 Runeworking XP. Renn pays 500 Credits for the Loadsteel Cutter in ",
            { text: "Cutting Costs", articleSlug: "mission-cutting-costs" },
            ", and Curly pays 150 Credits when you take on ",
            { text: "Curly Must-Stash", articleSlug: "mission-curly-must-stash" },
            " and 150 more when it's done.",
          ],
        ],
      },
      {
        heading: "What leveling up does",
        paragraphs: [
          "Higher Mining and Refining levels raise your chance of success on each attempt, up to a level where success is guaranteed. Levels have a cap, and every skill shows its current level and XP right where you use it — Mining at The Jag, Refining at the Processing Yard, and Welding at the Workbench, the Cargo Hold repair, and the Crew Stop repair. The Character screen shows all of them in one place, whichever one you're standing next to.",
          "Some Refining and Fabrication recipes need a certain level. When you reach a level that unlocks one or more of them, a message from System arrives in the Whispers tab of the Chat/Social panel, listing every recipe that just unlocked — including any you passed on the way, if one big reward carried you up several levels at once. System is pinned at the top of your Whispers and lights the Chat/Social button until you read it. It's RuneSpace itself, not a player, so you can't reply to it, block it, or report it, and no player or character can be named System.",
        ],
      },
    ],
  },
  {
    slug: "wade-rusk",
    title: "Wade Rusk",
    category: "people",
    summary:
      "The recovery and salvage man who meets you at the wreck, decides you are his apprentice, and teaches you to weld.",
    sections: [
      {
        paragraphs: [
          "Wade Rusk does recovery, salvage and field repairs. His own summary is shorter: if something around here quits moving, he either makes it move again or sells the parts that still do.",
          "He is the first person you meet after the crash, and he is not thrilled about it. You came down on what he describes as the nicest salvage claim Holo Hollow had seen in years, and then climbed out of it alive. He mentions this. He goes on mentioning it, and has said outright that he does not intend to stop.",
        ],
      },
      {
        heading: "Where to find him",
        paragraphs: [
          [
            "To begin with, Wade is at the Crash Site, standing over your ship and revising his estimate downward. Once you finish ",
            { text: "Keep the Change", articleSlug: "mission-keep-the-change" },
            " he goes back to running his own yard at Rusk Recovery on the northwest edge of town, and that is where you will find him from then on.",
          ],
        ],
      },
      {
        heading: "Working for him",
        paragraphs: [
          [
            "Wade hands out most of the early ",
            { text: "jobs", articleSlug: "missions" },
            ", starting by sending you to his niece ",
            { text: "Tansy Rusk", articleSlug: "tansy-rusk" },
            " out at The Jag. Once the Cargo Hold is holding he decides you are his apprentice — not a question, and not much of a ceremony either. By his account it mostly means you get the jobs he would rather not do twice.",
          ],
          [
            "He is the one who teaches you ",
            { text: "Welding", articleSlug: "cargo-hold-and-welding" },
            ", and he is deliberate about what he will let you put a torch to. People bring him things they cannot afford to lose twice, so you spend a long time on his own scrap before you go anywhere near anybody else's property.",
          ],
          [
            "Once you have finished Brace Yourself, he has a ship job for you too: ",
            { text: "Wheel Be Right Back", articleSlug: "mission-wheel-be-right-back" },
            ", rebuilding the landing gear at the Crash Site. He will not tell you where to get the parts, only what you need.",
          ],
          [
            "Once you have finished that and you are a good enough welder, he has the last ship job for you: ",
            { text: "Thrust Issues", articleSlug: "mission-thrust-issues" },
            ", fixing the drive. He is no more sentimental about the ship than he ever was. Once it is fixed, he says, you are on your own: he is done holding your hand.",
          ],
          [
            "When the drive is fixed and you have reported it, he has one more thing for you to take on: ",
            { text: "Move Along", articleSlug: "mission-move-along" },
            ", flying the ship over to Holo Hollow Landing. You take it from him yourself; it does not start on its own. Once the ship has landed he has a short line about it, and then he is done.",
          ],
          [
            "Get good enough and that changes. Once you can weld at a real level, Wade puts you on his ",
            { text: "Work Orders", articleSlug: "work-orders" },
            " board — paying jobs, off his own terminal, that stay yours to work whenever one is posted.",
          ],
        ],
      },
      {
        heading: "At the yard",
        paragraphs: [
          [
            "Rusk Recovery is racked salvage, stripped components, damaged work vehicles waiting their turn, and a workbench somebody genuinely uses — messy, and organised by a man who knows exactly where everything is. You can ",
            { text: "practise Welding", articleSlug: "practice-welding" },
            " there for as long as you have scrap, and he sells the scrap at four Credits a piece, the same as he would charge anybody.",
          ],
        ],
      },
      {
        heading: "Talking to him",
        paragraphs: [
          "Ask him about recovery work and you get the nearest thing he has to a philosophy: most of it is patience, a wreck will eventually tell you which half of it is still worth something, and he does not build anything from scratch — he makes what is already lying around work again, or work as something else.",
          "Praise is rationed. Do a job properly and he will acknowledge it in about eight words and then move on to the next thing.",
        ],
      },
    ],
  },
  {
    slug: "tansy-rusk",
    title: "Tansy Rusk",
    category: "people",
    summary:
      "Wade's niece, the field mechanic working the seam at The Jag, and the person who hands you your first real tool.",
    sections: [
      {
        paragraphs: [
          "Tansy Rusk works the ferrite seam at The Jag, out past The Long Scramble. She is a field mechanic first and a miner second, and the difference shows — she is at her happiest explaining why something works.",
          "She is Wade Rusk's niece, and she reads him fluently. When he is being impossible, she translates. When he is quietly pleased with you and has no intention of saying so, she says it for him.",
        ],
      },
      {
        heading: "The Salvage Cutter",
        paragraphs: [
          [
            "The tool the whole early game runs on is hers. She built it out of spare parts and stubbornness and is entirely cheerful about its faults: nothing matches, it is not very fast, and she suspects half of it violates a regulation ",
            { text: "Wade", articleSlug: "wade-rusk" },
            " already hates. It cuts shale perfectly well.",
          ],
          "It comes with the only safety briefing you are going to get, which is to keep your fingers out of the moving bits and avoid pointing the hot end at anything you are emotionally attached to.",
        ],
      },
      {
        heading: "What she teaches",
        paragraphs: [
          [
            "Tansy runs the part of your education that keeps everything else supplied: ",
            { text: "Mining at The Jag, and the Refining", articleSlug: "mining-and-refining" },
            " that turns what you pull out of the hardpan into something Wade can actually work with.",
          ],
          "She is unbothered by failure and expects you to be too. Some days the shale comes out clean, some days you swing eleven times for nothing, and she will point out that this is you rather than the tool — the more you work it, the more often it bites.",
        ],
      },
      {
        heading: "Out at the seam",
        paragraphs: [
          [
            "The Jag is a seam, not a mine, and Tansy would like that distinction observed. Whoever got here first carved it out of the hardpan; calling it a mine is generous. Her Cutter runs on ",
            { text: "Power Cells", articleSlug: "power-cells" },
            " like yours does, and running dry at the far end of a shift is a real problem out there — a dead Cutter, in her words, is a very heavy stick.",
          ],
        ],
      },
      {
        heading: "The workings below",
        paragraphs: [
          [
            "Below the seam is Deep Jag, closed since the roof came down long before you arrived. Tansy has known about it the whole time and has never mentioned it, because there was nothing to mention until somebody could actually help her reopen it. Once you can, she offers ",
            { text: "Brace Yourself", articleSlug: "mission-brace-yourself" },
            ": she brings the brace and the jack, you bring the stock and the torch.",
          ],
          "It is the closest she comes to asking for something for herself, and she does it in the same flat way she explains a tool — the work is what matters, and she assumes you already know that.",
        ],
      },
    ],
  },
  {
    slug: "bix-weller",
    title: "Bix Weller",
    category: "people",
    summary:
      "The man behind the counter at Holo Hollow Souvenirs + Mining Supplies, and the best-informed person in town.",
    sections: [
      {
        paragraphs: [
          "Bix Weller runs Holo Hollow Souvenirs + Mining Supplies, which is one shop with two names and a firm opinion about which of them counts.",
          "His parents opened it when people still came to Holo Hollow on purpose, and filled it with shirts, mugs and little projector toys — anything a child could talk a parent into buying on the way home. Bix grew up in it and took it over. The original Souvenirs sign is still up; the + Mining Supplies board is bolted on underneath, rougher and newer. That is the shop's entire history in one piece of signage.",
          "He still stocks the souvenirs. They do not move. The mining gear does. He does not accept that this makes it a mining store.",
        ],
      },
      {
        heading: "Over the counter",
        paragraphs: [
          [
            "Bix sells Power Cells, and buys Ferrite Shale, Refined Ferrite, Slag, any uncut gemstones you have mined, and any spare cells you are carrying — see ",
            { text: "Credits & Trading", articleSlug: "credits-and-trading" },
            " for what each is worth. Talking to him and trading with him are separate things, and you can do either without the other.",
          ],
        ],
      },
      {
        heading: "Ask him about Power Cells",
        paragraphs: [
          [
            "Bix will talk you out of a sale. Before you spend anything he will point out that the ",
            { text: "DeWhat? Emergency Power Annex", articleSlug: "power-cells" },
            " up the road issues five cells a day to anyone who walks up, for nothing.",
          ],
          "He also knows why, which is more than most of the town does. Back when projector nights filled every room out here, Settled Systems required a public emergency power depot; DeWhat? won the contract and installed it; the tourists left and the contract did not. He will sell you a cell anyway, and explain the arithmetic without being asked — five a day for him and five a day for you is not what stocks a shop.",
        ],
      },
      {
        heading: "Ask him about the town",
        paragraphs: [
          [
            "He remembers ",
            { text: "Holo Hollow", articleSlug: "holo-hollow" },
            " busy. Whole families, projector nights, full rooms, children trying to spend every Credit they had before their parents got them back into the speeder. Then the new releases stopped working here, and everybody discovered somewhere else to be.",
          ],
          "He is dry about all of it rather than bitter, and he is one of the few people out here who will give you a straight answer even when a vaguer one would make him money.",
        ],
      },
    ],
  },
  {
    slug: "renn-calder",
    title: "Renn Calder",
    category: "people",
    summary:
      "A ferrite miner at the Community Assistance Center, and the most clear-eyed person in Holo Hollow.",
    sections: [
      {
        paragraphs: [
          "Renn Calder mines ferrite and has no illusions about it. It is rock — useful rock, for exactly as long as somebody still wants enough of it.",
          "You will usually find him at the Holo Hollow Community Assistance Center, which used to be the Visitor Center and now handles local assistance and ration distribution. The old lettering is still legible underneath the newer signage, which is true of a lot of things around here.",
        ],
      },
      {
        heading: "What he makes of the place",
        paragraphs: [
          [
            "Renn is the youngest of the people you will meet in ",
            { text: "Holo Hollow", articleSlug: "holo-hollow" },
            " and the least interested in the story the town tells about itself. Every year, he will tell you, somebody says ferrite demand is about to turn around — and every year that turns into one more reason to wait one more year.",
          ],
          "He is not sneering at anyone for staying. He knows everybody here, he knows which roof leaks, and he knows exactly who turns out at two in the morning when something breaks. That is the point, as far as he is concerned: if he hated the place, leaving would be easy. Caring about somewhere does not mean you owe it your whole life, and staying can be loyalty or it can be fear, and those are not the same thing.",
        ],
      },
      {
        heading: "The Assistance Center",
        paragraphs: [
          "Ask him about the building and you get the one subject he is firm about. It used to be brochures, maps, and somebody behind a counter telling tourists what they absolutely could not leave without seeing. Now it is forms, notices, stacked ration crates, and whoever needs a hand that week.",
          "People talk about needing the place as though it were embarrassing. Renn does not think it is, and he will say so plainly.",
          "He also notices the things around town that everyone else has stopped seeing, and he will mention them — not as a request, and not expecting anybody to do anything about it. Just as a fact about the place.",
        ],
      },
    ],
  },
  {
    slug: "mara-kells",
    title: "Mara Kells",
    category: "people",
    summary:
      "The owner of HH B&B, who stopped waiting for the tourists and turned the family business into the inn the town actually needed.",
    sections: [
      {
        paragraphs: [
          "Mara Kells owns HH B&B, the bed-and-breakfast her parents ran back when families drove out to Holo Hollow to watch a projector show. Every room in it was decorated for them.",
          "The tourists stopped coming. The rooms did not stop existing. So Mara stopped waiting and made it what the town actually needed — a working inn for miners, haulers, contractors and anyone out here on a long stretch of work. Same beds, as she puts it. Fewer complaints about the pillows.",
          "She is warm first and direct second, usually in the same breath: she will tease you thoroughly and then tell you exactly what you ought to go and do next.",
        ],
      },
      {
        heading: "Getting through the door",
        paragraphs: [
          [
            "The rooms are held for locals and regular working crews rather than passing guests, so the B&B is shut to you at first. You meet Mara well before you get inside — she comes into ",
            { text: "Bix's shop", articleSlug: "bix-weller" },
            " while you are running an errand for Wade, takes one look at the arrangement, and concludes that you might not be a tourist any more.",
          ],
          [
            "Finish ",
            { text: "Keep the Change", articleSlug: "mission-keep-the-change" },
            " and the door is open to you.",
          ],
        ],
      },
      {
        heading: "Her and Bix",
        paragraphs: [
          [
            "Mara and ",
            { text: "Bix Weller", articleSlug: "bix-weller" },
            " have known each other since they were children running between their two buildings, and it shows in about four seconds of conversation.",
          ],
          "She is the practical half of that pair. It was never the business her parents built — she is clear about that — but it is the one this town needed, and she would rather run that than keep a museum.",
        ],
      },
    ],
  },
  {
    // Issue #292 — written only from the Public-Wiki-safe facts on Curly's
    // Notion Canon page.
    slug: "curly",
    title: "Curly",
    category: "people",
    summary:
      "A young offworld backpacker staying at HH B&B, who travels to see how people live on other planets — with rather more luggage than that requires.",
    sections: [
      {
        paragraphs: [
          [
            "Curly is a young adult backpacker from offworld, staying at the HH B&B in ",
            { text: "Holo Hollow", articleSlug: "holo-hollow" },
            ". He is travelling to experience how people live on other planets, and he is enthusiastic, outgoing and genuinely generous about it.",
          ],
          "He also overpacks, magnificently, and has an endearingly oblivious relationship with his own privilege. What fascinates him most about Holo Hollow is that people here make and repair things for themselves.",
        ],
      },
      {
        heading: "Finding him",
        paragraphs: [
          [
            "Curly is his own contact inside the HH B&B, alongside ",
            { text: "Mara Kells", articleSlug: "mara-kells" },
            ", so you can talk to him once ",
            { text: "Keep the Change", articleSlug: "mission-keep-the-change" },
            " has opened the B&B to you.",
          ],
        ],
      },
      {
        heading: "Curly Must-Stash",
        paragraphs: [
          [
            "His first optional job, ",
            { text: "Curly Must-Stash", articleSlug: "mission-curly-must-stash" },
            ", is to build a mount for the MYKEA SCHLEPPRAUM-8 he already owns, so it has somewhere to go in his room. It needs ",
            { text: "Welding", articleSlug: "cargo-hold-and-welding" },
            " level 1, and its guide has the details.",
          ],
        ],
      },
    ],
  },
  {
    // Issue #389 — written only from the Public-Wiki-safe facts on the Wise Old
    // Enby's Notion Canon page: name, appearance, nonbinary identity, and role.
    slug: "the-wise-old-enby",
    title: "The Wise Old Enby",
    category: "people",
    summary:
      "A researcher who lives and works at Hilltop Workshop on Stillreach, and who knows far more about unusual minerals than they first let on.",
    sections: [
      {
        paragraphs: [
          "The Wise Old Enby is a researcher at Hilltop Workshop, on the planet Stillreach. They are nonbinary, and they go by they and them.",
          "You will know them by the blue party hat, the long white hair and braided beard, the amber goggles, and a well-worn staff that is as much equipment as walking stick. They came to the hill following something odd in the ground, and stayed.",
        ],
      },
      {
        heading: "Finding them",
        paragraphs: [
          [
            "Hilltop Workshop is two walks from Stillreach Landing Station, by way of Windward Track (see ",
            { text: "Flying the Rivet to Stillreach", articleSlug: "travel-and-scavenging" },
            "). Anyone who reaches it can talk to them about the workshop and about Stillreach; no Mission or item is needed.",
          ],
        ],
      },
      {
        heading: "The unusual mineral",
        paragraphs: [
          [
            "They are the person ",
            { text: "Not From Around Here", articleSlug: "mission-not-from-around-here" },
            " leads to. Bring them a Rune Fragment or an intact Runestone and they can tell you what it is; afterwards, About RuneSpace and Where to Find Fragments are things you can ask them about again whenever you like.",
          ],
        ],
      },
      {
        heading: "The Resonance Rig",
        paragraphs: [
          [
            "Once they have explained RuneSpace, their Resonance Rig is yours to use, and they teach you ",
            { text: "Runeworking", articleSlug: "runeworking" },
            " in ",
            {
              text: "Seeker? I Hardly Know Her!",
              articleSlug: "mission-first-runeworking-lesson",
            },
            ", then send you looking for your first Resonance Echo in ",
            { text: "First Resonance Echo", articleSlug: "mission-first-resonance-echo" },
            ". You can hear each lesson again — First lesson, and How to Listen — and once they are done, About the Seekers and About Resonance Echoes.",
          ],
        ],
      },
      {
        heading: "Research Jobs",
        paragraphs: [
          "Talk to them and choose Research Jobs for repeatable work. They keep one research job going at a time per character; story missions are separate and never blocked. Each job lends you one item that takes a normal Inventory slot and its real weight, so you need room for it. You cannot sell, trade, store, stash or drop a loaned item, and none of these jobs pays any XP. To give a job up, choose Abandon Assignment in its Mission Log entry, from anywhere, or choose Destroy on the loaned item in your Inventory and confirm: either way you lose its progress and the loaned item, and nothing is paid. Once the Courier packet has been handed to FedHex there is nothing left to destroy, so use Abandon Assignment.",
          [
            "Research Courier lends a 2 kg Sealed Research Packet. Carry it to the FedHex terminal at Stillreach Landing Station (see ",
            { text: "Credits & Trading", articleSlug: "credits-and-trading" },
            "), choose Deliver Research Packet, then return to them to collect 25 Credits.",
          ],
          "Geological Field Survey lends a 0.1 kg Geological Sample Case. Collect one surface sample at each of Prospecting Quarry, The Dry Seam and Harmonic Workings, in any order, at eight game ticks (4.8 seconds) apiece, then return to collect 75 Credits. It is not Mining and needs no tool or skill.",
          "Resonance Calibration opens once they have explained RuneSpace. It lends a 0.1 kg Resonance Sampler: record a signature at The Low Hum (also eight ticks), then return to them and hear them out. They can then open a passage to Crash Site on Skatboll. Nothing happens until you confirm Teleport Now; Not Yet keeps your sampler and the job. You and what you carry make the trip, but your Rivet, its fuel and your Cargo Hold stay where they are parked. It costs no Credits and pays no XP.",
        ],
      },
    ],
  },
  {
    // Issue #248 — the locked Chat & Community Rules copy from planning #226.
    // Keep its casual, human tone; do not rewrite it into legal or HR voice.
    slug: COMMUNITY_RULES_SLUG,
    title: "Chat & Community Rules",
    category: "community",
    summary:
      "Argue, trash talk, swear at the RNG. Don't attack people for who they are, harass them, threaten them, creep on them, or scam them.",
    sections: [
      {
        paragraphs: [
          "RuneSpace is supposed to be a place where people can hang out, trade, argue about dumb stuff, swear occasionally, and generally act like humans.",
          "You do not have to be endlessly polite. You can disagree with people. You can talk trash. You can tell somebody their idea is terrible.",
          "Just don't make the game miserable for other people.",
        ],
      },
      {
        heading: "Don't target people for who they are",
        paragraphs: [
          "Don't attack someone because of their race, ethnicity, nationality, sex, gender identity, sexual orientation, disability, religion, faith, or similar parts of their identity.",
          "Aside from being harmful, it's also just lazy.",
          "If you're going to give someone shit, at least give them shit for something they actually said, did, or believe. Their terrible trade offer is fair game. Their outdated worldview is fair game. Who they are isn't.",
          "You can disagree with religions, beliefs, politics, opinions, or ideas. You cannot use that disagreement as an excuse to harass or demean the people who hold them.",
        ],
      },
      {
        heading: "Don't harass people",
        paragraphs: [
          "Arguments happen. One disagreement isn't harassment.",
          "Repeatedly targeting someone, following them around to bother them, continuing to contact them after they've made it clear they want you to stop, evading blocks, or organizing other people to pile onto them is not okay.",
          "If someone blocks you, that's the end of the interaction. Move on.",
        ],
      },
      {
        heading: "No threats or real-world intimidation",
        paragraphs: [
          "Don't threaten real-world violence, encourage someone to hurt themselves or someone else, share someone's private information, or try to scare somebody with information about their real life.",
          "RuneSpace drama stays in RuneSpace.",
        ],
      },
      {
        heading: "Don't be creepy",
        paragraphs: [
          "Sexual harassment, unwanted sexual comments directed at another player, exploitative sexual content, or sexual content involving minors is not allowed.",
        ],
      },
      {
        heading: "Don't scam or spam people",
        paragraphs: [
          "Don't impersonate other players or staff, run phishing scams, deliberately misrepresent trades, flood chat, or use chat primarily to annoy everyone else.",
          "Trade chat is there for buying, selling, price checks, and other marketplace stuff. General chat is for everything else.",
        ],
      },
      {
        heading: "Swearing isn't the problem",
        paragraphs: [
          "RuneSpace does not need a swear jar.",
          "Profanity by itself isn't a violation. Context matters. Saying \u201cthis fucking drop rate hates me\u201d is very different from directing hateful or threatening abuse at another person.",
          "Some particularly severe slurs may simply be blocked from being sent.",
        ],
      },
      {
        heading: "Use Block and Report",
        paragraphs: [
          "If you don't want to interact with someone, block them.",
          "If someone is breaking these rules, report the message or player. You can report without blocking, or do both.",
          [
            "Blocks, reports, chat messages, and related safety information may be retained and reviewed to keep RuneSpace safe. Direct messages aren't public to other players, but they may still be reviewed when necessary for moderation or safety. ",
            { text: "Safety & Privacy", articleSlug: SAFETY_PRIVACY_SLUG },
            " explains exactly what's kept and for how long.",
          ],
        ],
      },
      {
        heading: "Moderation isn't a game",
        paragraphs: [
          "Don't abuse the report system, organize false reports, or try to manipulate moderation against somebody you dislike.",
          "RuneSpace may use patterns such as reports and blocks to help identify things worth reviewing, but those signals aren't automatic proof that someone did something wrong.",
        ],
      },
      {
        heading: "What happens if you break the rules?",
        paragraphs: [
          "It depends on what happened.",
          "Sometimes a warning makes sense. Sometimes it doesn't.",
          "RuneSpace may temporarily or permanently restrict someone's ability to chat, DM, advertise, or initiate trades. More serious behavior\u2014such as credible threats, doxxing, serious scams, repeated harassment, or attempts to evade moderation\u2014can result in temporary or permanent account suspension.",
          "You do not necessarily get a warning first for serious behavior.",
          "The goal isn't to punish people for having a bad day. The goal is to stop people from making RuneSpace unsafe or miserable for everyone else.",
          [
            "If it happens to you, you'll get a notice that says which rule, what's affected, for how long, and a case reference \u2014 and you can appeal it. ",
            { text: "Safety & Privacy", articleSlug: SAFETY_PRIVACY_SLUG },
            " covers how appeals work.",
          ],
        ],
      },
      {
        heading: "The short version",
        paragraphs: [
          "Argue about ideas. Roast bad decisions. Complain about prices. Swear at the RNG.",
          "Don't attack people for who they are, don't harass them, don't threaten them, and don't be creepy.",
          "We're all here to play a game.",
        ],
      },
    ],
  },
  {
    // Issue #248 — the Safety / Privacy disclosure. Every sentence must stay
    // true to shipped storage and access. Never publish thresholds, signal
    // weights, or trigger logic here, and update this page before RuneSpace
    // collects a new kind of safety data or uses it for something new.
    slug: SAFETY_PRIVACY_SLUG,
    title: "Safety & Privacy",
    category: "community",
    summary:
      "What RuneSpace keeps when you chat, Whisper, block, or report, how its anonymous visit counts and optional product analytics work and how to turn each off, how long things are kept, who can see them, and how moderation and appeals work.",
    sections: [
      {
        paragraphs: [
          "Chat, Whispers, Block, and Report only work if RuneSpace keeps some information about them. This page says what that information is, why it's kept, how long it's kept, and who can look at it. It also covers the anonymous visit counts and the optional product analytics RuneSpace uses on its public site. It's here so nothing about it is a surprise.",
          [
            "The short version: messages are kept for 90 days, reports are kept longer as evidence, Whispers are private from other players but not from moderators with a real reason to look, and every time a moderator looks, it's recorded. The ",
            { text: "Chat & Community Rules", articleSlug: COMMUNITY_RULES_SLUG },
            " say what's allowed.",
          ],
        ],
      },
      {
        heading: "High Scores and players online",
        paragraphs: [
          "High Scores publicly show every character's name, Player name, portrait, Character Level, and skill progress. Anyone can open or share a character's profile.",
          "While you have Play open, RuneSpace records the latest game check-in for your account. A public count includes each recently checked-in account once, without showing who is online. A check-in stops counting after two minutes; the latest timestamp remains with the account until replaced by a later check-in or the account is deleted.",
        ],
      },
      {
        heading: "Public chat and promoted ads",
        paragraphs: [
          "Every General and Trade message is saved with its text, the channel, when it was sent, the character that sent it, that character's name at the time, and the player account the character belongs to. A promoted Trade ad is saved the same way, plus the Credits it cost. Automatic System lines in General, such as a rare-find announcement, are saved with their text and time but no player attached. Everyone playing can read public messages while they're kept.",
          "RuneSpace keeps these so chat history loads when you open it, so the shared send limit and the promoted-ad cooldown can be applied to your account across all your characters and tabs, and so reported messages can be checked.",
          "When a message @mentions someone, RuneSpace also saves which characters it mentions, their names at the time, and whether each of them has read it, so the mention lights up for that player and clears on every device once they've seen it. Mentions are part of the message: everyone who can read the message can see who it mentions, and they're deleted along with it.",
        ],
      },
      {
        heading: "Whispers",
        paragraphs: [
          "A Whisper is saved with its text, when it was sent, the character that sent it and its name at the time, the player account behind it, and the conversation it belongs to. RuneSpace also keeps a record of which two characters share each conversation and how far each has read, so unread Whispers clear on every device.",
          "If you hide a conversation, RuneSpace notes that on your side only, so it stays out of your list until there's a new Whisper or you open it again. Hiding doesn't delete or change any Whisper, and the other player isn't told.",
          "Whispers aren't public: other players can't read a conversation they aren't in. They are not end-to-end encrypted, though. RuneSpace stores them and can read them, and a moderator may review them for a legitimate safety or moderation reason \u2014 a report, a serious safety concern, or an active investigation. There is no tool for casually browsing people's Whispers.",
        ],
      },
      {
        heading: "How long messages are kept",
        paragraphs: [
          "General, Trade, promoted ads, and Whispers are all kept for 90 days, then deleted. Nobody can edit or delete a message before then, including you.",
          "The one exception is evidence attached to a report, below. A message that the slur filter stops is never sent or saved.",
        ],
      },
      {
        heading: "Blocks",
        paragraphs: [
          "When you block someone, RuneSpace saves which account blocked which, the characters involved, and when. It also keeps a history of every block and unblock. The blocked player is never told.",
          "Blocks are kept so they keep working across every character on both accounts, and as safety information for moderators. They aren't on the 90-day message timer. Blocking someone doesn't keep any extra chat on its own.",
          "While a block stands, the blocked player's General and Trade messages still take their place in your chat as a short \u201cMessage hidden\u201d line with their character's name and the time, so the conversation around them makes sense. What they wrote, and who they mentioned, is never sent to you. Their mentions of you don't light anything up, and you can't mention them until you unblock them.",
        ],
      },
      {
        heading: "Reports",
        paragraphs: [
          "A report saves who reported (account and character), who was reported (account, character, and the character's name at the time), the reason you picked, your optional note, and when. Reporting a message also saves a copy of that exact message and up to 10 messages before and 10 after it from the same channel \u2014 or, for a Whisper, from that one conversation only. Other conversations are never swept in.",
          "That copy is evidence, so it's kept after the original messages are deleted at 90 days. The reported player is never told who reported them, or that a report was made.",
        ],
      },
      {
        heading: "Player trades",
        paragraphs: [
          "Every completed trade between characters is recorded permanently: both characters and the player accounts behind them, the location, when it happened, and exactly what each side offered — Credits, items and quantities, and which individual pieces of gear. It's kept so trades can be checked later if someone reports a scam or something looks wrong, and it isn't on the 90-day message timer.",
          "Trade requests are kept so request limits can work across all of your characters and so a player who keeps sending you requests can be spotted; requests that went nowhere are cleared out as new ones are made. Once a request is accepted, RuneSpace also keeps that trade's offers and how it ended, even if it was canceled.",
        ],
      },
      {
        heading: "Moderation cases",
        paragraphs: [
          "Reports about the same account are reviewed together in a moderation case. A case holds those reports and their evidence, a moderator's internal notes, any sanction, and any appeal you send. Cases and their evidence are kept after they're closed, and a suspension \u2014 even a permanent one \u2014 doesn't delete them, so decisions can be checked later.",
        ],
      },
      {
        heading: "Safety signals",
        paragraphs: [
          "Patterns of reports and blocks \u2014 for example, several different players reporting or blocking the same account \u2014 can help moderators notice what's worth reviewing first and understand what they're looking at.",
          "They are context for a person, not a verdict. Nothing in RuneSpace warns, restricts, or suspends anyone automatically because of reports or blocks, and there's no hidden score. RuneSpace doesn't publish the details of how moderators prioritize reviews, because that would help people game the system or pile onto someone.",
        ],
      },
      {
        heading: "Who can see it, and how that's checked",
        paragraphs: [
          "Only RuneSpace's operators can open moderation cases, report evidence, or retained chat and Whispers. Every time one of them views that information, RuneSpace records who looked, when, which case or account it was about, and what kind of information they opened \u2014 even when they don't take any action. Every warning, restriction, suspension, change, reversal, and appeal decision is recorded the same way. Those records can't be edited or deleted from inside RuneSpace.",
          "Retained Whispers can only be opened from a moderation case, and only the conversations between the players in that report, around the time of the incident.",
        ],
      },
      {
        heading: "Anonymous visit counts",
        paragraphs: [
          "On runespace.qcfailed.com, RuneSpace keeps a simple daily tally of how many times its public pages are loaded and where those visits came from. It's how a solo developer can tell which posts and communities are actually bringing people to the game. This tally is separate from the optional PostHog analytics below, and it runs whether or not you say yes to PostHog.",
          "Each load adds one to a total filed under just four things: the day, the kind of page (the home page, Updates, the Wiki, High Scores, or Register and Sign in), the kind of site that sent you (for example LinkedIn, Reddit, Discord, or Google, otherwise \u201cother\u201d, \u201cdirect or unknown\u201d, or RuneSpace itself), and the utm_source, utm_medium, and utm_campaign tags on the link, if it had them and they're short plain words. That's all that's kept. It doesn't keep your IP address, browser details, the full address you opened or came from, a cookie or ID, or a list of visits, and it can't be tied to you or your account. Play, Characters, and operator pages aren't counted. Like any website, RuneSpace's hosting still handles your network address to deliver the page; the tally just doesn't record it.",
          "These are page loads, not people. Reloading counts again, automated visitors can slip in, and some browsers and link previews aren't counted at all, so treat the numbers as a rough guide. Daily totals are kept for 25 months and then deleted.",
          "Your visits aren't counted if your browser sends a Global Privacy Control or Do Not Track signal, or if you use the \u201cDo not count my visits\u201d button at the bottom of this page. It works on its own: it doesn't depend on, or change, your PostHog choice, and RuneSpace remembers it in a small cookie so it keeps working. One honest limit: the first page you open can be counted before you've had the chance to find this button.",
        ],
      },
      {
        heading: "Product analytics",
        paragraphs: [
          "On runespace.qcfailed.com, only if you accept, RuneSpace uses PostHog, a third-party product-analytics service, to learn where visitors come from, which public pages they open, where they stop while setting up an account and character, and whether they enter and come back to the game. Analytics never runs when the game is run on a developer's own computer. The private test copies RuneSpace uses to preview changes only send analytics while RuneSpace is deliberately testing it there; that traffic is labeled as test traffic and kept apart from the real numbers.",
          "It records the general kind of page you open (for example the Wiki, Sign in, or Play) \u2014 never a character's ID, a Player name, anything you searched for, a verification link, or anything after a \u201c?\u201d in an address. It records the website you arrived from and the utm_source, utm_medium, and utm_campaign tags on a link that brought you here, plus basic browser details such as browser, operating system, device type, and screen size, and a random ID that RuneSpace stores in your browser \u2014 all of it only if you accept. Like any website, your browser also has to contact PostHog to send this, so PostHog receives the network address and browser details every web request carries.",
          "It records four moments in the game: an account was created, a character was created, Play was opened, and the first time a character's skill XP rose while you were playing. It does not record chat, Whispers, trades, anything you type, your email address, your Player name, character names, inventory, missions, or conversations. RuneSpace does not record sessions or clicks, and does not use analytics for advertising.",
        ],
      },
      {
        heading: "Anonymous and signed-in analytics",
        paragraphs: [
          "Before you sign in, your visits are anonymous: just the random ID in your browser. When you sign in, analytics links your visits to the internal ID RuneSpace gives your account \u2014 not your email or your name \u2014 so a player who comes back on another day is counted once however many of the three characters they use. Signing out starts a new anonymous ID.",
          "Creating an account happens before you verify your email, so it is recorded anonymously and is joined to your account only if you verify and sign in in the same browser.",
        ],
      },
      {
        heading: "Your analytics choice, and how long it's kept",
        paragraphs: [
          "PostHog analytics is off until you say yes. The first time you visit the public site, RuneSpace asks, and it's a genuine either-way question: \u201cNo thanks\u201d is completely fine, and the game works exactly the same. Before you say yes, nothing is stored in your browser for PostHog and nothing is sent to it. RuneSpace remembers your answer in a small cookie so it doesn't ask again, and you can change it at the bottom of this page whenever you like. Saying no to PostHog doesn't turn off the anonymous visit counts above; they have their own button.",
          "If your browser sends a Global Privacy Control or Do Not Track signal, PostHog stays off \u2014 even if you accepted earlier \u2014 and RuneSpace doesn't ask. Turning PostHog analytics off stops anything further being sent, and also stops the character-creation report RuneSpace's server would otherwise send. Clearing your browser's site data forgets your answers, including your visit-count choice, so you'll be asked again and your visits can be counted again until you say no.",
          "PostHog keeps analytics events for up to one year, the retention of RuneSpace's current PostHog plan, and RuneSpace does not copy them anywhere else.",
        ],
      },
      {
        heading: "What this information is used for",
        paragraphs: ["RuneSpace uses everything on this page for these things only:"],
        list: [
          "Delivering chat and Whispers, loading history, and keeping unread counts in sync.",
          "Applying the shared send limit, the promoted-ad cooldown, the slur filter, and your blocks.",
          "Applying trade request limits, and checking completed trades when something goes wrong.",
          "Reviewing reports, enforcing the Chat & Community Rules, and handling appeals.",
          "Seeing, in anonymous daily totals, how many times public pages are loaded and which links and communities send visitors.",
          "Understanding how visitors find RuneSpace and how far they get through account setup and early play, using the optional product analytics above.",
        ],
      },
      {
        heading: "If this changes",
        paragraphs: [
          "If RuneSpace starts keeping a new kind of safety information, or starts using it for something new, this page will say so first.",
        ],
      },
      {
        heading: "Moderation notices and appeals",
        paragraphs: [
          "If a moderator acts on your account, you'll get a notice with the rule it's about, what you can't do, how long it lasts, and a case reference. A warning restricts nothing. A social restriction stops you from sending General and Trade messages, Whispers, and promoted ads, and from starting a trade with another player, but you can keep playing, reading public chat, and accepting a trade someone else starts. A suspension stops you from entering the game at all.",
          "You can appeal each notice once. Open the notice from your Characters page or the Chat panel, choose Appeal, and tell us briefly why it should be reviewed. That works even while you're suspended \u2014 you only need to sign in. A moderator will uphold the decision, change it, or reverse it, and your notice will show the outcome. Notices never say who reported you, and they don't name the moderator.",
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

/**
 * Whether the `/wiki` landing page's category panels list this article.
 * Visible unless an article explicitly opts out with `showInIndex: false`;
 * routing, lookup, and link validation never consult this.
 */
export function isWikiArticleIndexed(article: Pick<WikiArticle, "showInIndex">): boolean {
  return article.showInIndex !== false;
}

/**
 * Every declared category must actually list articles on the index.
 *
 * A category with nothing in it would render an empty heading on the index, and
 * a category nobody authored into is a half-finished migration. It counts only
 * index-visible articles, because a category holding nothing but hidden guides
 * would still render empty. This is a property of the shipped corpus rather
 * than of any collection, so it is checked here at import time instead of
 * inside `validatePublicWikiArticles`.
 */
export function assertWikiCategoriesArePopulated(articles: readonly WikiArticle[]): void {
  for (const category of WIKI_CATEGORIES) {
    if (
      !articles.some((article) => article.category === category.id && isWikiArticleIndexed(article))
    ) {
      throw new Error(`Wiki category has no articles: ${category.id}`);
    }
  }
}

/** The single validated repository-authored source for Wiki articles, in index order. */
export const wikiArticles = validatePublicWikiArticles(authoredWikiArticles);

assertWikiCategoriesArePopulated(wikiArticles);

export function getWikiArticles(): readonly WikiArticle[] {
  return wikiArticles;
}

/** The derived Items & Recipes directory (#338): a route, not an authored article. */
export const WIKI_ITEMS_PATH = "/wiki/items";

/**
 * Derived directories the index links beside a category's articles. Each is a
 * generated route rather than prose, so it is not in `authoredWikiArticles`; the
 * index lists it once and its pages link themselves.
 */
const WIKI_DIRECTORIES: readonly {
  categoryId: WikiCategoryId;
  title: string;
  path: string;
}[] = [{ categoryId: "gear-and-credits", title: "Items & Recipes", path: WIKI_ITEMS_PATH }];

export type WikiArticleGroup = {
  id: WikiCategoryId;
  label: string;
  description: string;
  articles: readonly WikiArticle[];
  directories: readonly { title: string; path: string }[];
};

/**
 * The validated collection grouped for the index: categories in declared
 * order, each holding its index-visible articles in authored order. Articles
 * with `showInIndex: false` are omitted here but remain routable. Every
 * category is guaranteed non-empty by `assertWikiCategoriesArePopulated`.
 */
export function getWikiArticleGroups(): readonly WikiArticleGroup[] {
  return WIKI_CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
    description: category.description,
    articles: wikiArticles.filter(
      (article) => article.category === category.id && isWikiArticleIndexed(article),
    ),
    directories: WIKI_DIRECTORIES.filter((entry) => entry.categoryId === category.id).map(
      ({ title, path }) => ({ title, path }),
    ),
  }));
}

/**
 * The article the index spotlights for a player who does not yet know what to
 * read. It is an ordinary authored article, deliberately not a second
 * quick-start page that would duplicate it, and it still appears in its own
 * category list below the spotlight.
 */
export const WIKI_START_HERE_SLUG = "getting-started";

export function getWikiStartHereArticle(): WikiArticle {
  const article = getWikiArticle(WIKI_START_HERE_SLUG);
  if (!article) {
    throw new Error(`Wiki start-here article is missing: ${WIKI_START_HERE_SLUG}`);
  }
  return article;
}

export function getWikiArticle(slug: string): WikiArticle | undefined {
  return wikiArticles.find((article) => article.slug === slug);
}

/** The canonical route projection used by index, article, and static-param generation. */
export function getWikiArticlePath(article: Pick<WikiArticle, "slug">): string {
  return `/wiki/${article.slug}`;
}
