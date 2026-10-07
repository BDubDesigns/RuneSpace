import { WIKI_CATEGORIES, WikiArticleSchema } from "@/game/schemas/public-wiki";
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
          "Holo Hollow currently has eight connected locations, though one of them is shut when you arrive. You can only walk between locations that are directly connected — there's no fast travel or shortcut. There is one paid ride, on a single fixed route, once you've earned it.",
        ],
      },
      {
        heading: "The local map",
        list: [
          "Crash Site — connects to the Abandoned Processing Yard, the DeWhat? Emergency Power Annex, The Long Scramble, and the town of Holo Hollow.",
          "Abandoned Processing Yard — connects to Crash Site and the Power Annex.",
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
            { text: "Brace Yourself", articleSlug: "missions" },
            ". After that it is an ordinary walk, and the map reads MINING.",
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
            { text: "Out of the Weather", articleSlug: "missions" },
            ", the mining crews will let you ride their shift hauler out from Holo Hollow to The Jag.",
          ],
          "It costs 5 Credits every ride — it isn't a one-time unlock that makes travel free. The ride takes about 12 seconds, where walking the same trip is two legs through The Long Scramble plus the stop in between.",
          "It runs one way: out to The Jag only. There is room for you heading out, but the hauler comes back loaded with shale, so you walk home through The Long Scramble like everybody else. You board it at the repaired Crew Stop in town. It's a real journey, not a teleport: you arrive when it gets there. There's nothing to scavenge on the back of a hauler, so walking is still the only way to find something along the route.",
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
          "Working material into something useful is a two-step loop: mine ore, then refine it at the Abandoned Processing Yard. There are two places to mine, three things you can refine, and — from Refining 5 — two ways to turn ore into Slag on purpose.",
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
          "A Power Cell does something different for it than for the Salvage Cutter. A charged Salvage Cutter mines faster; a charged Loadsteel Cutter mines at the same speed, but every successful attempt gives one more ore than usual — two or three instead of one or two. If you only have room for the usual amount, you still get the usual amount. Your chance of success and the XP an attempt pays stay the same.",
          "One Power Cell gives it ten charged attempts, used up one per attempt whether it succeeds or not, just like the Salvage Cutter. A new Loadsteel Cutter comes off the machine with no charge. Once its charge runs out it keeps its faster base speed and loses only the extra ore.",
        ],
      },
      {
        heading: "Mining Galvanite at Deep Jag",
        paragraphs: [
          [
            "Deep Jag, the lower workings southwest of The Jag, gives Galvanite once you have reopened it — see ",
            { text: "Brace Yourself", articleSlug: "missions" },
            ". It is harder rock and slower going: about nine seconds an attempt, with a lower chance of success that keeps improving until Mining 40. A success gives one or two Galvanite and noticeably more Mining experience than shale does.",
          ],
          "Galvanite is unusually conductive, but it does not generate power on its own. Your starter Salvage Cutter handles it, and a charged Power Cell speeds it up the same way. So does a Loadsteel Cutter.",
        ],
      },
      {
        heading: "Rare finds",
        paragraphs: [
          "Now and then a successful attempt turns up something extra in the rock: a rough, uncut gemstone. It comes in addition to your ore, never instead of it, and a failed attempt never finds one. A find is rare — you can mine for a long while without seeing one — and an attempt turns up at most one.",
          "The Jag can give Uncut Quartz or Uncut Topaz. Deep Jag can give Uncut Topaz or Uncut Sapphire. A find shows on the attempt's result as a purple-framed tile beside your ore — the gems keep that purple frame in your Inventory too — and the Mining experience on that result is one total: the ore's usual amount plus a bonus for the gem. Quartz adds 10, Topaz 20 and Sapphire 30, wherever you find them.",
          "Uncut gems stack only two to a tile, and Bix will buy them — see Credits & Trading. A Loadsteel Cutter's extra ore is only ever extra ore; it does not turn up more gems.",
          "Mining only starts, and keeps going, while you have room for your ore and for a find. If your Inventory is that tight when one turns up, the find is always kept; it is the ore that may come up short.",
          "Some finds are announced. When someone finds Uncut Topaz at The Jag or Uncut Sapphire at Deep Jag, a System line appears in General chat saying who found it and where. The other finds are yours alone to know about.",
        ],
      },
      {
        heading: "Refining at the Abandoned Processing Yard",
        paragraphs: [
          "Refining is only available at the Abandoned Processing Yard. Refine lists what you can refine right now with what you are carrying — plus any recipe a Mission is pointing you at, with what it is still missing. Recipes, beside it, lists every recipe your Refining level knows, whether or not you have the materials. The recipes below show what is still to come.",
          "A failed attempt says so: any Slag it makes, or any input a failed Galvaferrite pour hands back, is shown as what the failure left, not as something you refined.",
          "The Slag a failed Refined Ferrite or Galvanic Stock attempt makes is a bonus, never a requirement. You do not need room for it to start or keep refining; the attempt still finishes, spends its ore and pays its Refining XP. Slag is kept for as long as you have room, and whatever will not fit is thrown out. Turn Auto-discard Slag on and every bit of it is thrown out instead. It is the same setting as the Practice Welding bench's, so changing it in one place changes it in the other, and it stays until you change it. The result and history say when Slag was discarded, so it is never counted as something you are carrying.",
          "Auto-discard Slag only covers Slag from a failure. A pour that makes Slag on purpose still puts it in your Inventory and needs room for it, and a failed Galvaferrite pour always gives back the input it returns. The product you are actually refining still needs room too, and Slag you keep can use up that room.",
        ],
        list: [
          "Refined Ferrite — two Ferrite Shale, a little over four seconds. A failure still produces one Slag, which isn't wasted: the Cargo Hold repair needs both.",
          "Galvanic Stock — two Galvanite, about six seconds. Needs Refining 5. A failed pour leaves two Slag.",
          "Galvaferrite — one Refined Ferrite and one Galvanic Stock, about seven seconds. Needs Refining 8. A failed alloy hands back one of the two inputs and loses the other.",
          "Slag from Ferrite Shale — two Ferrite Shale into one Slag, a little under four seconds. Needs Refining 5. It never fails, and it pays the same small Refining XP a failed Refined Ferrite attempt does.",
          "Slag from Galvanite — two Galvanite into two Slag, a little under five seconds. Needs Refining 5. It never fails, and it pays what a failed Galvanic Stock pour does.",
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
          "Leave a spare slot while you mine, so a rare find always has somewhere to go.",
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
        heading: "Dropping items",
        paragraphs: [
          "Dropping a stack asks you to confirm the exact quantity first. In the current build, dropped items are permanently destroyed — there's no ground pickup yet, so only drop what you're sure you don't need.",
          [
            "Materials set aside for a piece on the ",
            { text: "Fabrication Station", articleSlug: "fabrication-and-tinkering" },
            " can't be dropped until that piece is finished.",
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
      "Your character's Credits, buying and selling at Bix Weller's shop, Wade's scrap counter at Rusk Recovery, and trading with other players.",
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
          "A repaired Cargo Hold gives you 32 slots of on-site storage at the Crash Site. You can deposit or withdraw a single item or a whole stack while you're stationary there — it's separate from what you're carrying in Inventory.",
        ],
      },
      {
        heading: "Welding other things",
        paragraphs: [
          [
            "Welding isn't a one-off button for your ship. Once you've learned it, it's something your character knows how to do, and there are other jobs that need it — starting with the Crew Stop in town, which you can repair during ",
            { text: "Out of the Weather", articleSlug: "missions" },
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
            { text: "Wheel Be Right Back", articleSlug: "missions" },
            ', and it sits beside the Cargo Hold from the start as a damaged system. Its repair opens up once you have taken that job from Wade. It takes 2 Wheel Assemblies, 2 Mounting Brackets and 1 Galvanic Wire Spool, then twelve passes. You do the welding yourself, but you can buy or trade for any of the parts — you don\'t need Fabrication or Refining levels to install them. Once it is done, the Landing Gear panel reads "Landing gear restored." The ship looks just as wrecked as before, and nothing about it lets you fly.',
          ],
          [
            "The last major repair is the ship's Propulsion System, and it sits beside the Cargo Hold and Landing Gear from the start as another damaged system. It belongs to ",
            { text: "Thrust Issues", articleSlug: "missions" },
            ", and its repair opens up once you have taken that job from Wade. You need Welding level 8 to take the job and to do the work. It takes 2 Drive Mounts, 1 Galvaferrite, 2 Mounting Brackets and 1 Galvanic Wire Spool, then sixteen passes. You can buy or trade for any of the parts, and you don't need Fabrication or Refining levels to install them, but the welding is always yours.",
          ],
          'The moment the sixteenth pass lands the ship is physically restored: the Crash Site shows it repaired, and the Propulsion System panel reads "Propulsion restored. Report to Wade." Report to him and it reads "Propulsion restored. Ship flight-ready." The sixteen passes pay their usual Welding XP and Wade adds nothing on top. The ship has no flight controls yet, so there is still nowhere to fly it.',
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
            { text: "Keep the Change", articleSlug: "missions" },
            " and Wade moves back to his own yard. Walk in and he will offer you ",
            { text: "10,000 Hours", articleSlug: "missions" },
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
            "Two things have to be true before Wade will put a customer's property in front of you: Welding level 5, and his own say-so. Once both hold, he offers you 10,001 Hours at Rusk Recovery. Accept it, and the board is yours for good — you do not need to turn the job in first. Turning it in afterward is just Wade looking at the finished work; the board keeps working the whole time either way. See ",
            { text: "Missions", articleSlug: "missions" },
            " for where this sits in the wider job chain.",
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
            { text: "10,000 Hours", articleSlug: "missions" },
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
    slug: "missions",
    title: "Missions",
    category: "getting-started",
    summary:
      "The jobs Wade Rusk, Tansy Rusk, Renn Calder and Curly hand out, and how the Mission Log tracks them.",
    sections: [
      {
        paragraphs: [
          "The Mission Log keeps track of every job you've accepted: what's left to do, what's ready to turn in, and what you've already finished. Each active job shows whether it's Active or ready to Turn in, and opening one leads with its Current Objective before the full list of what it needs.",
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
          [
            "Keep the Change — Wade makes you his apprentice and hands you 36 Credits to get Tansy three ",
            { text: "Power Cells", articleSlug: "power-cells" },
            ". Meet Bix Weller in town, then take the cells to Tansy at The Jag.",
          ],
          [
            "10,000 Hours — Wade moves back to his own yard at Rusk Recovery and offers you bench time. Accepting it hands you six Scrap Metal; complete three ",
            { text: "practice welds", articleSlug: "practice-welding" },
            " and show him the work.",
          ],
          [
            "Return the Favor — once 10,000 Hours is done, Tansy comes out to Rusk Recovery. Take the job and she opens the ",
            { text: "Fabrication Station", articleSlug: "fabrication-and-tinkering" },
            ": fabricate a Salvage Cutter there yourself, then hand her a Salvage Cutter. Worth 100 Fabrication XP.",
          ],
          [
            "Break It Down — follows straight on from Return the Favor. ",
            { text: "Tinker", articleSlug: "fabrication-and-tinkering" },
            " one piece of anything you can take apart, then tell Tansy. Worth 250 Fabrication XP, and she heads back to The Jag afterwards.",
          ],
          [
            "10,001 Hours — once you are Welding level 5, Wade offers you a paying job off his ",
            { text: "Work Orders", articleSlug: "work-orders" },
            " terminal at Rusk Recovery. Accepting it is what makes the board yours for good; finishing the job and showing him the work is just the formality. It does not need Return the Favor or Break It Down.",
          ],
          [
            "A Cut Above — once you have finished Brace Yourself and reached Fabrication 5, Tansy at The Jag wants to see you build a ",
            { text: "Loadsteel Cutter", articleSlug: "fabrication-and-tinkering" },
            ". The recipe is already open at Fabrication 5 — taking the job doesn't unlock it, and you don't need any Refining. Show her a Loadsteel Cutter you're carrying or have equipped, however you came by it. She lets you keep it. Worth 500 Fabrication XP.",
          ],
          [
            "Wheel Be Right Back — once you have finished Brace Yourself, Wade offers to put the ship's landing gear back under it at Rusk Recovery. Bring 2 Wheel Assemblies, 2 Mounting Brackets and 1 Galvanic Wire Spool to the Crash Site, ",
            { text: "weld the Landing Gear", articleSlug: "cargo-hold-and-welding" },
            " in twelve passes, then report to Wade. Worth 250 Welding XP on top of the passes.",
          ],
          [
            "Thrust Issues — once you have finished Wheel Be Right Back and reached Welding level 8, Wade offers to fix the ship's drive at Rusk Recovery. Bring 2 Drive Mounts, 1 Galvaferrite, 2 Mounting Brackets and 1 Galvanic Wire Spool to the Crash Site, ",
            { text: "weld the Propulsion System", articleSlug: "cargo-hold-and-welding" },
            " in sixteen passes, then report to Wade. The passes are the whole reward.",
          ],
        ],
      },
      {
        heading: "Side jobs",
        paragraphs: [
          "Not every job is part of the chain. A side job is entirely optional: nothing hands it to you, nothing is waiting on it, and you can ignore it forever without closing anything off.",
        ],
        list: [
          [
            "Out of the Weather — Renn Calder mentions that the Crew Stop out on the haul road is falling apart and nobody owns it enough to fix it. Repairing it takes 20 Refined Ferrite and ten ",
            { text: "welding passes", articleSlug: "cargo-hold-and-welding" },
            ". Renn brings it up in town once you've finished Hold It Together — he isn't asking you to do anything about it, and you can decide to pitch in. You don't need Keep the Change first, and it never blocks it.",
          ],
          [
            "Brace Yourself — Tansy Rusk has known about the cave-in below The Jag for years. Once you have finished Break It Down and reached both Mining 5 and Welding 5, she will ask you to help her reopen it back at The Jag: 25 Refined Ferrite and 5 ",
            { text: "Power Cells", articleSlug: "power-cells" },
            " hauled down to Deep Jag, then fifteen welding passes to set the brace. You do not need 10,001 Hours first — Work Orders and Deep Jag are two separate directions out of the same point.",
          ],
          [
            "Cutting Costs — once Brace Yourself is done, Renn Calder in Holo Hollow will pay 500 Credits for a ",
            { text: "Loadsteel Cutter", articleSlug: "mining-and-refining" },
            ". He doesn't care where it came from: one you made, one you were given or traded for, any you are carrying and not wearing. You don't need any Fabrication level or A Cut Above for it. He keeps the Cutter — he's buying it.",
          ],
          [
            "Curly Must-Stash — once the HH B&B is open to you after Keep the Change, ",
            { text: "Curly", articleSlug: "curly" },
            " will hire you to build a mount for his storage container. He pays 150 Credits when you take the job and another 150 when you come back to tell him it's done. The mount takes 6 Refined Ferrite and 3 Slag and six ",
            { text: "welding passes", articleSlug: "cargo-hold-and-welding" },
            ", which you do right there in the B&B; the passes earn their own Welding XP as you go. The container stays his, in his room — it isn't storage for you.",
          ],
        ],
      },
      {
        heading: "Brace Yourself in detail",
        paragraphs: [
          "Deep Jag sits on the map southwest of The Jag from the very beginning, marked CAVE-IN. You can look at it and you cannot go there: the passage is full of fallen rock. Tansy is not being coy about it — it simply was not worth attempting until you had enough hours behind a pick and a torch to be useful down there.",
          "She has the brace and the jack, which are hers and stay hers. What she needs is the stock to build the support out of and somebody to weld it, and that is the job. You can haul the material down over as many trips as you like; what you install stays installed and never comes back out.",
          [
            "The moment the fifteenth pass lands, the passage is open. The scene changes, the map reads MINING, and you can start mining ",
            { text: "Galvanite", articleSlug: "mining-and-refining" },
            " right there without going back up first. Tansy's 250 Welding XP is waiting for you at The Jag whenever you do head back — on top of the 750 the fifteen passes already earned.",
          ],
        ],
      },
      {
        heading: "Wheel Be Right Back in detail",
        paragraphs: [
          "Wade won't come find you for this one, and finishing Brace Yourself doesn't start it: walk out to Rusk Recovery and take it from him when you want it. It asks for nothing else first — no Welding level beyond what Brace Yourself already took, no Fabrication or Refining, and you don't need A Cut Above.",
          [
            "Where the parts come from is up to you. You can make Wheel Assemblies at Fabrication 5 at the ",
            { text: "Fabrication Station", articleSlug: "fabrication-and-tinkering" },
            ", buy them, trade for them or be given them, and the same goes for the Mounting Brackets and the Galvanic Wire Spool. You always do the welding yourself.",
          ],
          "You can install the parts across as many visits as you like, and what goes in stays in. When the twelfth pass lands the Landing Gear is done for good, and Wade has 250 Welding XP for you on top of the 600 the passes earned. It doesn't make the ship fly: the engine is still dead, and the Crash Site says so.",
        ],
      },
      {
        heading: "Thrust Issues in detail",
        paragraphs: [
          "Wade won't come find you for this one either, and finishing Wheel Be Right Back doesn't start it: reach Welding level 8, walk out to Rusk Recovery and take it from him when you want it. Below level 8 he has nothing to offer you for it. It asks for nothing else first — no Fabrication or Refining level, and you don't need A Cut Above.",
          [
            "Where the parts come from is up to you. You can make Drive Mounts at Fabrication 8 at the ",
            { text: "Fabrication Station", articleSlug: "fabrication-and-tinkering" },
            ", trade for them or be given them, and the same goes for the Galvaferrite, the Mounting Brackets and the Galvanic Wire Spool. You always do the welding yourself, and you need Welding level 8 to do it.",
          ],
          "You can install the parts across as many visits as you like, and what goes in stays in. When the sixteenth pass lands the ship is repaired for good and the Crash Site shows it, before you have even spoken to Wade. Reporting to him is a separate step, and it adds nothing: no extra XP, no Credits and no item. The repair is the reward. The ship is restored, but nothing lets you fly it yet.",
        ],
      },
      {
        heading: "Out of the Weather in detail",
        paragraphs: [
          "This one costs you rather than paying you up front: the materials and the time are yours. Renn won't chase you about it, and the Crew Stop stays where it is however long you take — you can put in some of the Refined Ferrite, go and get more, and come back.",
          [
            "What you get is worth having. The shelter stays repaired for good, and because the crews use it every workday and know who fixed it, they'll let you ride the shift hauler out to The Jag for ",
            { text: "5 Credits a trip", articleSlug: "travel-and-scavenging" },
            ". Only on the way out, though — the hauler comes back loaded with shale, so you walk home. Renn also passes on 250 Welding XP on top of what the welding itself earned you.",
          ],
        ],
      },
      {
        heading: "How missions work in practice",
        paragraphs: [
          "Objectives update live as you meet them. Every job you accept starts pinned: it gets its own strip at the top of the screen, on the Map and while travelling too — green while there's still work to do, blue once it's ready to hand in — and the Mission Log keeps the full checklist. Tap the pin on a strip to unpin it when you don't need to see it for a while. The job stays accepted and keeps counting your progress; highlights, the Map and handing it in all work as normal. Pin it back from the Mission Log at any time. Finishing Walk It Off, Cut Your Teeth, or Waste Not hands you the next job in the chain automatically — there's nothing extra to accept. Keep the Change works differently: after Hold It Together, go back and talk to Wade to take it on. 10,000 Hours and 10,001 Hours work the same way — Wade won't come find you, so walk out to Rusk Recovery and take each one on once it's available. Return the Favor is the same again, taken from Tansy in that yard, and Break It Down follows it automatically. Brace Yourself comes after Break It Down; 10,001 Hours is a separate branch that needs neither. After Brace Yourself, Tansy offers A Cut Above at The Jag once you reach Fabrication 5, Renn offers Cutting Costs in town, and Wade offers Wheel Be Right Back at Rusk Recovery. When every objective on a job is met, talk to the NPC named in it to turn it in.",
        ],
      },
      {
        heading: "Following a job",
        paragraphs: [
          "Once you've accepted a job, green and blue highlights point you toward whatever's next, wherever that actually is — the place on the Map, a building's Enter, a person, a piece of equipment, or an action control.",
          "Green means work still to do: the destination on the Map, a building's Enter once you've arrived, the person to talk to, the equipment to equip, or the action to start. Blue means a conversation — either someone has a new job for you, or a finished job is ready to hand in. The moment every objective on a job is met, it turns blue: the person you hand it in to lights up blue instead of green, and the Map labels their location TURN IN in plain text, even before you've arrived there. An accepted job's own destination is labeled MISSION the same way.",
          "If that destination is scrolled out of view, the arrow at the edge of the Map pointing toward it turns green or blue to match, and goes back to normal once the place is on screen. A job someone is only offering never lights up the Map.",
          "When a job can be finished more than one legitimate way — three Power Cells can come from your Inventory, the Annex, or Bix's shelf — nothing gets highlighted for that step. It's your call.",
        ],
      },
      {
        heading: "Keep the Change in detail",
        paragraphs: [
          "Wade's 36 Credits are a job budget, handed over when you accept. They're yours: three cells cost 36 Credits at Bix's price, but if you already have cells, or claim them free at the Annex, you keep whatever you don't spend. There's no second payout when you finish, and nothing is reimbursed.",
          [
            "Meeting Bix is part of the job even if you already have three cells — Wade wants his apprentice to know who keeps useful things on a shelf. Talking to him is all that's required; you never have to buy or sell anything. The three cells themselves can come from anywhere: your ",
            { text: "Inventory", articleSlug: "inventory-and-equipment" },
            ", the Annex, or Bix's shelf.",
          ],
          "Handing them over takes exactly three cells. Any extras you're carrying stay with you.",
        ],
      },
      {
        heading: "10,000 Hours in detail",
        paragraphs: [
          "Turning in Keep the Change ends with Tansy calling Wade to tell him you did the job properly, and Wade telling you to come by the shop. Nothing is accepted for you and nothing lights up on the map: Rusk Recovery has been walkable from the start, and the job is there when you walk in and talk to him.",
          [
            "Accepting it is the whole of the onboarding. He hands over six Scrap Metal — three welds' worth — and opens the ",
            { text: "workbench", articleSlug: "practice-welding" },
            " and his scrap counter at the same time. He will not let you near real client property yet.",
          ],
          "Any three genuine practice welds count, whatever scrap you used: his, scrap you already had, or scrap you bought back from him. Losing his scrap does not dead-end anything — buy two more and carry on. Showing him the finished work pays 50 Credits. The three welds already paid their own Welding XP, so there is no second helping.",
        ],
      },
      {
        heading: "Return the Favor in detail",
        paragraphs: [
          "Tansy gave you your first Cutter. This job is making one of your own — and it has to be one you actually fabricate while the job is open. A Cutter you already had, bought or were given does not count for that part.",
          "The Cutter you hand her can be any Salvage Cutter you are carrying and not wearing, including the one you just made. She will not take the one in your hand. She takes it apart on the spot to show you how Tinkering works; the Scrap from her demonstration stays with her.",
          [
            "You may use ",
            { text: "Manual Override", articleSlug: "fabrication-and-tinkering" },
            " on the job. If a push wrecks the Cutter, the job just waits for another one.",
          ],
        ],
      },
      {
        heading: "A Cut Above and Cutting Costs",
        paragraphs: [
          "A Cut Above only asks to see one. Any Loadsteel Cutter you have with you counts — one you made before taking the job, made since, bought, or were given, carried or equipped, charged or not. If you already have one when you take the job, you can show her straight away. One left in the Cargo Hold isn't with you, so it doesn't count. Tansy only looks — nothing is taken.",
          "Cutting Costs is the opposite: Renn is buying a Cutter, not checking who built it, so any Loadsteel Cutter you are carrying and not wearing will do. He will not take the one in your hand, and he pays his 500 Credits once.",
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
            { text: "repair it", articleSlug: "missions" },
            " with ",
            { text: "Welding", articleSlug: "cargo-hold-and-welding" },
            ", and afterwards the crews will give you a ",
            { text: "ride", articleSlug: "travel-and-scavenging" },
            ".",
          ],
          [
            "HH B&B — a family bed-and-breakfast from the tourism years, now the town's working inn. Its rooms are held for locals and regular working crews, so the door stays shut to you until you've finished ",
            { text: "Keep the Change", articleSlug: "missions" },
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
            { text: "Keep the Change", articleSlug: "missions" },
            ". His niece ",
            { text: "Tansy Rusk", articleSlug: "tansy-rusk" },
            ", a field mechanic and miner, is based out at The Jag, though after ",
            { text: "10,000 Hours", articleSlug: "missions" },
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
      "How Mining, Refining, Welding, and Fabrication track your progress, what your Character Level means, and what leveling up gets you.",
    sections: [
      {
        paragraphs: [
          "Four skills currently track your progress: Mining, Refining, Welding, and Fabrication. Each has its own experience (XP) total and level, earned separately.",
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
          "Refining — a Refining attempt at the Abandoned Processing Yard grants Refining XP, whether it succeeds or not.",
          "Welding — each completed welding pass grants Welding XP, whether you are repairing the Cargo Hold, the Landing Gear, the Propulsion System or the Crew Stop, building a Stash Mount, or practising at Wade's workbench. A practice pass pays a reduced share, because nothing is actually being repaired.",
          [
            "Fabrication — each finished piece at the ",
            { text: "Fabrication Station", articleSlug: "fabrication-and-tinkering" },
            " grants Fabrication XP, more if you pushed it with Manual Override, and taking a finished piece apart by Tinkering grants the same XP making it did. A piece wrecked by Manual Override grants none.",
          ],
        ],
      },
      {
        heading: "Mission rewards",
        paragraphs: [
          [
            "Some missions also grant skill XP when you complete them: ",
            { text: "Cut Your Teeth", articleSlug: "missions" },
            " grants +100 Mining XP, ",
            { text: "Waste Not", articleSlug: "missions" },
            " grants +100 Refining XP, ",
            { text: "Hold It Together", articleSlug: "missions" },
            " grants +100 Welding XP, and ",
            { text: "Out of the Weather", articleSlug: "missions" },
            " grants +250 Welding XP on top of what the welding itself paid. ",
            { text: "Return the Favor", articleSlug: "missions" },
            " grants +100 Fabrication XP, ",
            { text: "Break It Down", articleSlug: "missions" },
            " +250, and ",
            { text: "A Cut Above", articleSlug: "missions" },
            " +500. Not every mission pays in XP — ",
            { text: "10,000 Hours", articleSlug: "missions" },
            " pays 50 Credits instead, because its practice welds already earned their own Welding XP as you did them, Renn pays 500 Credits for the Loadsteel Cutter in ",
            { text: "Cutting Costs", articleSlug: "missions" },
            ", and Curly pays 150 Credits when you take on ",
            { text: "Curly Must-Stash", articleSlug: "missions" },
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
            { text: "Keep the Change", articleSlug: "missions" },
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
            { text: "Wheel Be Right Back", articleSlug: "missions" },
            ", rebuilding the landing gear at the Crash Site. He will not tell you where to get the parts, only what you need.",
          ],
          [
            "Once you have finished that and you are a good enough welder, he has the last ship job for you: ",
            { text: "Thrust Issues", articleSlug: "missions" },
            ", fixing the drive. He is no more sentimental about the ship than he ever was. He would like it off his front lawn.",
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
            { text: "Brace Yourself", articleSlug: "missions" },
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
            { text: "Keep the Change", articleSlug: "missions" },
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
            { text: "Keep the Change", articleSlug: "missions" },
            " has opened the B&B to you.",
          ],
        ],
      },
      {
        heading: "Curly Must-Stash",
        paragraphs: [
          [
            "His first optional job, ",
            { text: "Curly Must-Stash", articleSlug: "missions" },
            ", is to build a mount for the MYKEA SCHLEPPRAUM-8 he already owns, so it has somewhere to go in his room. It needs ",
            { text: "Welding", articleSlug: "cargo-hold-and-welding" },
            " level 1, and the Missions page has the details.",
          ],
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
      "What RuneSpace keeps when you chat, Whisper, block, or report, how long it keeps it, who can see it, and how moderation and appeals work.",
    sections: [
      {
        paragraphs: [
          "Chat, Whispers, Block, and Report only work if RuneSpace keeps some information about them. This page says what that information is, why it's kept, how long it's kept, and who can look at it. It's here so nothing about it is a surprise.",
          [
            "The short version: messages are kept for 90 days, reports are kept longer as evidence, Whispers are private from other players but not from moderators with a real reason to look, and every time a moderator looks, it's recorded. The ",
            { text: "Chat & Community Rules", articleSlug: COMMUNITY_RULES_SLUG },
            " say what's allowed.",
          ],
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
        heading: "What this information is used for",
        paragraphs: ["RuneSpace uses everything on this page for these things only:"],
        list: [
          "Delivering chat and Whispers, loading history, and keeping unread counts in sync.",
          "Applying the shared send limit, the promoted-ad cooldown, the slur filter, and your blocks.",
          "Applying trade request limits, and checking completed trades when something goes wrong.",
          "Reviewing reports, enforcing the Chat & Community Rules, and handling appeals.",
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
 * Every declared category must actually have articles.
 *
 * A category with nothing in it would render an empty heading on the index, and
 * a category nobody authored into is a half-finished migration. This is a
 * property of the shipped corpus rather than of any collection, so it is
 * checked here at import time instead of inside `validatePublicWikiArticles`.
 */
export function assertWikiCategoriesArePopulated(articles: readonly WikiArticle[]): void {
  for (const category of WIKI_CATEGORIES) {
    if (!articles.some((article) => article.category === category.id)) {
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

export type WikiArticleGroup = {
  id: WikiCategoryId;
  label: string;
  description: string;
  articles: readonly WikiArticle[];
};

/**
 * The validated collection grouped for the index: categories in declared
 * order, each holding its articles in authored order. Every category is
 * guaranteed non-empty by `validatePublicWikiArticles`.
 */
export function getWikiArticleGroups(): readonly WikiArticleGroup[] {
  return WIKI_CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
    description: category.description,
    articles: wikiArticles.filter((article) => article.category === category.id),
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
