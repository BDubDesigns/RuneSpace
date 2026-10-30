/**
 * One player-facing guide per shipped named Mission (#339).
 *
 * These are ordinary Wiki articles: `public-wiki.ts` spreads them into the one
 * `authoredWikiArticles` collection right after the Missions hub, so they share
 * its validation, its routes, and its authored-order rule. This file exists
 * only to keep that collection's source readable. It is not a second registry.
 *
 * Guides are filed under Getting Started with `showInIndex: false`: the Wiki
 * index links the Missions directory once instead of repeating sixteen guides.
 *
 * Every number and gate here is read from the shipped Mission definitions
 * (`game/content/missions.ts`), the repair recipes (`game/config/balance.ts`),
 * and `game/content/repair-targets.ts`, not from earlier Wiki prose. When a
 * Mission changes, update its guide in the same PR (docs/public-wiki.md).
 */

/** An authored link to another Wiki article (see `WikiLinkSegmentSchema`). */
const link = (text: string, articleSlug: string) => ({ text, articleSlug });

const missions = link("Missions", "missions");

const wade = link("Wade Rusk", "wade-rusk");
const tansy = link("Tansy Rusk", "tansy-rusk");
const bix = link("Bix Weller", "bix-weller");
const renn = link("Renn Calder", "renn-calder");
const curly = link("Curly", "curly");
const enby = link("the Wise Old Enby", "the-wise-old-enby");

const miningAndRefining = (text: string) => link(text, "mining-and-refining");
const welding = (text: string) => link(text, "cargo-hold-and-welding");
const fabrication = (text: string) => link(text, "fabrication-and-tinkering");
const inventory = (text: string) => link(text, "inventory-and-equipment");
const powerCells = (text: string) => link(text, "power-cells");
const practiceWelding = (text: string) => link(text, "practice-welding");
const workOrders = (text: string) => link(text, "work-orders");

const toWalkItOff = link("Walk It Off", "mission-walk-it-off");
const toCutYourTeeth = link("Cut Your Teeth", "mission-cut-your-teeth");
const toWasteNot = link("Waste Not", "mission-waste-not");
const toHoldItTogether = link("Hold It Together", "mission-hold-it-together");
const toKeepTheChange = link("Keep the Change", "mission-keep-the-change");
const toTenThousandHours = link("10,000 Hours", "mission-10000-hours");
const toTenThousandOneHours = link("10,001 Hours", "mission-10001-hours");
const toReturnTheFavor = link("Return the Favor", "mission-return-the-favor");
const toBreakItDown = link("Break It Down", "mission-break-it-down");
const toBraceYourself = link("Brace Yourself", "mission-brace-yourself");
const toWheelBeRightBack = link("Wheel Be Right Back", "mission-wheel-be-right-back");
const toThrustIssues = link("Thrust Issues", "mission-thrust-issues");
const toMoveAlong = link("Move Along", "mission-move-along");
const toACutAbove = link("A Cut Above", "mission-a-cut-above");
const toOutOfTheWeather = link("Out of the Weather", "mission-out-of-the-weather");
const toCuttingCosts = link("Cutting Costs", "mission-cutting-costs");
const toCurlyMustStash = link("Curly Must-Stash", "mission-curly-must-stash");
const toNotFromAroundHere = link("Not From Around Here", "mission-not-from-around-here");
const toFirstRuneworkingLesson = link(
  "Seeker? I Hardly Know Her!",
  "mission-first-runeworking-lesson",
);
const toFirstResonanceEcho = link("First Resonance Echo", "mission-first-resonance-echo");
const toAPlaceToCallHome = link("A Place to Call Home", "mission-a-place-to-call-home");
const toARuneOfYourOwn = link("A Rune of Your Own", "mission-a-rune-of-your-own");
const runeworking = (text: string) => link(text, "runeworking");

export const missionGuideArticles = [
  {
    slug: "mission-theyre-minerals-marie",
    title: "They're Minerals, Marie!",
    category: "getting-started",
    showInIndex: false,
    summary:
      "Werner's four supervised lessons and conversations unlock his Lapidary Workbench permanently.",
    sections: [
      {
        paragraphs: [
          [
            "See ",
            { text: "Missions", articleSlug: "missions" },
            " for the Mission Log and pinning.",
          ],
        ],
      },
      {
        heading: "Beginning",
        paragraphs: [
          "Speak to Werner at Werner's Lab on Stillreach. No earlier Mission or skill level is required. Accepting grants only supervised access; it does not hand over Quartz or open unrestricted training.",
        ],
      },
      {
        heading: "Four steps, in order",
        list: [
          "Shape one Stone while the first lesson is active. Bring your own Stone; mining, buying or trading for it all work. The supervised lesson consumes one Stone, takes 12 seconds and earns 15 Lapidary XP.",
          "Return to Werner. Acknowledge the required conversation to receive one Uncut Quartz and open the Quartz lesson together. If you cannot carry his gift, make room and try again; the lesson stays paused.",
          "Cut one Quartz while that lesson is active: 18 seconds, one Cut Quartz and 75 Lapidary XP. Any Uncut Quartz works, including one you already owned. You may sell, stash or trade the finished piece before returning.",
          "Return to Werner for the final examination. Completion grants 150 Lapidary XP once and permanently opens unrestricted workbench runs, including quantity and Max.",
        ],
      },
      {
        heading: "Permission and progress",
        paragraphs: [
          [
            "Only the current lesson counts. During the Mission, each lesson permits one piece; the bench pauses for Werner's conversation between them. Refreshing or leaving and returning preserves your place. After graduation the workbench remains authorized. See ",
            { text: "Lapidary", articleSlug: "lapidary" },
            " for recipes and normal runs.",
          ],
        ],
      },
    ],
  },
  {
    slug: "mission-walk-it-off",
    title: "Walk It Off",
    category: "getting-started",
    showInIndex: false,
    summary:
      "Your first Mission: reach The Jag and talk to Tansy Rusk. Where it starts, what it hands you, and what comes next.",
    sections: [
      {
        paragraphs: [
          [
            "The first Mission. Nothing has to be finished before you can take it, and it begins the starter chain.",
          ],
        ],
      },
      {
        heading: "Where it begins",
        paragraphs: [
          [
            wade,
            " offers it at the Crash Site, and sends you toward his niece at The Jag. If you walk to The Jag on your own first, ",
            tansy,
            " offers the same Mission there, so you cannot miss it either way.",
          ],
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          "Take the Mission from Wade at the Crash Site, or from Tansy once you reach The Jag.",
          "Travel to The Jag on the Map. You need to be standing there when you turn the Mission in.",
          "Talk to Tansy and choose Claim Cutter. If she was the one who offered the Mission, accepting leads straight into claiming it.",
        ],
      },
      {
        heading: "What you get",
        list: [
          [
            "A ",
            inventory("Salvage Cutter"),
            ", handed over when you claim it. It has to fit in your Inventory — if it does not, make room and claim it again.",
          ],
          "No XP or Credits.",
        ],
      },
      {
        heading: "What happens next",
        paragraphs: [
          [
            "Claiming the Cutter starts ",
            toCutYourTeeth,
            " automatically. There is nothing extra to accept.",
          ],
        ],
      },
      { paragraphs: [["Back to all ", missions, "."]] },
    ],
  },
  {
    slug: "mission-cut-your-teeth",
    title: "Cut Your Teeth",
    category: "getting-started",
    showInIndex: false,
    summary:
      "Equip your Salvage Cutter, make five Mining attempts, and show Tansy Rusk a full stack of Ferrite Shale.",
    sections: [
      {
        paragraphs: [["Teaches the Inventory-to-Equip step and the Mining loop."]],
      },
      {
        heading: "Where it begins",
        paragraphs: [
          [
            "Nothing to accept: it starts by itself the moment you claim your Cutter in ",
            toWalkItOff,
            ". You hand it in to ",
            tansy,
            " at The Jag.",
          ],
        ],
      },
      {
        heading: "What you need",
        list: [
          "Be at The Jag.",
          ["Equip the Salvage Cutter from your ", inventory("Inventory"), "."],
          [
            "Make 5 ",
            miningAndRefining("Mining attempts"),
            ". The objective counts them as you go.",
          ],
          "Carry a full stack of Ferrite Shale. Shale you scavenged counts exactly like shale you mined.",
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          "Equip your Salvage Cutter, then mine at The Jag until your five attempts are in and you are carrying a full stack of Ferrite Shale.",
          "Talk to Tansy and choose Show Shale.",
        ],
      },
      {
        heading: "What you get",
        list: [
          "100 Mining XP when you turn the Mission in.",
          "Nothing is taken: Tansy only looks at the shale, and you keep it.",
        ],
      },
      {
        heading: "Good to know",
        paragraphs: [
          "The equipped Cutter and the shale are checked live. If you take the Cutter off or drop shale before you turn the Mission in, it goes back to asking for them.",
        ],
      },
      {
        heading: "What happens next",
        paragraphs: [["Finishing it starts ", toWasteNot, " automatically."]],
      },
      { paragraphs: [["Back to all ", missions, "."]] },
    ],
  },
  {
    slug: "mission-waste-not",
    title: "Waste Not",
    category: "getting-started",
    showInIndex: false,
    summary:
      "Make five Refining attempts at the Abandoned Processing Yard, then report to Wade Rusk at the Crash Site.",
    sections: [
      {
        paragraphs: [["Teaches Refining, the other half of the early work loop."]],
      },
      {
        heading: "Where it begins",
        paragraphs: [
          [
            "Nothing to accept: it starts by itself when you finish ",
            toCutYourTeeth,
            ". You report to ",
            wade,
            " at the Crash Site.",
          ],
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          [
            "Walk to the Abandoned Processing Yard and make 5 ",
            miningAndRefining("Refining attempts"),
            ". The objective counts them.",
          ],
          "Return to Wade at the Crash Site and choose Report to Wade.",
        ],
      },
      {
        heading: "What you get",
        list: ["100 Refining XP when you report to Wade."],
      },
      {
        heading: "What happens next",
        paragraphs: [["Reporting starts ", toHoldItTogether, " automatically."]],
      },
      { paragraphs: [["Back to all ", missions, "."]] },
    ],
  },
  {
    slug: "mission-hold-it-together",
    title: "Hold It Together",
    category: "getting-started",
    showInIndex: false,
    summary:
      "Repair the Cargo Hold at the Crash Site, then report the finished repair to Wade Rusk.",
    sections: [
      {
        paragraphs: [["Teaches you Welding and gives you the Cargo Hold."]],
      },
      {
        heading: "Where it begins",
        paragraphs: [
          [
            "Nothing to accept: it starts by itself when you report ",
            toWasteNot,
            ". You report the repair to ",
            wade,
            " at the Crash Site.",
          ],
        ],
      },
      {
        heading: "What you need",
        list: [
          [
            "15 Refined Ferrite and 6 Slag, installed into the Cargo Hold. You can install them across as many visits as you like, but once installed they do not come back out. See ",
            miningAndRefining("Mining and Refining"),
            " for where they come from.",
          ],
          "Twelve welding passes of about three seconds each, done while you are standing at the Crash Site.",
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          [
            "Install the Refined Ferrite and Slag at the Crash Site, then ",
            welding("weld the Cargo Hold"),
            " in twelve passes.",
          ],
          "Talk to Wade and choose Report Repair.",
        ],
      },
      {
        heading: "What you get",
        list: [
          "The usual Welding XP for each pass as you weld, 50 apiece.",
          "100 Welding XP more when you report to Wade.",
          "The repaired Cargo Hold, once the repair is finished: 32 slots of storage at the Crash Site.",
        ],
      },
      {
        heading: "What happens next",
        paragraphs: [
          [
            "Nothing starts by itself. Finishing it is what makes two other Missions available, and neither is a continuation: ",
            toKeepTheChange,
            " is Wade's next Mission, and ",
            toOutOfTheWeather,
            " is an optional Mission from Renn. They do not depend on each other.",
          ],
        ],
      },
      { paragraphs: [["Back to all ", missions, "."]] },
    ],
  },
  {
    slug: "mission-keep-the-change",
    title: "Keep the Change",
    category: "getting-started",
    showInIndex: false,
    summary:
      "Wade Rusk makes you his apprentice, hands you 36 Credits, and sends you to meet Bix Weller and get three Power Cells to Tansy Rusk.",
    sections: [
      {
        paragraphs: [
          [
            "After the starter run of automatic Missions, this is the first one you take on yourself.",
          ],
        ],
      },
      {
        heading: "Where it begins",
        paragraphs: [
          [
            "After ",
            toHoldItTogether,
            ", go back and talk to ",
            wade,
            " at the Crash Site. Nothing hands it to you and nothing on the Map points to it: you choose Take the Job in his conversation list.",
          ],
        ],
      },
      {
        heading: "What you need",
        list: [
          [
            "Meet ",
            bix,
            " at his shop in Holo Hollow. This is part of the Mission even if you already have three cells. Talking to him is all that is required; you never have to buy or sell anything.",
          ],
          [
            "Three ",
            powerCells("Power Cells"),
            ". They can come from your ",
            inventory("Inventory"),
            ", the Annex, or Bix's shelf.",
          ],
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          "Take the Mission from Wade at the Crash Site. He hands you the Credits straight away.",
          "Walk to Holo Hollow and talk to Bix.",
          "Get three Power Cells.",
          "Take them to Tansy at The Jag and choose Hand Over Cells.",
        ],
      },
      {
        heading: "What you get",
        list: [
          "36 Credits when you accept, as Wade's budget for the Mission — three cells at Bix's price of 12 each. They are yours: if you already have cells, or claim them free at the Annex, you keep whatever you do not spend. Nothing is reimbursed.",
          "Nothing more when you finish. There is no second payout.",
        ],
      },
      {
        heading: "Good to know",
        list: [
          "Handing the cells over takes exactly three. Any extras you carry stay with you.",
          "Finishing it ends with Tansy calling Wade to say you did the work properly. Wade moves back to his own yard at Rusk Recovery, and HH B&B opens to you.",
        ],
      },
      {
        heading: "What opens up",
        list: [
          [toTenThousandHours, " — Wade's next Mission, at Rusk Recovery."],
          [toCurlyMustStash, " — an optional Mission from ", curly, " at HH B&B."],
        ],
      },
      { paragraphs: [["Back to all ", missions, "."]] },
    ],
  },
  {
    slug: "mission-10000-hours",
    title: "10,000 Hours",
    category: "getting-started",
    showInIndex: false,
    summary:
      "Wade Rusk puts you on his bench at Rusk Recovery: six free Scrap Metal, three practice welds, and 50 Credits.",
    sections: [
      {
        paragraphs: [["Accepting it is what opens Wade's Workbench to you."]],
      },
      {
        heading: "Where it begins",
        paragraphs: [
          [
            "After ",
            toKeepTheChange,
            ", ",
            wade,
            " is back at his own yard at Rusk Recovery. Nothing is accepted for you and nothing lights up on the Map: walk in, talk to him, and choose Pick Up the Torch.",
          ],
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          [
            "Accept the Mission. Wade hands you six Scrap Metal, three welds' worth, and opens the ",
            practiceWelding("Workbench"),
            " and his scrap counter. He hands over all six or none: if you do not have room, nothing is handed over and the Mission is not started, so make room and come back.",
          ],
          [
            "Complete 3 ",
            practiceWelding("practice welds"),
            " at the Workbench. Each weld spends 2 Scrap Metal and pays its own Welding XP.",
          ],
          "Talk to Wade and choose Show Him the Work.",
        ],
      },
      {
        heading: "What you get",
        list: [
          "Six Scrap Metal when you accept, and the Workbench for good.",
          "50 Credits when you show Wade the work. The three welds already paid their own Welding XP, so there is no second helping.",
        ],
      },
      {
        heading: "Good to know",
        paragraphs: [
          "Any three genuine practice welds count, whatever scrap you used: his, scrap you already had, or scrap you bought back from him. Losing his scrap does not dead-end anything — buy two more and carry on.",
        ],
      },
      {
        heading: "What opens up",
        list: [
          [
            toReturnTheFavor,
            " — Tansy comes out to the yard and offers it, starting her Fabrication lessons.",
          ],
          [
            toTenThousandOneHours,
            " — Wade's paying ",
            workOrders("Work Orders"),
            ", once you are Welding level 5. It does not need Return the Favor or Break It Down.",
          ],
        ],
      },
      { paragraphs: [["Back to all ", missions, "."]] },
    ],
  },
  {
    slug: "mission-10001-hours",
    title: "10,001 Hours",
    category: "getting-started",
    showInIndex: false,
    summary:
      "At Welding level 5 Wade Rusk opens the Work Orders board to you for good. Complete one paying Work Order, then show him.",
    sections: [
      {
        paragraphs: [
          [
            "This is not side work: it is how paid ",
            workOrders("Work Orders"),
            " become yours, and it runs independently of the Fabrication and Deep Jag Missions.",
          ],
        ],
      },
      {
        heading: "Where it begins",
        paragraphs: [
          [
            "You need to have finished ",
            toTenThousandHours,
            " and be at Welding level 5. Then ",
            wade,
            " offers it at Rusk Recovery, but he will not come find you — walk out, talk to him, and choose Take the Work. It does not need ",
            toReturnTheFavor,
            " or ",
            toBreakItDown,
            ".",
          ],
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          "Accept the Mission. This is the moment the Work Orders board becomes yours for good.",
          [
            "Take a Work Order off the terminal beside the Workbench and finish it. Taking a Work Order hands its materials over from your Inventory right away, so carry everything it asks for first. See ",
            workOrders("Work Orders"),
            " for how the board works.",
          ],
          "Talk to Wade and choose Show Him the Job.",
        ],
      },
      {
        heading: "What you get",
        list: [
          "The Work Order's own Credits and Welding XP, paid when you finish it.",
          "10 Refined Ferrite and 5 Power Cells from Wade when you show him the work, handed over together or not at all. They have to fit in your Inventory — if they do not, make room and report again.",
        ],
      },
      {
        heading: "Good to know",
        paragraphs: [
          "Accepting is the real unlock. Showing Wade the work is not a second gate: the board keeps working whether or not you have turned the Mission in.",
        ],
      },
      { paragraphs: [["Back to all ", missions, "."]] },
    ],
  },
  {
    slug: "mission-return-the-favor",
    title: "Return the Favor",
    category: "getting-started",
    showInIndex: false,
    summary:
      "Tansy Rusk opens the Fabrication Station at Rusk Recovery: fabricate a Salvage Cutter, then hand her a Salvage Cutter.",
    sections: [
      {
        paragraphs: [
          [
            "Teaches ",
            fabrication("Fabrication"),
            ", and accepting it is what opens the Fabrication Station.",
          ],
        ],
      },
      {
        heading: "Where it begins",
        paragraphs: [
          [
            "After ",
            toTenThousandHours,
            ", ",
            tansy,
            " comes out to Rusk Recovery. Talk to her in the yard and choose Take the Job. It does not start by itself, and it does not need any Fabrication level.",
          ],
        ],
      },
      {
        heading: "What you need",
        list: [
          [
            "Fabricate a Salvage Cutter at the Fabrication Station while the Mission is open: 5 Refined Ferrite and 1 ",
            powerCells("Power Cell"),
            ". A Cutter you already had, bought or were given does not count for this part, and neither does a workpiece that busts.",
          ],
          "Carry a Salvage Cutter that you are not wearing, to hand over.",
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          "Take the Mission from Tansy.",
          "Fabricate a Salvage Cutter at the Station.",
          "Talk to Tansy and choose Hand Over the Cutter. She will not take the one in your hand. The Cutter you just made is fine, and so is any other Salvage Cutter you are carrying.",
        ],
      },
      {
        heading: "What you get",
        list: [
          "The Fabrication Station opens as soon as you accept.",
          "100 Fabrication XP when you hand the Cutter over. Fabricating it pays its own 65 Fabrication XP on top.",
          "Tinkering opens when the Mission is done. Tansy takes the Cutter apart on the spot to show you how it works, and the Scrap from her demonstration stays with her.",
        ],
      },
      {
        heading: "Good to know",
        paragraphs: [
          [
            "You may use ",
            fabrication("Manual Override"),
            " on this first Cutter. If a push wrecks the workpiece, the Mission just waits for another one.",
          ],
        ],
      },
      {
        heading: "What happens next",
        paragraphs: [["Finishing it starts ", toBreakItDown, " automatically."]],
      },
      { paragraphs: [["Back to all ", missions, "."]] },
    ],
  },
  {
    slug: "mission-break-it-down",
    title: "Break It Down",
    category: "getting-started",
    showInIndex: false,
    summary:
      "Tinker one piece at the Fabrication Station, then tell Tansy Rusk. The second half of her Fabrication lesson.",
    sections: [
      {
        paragraphs: [["Teaches Tinkering, the other half of ", fabrication("Fabrication"), "."]],
      },
      {
        heading: "Where it begins",
        paragraphs: [
          [
            "Nothing to accept: it starts by itself when you finish ",
            toReturnTheFavor,
            ". You report to ",
            tansy,
            " at Rusk Recovery.",
          ],
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          [
            fabrication("Tinker"),
            " one piece of anything you can take apart. Only a finished piece you are carrying and not wearing can be Tinkered, and a batch has to finish to count.",
          ],
          "Talk to Tansy and choose Tell Tansy.",
        ],
      },
      {
        heading: "Good to know",
        list: [
          "The Cutter you handed over in Return the Favor is gone, so you may need something to take apart. A Mounting Bracket is the cheapest thing to make at the Station: 2 Refined Ferrite.",
          "Tinkering will not take apart the last Mining Cutter you can use, so keep one back.",
        ],
      },
      {
        heading: "What you get",
        list: [
          "250 Fabrication XP when you tell Tansy. The Tinkering itself pays the piece's own Fabrication XP too.",
          "Tansy heads back to The Jag afterwards.",
        ],
      },
      {
        heading: "What opens up",
        paragraphs: [
          [
            "Finishing it is the story gate for ",
            toBraceYourself,
            ", once you are also Mining 5 and Welding 5.",
          ],
        ],
      },
      { paragraphs: [["Back to all ", missions, "."]] },
    ],
  },
  {
    slug: "mission-brace-yourself",
    title: "Brace Yourself",
    category: "getting-started",
    showInIndex: false,
    summary:
      "Tansy Rusk reopens the cave-in below The Jag: haul 25 Refined Ferrite and 5 Power Cells down to Deep Jag, then weld fifteen passes.",
    sections: [
      {
        paragraphs: [
          [
            "A progression Mission, not an optional one: finishing it gates ",
            toWheelBeRightBack,
            ", ",
            toACutAbove,
            " and ",
            toCuttingCosts,
            ".",
          ],
        ],
      },
      {
        heading: "Where it begins",
        paragraphs: [
          [
            "You need to have finished ",
            toBreakItDown,
            " and be at both Mining level 5 and Welding level 5. Below either level ",
            tansy,
            " does not raise the subject. Then she offers it at The Jag; choose Take the Job.",
          ],
          "It does not need 10,001 Hours. Work Orders and Deep Jag are two separate directions out of the same point, and you can do either, both or neither first.",
        ],
      },
      {
        heading: "What you need",
        list: [
          [
            "25 Refined Ferrite and 5 ",
            powerCells("Power Cells"),
            ". The Cells go into Tansy's jack and are spent setting the brace.",
          ],
          ["Fifteen ", welding("welding passes"), " at Deep Jag."],
          "The brace and jack hardware is Tansy's and stays hers. You bring the stock and the welding.",
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          "Take the Mission from Tansy at The Jag. Deep Jag has been on the Map from the start, marked CAVE-IN; once you accept, you can walk down to work on the passage.",
          "Haul the material down over as many trips as you like and install it. What you install stays installed.",
          "Weld fifteen passes. The moment the fifteenth lands the passage is open: the map reads MINING, and you can mine Galvanite right there without going back up.",
          "Go back up to The Jag and tell Tansy the Deep Jag is open (Tell Tansy). Your 250 Welding XP is waiting whenever you head back.",
        ],
      },
      {
        heading: "What you get",
        list: [
          "Access to Deep Jag as soon as you accept, so you can work on the passage.",
          "50 Welding XP for each pass as you weld, 750 in all.",
          "250 Welding XP from Tansy when you tell her.",
          [
            "An open Deep Jag, which gives ",
            miningAndRefining("Galvanite"),
            ". The mine is open the moment the brace is in, even if you never walk back to Tansy.",
          ],
        ],
      },
      {
        heading: "What opens up",
        list: [
          [toWheelBeRightBack, " — Wade's landing-gear Mission. No skill gate."],
          [toACutAbove, " — Tansy's Loadsteel Cutter lesson, at Fabrication level 5."],
          [toCuttingCosts, " — Renn's Loadsteel Cutter purchase. No skill gate."],
        ],
      },
      { paragraphs: [["Back to all ", missions, "."]] },
    ],
  },
  {
    slug: "mission-wheel-be-right-back",
    title: "Wheel Be Right Back",
    category: "getting-started",
    showInIndex: false,
    summary:
      "Wade Rusk puts the ship's landing gear back under it: bring 2 Wheel Assemblies, 2 Mounting Brackets and 1 Galvanic Wire Spool, then weld twelve passes.",
    sections: [
      {
        paragraphs: [["The middle step of restoring your ship; it leads to ", toThrustIssues, "."]],
      },
      {
        heading: "Where it begins",
        paragraphs: [
          [
            "After ",
            toBraceYourself,
            ". ",
            wade,
            " will not come find you for this one, and finishing Brace Yourself does not start it: walk out to Rusk Recovery and choose Take the Job when you want it. It asks for nothing else first — no Welding level beyond what Brace Yourself already took, no Fabrication or Refining level, and you do not need ",
            toACutAbove,
            ".",
          ],
        ],
      },
      {
        heading: "What you need",
        list: [
          [
            "2 Wheel Assemblies, 2 Mounting Brackets and 1 Galvanic Wire Spool, installed into the Landing Gear at the Crash Site. You can ",
            fabrication("fabricate them"),
            " — Wheel Assemblies and the Wire Spool at Fabrication 5, Mounting Brackets at Fabrication 1 — or trade for them or be given them. Fabricating is not required, so a piece you did not make works exactly the same.",
          ],
          ["Twelve ", welding("welding passes"), ". You always do the welding yourself."],
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          "Take the Mission from Wade at Rusk Recovery.",
          "Install the parts at the Crash Site across as many visits as you like. What goes in stays in.",
          'Weld the twelve passes. When the twelfth lands the Landing Gear is done for good, and the panel reads "Landing gear restored."',
          "Talk to Wade at Rusk Recovery and choose Report Repair.",
        ],
      },
      {
        heading: "What you get",
        list: [
          "50 Welding XP for each pass, 600 in all.",
          "250 Welding XP more when you report to Wade.",
        ],
      },
      {
        heading: "Good to know",
        paragraphs: [
          "The ship looks just as wrecked as before and nothing about this repair lets you fly it. The engine is still dead, and the Crash Site says so.",
        ],
      },
      {
        heading: "What opens up",
        paragraphs: [[toThrustIssues, " — Wade's last ship Mission, at Welding level 8."]],
      },
      { paragraphs: [["Back to all ", missions, "."]] },
    ],
  },
  {
    slug: "mission-thrust-issues",
    title: "Thrust Issues",
    category: "getting-started",
    showInIndex: false,
    summary:
      "At Welding level 8, Wade Rusk lets you fix the ship's drive: 2 Drive Mounts, 1 Galvaferrite, 2 Mounting Brackets, 1 Galvanic Wire Spool and sixteen passes. The repair is the whole reward.",
    sections: [
      {
        paragraphs: [["The last repair of the ship, after ", toWheelBeRightBack, "."]],
      },
      {
        heading: "Where it begins",
        paragraphs: [
          [
            "You need to have finished Wheel Be Right Back and reached Welding level 8. ",
            wade,
            " will not come find you: walk out to Rusk Recovery and choose Fix the Drive when you want it. Below level 8 he has nothing to offer you for it. It asks for nothing else — no Fabrication or Refining level, and you do not need ",
            toACutAbove,
            ".",
          ],
        ],
      },
      {
        heading: "What you need",
        list: [
          [
            "2 Drive Mounts, 1 Galvaferrite, 2 Mounting Brackets and 1 Galvanic Wire Spool, installed at the Crash Site. You can ",
            fabrication("fabricate"),
            " Drive Mounts at Fabrication 8, or trade for them or be given them, and the same goes for the other parts. Fabricating is not required.",
          ],
          [
            "Sixteen ",
            welding("welding passes"),
            ". You always do the welding yourself, and you need Welding level 8 to do it.",
          ],
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          "Take the Mission from Wade at Rusk Recovery.",
          "Install the parts at the Crash Site across as many visits as you like. What goes in stays in.",
          'Weld the sixteen passes. When the sixteenth lands the ship is repaired for good and the Crash Site shows it, before you have even spoken to Wade. The Propulsion System panel reads "Propulsion restored. Report to Wade."',
          'Talk to Wade at Rusk Recovery and choose Report Repair. The panel then reads "Propulsion restored. Ship flight-ready."',
        ],
      },
      {
        heading: "What you get",
        list: [
          "50 Welding XP for each pass, 800 in all. That is the whole reward.",
          "Reporting to Wade adds nothing: no extra XP, no Credits and no item.",
        ],
      },
      {
        heading: "What opens up",
        paragraphs: [
          [
            "Once you have reported the repair, Wade has one more job for you: ",
            toMoveAlong,
            ". Until you take it, the ship cannot make its first flight.",
          ],
        ],
      },
      { paragraphs: [["Back to all ", missions, "."]] },
    ],
  },
  {
    slug: "mission-move-along",
    title: "Move Along",
    category: "getting-started",
    showInIndex: false,
    summary:
      "Wade Rusk wants your repaired Rivet flown from the Crash Site to Holo Hollow Landing: fuel it, launch it, and land. It costs 10 Fuel Units and takes 15 seconds, and it pays nothing.",
    sections: [
      {
        paragraphs: [["The first flight of your ship, after ", toThrustIssues, "."]],
      },
      {
        heading: "Where it begins",
        paragraphs: [
          [
            "You need to have finished Thrust Issues, which means reporting the drive repair to ",
            wade,
            ". Wade's send-off ends that report, and Move Along starts on its own: there is nothing to accept. The ship will not make its first flight until it has started.",
          ],
        ],
      },
      {
        heading: "What you need",
        list: [
          "Fuel. Every ship starts with an empty 300 Fuel Unit tank, and this flight uses 10. You can make a Full Small Fuel Canister at the Abandoned Processing Yard or buy one at Last Leg Trading in Holo Hollow Landing. Each canister adds 50 Fuel Units.",
          "To be standing at your ship, at the Crash Site, with nothing else going on.",
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          "Report Thrust Issues to Wade at Rusk Recovery; Move Along starts with it. You can walk over to the Landing and back for fuel whenever you like; walking there does not move the ship.",
          "At the Crash Site, choose Board Ship in the Ship panel. Its tank shows how much fuel you have and says how many full canisters are available in Inventory and in the Cargo Hold, with a Load 1 Canister button for each. Each click uses exactly one Full Small Fuel Canister and does not give an empty one back. If the tank can only take part of a canister, the game tells you exactly how much it will add and how much will be wasted, and asks you to confirm.",
          "Choose Launch. It shows the destination, the 10 Fuel Unit cost and your tank before and after, and tells you that leaving moves your ship from the Crash Site to Holo Hollow Landing for good. There is no second confirmation, and a flight cannot be cancelled.",
          "The flight takes 15 seconds. You watch the Rivet lift off from the Crash Site, cross a small chart of the hop to Holo Hollow Landing, and settle onto the pad; the scene follows the flight itself and adds no time to it. While it lasts you cannot walk, work, trade or change your gear, but you can still look at your Inventory, Equipment and Missions. You can minimize the flight and reopen it, and a reload picks up where it was.",
          "On touchdown the game shows Flight complete — Arrived at Holo Hollow Landing and Mission Complete: Move Along. You can dismiss it; until you do it will be waiting after a reload or on another device.",
        ],
      },
      {
        heading: "What you get",
        list: [
          "Nothing in the way of a reward: no XP, no Credits, no item and no free fuel. You do not report back to Wade.",
          [
            "Your ship and its Cargo Hold are now at Holo Hollow Landing, and so are you. The Crash Site shows empty ground, and the ship never flies back there. From the Landing it can fly on to Stillreach; see ",
            { text: "Travel & Scavenging", articleSlug: "travel-and-scavenging" },
            ". Later flights complete nothing and do not replay this Mission.",
          ],
        ],
      },
      {
        heading: "Good to know",
        list: [
          "If you leave the game during the flight it still lands: the next time you load your character it has arrived, however long you were away.",
          "Walking to Holo Hollow Landing, clicking Launch or watching the countdown run out does not complete the Mission. Only the ship landing does.",
          "The Cargo Hold goes where the ship goes, and can only be opened while you are standing at the ship.",
        ],
      },
      { paragraphs: [["Back to all ", missions, "."]] },
    ],
  },
  {
    slug: "mission-a-cut-above",
    title: "A Cut Above",
    category: "getting-started",
    showInIndex: false,
    summary:
      "At Fabrication level 5, show Tansy Rusk a Loadsteel Cutter at The Jag for 500 Fabrication XP. She only looks; you keep it.",
    sections: [
      {
        paragraphs: [
          [
            "A separate advanced Fabrication Mission, not part of the ship repairs, and different from ",
            toCuttingCosts,
            ".",
          ],
        ],
      },
      {
        heading: "Where it begins",
        paragraphs: [
          [
            "You need to have finished ",
            toBraceYourself,
            " and reached Fabrication level 5. Then ",
            tansy,
            " offers it at The Jag; choose Take the Job. It does not need ",
            toWheelBeRightBack,
            " or Cutting Costs.",
          ],
        ],
      },
      {
        heading: "What you need",
        list: [
          [
            "A Loadsteel Cutter with you. The recipe opens at Fabrication level 5 whether or not you ever take this Mission — accepting it unlocks nothing — and needs 2 Galvaferrite, 1 Galvanic Wire Spool and 1 Power Cell at the ",
            fabrication("Fabrication Station"),
            ". No Refining level is needed.",
          ],
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          "Take the Mission from Tansy at The Jag.",
          "Get a Loadsteel Cutter, however you like. One you made earlier, made since, traded for or were given all work, carried or equipped, charged or not. If you already have one when you take the Mission, you can show her straight away.",
          "Talk to Tansy at The Jag and choose Show Her the Cutter.",
        ],
      },
      {
        heading: "What you get",
        list: ["500 Fabrication XP when you show her."],
      },
      {
        heading: "Good to know",
        list: [
          "Tansy only looks — nothing is taken, and you keep the Cutter.",
          "One left in the Cargo Hold is not with you, so it does not count.",
          "If you have only one Cutter and also want Cutting Costs, show it to Tansy first: Renn keeps the one he buys.",
        ],
      },
      { paragraphs: [["Back to all ", missions, "."]] },
    ],
  },
  {
    slug: "mission-out-of-the-weather",
    title: "Out of the Weather",
    category: "getting-started",
    showInIndex: false,
    summary:
      "An optional Mission from Renn Calder: repair the Crew Stop on the haul road with 20 Refined Ferrite and ten welding passes.",
    sections: [
      {
        paragraphs: [
          [
            "Genuinely optional: nothing hands it to you, nothing is waiting on it, and you can ignore it forever without closing anything off.",
          ],
        ],
      },
      {
        heading: "Where it begins",
        paragraphs: [
          [
            "Once you have finished ",
            toHoldItTogether,
            ", ",
            renn,
            " brings it up in Holo Hollow — the Crew Stop out on the haul road is falling apart and nobody owns it enough to fix it. He is not asking you to do anything about it; if you want to pitch in, choose Pitch In. You do not need ",
            toKeepTheChange,
            " first, and it never blocks it.",
          ],
        ],
      },
      {
        heading: "What you need",
        list: [
          "20 Refined Ferrite, installed at the Crew Stop. You can put in some, go and get more, and come back. Installed material does not come back out.",
          ["Ten ", welding("welding passes"), "."],
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          "Accept the Mission from Renn.",
          "Install the Refined Ferrite and weld the ten passes at the Crew Stop.",
          "Talk to Renn and choose Tell Renn.",
        ],
      },
      {
        heading: "What you get",
        list: [
          "50 Welding XP for each pass, 500 in all.",
          "250 Welding XP more when you tell Renn.",
          [
            "Once the repair is done, the shelter stays fixed for good. The crews use it every workday and know who fixed it, so they let you ride the shift hauler out to The Jag for ",
            link("5 Credits a trip", "travel-and-scavenging"),
            ". Only on the way out — the hauler comes back loaded with shale, so you walk home.",
          ],
        ],
      },
      {
        heading: "Good to know",
        paragraphs: [
          "This one costs you rather than paying you up front: the materials and the time are yours. Renn will not chase you about it, and the Crew Stop stays where it is however long you take. No Credits are paid, and no other Mission depends on it.",
        ],
      },
      { paragraphs: [["Back to all ", missions, "."]] },
    ],
  },
  {
    slug: "mission-cutting-costs",
    title: "Cutting Costs",
    category: "getting-started",
    showInIndex: false,
    summary:
      "An optional hand-in after Brace Yourself: Renn Calder pays 500 Credits for a Loadsteel Cutter, and keeps it.",
    sections: [
      {
        paragraphs: [["Optional, and gated by ", toBraceYourself, " — not by ", toACutAbove, "."]],
      },
      {
        heading: "Where it begins",
        paragraphs: [
          [
            "Once you have finished Brace Yourself, ",
            renn,
            " offers it in Holo Hollow; choose Take the Job. You do not need any Fabrication level, and you do not need A Cut Above.",
          ],
        ],
      },
      {
        heading: "What you need",
        paragraphs: [
          [
            "A Loadsteel Cutter you are carrying and not wearing. Renn is buying a Cutter, not checking who built it: one you made, one you were given or traded for, any that is legitimately yours will do. He will not take the one in your hand. To make one yourself, see ",
            fabrication("Fabrication"),
            ".",
          ],
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          "Take the Mission from Renn.",
          "Make sure the Cutter you bring is not the one you are wearing.",
          "Talk to Renn in Holo Hollow and choose Hand Over the Cutter.",
        ],
      },
      {
        heading: "What you get",
        list: ["500 Credits, paid once.", "Renn keeps the Cutter. He is buying it."],
      },
      {
        heading: "Good to know",
        paragraphs: [
          "If you only have one Loadsteel Cutter and also want A Cut Above, show it to Tansy first. She only looks, and you keep it; Renn does not give it back.",
        ],
      },
      { paragraphs: [["Back to all ", missions, "."]] },
    ],
  },
  {
    slug: "mission-curly-must-stash",
    title: "Curly Must-Stash",
    category: "getting-started",
    showInIndex: false,
    summary:
      "An optional paid commission: weld a mount for Curly's storage container in his room at HH B&B. 150 Credits when you take it, 150 when it is done.",
    sections: [
      {
        paragraphs: [
          [
            "An optional commission: nothing requires it, and ignoring it changes nothing anywhere else.",
          ],
        ],
      },
      {
        heading: "Where it begins",
        paragraphs: [
          [
            toKeepTheChange,
            " is what opens HH B&B to you. Once it is open, ",
            curly,
            " will hire you to build a mount for the storage container he already owns; choose Take the Job. You need Welding level 1.",
          ],
        ],
      },
      {
        heading: "What you need",
        list: [
          "6 Refined Ferrite and 3 Slag, installed at the mount in his room at HH B&B.",
          ["Six ", welding("welding passes"), ", which you do right there in the B&B."],
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          "Take the Mission from Curly. He pays 150 Credits straight away.",
          "Install the materials and weld the six passes at the B&B.",
          "Talk to Curly and choose Collect Payment.",
        ],
      },
      {
        heading: "What you get",
        list: [
          "150 Credits when you take the Mission and another 150 when you collect, 300 in all.",
          "The passes earn their own Welding XP as you go, 50 apiece. The Mission adds none on top.",
        ],
      },
      {
        heading: "Good to know",
        paragraphs: [
          "The finished mount holds Curly's container, in Curly's room. It is work finished for him — not storage for you, and not one of your own site stashes.",
        ],
      },
      { paragraphs: [["Back to all ", missions, "."]] },
    ],
  },
  {
    slug: "mission-not-from-around-here",
    title: "Not From Around Here",
    category: "getting-started",
    showInIndex: false,
    summary:
      "A Rune Fragment or intact Runestone you carry offers it: find out what the unusual mineral is. On Skatboll, Wade or Tansy can point you to Tolliver Kade, who points you to a researcher on Stillreach; on Stillreach you can go straight to the Wise Old Enby at Hilltop Workshop. It pays nothing.",
    sections: [
      {
        paragraphs: [
          [
            "A mystery Mission that starts from an item instead of a person. Nothing has to be finished before you can take it.",
          ],
        ],
      },
      {
        heading: "Where it begins",
        paragraphs: [
          [
            "You need to be carrying a Rune Fragment or an intact Runestone, both of which ",
            miningAndRefining("Mining"),
            " can turn up. The tile glows blue, and its picture hops now and then, in your ",
            inventory("Inventory"),
            ". Select the stack, choose Inspect in Item details, and then Start mission. Choosing Not now, or closing the offer, changes nothing. Either item starts the same Mission, and one you keep in the Cargo Hold or a stash does not offer it, because the offer comes from a stack you are carrying. This works on either planet.",
          ],
          [
            "On Stillreach you can also start it in person. Carry either stone to Hilltop Workshop and talk to ",
            enby,
            ": their Talk glows blue and Show strange mineral is in their list. It is the same Mission, with Start mission and Not now at the end.",
          ],
          "Starting the Mission does not use up the Fragment or the Runestone. It stays in your Inventory, and once the Mission is started both stop glowing.",
        ],
      },
      {
        heading: "What you need",
        paragraphs: [
          [
            "To talk to ",
            enby,
            " at Hilltop Workshop on Stillreach, and to hear them out. You do not need to be carrying the stone by then: once the Mission is started, the investigation counts whatever you have done with it since.",
          ],
          [
            "Getting to Stillreach means flying the Rivet there (see ",
            { text: "Flying the Rivet to Stillreach", articleSlug: "travel-and-scavenging" },
            "). While you are on Skatboll, the Mission helps you find out where to go: until you have spoken to anyone, the Mission Log names three possible contacts, ",
            wade,
            ", ",
            tansy,
            " and Tolliver Kade, and all three of their places glow green on the Map. Tolliver, at Last Leg Trading in Holo Hollow Landing, is the one who knows; Talk is open before you have repaired your ship, and Trade is a separate thing that does not matter here.",
          ],
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          [
            "On Skatboll, optionally show the Fragment to ",
            wade,
            " or ",
            tansy,
            ", wherever each of them is standing for you right now, and choose Worth asking at the end. Either of them is enough: once one has pointed you toward Tolliver, the Map and the Mission Log narrow to him alone, and the other adds nothing.",
          ],
          "Talk to Tolliver Kade at Last Leg Trading and choose Noted at the end of the conversation. The Mission then reads Find the researcher at Hilltop Workshop on Stillreach, and nothing on Skatboll's Map glows for it any more.",
          "On Stillreach, the Mission points straight at Hilltop Workshop, whether or not you ever spoke to Wade, Tansy or Tolliver: it is the one place that glows on the Map. If you fly back to Skatboll before finishing, anything you had not yet done there is waiting as you left it.",
          [
            "At Hilltop Workshop, talk to ",
            enby,
            " and choose Not From Around Here. Hear them out and choose I understand at the end. That is what completes the Mission. Backing out of any of these conversations early, or just opening one, records nothing.",
          ],
        ],
      },
      {
        heading: "What you get",
        list: [
          "No Credits, no XP and no item, at any step. Nothing is taken from you either.",
          "An answer about the mineral, and a new thing to ask the Wise Old Enby about: About RuneSpace, which you can read again whenever you like. Where to Find Fragments joins it, too.",
          [
            "The Wise Old Enby's Resonance Rig, which is yours to use from now on (see ",
            runeworking("Runeworking"),
            ").",
          ],
          [
            "The next Mission, ",
            toFirstRuneworkingLesson,
            ", starts by itself the moment you choose I understand, and the Wise Old Enby carries straight on into the lesson. If you finished this Mission before that lesson existed, ask the Wise Old Enby for it instead.",
          ],
        ],
      },
      {
        heading: "Good to know",
        list: [
          "Tolliver does not have to be the one who sent you. If he did, the Wise Old Enby will say so; if not, they start from the beginning. Either way the explanation is the same.",
          "You can unpin the Mission and the Map's highlights go quiet; you can still talk to anyone you like. Talking to Wade, Tansy or Tolliver about anything else works as it always did.",
        ],
      },
      { paragraphs: [["Back to all ", missions, "."]] },
    ],
  },
  {
    slug: "mission-first-runeworking-lesson",
    title: "Seeker? I Hardly Know Her!",
    category: "getting-started",
    showInIndex: false,
    summary:
      "The Wise Old Enby teaches the first Runeworking recipe: attune three Beginner Echo Seekers at the Resonance Rig on Hilltop Workshop, then return to them. It pays 150 Runeworking XP.",
    sections: [
      {
        paragraphs: [
          [
            "Your first lesson in ",
            runeworking("Runeworking"),
            ", from ",
            enby,
            " at Hilltop Workshop on Stillreach. ",
            toNotFromAroundHere,
            " has to be finished first.",
          ],
        ],
      },
      {
        heading: "Where it begins",
        paragraphs: [
          [
            "It starts by itself when you finish ",
            toNotFromAroundHere,
            ": choosing I understand at the end of that conversation hands you this Mission, and the Wise Old Enby goes straight on into the lesson.",
          ],
          [
            "If you finished Not From Around Here before this lesson existed, talk to ",
            enby,
            " instead. Their Talk glows blue and Seeker? I Hardly Know Her! is in their list; choose Begin Lesson at the end, or Not Now to leave it for later. It is the same lesson either way, and once you have it the offer is gone.",
          ],
        ],
      },
      {
        heading: "What you need",
        paragraphs: [
          [
            "Rune Fragments, one for each Beginner Echo Seeker. Tap Sources beside the objective in the Mission Log to see how a Seeker is made, and from there where Rune Fragments come from. The Wise Old Enby also has advice: ask them about Where to Find Fragments, and come back once your Mining has improved for a different answer.",
          ],
          "No Runeworking level beyond the 1 you start with.",
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          "At Hilltop Workshop, the Resonance Rig sits below the Wise Old Enby. Choose Attune, pick the Beginner Echo Seeker, choose how many to make (or Max), and start.",
          "Each Seeker takes 20.4 seconds and one Rune Fragment, always succeeds, and pays 25 Runeworking XP. The finished Seeker goes straight into your Inventory.",
          "Three Seekers attuned after you have the lesson is what counts, made in one run or several, in one sitting or across days, with you watching or away. Seekers you made before you had the lesson, and Seekers you bought, were given or traded for, do not count, and neither does simply carrying three.",
          [
            "Once the Mission Log shows 3 / 3, go back to ",
            enby,
            " and choose Complete Seeker? I Hardly Know Her! at the end of what they have to say. Reaching three never finishes the lesson by itself, and if the Rig is still running you need to let it stop first.",
          ],
        ],
      },
      {
        heading: "What you get",
        list: [
          "150 Runeworking XP when you complete the lesson, once. The three Seekers already paid 25 each as you made them, so a fresh character finishes the lesson on 225 Runeworking XP.",
          "Your Seekers: you keep every one you make.",
          "Something new to ask the Wise Old Enby about: About the Seekers. First lesson stays there too, so you can hear the instructions again.",
        ],
      },
      {
        heading: "What comes next",
        paragraphs: [
          [
            "Completing the lesson goes straight on into ",
            toFirstResonanceEcho,
            ", and the Wise Old Enby hands you two more Seekers with it. They need room for both: if your Inventory has no space or carrying capacity for two Seekers, the lesson still completes and pays, and you can make room and ask them for the next Mission later.",
          ],
        ],
      },
      {
        heading: "Good to know",
        list: [
          "The Rig is yours whether or not you have the lesson. Keep making Seekers as often as you like, before, during and after it; each one pays its own XP.",
          [
            "Seekers are used from Inventory to hunt for Resonance Echoes; ",
            toFirstResonanceEcho,
            " teaches how.",
          ],
        ],
      },
      { paragraphs: [["Back to all ", missions, "."]] },
    ],
  },
  {
    slug: "mission-first-resonance-echo",
    title: "First Resonance Echo",
    category: "getting-started",
    showInIndex: false,
    summary:
      "The Wise Old Enby gives you two Beginner Echo Seekers and sends you to find your first Resonance Echo. It pays 300 Runeworking XP.",
    sections: [
      {
        paragraphs: [
          [
            "Your second lesson in ",
            runeworking("Runeworking"),
            ", from ",
            enby,
            " at Hilltop Workshop on Stillreach: use a Beginner Echo Seeker, follow what it tells you, and find one Resonance Echo. ",
            toFirstRuneworkingLesson,
            " has to be finished first.",
          ],
        ],
      },
      {
        heading: "Where it begins",
        paragraphs: [
          [
            "It starts by itself when you complete ",
            toFirstRuneworkingLesson,
            ", and the Wise Old Enby hands you two Beginner Echo Seekers with it, on top of any you kept.",
          ],
          [
            "The two Seekers need two Seekers' worth of room in your Inventory, both slots and carrying capacity. If they will not fit, the lesson still completes and pays, but this Mission does not start yet. Make room, talk to ",
            enby,
            " again, and choose Take the Seekers. The same offer is there if you finished the lesson before this Mission existed. You only ever get the two Seekers once.",
          ],
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          "Open your Inventory, select a Beginner Echo Seeker and choose Use. You stand still for 4.8 seconds while it listens, and one Seeker is used up whatever it finds.",
          "A Seeker searches the planet you are standing on. Skatboll and Stillreach each have their own hidden Echo and their own search: leave one world and come back, and its search and last reading are still there.",
          "If the Echo is somewhere else, the reading says which way it lies from where you took it: east or west, and north or south. Sometimes you are already lined up in one direction, and it says due north or due east instead.",
          "Your last reading on the current planet stays in the Seeker's details. Standing somewhere that reading has already ruled out, the details say so, and why; anywhere else they say the spot is not ruled out. You can still take a reading anywhere.",
          "Your first reading on a planet may find the Echo right where you are.",
          [
            "One Echo on either planet completes the objective. Then go back to ",
            enby,
            " and choose Complete First Resonance Echo at the end of what they have to say. Finding the Echo never finishes the Mission by itself.",
          ],
        ],
      },
      {
        heading: "What you get",
        list: [
          "Every Echo you find pays 50 Runeworking XP and gives up one item, such as a Rune Fragment or an uncut gem. A wrong reading pays nothing.",
          "300 Runeworking XP when you complete the Mission, once. A fresh character who made exactly the three lesson Seekers reaches 575 Runeworking XP here: Level 2.",
          "Something new to ask the Wise Old Enby about: About Resonance Echoes. How to Listen stays there from the moment you have the Mission, so you can hear the instructions again.",
        ],
      },
      {
        heading: "Good to know",
        list: [
          "Leave room in your Inventory before you look. If the item an Echo gives up does not fit, it is lost, though the Echo still counts and still pays its XP.",
          "Run out of Seekers? Make more at the Resonance Rig. The Echo stays where it is until you find it, and finding one starts a new search on that planet next time.",
          "Echoes found before you had this Mission do not count toward it. Hunting stays open after it, for as long as you have Seekers.",
        ],
      },
      { paragraphs: [["Back to all ", missions, "."]] },
    ],
  },
  {
    slug: "mission-a-place-to-call-home",
    title: "A Place to Call Home",
    category: "getting-started",
    showInIndex: false,
    summary:
      "The Wise Old Enby asks you to build a Resonance Rig of your own at your Crash Site. It needs Welding 12, 24 welds and a Resonance Core, and hands you two Skatboll TP Runes.",
    sections: [
      {
        paragraphs: [
          [
            "Your own Resonance Rig, built on the resonance point beneath your Crash Site on Skatboll. ",
            enby,
            " offers it at Hilltop Workshop on Stillreach once you have finished ",
            toFirstRuneworkingLesson,
            " and reached Runeworking 5. You do not need ",
            toFirstResonanceEcho,
            ", and you do not need Welding 12 to accept it.",
          ],
        ],
      },
      {
        heading: "Where it begins",
        paragraphs: [
          [
            "Talk to ",
            enby,
            " at Hilltop Workshop and choose A Place to Call Home, then Accept Mission (or Not Now, which changes nothing). It is offered by hand: there is nothing to accept anywhere else.",
          ],
        ],
      },
      {
        heading: "What it needs",
        list: [
          [
            "Welding level 12. This is the first objective, not a requirement to accept: if you are already Welding 12 it is met at once, and below it the Mission waits while you ",
            welding("practise your Welding"),
            ". Any proper Welding work counts, and ",
            wade,
            " has a workbench at Rusk Recovery for it.",
          ],
          "Installed once at the Crash Site: 1 Resonance Core, 3 Galvaferrite, 4 Mounting Brackets, 1 Galvanic Wire Spool and 2 Power Cells. The Galvaferrite and Wire Spool are on top of whatever went into making the Core. Parts can be fabricated, bought or traded, and you can install them in stages.",
          "24 Welding sections to secure the Rig. They are ordinary Welding: the same controls, progress and Clean Pass as any repair, and they carry on while you are away.",
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          [
            "Work up to Welding 12 and gather the parts, then travel back to your Crash Site on Skatboll. A Skatboll TP Rune, if you have one, lands you there and leaves your ship where it is (see ",
            { text: "Inventory & Equipment", articleSlug: "inventory-and-equipment" },
            ").",
          ],
          "Install the parts, then start welding. The 24th weld finishes your Rig for good.",
          [
            "The place is now your Resonance Site, and ",
            enby,
            " arrives. A short scene shows it; you can skip it and nothing is lost, and if you were away when the last weld finished it is waiting for you. They do not start talking by themselves: talk to them and choose Complete A Place to Call Home.",
          ],
        ],
      },
      {
        heading: "What you get",
        list: [
          "1,200 base Welding XP, from the 24 welds themselves as you do them. The Mission adds no Welding XP of its own.",
          "Two Skatboll TP Runes when you complete it, handed over together. You need room for both in your Inventory (slots and carrying capacity). If they will not fit, nothing happens at all: no runes, and the Mission is not complete. Make room and talk to them again.",
          [
            "It starts ",
            toARuneOfYourOwn,
            " for you at the same moment, with nothing further to accept.",
          ],
        ],
      },
      {
        heading: "Good to know",
        list: [
          "The Rig is yours alone: another character's Crash Site is still the Crash Site. It stays on its resonance point and never travels with your ship.",
          "While the Wise Old Enby is visiting your Resonance Site they are not at Hilltop Workshop, so their Research Jobs cannot be offered or handed in. A job you already hold is kept and waits for them to come home.",
          ["Following ", toFirstRuneworkingLesson, ". Back to all ", missions, "."],
        ],
      },
    ],
  },
  {
    slug: "mission-a-rune-of-your-own",
    title: "A Rune of Your Own",
    category: "getting-started",
    showInIndex: false,
    summary:
      "Craft one Skatboll TP Rune at your own Resonance Rig. It starts by itself when you finish A Place to Call Home and pays 500 Runeworking XP.",
    sections: [
      {
        paragraphs: [
          [
            "The lesson that follows ",
            toAPlaceToCallHome,
            ": make a Skatboll TP Rune yourself, at your own Resonance Rig. It starts by itself when you finish that Mission, so there is no offer and nothing to accept. ",
            enby,
            " is still at your Resonance Site, waiting.",
          ],
        ],
      },
      {
        heading: "What it needs",
        list: [
          [
            "Runeworking 5 and one Cut Quartz and one intact Runestone, which you find yourself (",
            { text: "Lapidary", articleSlug: "lapidary" },
            " cuts the Quartz). No materials are provided. The two runes you were just given do not count, and neither does a rune you were handed, traded or found.",
          ],
          [
            "Only a rune you genuinely attune at your Rig counts, after this Mission has started. Attuning takes 28.8 seconds and pays 125 ",
            runeworking("Runeworking"),
            " XP on its own. The recipe works the same as any other Rig run, including its numbers and Max, and Stop After This Attunement.",
          ],
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          "Gather a Cut Quartz and an intact Runestone and carry them to your Resonance Site.",
          "Choose Attune at your Rig and start the Skatboll TP Rune. When it finishes, the objective reads 1 of 1.",
          [
            "Talk to ",
            enby,
            " and choose Complete A Rune of Your Own. Crafting alone never finishes it.",
          ],
        ],
      },
      {
        heading: "What you get",
        list: [
          "500 Runeworking XP when you complete the Mission, once. The attunement already paid its own 125.",
          "The rune you made is yours to keep. The Wise Old Enby asks for nothing back, and the Mission does not mind if you have already used, stored or traded it.",
          [
            "They then take their own rune to The Low Hum and walk home to Hilltop Workshop, so their ",
            { text: "Research Jobs", articleSlug: "the-wise-old-enby" },
            " are open again.",
          ],
        ],
      },
      {
        heading: "Good to know",
        list: [
          "Your Rig keeps making Skatboll TP Runes after the Mission, as often as you like, for as long as you have the ingredients.",
          ["Following ", toAPlaceToCallHome, ". Back to all ", missions, "."],
        ],
      },
    ],
  },
];
