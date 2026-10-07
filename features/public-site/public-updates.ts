import { ITEM_IDS } from "@/game/config/foundations";
import { resolveArticleArt } from "@/game/content/article-art";
import { PublicUpdateSchema } from "@/game/schemas/public-updates";
import { COMMUNITY_RULES_SLUG, SAFETY_PRIVACY_SLUG } from "./policy-links";
import { getWikiArticle } from "./public-wiki";
import type { PublicUpdate } from "@/game/schemas/public-updates";

export type { PublicUpdate } from "@/game/schemas/public-updates";

const authoredUpdates = [
  {
    // Issue #325 — Mission pinning and the refreshed Mission Log.
    slug: "pin-it",
    title: "Pin it",
    publishedAt: "2026-10-06T20:45:00-07:00",
    summary:
      "You can now unpin a job from the strips at the top of the screen and pin it back from the Mission Log. The Mission Log itself has been tidied up so what to do next stands out.",
    body: [
      [
        "Some jobs wait a long time before you can do anything about them, and until now every one you had accepted kept its strip at the top of the screen. Now each strip has a pin. Tap it and that strip goes away. The job does not: it stays accepted in the Mission Log and keeps counting everything you do toward it. See ",
        { text: "Missions", articleSlug: "missions" },
        " for how jobs work.",
      ],
      "Unpinning only changes what the strips show. People still light up when they have something for you, the Map still marks where to go, a finished job still turns blue, and handing it in works exactly as before. Pin it again from the Mission Log whenever you like and its strip comes straight back with your current progress. Every job you take on starts pinned, including the ones that follow straight on from the last.",
      "The Mission Log has had a tidy-up too. Each job says plainly whether it is Active or ready to Turn in, the pin sits in its header so you never need to open a job to change it, and an open job leads with its Current Objective before the full list of what it needs. Finished jobs stay in their own section, closed until you want them.",
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "An Unpin button on every Current Missions strip, which hides that strip without affecting the job.",
          "A Pin button on every active job in the Mission Log, to pin or unpin it from there.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "Every newly accepted job starts pinned.",
          "Mission Log jobs show Active or Turn in at a glance and lead with their Current Objective, with the full list of requirements under Progress.",
        ],
      },
    ],
  },
  {
    // Issue #326 — item sources in the Mission Log.
    slug: "how-to-get-it",
    title: "How to get it",
    publishedAt: "2026-10-06T14:20:00-07:00",
    summary:
      "The Mission Log now has a Sources button beside every item a Mission is still waiting on. It tells you how that item can be made, mined, bought or traded — and what you need first.",
    body: [
      { kind: "figure", art: { kind: "item", itemId: ITEM_IDS.wheelAssembly }, side: "right" },
      [
        "A Mission tells you what it needs. It never told you how to get it, and a Wheel Assembly is easy to forget the recipe for. Open the Mission Log, find an item a Mission is still waiting on, and tap Sources. See ",
        { text: "Missions", articleSlug: "missions" },
        " for how the Log works.",
      ],
      "The details list every way you can get that item that you know about: the recipe that makes it and where, the mine it comes from, the merchant who sells it and for how much, the daily claim, an occasional find while walking, and trading with another player. What you can use right now comes first. A recipe you are not high enough level for is still listed, with the level it needs, so you can decide whether to level up, buy or trade instead.",
      "Each ingredient in a recipe has its own Sources button, so you can follow a Wheel Assembly down to its Galvanic Stock and on to the ore it starts as, and step back out the same way. Things you have not come across yet are not shown. The list only grows as you do.",
      "Opening Sources never changes your Mission, its objective or where it points you. It is a reference, and the compact Missions strip stays exactly as short as it was.",
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "A Sources button beside every item or repair material an active Mission still needs, opening a short list of the ways you can get it.",
          "Recipes you cannot use yet appear locked with the level they need, below the ways you can use now.",
          "Recipe ingredients can be opened in turn, with a Back button, so you can follow a part down to its raw material.",
        ],
      },
    ],
  },
  {
    // Issue #322 — Wheel Be Right Back and the Wheel Assembly.
    slug: "wheel-be-right-back",
    title: "Wheel Be Right Back",
    publishedAt: "2026-10-05T19:15:00-07:00",
    summary:
      "Wade has a new ship job for anyone who has finished Brace Yourself: get the landing gear back under the wreck. It brings a new Fabrication 5 part, a second repair at the Crash Site, and an engine that is still dead.",
    body: [
      { kind: "figure", art: { kind: "item", itemId: ITEM_IDS.wheelAssembly }, side: "right" },
      [
        "Once you have finished Brace Yourself, go and see Wade at Rusk Recovery. He wants the ship's wheels rebuilt and its mounts back under it — it won't make her fly, but there's no point fixing an engine on something that can't land. Nobody hands you the job; you take it from him yourself, whenever you like. See ",
        { text: "Missions", articleSlug: "missions" },
        " for the details.",
      ],
      [
        "The job needs 2 Wheel Assemblies, 2 Mounting Brackets and 1 Galvanic Wire Spool, installed at the Crash Site and welded in twelve passes. The Wheel Assembly is new: a Fabrication 5 recipe at the ",
        { text: "Fabrication Station", articleSlug: "fabrication-and-tinkering" },
        " that takes 3 Refined Ferrite, 1 Galvanic Stock and a Mounting Bracket, and, like any other part, can be taken apart again by Tinkering. You never need Fabrication or Refining levels of your own to do the job — buy the parts, trade for them or be given them — but the welding is always yours. Finishing it pays Wade's 250 Welding XP on top of the passes themselves.",
      ],
      [
        'When the last pass lands, the Landing Gear panel at the Crash Site reads "Landing gear restored. Propulsion offline." The wreck looks just as it did, and the ship still can\'t fly. See ',
        { text: "Cargo Hold & Welding", articleSlug: "cargo-hold-and-welding" },
        " for the recipe.",
      ],
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "Wheel Be Right Back, a job Wade offers at Rusk Recovery once Brace Yourself is finished: repair the ship's landing gear at the Crash Site, then report to him for 250 Welding XP.",
          "The Landing Gear repair at the Crash Site: 2 Wheel Assemblies, 2 Mounting Brackets and 1 Galvanic Wire Spool, then twelve welding passes.",
          "The Wheel Assembly, a Fabrication 5 recipe (3 Refined Ferrite, 1 Galvanic Stock and 1 Mounting Bracket, 21.6 seconds, 100 Fabrication XP) that stacks two to a slot and can be traded or Tinkered.",
        ],
      },
    ],
  },
  {
    // Issue #312 — Turn Back from an active Journey.
    slug: "turn-back",
    title: "Turn back",
    publishedAt: "2026-10-05T09:10:00-07:00",
    summary:
      "You can now Turn Back from a Journey. It ends the trip and leaves you where you set out — but turning back from a walk switches Scavenge off until you complete one.",
    body: [
      [
        "Start walking somewhere, change your mind, and you used to be stuck until you arrived. The Journey now has a Turn Back button. One click, no confirmation, and you're idle at the place you left — not halfway along the route, and with no trip home to wait out. If you arrive before the button gets there, you've arrived and you stay put. See ",
        { text: "Travel & Scavenging", articleSlug: "travel-and-scavenging" },
        " for the details.",
      ],
      "Turning back from a walk isn't a way to reroll Scavenge. After you turn back from a walk, walks stop offering Scavenge until you complete a walk by arriving — starting and cancelling more walks won't change that, and neither will reloading or logging out and in. The Journey says so while it applies, and a find you'd already claimed stays yours.",
      "You can also turn back from the Crew Hauler. The fare was spent when you boarded and isn't refunded, and the button says so before you press it. Turning back from a ride doesn't touch Scavenge.",
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "Turn Back on the Journey, for walks and Crew Hauler rides alike.",
          "A notice that Scavenge is unavailable until you complete a walk, shown after turning back from a walk and on any walk it affects.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "Turning back from a walk switches off Scavenge on walks until you complete one by arriving.",
          "A Crew Hauler ride that you turn back from is not refunded.",
        ],
      },
    ],
  },
  {
    // Issue #308 — Mining Secondary Finds and uncut gemstones.
    slug: "rare-finds",
    title: "Rare finds",
    publishedAt: "2026-10-04T15:30:00-07:00",
    summary:
      "Mining can now turn up more than ore. A successful attempt will occasionally pull a rough gemstone out of the rock — Uncut Quartz, Topaz or Sapphire — and the rarest ones get announced in General.",
    body: [
      { kind: "figure", art: { kind: "item", itemId: ITEM_IDS.uncutTopaz }, side: "right" },
      [
        "Every so often a successful Mining attempt will come away with something besides ore: a rough, uncut gemstone chipped out of the rock. It's a bonus on top of the ore you were already after, never a replacement for it, and it only happens on a success. The Jag can give Uncut Quartz or Uncut Topaz; Deep Jag can give Uncut Topaz or Uncut Sapphire. They are rare. You can mine for a good while and see nothing, which is what makes the ones you do see worth noticing. See ",
        { text: "Mining & Refining", articleSlug: "mining-and-refining" },
        " for the details.",
      ],
      "A find shows up on the attempt's result as a purple-framed tile beside your ore, and the gems keep that purple frame wherever you carry them, Inventory included. The Mining experience on that result is one number — the ore's usual amount plus a bonus for the gem: 10 for Quartz, 20 for Topaz and 30 for Sapphire, the same wherever you dig it up. A Loadsteel Cutter's extra ore is still only extra ore; it doesn't find you more gems.",
      "Mining now wants room for your ore and a possible find before it starts, and keeps checking as you go, so a gem is never found and then lost for lack of space. If you're nearly full when one does turn up, the gem is kept and it's the ore that may come up short. Gems stack two to a tile, and Bix will buy them: 8 Credits for Quartz, 18 for Topaz and 35 for Sapphire.",
      [
        "Two of the finds are announced. When someone digs up Uncut Topaz at The Jag or Uncut Sapphire at Deep Jag, a RARE FIND System line appears in General saying who found it and where. It's RuneSpace talking, not a player, so there's nobody to whisper, report or block, and it doesn't use up anyone's message allowance. See ",
        { text: "Community Rules", articleSlug: COMMUNITY_RULES_SLUG },
        " for how General is meant to be used.",
      ],
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "Rare finds in Mining: Uncut Quartz and Uncut Topaz at The Jag, and Uncut Topaz and Uncut Sapphire at Deep Jag.",
          "Rare gems are framed in purple on the attempt result and in your Inventory, with the Mining experience for the attempt shown as one combined total.",
          "Bix buys Uncut Quartz for 8 Credits, Uncut Topaz for 18 and Uncut Sapphire for 35.",
          "System announcements in General when Uncut Topaz is found at The Jag or Uncut Sapphire at Deep Jag.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "Mining checks for room for your ore and one possible find before each attempt, so it can stop a little sooner when your Inventory is nearly full.",
          "Mining rewards now share the row in as many equal-width cards as fit, instead of a fixed two or three, and a stackable reward shows how full a stack it would fill, just like Inventory.",
        ],
      },
    ],
  },
  {
    // Issue #292 — Curly and Curly Must-Stash.
    slug: "curly-must-stash",
    title: "Curly Must-Stash",
    publishedAt: "2026-10-04T02:15:00-07:00",
    summary:
      "There's a new guest at the HH B&B. Curly, an offworld backpacker, has a storage container, a room full of luggage, and a paying job for anyone who can weld.",
    hero: {
      src: "/location-scenes/curly-room-after.webp",
      alt: "A lamplit inn guest room with a MYKEA storage container mounted on a welded frame above the bed, the luggage around it a little tidier",
      width: 1672,
      height: 892,
    },
    body: [
      [
        "Once Keep the Change has opened the HH B&B to you, Mara isn't the only person inside any more. ",
        { text: "Curly", articleSlug: "curly" },
        " is a young backpacker from offworld, travelling to see how people live on other planets, and he has brought a great deal of luggage to do it with.",
      ],
      [
        "He already owns a perfectly good storage container. What he needs is somewhere to mount it, and he's happy to pay for skilled local labour: 150 Credits when you take the job, and another 150 when it's done. Curly Must-Stash is optional and needs Welding 1. The mount is the same job as the stash mount at The Jag — 6 Refined Ferrite, 3 Slag and six ",
        { text: "welding passes", articleSlug: "cargo-hold-and-welding" },
        " — built right there in the B&B, and the passes earn their own Welding XP.",
      ],
      "The container stays his, in his room. It isn't a stash for you, and building it doesn't change anything about the stashes you can build for yourself.",
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "Curly, a second person to talk to at the HH B&B once Keep the Change is done, with his own topics.",
          "Curly Must-Stash, an optional job at Welding 1: build a mount for Curly's container in his room. It pays 150 Credits up front and 150 on completion.",
          "A Wiki page for Curly.",
        ],
      },
    ],
  },
  {
    // Issue #284 — character-owned site stashes.
    slug: "a-stash-of-your-own",
    title: "A Stash of Your Own",
    publishedAt: "2026-10-02T00:15:00-07:00",
    summary:
      "You can now build a stash mount at The Jag, Rusk Recovery, the Abandoned Processing Yard and Deep Jag, install any container you own, and keep your work-site materials right where you use them.",
    body: [
      "Hauling ore back to the ship and carrying inputs back out again is a lot of walking. Now four of your work sites can hold a stash of their own, so a mine can keep its ore and a bench can keep its parts.",
      [
        "It takes two steps. First you weld a mount down at the site — the standard materials-and-welding job, with Clean Pass as usual. Then you install a container you own and aren't wearing: your starting MYKEA, a Scrap Box, a Freight Harness, whichever you like. The stash gets exactly as many slots as that container has, and what you put in it has no weight limit. The full list of sites, materials and Welding levels is in ",
        { text: "the Wiki", articleSlug: "cargo-hold-and-welding" },
        ".",
      ],
      "A stash belongs to you and stays where you built it, so what you leave at The Jag is waiting at The Jag. You can only reach it while you're standing there. Nothing about it shows up at a site until you can build it: The Jag asks for Welding 1, Rusk Recovery and the Abandoned Processing Yard for Welding 5, and Deep Jag for Welding 8 once its passage has been braced open. You never need Mining, Refining or Fabrication levels of your own to build one — every material can be bought or traded for.",
      "When you want a different container, you can swap in another kind without emptying the stash, as long as the new one has room for everything in it and the old one fits back in your Inventory. To take a container out altogether, empty the stash first.",
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "Stash Mounts at The Jag (Welding 1), Rusk Recovery and the Abandoned Processing Yard (Welding 5), and Deep Jag (Welding 8, after its passage is braced open).",
          "Choose a container to install at a built mount, then use the stash through the same storage screen as the Cargo Hold. Swap Container and Remove Container are under Container management. Any container you own works, and a stash has as many slots as its container.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "An installed container is not carried or worn, so it can't be traded, taken apart, or put in the Cargo Hold until you take it back out.",
        ],
      },
    ],
  },
  {
    // Issue #286 — the desktop Play workspace.
    slug: "room-to-spread-out",
    title: "Room to Spread Out",
    publishedAt: "2026-10-01T17:30:00-07:00",
    summary:
      "On a wide screen, Play now has a sidebar: your current Missions stay in view, and Chat, Inventory, Character, and Missions open beside the game instead of over it.",
    body: [
      "RuneSpace started as a game for phones, and on a phone it works exactly the way it did: buttons along the bottom, Chat on its own floating button, and everything else opening over the game. On a wide screen, though, that left a lot of empty room, and every trip to your Inventory or to Chat covered up the thing you were playing.",
      "Now, on a screen about 1280 pixels wide or more, Play uses that room. A sidebar runs down the right. Your current Missions stay at the top of it, always in view, and under them four tabs — Chat, Inventory, Character, and Missions — open right there, beside the game. Next to News at the top, a Location | Map switch flips between where you are and the map.",
      "Chat is the tab you start on. If you'd rather start somewhere else, open that tab and choose Set as default; RuneSpace remembers it for that character in that browser. Opening a different tab for a minute doesn't change it, and the Back button on that tab takes you home, to Chat or whichever tab you chose. Switching tabs won't lose a message you were halfway through typing, and a new Whisper or a trade request still lights up the Chat tab while you're busy in your Inventory.",
      "Phones and tablets are unchanged. If you make a window narrower, whatever you had open turns back into the usual panel over the game.",
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "On screens about 1280 pixels wide or more, a right-hand sidebar keeps your current Missions in view and docks Chat, Inventory, Character, and Missions beside the game as tabs.",
          "Set as default on any of those tabs chooses which one you start on, for that character in that browser. Chat is the default until you choose another.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "On wide screens Map is a Location | Map switch at the top, next to News, and the bottom bar and floating Chat button are not shown.",
          "Unsent Chat messages are kept when you move between tabs.",
        ],
      },
    ],
  },
  {
    // Issue #261 — public @mentions, blocked-player placeholders in General and
    // Trade, and hiding a Whisper conversation.
    slug: "heads-up",
    title: "Heads Up",
    publishedAt: "2026-10-01T00:15:00-07:00",
    summary:
      "You can now @mention a player in General or Trade to get their attention, a blocked player's messages leave a placeholder instead of a gap, and you can hide a Whisper conversation.",
    body: [
      "General and Trade are meant to be easy to ignore. Nothing there counts as unread, and that isn't changing. But sometimes you want one particular person to see a message — the player who asked for Shale an hour ago, or the one you're haggling with. Now you can say so.",
      "Type @ in General or Trade and a list of players appears: people who've been talking in chat, people you Whisper with, and people at your location. Pick one and their name drops into your message. That's what makes it a mention — typing a name by hand doesn't. You can mention up to five players in one message, and it still counts as one message toward the send limit. It works in promoted ads too.",
      "When someone mentions you, the message is marked as yours, the Chat/Social button lights up, and the General or Trade tab shows how many mentions you haven't seen. Open the channel and they clear, on every device.",
      "Blocking someone in a busy channel used to cut their messages out entirely, which could leave everyone else's replies looking like they were aimed at nothing. Now each of their messages leaves a short line in its place — their character's name, the time, and \u201cMessage hidden — blocked player\u201d — so you can follow the conversation without seeing a word they wrote. There's no way to reveal it short of unblocking them. Their mentions of you don't light anything up, and they still aren't told you blocked them.",
      [
        "Finally, a Whisper conversation you're done with can now be hidden. Hide takes it off your list and clears its unread, but deletes nothing, and the other player's list doesn't change. A new Whisper from either of you brings it back, and so does starting a Whisper with them by name. What all of this keeps, and for how long, is on the ",
        { text: "Safety & Privacy", articleSlug: SAFETY_PRIVACY_SLUG },
        " page.",
      ],
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "@mentions in General, Trade, and promoted ads: type @ and pick a player from the list.",
          "Mentions of you are marked in chat, light the Chat/Social button, and badge the General or Trade tab until you've read them, on every device.",
          "Hide on a Whisper conversation, which takes it off your list until the next Whisper or until you open it again.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "A blocked player's General and Trade messages now show as a hidden-message line with their name and the time, instead of disappearing.",
        ],
      },
    ],
  },
  {
    // Issue #274 — automatic System notices for recipe unlocks.
    slug: "something-new-to-make",
    title: "Something New to Make",
    publishedAt: "2026-09-30T22:30:00-07:00",
    summary:
      "Reaching a level that unlocks new Refining or Fabrication recipes now sends you a System message in Chat/Social listing exactly what you can make.",
    body: [
      "Hitting a new level used to unlock recipes quietly. Unless you went back to the console and looked, you could carry on for a while without knowing you could pour Galvanic Stock or wind a Galvanic Wire Spool. Now RuneSpace tells you.",
      "When you reach a Refining or Fabrication level that unlocks recipes, a message from System arrives in the Whispers tab of the Chat/Social panel, listing every recipe that just opened up. A big reward that carries you past several levels at once still lists everything you skipped over, in one message, so nothing slips by.",
      [
        "System sits pinned at the top of your Whispers and lights the Chat/Social button until you read it. It is RuneSpace itself, not a player, so there is nothing to reply to, block, or report. Which levels unlock what is on the ",
        { text: "Mining & Refining", articleSlug: "mining-and-refining" },
        " and ",
        { text: "Fabrication & Tinkering", articleSlug: "fabrication-and-tinkering" },
        " pages of the Wiki.",
      ],
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "A System message in Chat/Social → Whispers whenever a level unlocks new Refining or Fabrication recipes, naming every recipe it unlocked.",
          "System is pinned above your other Whispers, counts toward unread, and stays read once you have read it, on every device.",
        ],
      },
      {
        heading: "Changed",
        items: ['Player names and character names can no longer be "System".'],
      },
    ],
  },
  {
    // Issue #268 — the one announcement for direct player trading (#266
    // requests and sessions, #267 settlement, #268 the trading experience).
    // Never publish request limits, escalation thresholds, or how trades are
    // recorded or serialized.
    slug: "meet-me-there",
    title: "Meet Me There",
    publishedAt: "2026-09-30T20:00:00-07:00",
    summary:
      "You can now trade Credits and items directly with other players — in person, at the same location, with nothing moving until you both confirm.",
    body: [
      "You can finally hand things to other people. Trading in RuneSpace is face to face: find the player where they actually are, stand at the same location, and swap there. No auction house, no mail, no trading from across the map.",
      "Open the list of characters at your location, pick theirs, and choose Trade on their profile. They get a card at the top of their Chat/Social panel — it doesn't interrupt whatever they're doing — and they can Accept or Decline. A request only waits a short while, and you can cancel yours any time.",
      "Accepting opens the trade screen for both of you. Put in Credits, stacks of material, or gear you're carrying — a spare Cutter keeps exactly the charge it has, and the screen shows it. Choose Ready when the offers look right. Change anything and both of you have to Ready again, so nobody can agree to one deal and get another.",
      "When you're both Ready, the offers freeze into a final You Give / You Receive review, and you each Confirm. Nothing moves until both of you have confirmed; then it all moves at once. If something doesn't fit — a full Inventory, too much weight, or a trade that would leave someone without a working Cutter — nothing moves, you both see why, and you can fix it and try again.",
      [
        "Your own characters can trade with each other too, the same way, so moving Credits or gear between them is just a short walk. Refreshing or reconnecting puts you right back into the same trade. Everything else — what can be offered, Decline & Block for persistent requests, and what happens if a trade stalls — is in ",
        { text: "Player Trading", articleSlug: "player-trading" },
        " on the Wiki.",
      ],
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "Direct player trading between characters at the same location, started with Trade on a character's profile.",
          "Trade requests as cards in the Chat/Social panel, with Accept and Decline, and Decline & Block for a player who keeps asking.",
          "A trade screen for offering Credits, carried stacks, and carried gear, with Ready, Change Offer, and a final You Give / You Receive review before Confirm Trade.",
          "Trading between your own characters.",
          "A Player Trading page in the Wiki.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "A profile for one of your own characters now offers Trade only, without Whisper, Report, or Block.",
        ],
      },
    ],
  },
  {
    // Issue #248 — the one alpha announcement for the whole social stack
    // (#246 General/Trade, #247 Whispers/Block/Report) and its policies.
    slug: "open-channels",
    title: "Open Channels",
    publishedAt: "2026-09-30T09:00:00-07:00",
    summary:
      "General chat, Trade chat, and 1:1 Whispers are live in the Chat/Social panel, with Block and Report built in — and RuneSpace now has Community Rules and a moderation process behind them.",
    body: [
      "Holo Hollow has other people in it now, and you can finally talk to them. The Chat/Social button in Play opens a panel over whatever you are doing — the Map, a job, a walk — and closing it puts you right back where you were.",
      "General is for everything. Trade is for buying, selling, and price checks. If you want more eyes on a Trade post, a promoted ad costs 50 Credits, stands out, and shows up in both channels. Every account shares one send limit across its characters, and the indicator by the message box tells you when to slow down.",
      "Whispers are 1:1 conversations between characters. Start one from a name in chat, from a nearby player's profile, or by typing a character's exact name in the Whispers tab. A Whisper waits if the other player is offline, and unread Whispers light up the Chat/Social button.",
      "Block and Report sit next to every message and player. Block covers all of someone's characters: their public messages disappear for you, Whispers between you stop, and they are never told. Report sends the message, with a little of the conversation around it, to a real person for review. You can do both at once.",
      [
        "All of this comes with the ",
        { text: "Chat & Community Rules", articleSlug: COMMUNITY_RULES_SLUG },
        ". The short version: argue, trash talk, swear at the RNG — just don't attack people for who they are, harass, threaten, creep, scam, or spam. Reports are read by a person, not a bot. If a moderator acts on your account, you get a notice that says which rule, what's affected, for how long, and how to appeal.",
      ],
      [
        "Messages are kept for 90 days. Whispers are private from other players, but they are not end-to-end encrypted, and a moderator may review them when there is a real safety reason such as a report — and every time a moderator looks, it is recorded. ",
        { text: "Safety & Privacy", articleSlug: SAFETY_PRIVACY_SLUG },
        " spells out exactly what is kept, for how long, and who can see it.",
      ],
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "General and Trade chat in the Chat/Social panel, with recent history and older messages on demand.",
          "Promoted Trade ads: 50 Credits, shown in both General and Trade, one every 10 minutes per account.",
          "1:1 Whispers between characters, with unread counts that clear on every device.",
          "Block, with a Blocked Players list to undo it.",
          "Report Message and Report Player, with an optional note, plus Report + Block in one step.",
          "Chat & Community Rules and a Safety & Privacy page in the Wiki.",
          "Moderation notices with a case reference and an appeal you can send from inside RuneSpace.",
        ],
      },
    ],
  },
  {
    slug: "slag-without-the-shuffle",
    title: "Slag Without the Shuffle",
    publishedAt: "2026-09-29T19:00:00-07:00",
    summary:
      "Refining no longer stops because there is nowhere to put the Slag a failure might make. Auto-discard Slag is now one setting, shared by the Practice bench and the Refining console.",
    body: [
      "A long walk to the Abandoned Processing Yard could end with Refining refusing to run, because the game wanted room for the Slag a failed attempt might leave, even when you had no use for it. That was a trap, and it hit hardest right after the walk.",
      "Now the Slag from a failed Refined Ferrite or Galvanic Stock attempt is a bonus. You only need room for what you are actually refining. A failure still finishes the attempt, spends its ore and pays its Refining XP; the Slag is kept while there is room and thrown out where there is not.",
      "Refining also has the Auto-discard Slag switch the Practice bench already had, and it is one setting: change it at the Yard and the bench follows, and the other way around. Turn it on and the Slag from failed attempts is thrown out. The results say when Slag was discarded, so it never looks like you are carrying something you are not.",
      "The switch only covers the Slag a failure makes. The two Slag recipes still hand you the Slag you asked for and need room for it, and a failed Galvaferrite pour still gives back its input.",
    ],
    patchNotes: [
      {
        heading: "Changed",
        items: [
          "Refined Ferrite and Galvanic Stock attempts no longer need free room for the Slag a failure might make.",
          "A failed attempt keeps as much Slag as fits and throws out the rest, and it still finishes, spends its ore and pays its Refining XP.",
          "Auto-discard Slag is now one setting for your character, shared by the Practice bench and the Refining console.",
          "Refining results and history say when Slag was discarded instead of counting it as carried.",
        ],
      },
    ],
  },
  {
    slug: "eyes-on-the-map",
    title: "Eyes on the Map",
    publishedAt: "2026-09-28T18:00:00-07:00",
    summary:
      "Choosing where to walk no longer sends you scrolling: the Map keeps your destination and its Walk button just above the navigation bar. Edge arrows point toward an off-screen job, and the Journey shows its newest event first.",
    body: [
      "Picking a destination on the Map used to open its details underneath the map. On a phone that could mean scrolling a long way down to find the Walk button, and losing sight of the map you had just used to choose. Now a small panel appears just above the navigation bar the moment you select a location: its name, what's there, how long the walk takes, and the Walk button. The page does not move and the map stays usable — select another location to switch, or tap an empty part of the map to close the panel.",
      "The panel stays short on purpose. Details opens the location's full description inside the same panel, and selecting Details again puts it away; every new location starts short again, so the Walk button is always in view. Select the place you are standing and it says You are here; select somewhere with no path from where you are and it says No route from here. Neither pretends you can walk there.",
      "The arrows at the edges of the Map now all share one shape, turned to face their direction, and each one breathes from its own centre. When a job you have accepted points to a place that is scrolled out of view, the arrow toward it turns green for work still to do or blue for a hand-in, and goes back to normal once the place is on screen. A job someone is only offering never lights them up.",
      "On a Journey, the newest thing that happened is now at the top, marked Latest, with the rest of the walk below it. When something catches your eye, the Scavenge button is right there instead of under the rest of the trip.",
    ],
    patchNotes: [
      {
        heading: "Changed",
        items: [
          "Selecting a location on the Map opens a compact panel above the navigation bar with the Walk button, instead of details below the map.",
          "Details expands the location's description in the same panel; tap empty map space, or press Escape, to close the panel.",
          "The current location reads You are here, and a location you cannot walk to from here reads No route from here, with no Walk button.",
          "All four Map edge arrows share one shape and breathe from their own centre.",
          "An edge arrow turns green or blue when an accepted job's destination lies off-screen in that direction.",
          "The Journey lists its newest event first, marked Latest.",
        ],
      },
    ],
  },
  {
    slug: "what-can-i-refine",
    title: "What Can I Refine?",
    publishedAt: "2026-09-28T17:00:00-07:00",
    summary:
      "The Refining console now shows what you can refine right now as item tiles, with everything you know on a separate Recipes view — and Max and the bench's Auto-discard Slag setting now look switched on when they are.",
    body: [
      "The Refining console used to list every recipe it had, all the way up to Refining 8, as a column of text above the part you actually use. On a phone that pushed Start and the run's progress well down the screen, just to tell you about pours you could not make yet.",
      "Now it works like the Fabrication Station. Refine shows only what you can refine right now with what you are carrying, as item tiles with the artwork you already know from your Inventory, and the one you have picked is clearly marked. If a Mission is pointing you at a recipe you are short for, that one stays too, saying what it is missing. Recipes, beside it, lists everything your Refining level knows, whether or not you have the materials. What unlocks later is in the Wiki.",
      "A failed attempt now reads as one. The Slag a bad pour leaves, or the input a failed Galvaferrite pour hands back, is shown as what the failure left rather than looking like the thing you were making.",
      "Two small controls got the same treatment. Max, on the run-size control at the Yard, the bench, and the Fabrication Station, now lights up while it is chosen instead of only saying Max in the readout. The bench's Slag setting is now labelled Auto-discard Slag: On or Off, and it lights up when it is on. Neither one works any differently.",
    ],
    patchNotes: [
      {
        heading: "Changed",
        items: [
          "The Refining console has Refine and Recipes views. Refine lists the recipes you can start now as item tiles; Recipes lists every recipe your Refining level knows.",
          "Recipes you cannot start no longer sit above the Refining run controls. A recipe a Mission is guiding stays on Refine with what it is missing.",
          "A failed Refining attempt is headed as a failure, and its Slag or returned input is labelled as what the failure left.",
          "Max stays visibly selected on the run-size control while it is chosen.",
          "The Practice Welding bench's Slag setting reads Auto-discard Slag: On/Off and is visibly switched on when on.",
        ],
      },
    ],
  },
  {
    slug: "a-cut-above",
    title: "A Cut Above",
    publishedAt: "2026-09-27T16:00:00-07:00",
    summary:
      "Fabrication 5 and 8: make your own Power Cells, Galvanic Wire Spools and a second Mining tool, the Loadsteel Cutter, then a Freight Harness for six more Inventory slots. Tansy and Renn both have a job about that Cutter.",
    hero: {
      src: "/location-scenes/deep-jag-opened.webp",
      alt: "Cleared mine passage held open by a welded header beam on two yellow hydraulic braces, rubble pushed to the sides, tunnel running away into the dark",
      width: 1536,
      height: 384,
    },
    body: [
      "The Fabrication Station has more on it now, and your Fabrication level is the only thing that opens it. Reach Fabrication 5 and four new recipes appear; reach Fabrication 8 and a fifth does. They work Galvanic Stock and Galvaferrite, but you do not need any Refining of your own to use them — stock you bought or were handed works exactly as well.",
      "At Fabrication 5 you can turn one Galvanic Stock into two Scrap Metal, a Galvanic Wire Spool, or two Power Cells. The Cells come off the machine charged and ready — one batch is always two, so the tile says two however many batches you choose, and four batches make eight.",
      "The fourth Fabrication 5 recipe is the Loadsteel Cutter: two Galvaferrite, a Wire Spool and a Power Cell. It is a second Mining tool rather than a better Salvage Cutter, and it needs Mining 5 to equip. It is faster whether or not it is charged. A Power Cell does not speed it up further the way it does a Salvage Cutter; instead, every successful charged attempt gives one more ore than usual — two or three instead of one or two. One Cell is still ten charged attempts, and a new one comes off the machine empty.",
      "Fabrication 8 adds the Freight Harness, a heavy container that fits either container attachment and adds six Inventory slots. It weighs 9 kg, and that weight is carried like any other gear.",
      "Everything new can be taken apart by Tinkering on the same terms as before. Power Cells go two at a time, and Tinkering still will not take your last usable Mining Cutter, whichever kind it is.",
      "Once Brace Yourself is behind you, Tansy has one more lesson at The Jag when you reach Fabrication 5: get your hands on a Loadsteel Cutter and show her. However you came by it, carried or equipped, she only wants to look, and you keep it. Renn Calder, meanwhile, has been saving for one. Bring him any Loadsteel Cutter and he will pay for it.",
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "Fabrication 5 recipes: Scrap Metal from Galvanic Stock, Galvanic Wire Spool, Power Cells (two per batch) and the Loadsteel Cutter.",
          "Fabrication 8 recipe: the Freight Harness, a 9 kg container attachment that adds six Inventory slots.",
          "The Loadsteel Cutter: a second Mining tool that needs Mining 5, mines faster charged or not, and gives one more ore on every successful charged attempt.",
          "Tinkering for the Galvanic Wire Spool, Power Cells (as a pair), the Loadsteel Cutter and the Freight Harness.",
          "A Cut Above, from Tansy at The Jag after Brace Yourself at Fabrication 5 — 500 Fabrication XP.",
          "Cutting Costs, an optional job from Renn in Holo Hollow after Brace Yourself — 500 Credits for a Loadsteel Cutter.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "Loading a Power Cell, Cutter charge, and Mining timing now follow whichever Mining Cutter you have equipped.",
          "Selecting a piece of gear in your Inventory shows what it does, such as the slots a container adds or the Mining level a Cutter needs.",
          "Swapping one Mining Cutter for another stops a Mining run; start again to mine with the new one.",
        ],
      },
    ],
  },
  {
    slug: "return-the-favor",
    title: "Return the Favor",
    publishedAt: "2026-09-26T21:00:00-07:00",
    summary:
      "Tansy comes out to Rusk Recovery to teach Fabrication: brackets, a Scrap Box and a Salvage Cutter of your own at the new Fabrication Station, Manual Override if you want to push your luck, and Tinkering to take finished pieces apart again.",
    hero: {
      src: "/location-scenes/rusk-recovery.webp",
      alt: "Wade Rusk's recovery yard, with the Workbench and a terminal reading WORK ORDERS beneath the yard's sign, racked salvage under an overcast sky",
      width: 1536,
      height: 384,
    },
    body: [
      "Once you have finished 10,000 Hours, Tansy Rusk comes out to Wade's yard. She has a job for you: she made your first Salvage Cutter, and now you make one. Taking on Return the Favor opens the Fabrication Station and a new skill to train, Fabrication.",
      "Rusk Recovery now has two work areas. The Welding Workshop is the bench and the Work Orders terminal, exactly where they were; the Fabrication Station sits beside it. Pick one and that is what the yard lays out, while Wade and Tansy stay where they are.",
      "The station makes four things from Fabrication level 1: Mounting Brackets, Scrap Metal for practice welding, a Scrap Box — a heavy container that adds three Inventory slots — and a Salvage Cutter of your own, from Refined Ferrite and a Power Cell. Choose how many before you start, or Max to keep going until the next piece cannot start. A piece on the machine sets its materials aside until it is done: you cannot drop them or walk off, and there is no cancel. Stop After This Workpiece finishes it and ends the run there.",
      "Manual Override is there for more XP at more risk. Each piece gets a Load and a Trend; choose a Feed, and if it lands within two of where the Load moves, the piece's XP goes up by 1.20×, or 1.30× dead on. Miss, and the piece is wrecked — no item, no XP. Up to five pushes a piece, lock in whenever you like, and a piece whose timer runs out while you are deciding simply waits for you.",
      "Hand Tansy a Cutter and she shows you Tinkering: taking a finished piece apart for its full Fabrication XP and some Scrap Metal, at twice the time it took to make. That leads straight into Break It Down. Finish it and she heads back to The Jag, and Brace Yourself now follows Break It Down, still needing Mining 5 and Welding 5. 10,001 Hours needs none of it.",
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "The Fabrication skill.",
          "Return the Favor and Break It Down, from Tansy at Rusk Recovery once 10,000 Hours is done.",
          "The Fabrication Station at Rusk Recovery, with Mounting Bracket, Scrap Metal, Scrap Box and Salvage Cutter recipes and the same run-size control as Refining.",
          "Manual Override: optional pushes for up to 1.30× Fabrication XP each, at the risk of wrecking the piece.",
          "Tinkering: take a Mounting Bracket, Scrap Box or Salvage Cutter apart for Fabrication XP and Scrap Metal, with an Auto-discard Scrap setting. It never takes your last Mining Cutter.",
          "The Scrap Box, a 5 kg container that adds three Inventory slots.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "Rusk Recovery shows two work areas once the Fabrication Station is open; the bench and the Work Orders terminal are under the Welding Workshop.",
          "Tansy is at Rusk Recovery from 10,000 Hours until Break It Down is done.",
          "Brace Yourself now follows Break It Down instead of 10,000 Hours. If you already have it, you keep it — finish Tansy's chapter and she will be back at The Jag for the hand-in.",
        ],
      },
    ],
  },
  {
    slug: "how-many",
    title: "How Many?",
    publishedAt: "2026-09-26T11:00:00-07:00",
    summary:
      "Refining and Practice Welding now ask how many before you start — a number of batches or welds, or Max to keep going until you run out — and stop on their own. Refining 5 also adds two ways to make Slag on purpose.",
    body: [
      "Refining and practice at Wade's bench used to be all or nothing. Press Start and the work kept going until you stopped it or ran out of material, which meant a trip to the Processing Yard to refine a few pieces of shale could quietly eat the whole stack.",
      "Now both of them ask first. Before you start, pick how many: it starts at one, and the minus and plus buttons change it by one, up to as many as your materials pay for. When the last one you picked is done, it stops by itself. Or press Max, and it keeps going the way it used to — until there is no material or no room for another. While it runs you can see how far along you are.",
      "At the Processing Yard the number counts batches, and a batch counts whether it succeeds or fails — five batches is five attempts. A Max run has no number to reach: a failed Galvaferrite pour that hands back one of its inputs just leaves more to pour, so how many attempts it makes depends on how the pours go. Whichever you pick, if there is no room or no material for the next batch, the run ends there and tells you why. At the bench it counts whole practice welds, and a half-finished weld waiting on the bench is the first of them. Stop After Current Weld still works partway through a run, finishing the weld you are on and leaving the rest.",
      "If your inventory changes between choosing a number and pressing Start, neither one will quietly run fewer than you asked for. It tells you how many your materials now cover, and you choose again.",
      "Reaching Refining 5 also opens two new recipes for when you need Slag and do not feel like waiting for a bad pour: two Ferrite Shale into one Slag, or two Galvanite into two. They never fail, they are quick, and they pay about what a failed attempt does — useful, not a shortcut for training.",
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "A run-size control on the Refining console and the Practice Welding bench: starts at 1, with minus, plus, and Max to keep going until you run out.",
          "Progress through the chosen run while it is working, and a message when it completes.",
          "Two Refining 5 recipes that always succeed: 2 Ferrite Shale into 1 Slag, and 2 Galvanite into 2 Slag.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "Refining runs the number of batches you choose — failed attempts included — then stops by itself. Max keeps going until the next batch cannot start.",
          "Practice Welding runs the number of whole welds you choose, then stops by itself with the bench clear. Max welds until the Scrap runs out.",
          "Starting with a number that no longer fits your inventory is refused, showing how many your materials now cover, instead of running a different amount.",
        ],
      },
    ],
  },
  {
    slug: "price-check",
    title: "Price Check",
    publishedAt: "2026-09-26T01:00:00-07:00",
    summary:
      "Scrap Metal now stacks three to a slot, Wade and Bix have new prices and a daily limit of twelve, Keep the Change pays 36 Credits, and the Work Orders that use Power Cells pay more.",
    body: [
      "Scrap Metal stacks now. Three pieces share one inventory slot, so the six Wade hands you for 10,000 Hours take two slots instead of six, and a trip to the bench is a lot less of a packing puzzle.",
      "Wade and Bix have both repriced. Wade sells Scrap Metal at 4 Credits a piece and will now take spare scrap back at 1. Bix sells Power Cells at 12 Credits each and buys them back at 4. Each of them now sells any one character at most twelve a day — twelve Scrap from Wade, twelve Power Cells from Bix — and the counter shows how many you have left. The count starts again at midnight Pacific time, the same moment the Annex allotment and ForceSales' refresh come back.",
      "The limit is on what you buy from them, not on what you own. Selling back doesn't earn you more for the day, and Cells from the Annex or the Scrap Wade gives you for 10,000 Hours never count against it.",
      "Wade still pays Keep the Change's budget up front at exactly what three Cells cost from Bix, so that job now hands over 36 Credits. And because a Work Order's pay covers what it would cost you to replace its materials, the five jobs that use up a Power Cell now pay a little more.",
    ],
    patchNotes: [
      {
        heading: "Changed",
        items: [
          "Scrap Metal stacks up to three to an inventory slot. Using scrap at the bench frees a slot only when it empties a stack.",
          "Wade sells Scrap Metal at 4 Credits each (up to 12 per character per day) and buys it back at 1.",
          "Bix sells Power Cells at 12 Credits each (up to 12 per character per day) and buys them back at 4.",
          "The Trade counter shows how many of Wade's Scrap and Bix's Power Cells you can still buy today, and Max accounts for it.",
          "Keep the Change hands over 36 Credits when you take the job — still exactly the price of three Cells from Bix.",
          "Work Orders that use Power Cells pay more: Cracked Cutter Housing 120, Electric Cargo Dolly 210, FurBaby™ Repair 115, Powered Cable Puller 230, and Speeder Power Cradle 280 Credits.",
        ],
      },
    ],
  },
  {
    slug: "network-administrator",
    title: "I Am the Network Administrator",
    publishedAt: "2026-09-20T14:00:00-07:00",
    summary:
      "Refining 5 turns Galvanic Stock into real client work — eight new jobs at Wade's terminal — and unlocks ForceSales Free's one free queue refresh a day.",
    body: [
      "Deep Jag gave you a reason to refine Galvanite into Galvanic Stock. Refining 5 gives you a reason to keep making it: Wade's terminal has eight new jobs that need it, on top of the eight you already know.",
      "Every one of them goes to somebody already on the board. Greta Voss's countertop cooker joins her heater housing. Bix Weller's old souvenir-shop display joins his sagging shelving. Renn Calder needs his helmet charging rack looked at, on top of the carry frame he already brought you. It is the same eight clients, and now each one has brought a second thing in — Holo Hollow is small enough that a repair shop sees the same names twice.",
      "One of them is Tansy's. She has had a FurBaby™ companion toy since she was a kid, and its conductive rail and Cell socket have finally given out. She would like it fixed, not replaced, and she is not going to tell you where she got it.",
      "The originals still pay in Refined Ferrite. This new batch runs on Galvanic Stock — with Refined Ferrite or a Power Cell layered in where the fiction actually calls for it, the same way it always has. Nothing about the eight jobs you already know has changed, and nothing about how you take a job, weld it, or get paid is any different for these.",
      "Reaching Refining 5 also does something to the terminal itself. It runs ForceSales — commercial software, not something built for Wade, and he is on the free tier. Free tier gets you one thing: a full refresh of every unaccepted posting, once a day, RuneSpace Pacific time. A job already on the bench is never touched by a refresh, whatever else changes around it. There is still no auto-rotation and no reroll on level-up; the board only ever changes because you finished a job or spent your day's refresh.",
      "Ask Wade about it and he will tell you, in exactly as many words as he ever uses, that ForceSales thinks he should talk to his Network Administrator about upgrading to Pro. He is aware of the joke. He is not upgrading.",
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "Eight new Work Orders at Refining level 5, one more job for each of the eight clients you already know: Greta Voss, Bix Weller, Tansy Rusk, Renn Calder, Otis Mott, Mara Kells, Pell Larkin, and Juno Stemp. All run on Galvanic Stock.",
          "ForceSales Free's daily board refresh: once you have the board and Refining level 5, refresh every unaccepted posting once per RuneSpace Pacific day. A job already on the bench is never touched.",
          "A ForceSales topic when you talk to Wade, once the refresh is unlocked — his side of why the yard is still running the free tier.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "The Work Orders terminal now credits ForceSales Free as the software running it, alongside the same job board you already use.",
        ],
      },
    ],
  },
  {
    slug: "know-your-character",
    title: "Know Your Character",
    publishedAt: "2026-09-19T17:00:00-07:00",
    summary:
      "The far-left footer button is Character now. It is the character you are actually playing: portrait, name, Credits, every skill you have, and one Character Level that finally means something.",
    body: [
      "Until today, finding out how your character was doing meant piecing it together. Credits were in your Inventory. Your Mining level was at The Jag, your Refining level at the Processing Yard, your Welding level wherever you happened to be welding. The only place you could see a whole character at once was somebody else's — the profile that opens when you tap a name in the list of characters standing around you.",
      "So the far-left footer destination has stopped being Characters and become Character: yours, the one you are playing right now. It opens the same way Inventory does, over the top of what you were doing, and it closes the same way.",
      "At the top is your portrait, your name, your Character Level, and your Credits. Credits are still in your Inventory too — that is deliberate, because you want them while you are packing and you want them while you are sizing up your character.",
      "Below that is every skill RuneSpace has, not just the ones you have used. Each one shows the level you are and how far through that level you are, which is the question that actually matters when you are deciding whether one more run is worth it. A skill you have never touched is Level 1 with a bar at zero, sitting there waiting.",
      "Character Level is the new part. It is one number for everything you have trained: you start at Level 1, and every skill level you earn adds one. Mining 4, Refining 2 and Welding 1 makes you Character Level 5. All three at Level 1 makes you Character Level 1. It is not the sum of your levels, and there is no separate Character XP bar to grind — the number just follows your skills, so training anything moves it.",
      "Because skills begin at Level 1, a skill you have not trained is worth nothing toward it. That is the point: when RuneSpace adds a fourth skill, nobody's Character Level jumps or drops overnight. It only moves when you do.",
      "The level next to a character's name in the list of people at your location is that same Character Level now, and so is the one on their profile. Before today those two could disagree with each other, because they were counting different things.",
      "Switching characters has not gone anywhere — it has moved one step in. Character, then Switch Character, and you are at the same selection screen as always. It is pinned to the bottom of the panel rather than sitting under the skill list, so it stays where you can reach it no matter how many skills you eventually have.",
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "A Character screen on the far-left footer destination, showing the character you are playing: portrait, name, Character Level, and Credits.",
          "Every skill in the game listed on that screen with its current level and progress toward the next one, including skills you have not trained yet.",
          "A Switch Character action pinned to the bottom of the Character screen, which opens the existing character selection.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "The far-left footer destination is now Character and opens your own profile; character selection is one step further in, behind Switch Character.",
          "Character Level is one definition everywhere: 1 plus every skill level you have earned. The profile panel for a nearby character and the level beside their name in the list now both show it.",
          "A future skill will appear on the Character screen and in a nearby character's profile on its own, without changing anyone's existing Character Level.",
        ],
      },
    ],
  },
  {
    slug: "brace-yourself",
    title: "Brace Yourself",
    publishedAt: "2026-09-19T09:00:00-07:00",
    summary:
      "There is a passage under The Jag that has been shut since before you got here. Tansy has the brace. You have the torch. Below it is harder ore than anything you have cut so far.",
    hero: {
      src: "/location-scenes/deep-jag-opened.webp",
      alt: "Cleared mine passage held open by a welded header beam on two yellow hydraulic braces, rubble pushed to the sides, tunnel running away into the dark",
      width: 1536,
      height: 384,
    },
    body: [
      "Look at your map. Southwest of The Jag, a little further down than anything else out there, is a hex that has been marked CAVE-IN since the day you made your character. You can select it. You cannot walk into it. Nobody has ever said a word about it.",
      "That is Deep Jag, and it is Tansy's. The lower workings came down long before you arrived, and she has never mentioned it because there was nothing to mention: reopening it is two people's work, and until now you were not the second one. Finish 10,000 Hours, get your Mining and your Welding both to level 5, and she will bring it up.",
      "Brace Yourself is the job. She supplies the brace and the jack — that hardware is hers and it stays hers. What she needs is somebody to haul the stock down and weld the support together under a roof that already fell once. That comes to 25 Refined Ferrite and 5 Power Cells, installed in as many trips as you like, and then fifteen welding passes.",
      "The fifteenth pass is the one to watch. The moment it lands the passage is open: the rock is pushed back to the sides, the brace is standing where you welded it, the map reads MINING, and you can start cutting immediately. No walk back to Tansy first, no second thing to unlock. Her 250 Welding XP is waiting at The Jag whenever you next go up, on top of the 750 the work itself paid.",
      "What is down there is Galvanite — dark rock shot through with bright conductive veining, which the crews call live rock and which does not, before you ask, generate any power on its own. It is harder going than shale: about nine seconds an attempt against six, a lower success rate that keeps climbing until Mining 40, and 400 grams a piece against shale's 100. A full container out of Deep Jag is a much shorter trip than a full container out of The Jag.",
      "It also gives the Processing Yard two new things to do. Every recipe is listed at the console now, including the ones you cannot run yet, so you can see what is coming and what it will cost. Two Galvanite becomes one Galvanic Stock at Refining 5. One Refined Ferrite and one Galvanic Stock alloy into Galvaferrite at Refining 8 — and when that one fails, one of the two inputs comes back and the other is gone.",
      "Bix takes Galvanite at 4 Credits and Galvanic Stock at 18. Wade has started buying structural material back out of his own yard as well: Refined Ferrite at 10, Galvanic Stock at 18, and Galvaferrite at 45. Where he and Bix both buy the same thing, they pay the same for it. Galvaferrite has nothing to make out of it yet. Sell it or stack it — it is the best thing you can currently produce, and it is going somewhere.",
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "Deep Jag, a new location southwest of The Jag and reachable only from it. It is on your map from the start, marked CAVE-IN, and cannot be walked into until you reopen it.",
          "Brace Yourself, Tansy's job to reopen the collapsed passage. Needs 10,000 Hours finished plus Mining level 5 and Welding level 5; it does not need 10,001 Hours.",
          "The cave-in repair: 25 Refined Ferrite and 5 Power Cells, installable across as many visits as you like, then fifteen welding passes for 750 Welding XP. Turning the job in with Tansy pays 250 more.",
          "Galvanite Mining at Deep Jag once the brace is in — about nine seconds an attempt, one or two per success, 25 Mining XP, and a success rate that keeps improving until Mining 40. Your Salvage Cutter handles it, and a charged Power Cell halves the time the same way it does at The Jag.",
          "Two Refining recipes: Galvanic Stock from two Galvanite at Refining 5, and Galvaferrite from one Refined Ferrite and one Galvanic Stock at Refining 8. A failed alloy hands back one input and loses the other.",
          "Galvanite, Galvanic Stock and Galvaferrite as carryable material, with their own artwork and stack limits.",
          "Bix buys Galvanite at 4 Credits and Galvanic Stock at 18. Wade buys Refined Ferrite at 10, Galvanic Stock at 18, and Galvaferrite at 45.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "The Refining console lists every recipe, including ones your Refining level is too low for, each showing what it needs and the level it wants.",
          "A place can now change what it is. Deep Jag is one location whose scene, map status and available work all follow the state of its repair rather than being fixed.",
          "The local map scrolls in both directions now that it reaches further south, using the same edge markers it already used for left and right.",
          "Mining run totals name the ore you are actually cutting instead of always saying shale.",
          "Wade's counter has a Buy and a Sell side now that he buys material back.",
        ],
      },
    ],
  },
  {
    slug: "ten-thousand-one-hours",
    title: "10,001 Hours",
    publishedAt: "2026-09-17T09:00:00-07:00",
    summary:
      "Wade's terminal stops being empty. Reach Welding level 5, take 10,001 Hours, and the Work Orders board is yours to keep — paying jobs, real Credits, and a Workbench that now has to mind its manners about sharing.",
    hero: {
      src: "/location-scenes/rusk-recovery.webp",
      alt: "Wade Rusk's recovery yard, with the Workbench and a terminal reading WORK ORDERS beneath the yard's sign, racked salvage under an overcast sky",
      width: 1536,
      height: 384,
    },
    body: [
      "Wade's terminal has been sitting in the corner of his yard since the day 10,000 Hours opened the Workbench, and it has stayed exactly as empty as he told you it would be. That changes now. Put in the Welding hours and he will hand you 10,001 Hours — the first real client job off that terminal, and the last thing standing between you and the whole board.",
      "10,001 Hours needs two things: Welding level 5, and Wade deciding you have earned it. Accept the job and the terminal comes alive with three postings at once. Take one, weld it at the Workbench, and get paid. Finish it and Wade fills the empty slot with something new, so there are always three to choose from. Turning 10,001 Hours in afterward is just Wade looking at the work — accepting it is what actually unlocks the board, and it stays unlocked whether or not you have handed the mission in yet.",
      "Taking a posting hands over its materials the moment you accept — no getting them back once you have. Weld it at the Workbench the same way you would a practice piece, and finishing it pays real Credits on top of Welding XP for every section you completed. There is no way to abandon a job partway through; the only way it leaves the bench is finishing it.",
      "Because a client's property and your own practice now share one Workbench, the bench only ever holds one of them at a time. An unfinished practice weld counts as occupying it even after you have Stopped it, so a new Stop After Current Weld control lets that weld run to its natural end without starting another one on your dime — the bench is clear the moment it is done.",
      "Clean Pass grew up to match. It used to open exactly twice in any welding job; now how many chances you get depends on how long the job actually is — short jobs get none at all, and the longer client jobs on the board can turn up two or three. Catching one hasn't changed: time it right and the work jumps forward a whole extra section, for that section's XP, and missing one still costs nothing.",
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "Work Orders are playable at Rusk Recovery. Take a posting off the terminal, weld it at Wade's Workbench, and get paid in Credits and Welding XP.",
          "10,001 Hours, the mission that opens the Work Orders board for good. Wade offers it at Rusk Recovery once you reach Welding level 5, and accepting it — not finishing it — is what unlocks the board.",
          "Stop After Current Weld, a control at the Workbench that lets the weld already on the bench finish without starting another one after it.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "The Workbench now holds one piece of work at a time. A client's Work Order and an unfinished practice weld can't occupy it together — finish or clear one before starting the other.",
          "Clean Pass now scales with a job's length instead of always offering exactly two chances: none under six sections of welding, and roughly one more for every five sections beyond that.",
        ],
      },
    ],
  },
  {
    slug: "where-to-look",
    title: "Where to Look",
    publishedAt: "2026-09-15T16:00:00-07:00",
    summary:
      "Every place in the game now lays itself out the same way, and the thing you came to do is on screen when you get there instead of three scrolls down.",
    body: [
      "RuneSpace has been picking up places faster than it picked up a way to lay one out. The Jag put mining controls in the middle of the location panel with nothing naming them. The Crash Site put the Cargo Hold in a panel inside a panel. Rusk Recovery put the workbench underneath everything. Each screen was fine on its own and none of them agreed with any other, and on a phone the thing you actually walked there to do was usually below the fold.",
      "So every location now reads the same way. The place is at the top: its artwork, what it is, who else is standing there, and the person you can talk to. Underneath that, in its own panel with its own name, is what you can do here — Mining, Refining, Practice Welding, a repair, the Annex claim. Then the things that activity needs you to know, and then the run you are in the middle of.",
      'The place used to introduce itself three times before it said anything: its name on the artwork, its name again underneath, and the word "Location" over the top of that. It says it once now. Bix, Wade, Tansy, Renn and Mara are a row rather than a card — name, what they do, Talk, and Trade where there is trading — which keeps them near the top of the screen without taking a third of it.',
      "The numbers that follow an activity got a lot smaller. Your level and the XP to the next one is a line. What you are carrying that matters here — the shale, the scrap, your slots, your weight — is a line. The run you are in is a line of totals with a History button beside it, instead of a permanent list of your last ten attempts. Nothing was taken away; it just stopped taking up half the screen to say it.",
      "Two repairs were quietly not telling you something. Welding the Cargo Hold and welding the Crew Stop both earn Welding XP, and neither showed your Welding level while you did it. They do now, the same way the workbench does.",
      "Trade opens as its own panel over the top of the screen, the way conversations already did, rather than unfolding the whole shop between you and the room you are standing in.",
    ],
    patchNotes: [
      {
        heading: "Changed",
        items: [
          "Every stationary location now composes the same way: the place and its people first, then the activity in its own named panel, then that activity's context and current run, then anything that is genuinely a separate system.",
          "Mining and Refining are named on screen. Both were previously unlabelled controls in the middle of the location panel.",
          'Removed the duplicate location name and the "Location" / "Local place" heading above every place\'s description.',
          "The resident is a compact row rather than a card, keeping the person and their Talk and Trade controls high on the screen.",
          "Who else is at a location moved up beside the resident and reads as the place's own information.",
          "Skill progression, carried materials and the current run are compact rows inside the activity's panel instead of three standalone cards below it.",
          "Trade opens in a panel over the screen instead of expanding inline inside the place.",
          "Inside every activity the controls come first and the text explaining them follows, so the primary control is on screen when you arrive.",
        ],
      },
      {
        heading: "Added",
        items: [
          "Welding progression is now shown on the Cargo Hold repair and the Crew Stop repair, both of which award Welding XP.",
          "A History control on Mining, Refining and Practice run summaries, which opens that run's previous attempts.",
        ],
      },
      {
        heading: "Fixed",
        items: [
          "A run's most recent attempt is no longer shown twice on the same screen. The History list holds the attempts before it.",
          "The Refining run no longer repeats the carried Refined Ferrite and Slag shown directly above it.",
          "Attempt history no longer scrolls inside the page; it opens in the page itself.",
        ],
      },
    ],
  },
  {
    slug: "ten-thousand-hours",
    title: "10,000 Hours",
    publishedAt: "2026-09-15T09:00:00-07:00",
    summary:
      "Wade Rusk has a yard, a workbench, and six pieces of scrap with your name on them. Welding stops being something two jobs needed and starts being something you can just go and get better at.",
    hero: {
      src: "/location-scenes/rusk-recovery.webp",
      alt: "Working recovery yard with racked salvage, stripped components, damaged work vehicles, and a welding bench under an overcast sky",
      width: 1536,
      height: 384,
    },
    body: [
      "Wade has been standing at your crash site since the first day, which was never where he actually worked. Finish Keep the Change and Tansy will call him from The Jag to tell him his apprentice did a proper job — and he'll tell you, in about as many words as he ever uses, to come by the shop.",
      "The shop is Rusk Recovery, a recovery yard on the northwest edge of Holo Hollow, one ordinary walk from town. It has been on your map from the beginning. What's different is that Wade is in it now, and that he has something to offer when you walk in.",
      "That something is bench time. Take 10,000 Hours from him and he hands over six pieces of scrap metal on the spot — three welds' worth — and opens the workbench. He is not letting you near a client's property yet. People bring him things they cannot afford to lose twice, and you have not earned that.",
      "Practice welding is the real thing, not a tutorial. Two pieces of scrap go in, ten sections of welding come out, and you get a reduced share of the usual Welding XP because nothing is actually being repaired. Keep the slag or set the bench to throw it out; Bix still pays a Credit apiece if you keep it. Start once and the bench keeps going, weld after weld, until the scrap runs out — including while you are away from the screen. Stop whenever you like: the half-finished weld and the scrap you already spent are waiting when you come back.",
      "Welding also picked up something new, everywhere it happens. Twice in any weld — practice, the Cargo Hold, the Crew Stop — a moment opens up where the bead is running clean and you can lay one in. Take it in time and you get a whole extra section of progress and the XP that goes with it. Miss it and nothing at all happens; it costs nothing to let one go. You will know when you catch one.",
      "Three practice welds and Wade will look at your hands, tell you the last one is better than the first, and pay you fifty Credits for the day. Out of scrap? He sells it, two Credits a piece, same as he'd charge anybody. And the beaten-up terminal in the corner of the yard — the one you have been walking past — is where the paying work comes in. Not yet. But that is where it comes in.",
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "Rusk Recovery, Wade's recovery yard northwest of Holo Hollow. Visible and walkable from the start of the game, one ordinary 24-second walk from town.",
          "10,000 Hours, the next main-story job. Wade offers it at his own yard once Keep the Change is finished; accepting it hands you six Scrap Metal and opens the workbench.",
          "Practice Welding at the workbench: 2 Scrap Metal per weld, ten sections, up to 2 Slag out, and 10 Welding XP a section. One Start keeps welding until the scrap runs out, including while you are offline.",
          "Scrap Metal, sold by Wade at 2 Credits a piece. It is fungible but does not stack, so each piece takes an inventory slot.",
          "Clean Pass, on every kind of Welding. Two moments in each weld where a well-timed pass is worth an extra section and its XP; missing one costs nothing.",
          "A persistent Keep Slag / Auto-discard Slag setting for the bench, applied when each weld finishes.",
          "Finishing 10,000 Hours pays 50 Credits and reveals the Work Orders terminal at Rusk Recovery. There are no Work Orders to take yet; real client work will need Welding level 5.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "Wade Rusk now works out of Rusk Recovery once Keep the Change is finished, and is no longer found at the Crash Site.",
          "Turning in Keep the Change ends with Tansy calling Wade, and Wade telling you where to find him.",
        ],
      },
    ],
  },
  {
    slug: "out-of-the-weather",
    title: "Out of the Weather",
    publishedAt: "2026-09-12T20:30:00-07:00",
    summary:
      "Renn Calder has an optional job nobody else wanted: fix the Crew Stop on the haul road. Do it, and the mining crews start letting you ride along.",
    hero: {
      src: "/location-scenes/holo-hollow-crew-stop-repaired.webp",
      alt: "Roadside crew shelter at dusk, its canopy whole and squared on welded bracing with the bench remounted along the back wall, mine workings lit beyond",
      width: 1536,
      height: 384,
    },
    body: [
      "The Crew Stop has been standing out on the haul road the whole time. It's where the mining crews wait for the shift hauler out to The Jag, and it's in a bad way — the canopy sags at one corner, the bench leans with it, and most mornings the crews stand in the weather instead. Everybody complains about it. Nobody owns it enough to fix it.",
      "Once you've finished Hold It Together, Renn Calder will mention it. Taking the job is entirely your call: it isn't part of the main story, nothing is waiting on it, and ignoring it forever closes nothing off. It also isn't free. Twenty Refined Ferrite and ten welding passes come out of your own pocket and your own afternoon. You can put in some of the ferrite, go and get more, and come back — the shelter isn't going anywhere.",
      "What you get back is the point. The Crew Stop stays repaired, permanently and visibly. And because the crews use it every workday and know exactly who fixed it, they'll squeeze you onto the shift hauler out to The Jag for five Credits — a ride you board at the repaired Crew Stop itself. Only on the way out, mind: coming back the hauler is loaded with shale and there is no room for a passenger, so the walk home is still yours.",
      "Walking hasn't changed at all. It's still free, still goes through The Long Scramble, and still gives you a chance to scavenge on the way. There's nothing to find on the back of a hauler, so the trade is the same every time you make it: spend the time and maybe turn something up, or spend the Credits and get there.",
      "This is the first thing in RuneSpace you can choose to do purely because it makes the place better, and have the world stay that way afterwards. It won't be the last.",
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "Out of the Weather, an optional side job offered by Renn Calder in Holo Hollow once you've finished Hold It Together. Keep the Change is not required, and taking or skipping this job never affects the main story.",
          "The Crew Stop, a new place in Holo Hollow. It's visible from the start, and it visibly stays repaired once you fix it.",
          "Welding now has a second job to do. The Crew Stop repair needs 20 Refined Ferrite, no Slag, and ten welding passes, using the same Welding skill you already have.",
          "The Crew Hauler: a 5-Credit ride from Holo Hollow out to The Jag, unlocked by finishing Out of the Weather. Outbound only, charged every trip, and a real journey rather than a teleport — the walk back is unchanged.",
          "Finishing Out of the Weather earns 250 Welding XP on top of what the welding itself paid you.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "Welding jobs now each carry their own material recipe and pass count. The Cargo Hold repair is unchanged: still 15 Refined Ferrite, 6 Slag, and twelve passes.",
        ],
      },
    ],
  },
  {
    slug: "following-the-job",
    title: "Following the Job",
    publishedAt: "2026-09-12T08:00:00-07:00",
    summary:
      "The Map now spells out MISSION and TURN IN in plain text, every accepted job gets a compact strip at the top of the screen, and a finished job turns blue.",
    body: [
      "Guidance used to run out at the edge of the room you were standing in. If a job's next step was somewhere else, you knew a location was probably relevant, but nothing on the Map actually said so — and once every objective on a job was done, the person waiting to receive it still glowed the same green as work you hadn't finished yet.",
      "The Map now labels a hex MISSION when it's where an accepted job needs you next, and TURN IN when it's where a finished job gets handed in — each with a glowing outline around the hex, visible from anywhere on the Map, not just once you arrive. Get there and the same handoff you already know continues as normal: a building's Enter lights up, then the person inside.",
      "Blue is now reserved for conversations: someone with a new job for you, or the person waiting for one you've already finished. Green always means there's still work to do. And when a job can genuinely be finished more than one way — three Power Cells can come from your Inventory, the Annex, or Bix's shelf — nothing gets highlighted for that step. That choice stays yours.",
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "The Map labels a hex MISSION when it's an accepted job's destination, and TURN IN when it's where a finished job is handed in, each with a glowing outline.",
          "A finished job's hand-in point is now highlighted even from elsewhere, before you've arrived there.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "The person you hand a finished job to is now highlighted blue instead of green.",
          "Green now always means there is work still to do.",
          "Your accepted jobs now sit at the top of the screen as compact strips, one per job — green while work remains, blue once a job is ready to hand in. They stay there on the Map and while you travel.",
        ],
      },
      {
        heading: "Fixed",
        items: [
          "The keyboard focus outline is now visible on buttons, including buttons highlighted for a job. Clicking or tapping a button doesn't show it.",
        ],
      },
    ],
  },
  {
    slug: "keep-the-change",
    title: "Keep the Change",
    publishedAt: "2026-09-11T20:00:00-07:00",
    summary:
      "Wade makes you his apprentice, hands you 24 Credits for a three-cell job, and sends you to meet the man who keeps the useful things on a shelf.",
    hero: {
      src: "/location-scenes/hh-bnb-exterior.webp",
      alt: "Converted family bed-and-breakfast serving as a working inn, with a hand-lettered HH B&B sign",
      width: 1536,
      height: 384,
    },
    body: [
      "The Cargo Hold is holding, so Wade Rusk has decided what to do with you: you are his apprentice now, and he is not asking. Go back and talk to him at the Crash Site once Hold It Together is done. This one does not arrive on its own.",
      "While you are standing there, Tansy calls in from the seam. She is out of Power Cells and her Cutter is dead weight. She needs three, Wade has none, and Bix charges eight apiece — so Wade hands you twenty-four Credits and a piece of advice: if you already have cells, or you know a cheaper way, keep what you do not spend. That is the whole point. If the Annex or your existing stash covers the job, Wade really does mean it: keep the budget.",
      "You still have to go and see Bix. Not to buy anything — Wade just thinks his apprentice ought to know the person who keeps useful things on a shelf. Bix will explain why an automated depot up the road gives Power Cells away for nothing while he sells them for eight, and the answer turns out to involve a tourism-era Settled Systems contract that nobody ever got around to cancelling.",
      "You will also meet Mara Kells, who owns the HH B&B and has an opinion about Wade taking on an apprentice. Get Tansy her cells, and the rooms that were held for locals and working crews are open to you too.",
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "Keep the Change is a new job from Wade Rusk, available after Hold It Together. Talk to Wade to take it on — it does not start by itself.",
          "Accepting it hands you 24 Credits up front. Whatever you do not spend is yours to keep, and there is no second payout at the end.",
          "Meet Bix Weller in Holo Hollow as part of the job, whether or not you need to buy anything from him.",
          "Bix explains the DeWhat? Emergency Power Annex: an old Settled Systems emergency-power contract from the tourism years that is still running, and why he sells Power Cells anyway.",
          "Mara Kells is introduced during that conversation and can be talked to at the HH B&B afterwards.",
          "Finishing the job opens HH B&B, which was previously visible but closed to outside guests.",
          "The Wiki covers the Annex's history, why free and paid Power Cells coexist, and how Keep the Change works.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "The DeWhat? Emergency Power Annex description now says what the depot actually is. Its daily allotment of five Power Cells per character is unchanged.",
        ],
      },
    ],
  },
  {
    slug: "holo-hollow-opens-for-business",
    title: "Holo Hollow Opens for Business",
    publishedAt: "2026-09-10T20:00:00-07:00",
    summary:
      "The town you have been hearing about is finally on the map. Walk into Holo Hollow, meet Bix and Renn, and spend your first Credits.",
    hero: {
      src: "/location-scenes/holo-hollow.webp",
      alt: "Weathered main street of Holo Hollow, faded holo-tourism signage above working shopfronts under an overcast sky",
      width: 1536,
      height: 384,
    },
    body: [
      "Wade and Tansy have been talking about Holo Hollow since the day you crawled out of your ship. It is now a real place you can walk to — one hex out from the Crash Site, the Power Annex, and the bottom of the Long Scramble.",
      "Holo Hollow is a mining town built on the bones of a tourist town, and it has not entirely decided which one it is. Step off the street and into the places that are open: Holo Hollow Souvenirs + Mining Supplies, where Bix Weller keeps mining supplies under a sign that still advertises novelty holo toys, and the Community Assistance Center, where Renn Calder can tell you what the place used to be. HH B&B is there too, though the rooms are held for locals and regular crews for now.",
      "Your character also has Credits — ten of them to start, whether the character is new or one you have been playing. Bix will buy Ferrite Shale, Refined Ferrite, Slag, and spare Power Cells, and he will sell you Power Cells at eight Credits apiece. He is aware that is more than he pays for them, and he will tell you why if you ask.",
      "Talking and trading are separate. You can ask Bix about the shop without buying a thing, and you can buy a Power Cell without hearing the whole story of the projector nights. Both are worth doing.",
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "Holo Hollow is a new location on the map, reachable from the Crash Site, the Emergency Power Annex, and The Long Scramble.",
          "Holo Hollow Souvenirs + Mining Supplies and the Community Assistance Center can be entered from the town; HH B&B is visible but closed to outside guests for now.",
          "Bix Weller and Renn Calder are new people to talk to, each with several subjects you can revisit any time.",
          "Credits are a new per-character currency. Every character starts with 10.",
          "Trade with Bix: buy Power Cells for 8 Credits each, and sell Ferrite Shale (2), Refined Ferrite (10), Slag (1), or spare Power Cells (3).",
          "Your Credit balance is shown while trading and in your Inventory.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "Stepping into a shop or building in town is instant — it is not a journey, it does not interrupt anything, and the map still shows you in Holo Hollow.",
        ],
      },
    ],
  },
  {
    slug: "cargo-hold-is-easier-to-scan",
    title: "The Cargo Hold Is Easier to Scan",
    publishedAt: "2026-09-09T20:00:00-07:00",
    summary:
      "Deposit and Withdraw now work from a compact grid you select into, instead of a long list of permanent buttons.",
    body: [
      "The repaired Cargo Hold at the Crash Site started to feel heavier than it should the moment you had more than a few things stored in it. Every stack and every unique item rendered as its own tall row with WITHDRAW 1 and WITHDRAW STACK sitting there permanently, whether you needed them or not, and Carried Inventory did the same thing on the deposit side.",
      "Cargo and Carried now render as a compact grid of tiles — the same artwork, name, and quantity you're used to, just smaller and side by side. Select a tile and the Deposit or Withdraw actions for that one item appear below it. Select something else and the actions move with it.",
      "Nothing about what the Cargo Hold can hold or how a transfer works has changed. Stack limits, unique-item handling, and the 32-slot capacity are exactly what they were before — this only changes how you look at what's stored and pick the thing you want to move.",
    ],
    patchNotes: [
      {
        heading: "Changed",
        items: [
          "Cargo Hold and Carried Inventory contents now render as a compact selectable tile grid instead of one large row per stored item.",
          "Deposit and Withdraw actions now appear only for the currently selected item, in one action area beneath the grid.",
        ],
      },
    ],
  },
  {
    slug: "talk-is-a-conversation-now",
    title: "Talk Is a Conversation Now",
    publishedAt: "2026-09-09T15:00:00-07:00",
    summary:
      "Talking to Wade or Tansy now opens a list of what you can actually talk about — the current job, plus subjects you can revisit any time.",
    body: [
      "Until now, talking to someone in Holo Hollow gave you exactly one conversation: whatever the game decided was most relevant at that moment. It worked for handing out jobs, but it meant Wade and Tansy only ever had one thing to say.",
      "Talk now opens a conversation instead. Anything tied to your current work shows up first — a job that is available, one you are in the middle of, or one that is ready to hand in — and below that is a list of subjects you can bring up whenever you like.",
      "Those subjects stay available. Ask Wade about recovery work, ask Tansy about mining the seam at The Jag, and come back and ask again later. A few subjects only show up once you have done the work that would make the two of you talk about them.",
      "Nothing about the jobs themselves changed. Walk It Off, Cut Your Teeth, Waste Not, and Hold It Together ask for exactly what they asked for before, hand out the same rewards, and are still turned in with the same person in the same place.",
    ],
    patchNotes: [
      {
        heading: "Added",
        items: [
          "Talk now opens a conversation list for that person: current job conversations first, then a Talk about section of subjects you can revisit.",
          "Wade and Tansy each have new subjects to talk about that are not tied to a job, and one of Tansy's opens up after you finish the current run of work.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "Finishing a conversation returns you to that person's conversation list instead of closing straight back to the world.",
        ],
      },
    ],
  },
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

    for (const paragraph of update.body) {
      if (typeof paragraph === "string") continue;
      if (!Array.isArray(paragraph)) {
        resolveArticleArt(paragraph.art);
        continue;
      }
      for (const segment of paragraph) {
        if (typeof segment !== "string" && !getWikiArticle(segment.articleSlug)) {
          throw new Error(
            `Update "${update.slug}" links to unknown Wiki article slug: ${segment.articleSlug}`,
          );
        }
      }
    }
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
