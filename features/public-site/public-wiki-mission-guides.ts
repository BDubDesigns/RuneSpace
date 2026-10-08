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
const toACutAbove = link("A Cut Above", "mission-a-cut-above");
const toOutOfTheWeather = link("Out of the Weather", "mission-out-of-the-weather");
const toCuttingCosts = link("Cutting Costs", "mission-cutting-costs");
const toCurlyMustStash = link("Curly Must-Stash", "mission-curly-must-stash");

export const missionGuideArticles = [
  {
    slug: "mission-walk-it-off",
    title: "Walk It Off",
    category: "getting-started",
    showInIndex: false,
    summary:
      "Your first job: reach The Jag and talk to Tansy Rusk. Where it starts, what it hands you, and what comes next.",
    sections: [
      {
        paragraphs: [
          [
            "Part of the ",
            missions,
            " list, and the first job on it. Nothing has to be finished before you can take it.",
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
            " offers the same job there, so you cannot miss it either way.",
          ],
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          "Take the job from Wade at the Crash Site, or from Tansy once you reach The Jag.",
          "Travel to The Jag on the Map. You need to be standing there when you hand the job in.",
          "Talk to Tansy and choose Claim Cutter. If she was the one who offered the job, accepting leads straight into claiming it.",
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
        paragraphs: [
          [
            "Part of the ",
            missions,
            " list. It teaches the Inventory-to-Equip step and the Mining loop.",
          ],
        ],
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
          "100 Mining XP when you hand the job in.",
          "Nothing is taken: Tansy only looks at the shale, and you keep it.",
        ],
      },
      {
        heading: "Good to know",
        paragraphs: [
          "The equipped Cutter and the shale are checked live. If you take the Cutter off or drop shale before you hand the job in, it goes back to asking for them.",
        ],
      },
      {
        heading: "What happens next",
        paragraphs: [["Finishing it starts ", toWasteNot, " automatically."]],
      },
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
        paragraphs: [
          [
            "Part of the ",
            missions,
            " list. It teaches Refining, the other half of the early work loop.",
          ],
        ],
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
        paragraphs: [
          [
            "Part of the ",
            missions,
            " list. It is the job that teaches you Welding and gives you the Cargo Hold.",
          ],
        ],
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
          "The repaired Cargo Hold itself: 32 slots of storage at the Crash Site.",
        ],
      },
      {
        heading: "What happens next",
        paragraphs: [
          [
            "Nothing starts by itself. Finishing it is what makes two other jobs available, and neither is a continuation: ",
            toKeepTheChange,
            " is Wade's next job, and ",
            toOutOfTheWeather,
            " is an optional job from Renn. They do not depend on each other.",
          ],
        ],
      },
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
            "Part of the ",
            missions,
            " list. It is the first job you take on yourself rather than having it start for you.",
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
            " at his shop in Holo Hollow. This is part of the job even if you already have three cells. Talking to him is all that is required; you never have to buy or sell anything.",
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
          "Take the job from Wade at the Crash Site. He hands you the Credits straight away.",
          "Walk to Holo Hollow and talk to Bix.",
          "Get three Power Cells.",
          "Take them to Tansy at The Jag and choose Hand Over Cells.",
        ],
      },
      {
        heading: "What you get",
        list: [
          "36 Credits when you accept, as Wade's job budget — three cells at Bix's price of 12 each. They are yours: if you already have cells, or claim them free at the Annex, you keep whatever you do not spend. Nothing is reimbursed.",
          "Nothing more when you finish. There is no second payout.",
        ],
      },
      {
        heading: "Good to know",
        list: [
          "Handing the cells over takes exactly three. Any extras you carry stay with you.",
          "Finishing it ends with Tansy calling Wade to say you did the job properly. Wade moves back to his own yard at Rusk Recovery, and HH B&B opens to you.",
        ],
      },
      {
        heading: "What opens up",
        list: [
          [toTenThousandHours, " — Wade's next job, at Rusk Recovery."],
          [toCurlyMustStash, " — an optional job from ", curly, " at HH B&B."],
        ],
      },
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
        paragraphs: [
          ["Part of the ", missions, " list. Accepting it is what opens Wade's Workbench to you."],
        ],
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
            "Accept the job. Wade hands you six Scrap Metal, three welds' worth, and opens the ",
            practiceWelding("Workbench"),
            " and his scrap counter. He hands over all six or none: if you do not have room, nothing is handed over and the job is not started, so make room and come back.",
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
    ],
  },
  {
    slug: "mission-10001-hours",
    title: "10,001 Hours",
    category: "getting-started",
    showInIndex: false,
    summary:
      "At Welding level 5 Wade Rusk opens the Work Orders board to you for good. Finish one paying job, then show him.",
    sections: [
      {
        paragraphs: [
          [
            "Part of the ",
            missions,
            " list. This is not side work: it is how paid ",
            workOrders("Work Orders"),
            " become yours, and it runs independently of the Fabrication and Deep Jag jobs.",
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
          "Accept the job. This is the moment the Work Orders board becomes yours for good.",
          [
            "Take a job off the terminal beside the Workbench and finish it. Taking a job hands its materials over from your Inventory right away, so carry everything it asks for first. See ",
            workOrders("Work Orders"),
            " for how the board works.",
          ],
          "Talk to Wade and choose Show Him the Job.",
        ],
      },
      {
        heading: "What you get",
        list: [
          "The job's own Credits and Welding XP, paid when you finish the Work Order.",
          "10 Refined Ferrite and 5 Power Cells from Wade when you show him the work, handed over together or not at all. They have to fit in your Inventory — if they do not, make room and report again.",
        ],
      },
      {
        heading: "Good to know",
        paragraphs: [
          "Accepting is the real unlock. Showing Wade the work is not a second gate: the board keeps working whether or not you have turned the job in.",
        ],
      },
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
            "Part of the ",
            missions,
            " list. It teaches ",
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
            "Fabricate a Salvage Cutter at the Fabrication Station while the job is open: 5 Refined Ferrite and 1 ",
            powerCells("Power Cell"),
            ". A Cutter you already had, bought or were given does not count for this part, and neither does a workpiece that busts.",
          ],
          "Carry a Salvage Cutter that you are not wearing, to hand over.",
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          "Take the job from Tansy.",
          "Fabricate a Salvage Cutter at the Station.",
          "Talk to Tansy and choose Hand Over the Cutter. She will not take the one in your hand. The Cutter you just made is fine, and so is any other Salvage Cutter you are carrying.",
        ],
      },
      {
        heading: "What you get",
        list: [
          "100 Fabrication XP when you hand the Cutter over. Fabricating it pays its own 65 Fabrication XP on top.",
          "Tinkering opens when the job is done. Tansy takes the Cutter apart on the spot to show you how it works, and the Scrap from her demonstration stays with her.",
        ],
      },
      {
        heading: "Good to know",
        paragraphs: [
          [
            "You may use ",
            fabrication("Manual Override"),
            " on this first Cutter. If a push wrecks the workpiece, the job just waits for another one.",
          ],
        ],
      },
      {
        heading: "What happens next",
        paragraphs: [["Finishing it starts ", toBreakItDown, " automatically."]],
      },
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
        paragraphs: [
          [
            "Part of the ",
            missions,
            " list. It teaches Tinkering, the other half of ",
            fabrication("Fabrication"),
            ".",
          ],
        ],
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
            "Part of the ",
            missions,
            " list. This is not a side job: finishing it is the gate for ",
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
          "Take the job from Tansy at The Jag. Deep Jag has been on the Map from the start, marked CAVE-IN; once you accept, you can walk down to work on the passage.",
          "Haul the material down over as many trips as you like and install it. What you install stays installed.",
          "Weld fifteen passes. The moment the fifteenth lands the passage is open: the map reads MINING, and you can mine Galvanite right there without going back up.",
          "Go back up to The Jag and tell Tansy the Deep Jag is open (Tell Tansy). Your 250 Welding XP is waiting whenever you head back.",
        ],
      },
      {
        heading: "What you get",
        list: [
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
          [toWheelBeRightBack, " — Wade's landing-gear job. No skill gate."],
          [toACutAbove, " — Tansy's Loadsteel Cutter lesson, at Fabrication level 5."],
          [toCuttingCosts, " — Renn's Loadsteel Cutter purchase. No skill gate."],
        ],
      },
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
        paragraphs: [
          [
            "Part of the ",
            missions,
            " list. It is the middle step of restoring your ship, and it leads to ",
            toThrustIssues,
            ".",
          ],
        ],
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
          "Take the job from Wade at Rusk Recovery.",
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
        paragraphs: [[toThrustIssues, " — Wade's last ship job, at Welding level 8."]],
      },
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
        paragraphs: [
          [
            "Part of the ",
            missions,
            " list. It is the last repair of the ship, after ",
            toWheelBeRightBack,
            ".",
          ],
        ],
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
          "Take the job from Wade at Rusk Recovery.",
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
        heading: "Good to know",
        paragraphs: [
          "The ship is repaired, but it has no flight controls yet, so there is still nowhere to fly it.",
        ],
      },
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
            "Part of the ",
            missions,
            " list. It is a separate advanced Fabrication opportunity, not part of the ship repairs, and it is a different job from ",
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
            "A Loadsteel Cutter with you. The recipe opens at Fabrication level 5 whether or not you ever take this job — accepting it unlocks nothing — and needs 2 Galvaferrite, 1 Galvanic Wire Spool and 1 Power Cell at the ",
            fabrication("Fabrication Station"),
            ". No Refining level is needed.",
          ],
        ],
      },
      {
        heading: "Walkthrough",
        list: [
          "Take the job from Tansy at The Jag.",
          "Get a Loadsteel Cutter, however you like. One you made earlier, made since, traded for or were given all work, carried or equipped, charged or not. If you already have one when you take the job, you can show her straight away.",
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
    ],
  },
  {
    slug: "mission-out-of-the-weather",
    title: "Out of the Weather",
    category: "getting-started",
    showInIndex: false,
    summary:
      "An optional job from Renn Calder: repair the Crew Stop on the haul road with 20 Refined Ferrite and ten welding passes.",
    sections: [
      {
        paragraphs: [
          [
            "Part of the ",
            missions,
            " list. It is genuinely optional: nothing hands it to you, nothing is waiting on it, and you can ignore it forever without closing anything off.",
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
          "Accept the job from Renn.",
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
            "The shelter stays repaired for good. The crews use it every workday and know who fixed it, so they let you ride the shift hauler out to The Jag for ",
            link("5 Credits a trip", "travel-and-scavenging"),
            ". Only on the way out — the hauler comes back loaded with shale, so you walk home.",
          ],
        ],
      },
      {
        heading: "Good to know",
        paragraphs: [
          "This one costs you rather than paying you up front: the materials and the time are yours. Renn will not chase you about it, and the Crew Stop stays where it is however long you take. No Credits are paid, and no other job depends on it.",
        ],
      },
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
        paragraphs: [
          [
            "Part of the ",
            missions,
            " list. It is optional, and it is gated by ",
            toBraceYourself,
            " — not by ",
            toACutAbove,
            ".",
          ],
        ],
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
          "Take the job from Renn.",
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
            "Part of the ",
            missions,
            " list. It is an optional commission: nothing requires it, and ignoring it changes nothing anywhere else.",
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
          "Take the job from Curly. He pays 150 Credits straight away.",
          "Install the materials and weld the six passes at the B&B.",
          "Talk to Curly and choose Collect Payment.",
        ],
      },
      {
        heading: "What you get",
        list: [
          "150 Credits when you take the job and another 150 when you collect, 300 in all.",
          "The passes earn their own Welding XP as you go, 50 apiece. The job adds none on top.",
        ],
      },
      {
        heading: "Good to know",
        paragraphs: [
          "The finished mount holds Curly's container, in Curly's room. It is a job finished for him — not storage for you, and not one of your own site stashes.",
        ],
      },
    ],
  },
];
