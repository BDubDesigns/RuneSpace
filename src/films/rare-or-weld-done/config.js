/**
 * "Rare or Weld Done?" - editable content.
 *
 * NAMES  : placeholder lore. The Emerald's name and the third planet are NOT decided; every scene reads
 *          them from here, so renaming them is a one-line change (see STORY.md).
 * TEXT   : every title card string and in-picture lettering.
 * TIMING : scene durations in ms (scene starts are the running sum, in the order set by index.js).
 * CAPTION: CC text for each scene; every id in TIMING needs one.
 */

export const NAMES = {
  /** The giant gem (working name, may change). Shown on the newspaper, the museum placard and the admission sign. */
  emerald: 'THE NEBULA HEART EMERALD',
  /** Neutral label for the museum on the unnamed third planet (do not invent an official planet name). */
  museum: 'PLANET THREE MUSEUM',
  /** In-fiction gag price. NOT the RuneSpace Holo Drive-In ticket price. */
  price: '5 CREDITS ADMISSION',
};

const nameWords = NAMES.emerald.split(' ');
/** The Emerald's name split for big lettering: everything but the last word, then the last word. */
const nameTop = nameWords.slice(0, -1).join(' ');
const nameLast = nameWords[nameWords.length - 1];
const priceWords = NAMES.price.split(' ');
const priceLines = [priceWords.slice(0, -1).join(' '), priceWords[priceWords.length - 1]];

export const TEXT = {
  studio: ['SKATBOLL', 'SILENT PICTURES', 'PROUDLY PRESENT'],
  title: ['RARE OR', 'WELD DONE?'],
  subtitle: 'A HEIST IN ONE REEL',
  night: ['THAT NIGHT, AT THE', NAMES.museum + '...'],
  // locked wording: do not edit without the project owner
  ifIcant: ["IF I CAN'T BRING THE EMERALD", 'TO A FENCE...'],
  illBring: ["I'LL BRING THE FENCE", 'TO THE EMERALD!'],
  morning: ['THE NEXT MORNING...'],
  end: ['THE END'],

  // in-picture lettering
  headline: [nameTop, `${nameLast}!`],
  headlineSub: ['ON DISPLAY FOR', 'ONE WEEK ONLY!'],
  paperName: 'THE DAILY NOVA',
  weekOnly: 'ONE WEEK ONLY!',
  fence: 'FENCE',
  museumSign: NAMES.museum,
  placard: [nameTop, nameLast],
  /** the admission sign, top to bottom */
  sign: [nameTop, nameLast, ...priceLines],
  admission: NAMES.price,
  openDaily: 'OPEN DAILY',
  booth: 'TICKETS',
};

/** Scene durations (ms). Cards are timed ~1 s plus ~0.4 s per word; punchline cards get extra air. */
export const TIMING = {
  studio: 3000,
  title: 4200,

  // 1. the newspaper
  read: 5200,
  paper: 5200,
  plan: 8200,
  grab: 3200,

  // 2. the great heist
  night: 3000,
  wall: 7600,
  arc: 3200,
  cut: 9800,
  squeeze: 3800,
  vault: 7000,

  // 3. the impossible getaway
  sack: 7000,
  kickRun: 4200,
  kick: 6600,

  // 4. the balloons
  balloons: 10800,
  rise: 6400,
  pop: 6000,
  crash: 6600,

  // 5. a brilliant realization
  despair: 6400,
  ifIcant: 4200,
  illBring: 5000,

  // 6. the construction montage
  posts: 3200,
  iron: 3000,
  gate: 3200,
  signUp: 3600,
  ready: 2600,

  // 7. the perfect crime
  morning: 2200,
  queue: 7600,

  // 8. the punchline
  reread: 6200,
  plate: 8200,
  end: 3600,
};

/** Alt text for captions (shown when CC is on). */
export const CAPTION = {
  studio: 'Skatboll Silent Pictures presents.',
  title: 'RARE OR WELD DONE? A heist in one reel.',
  read: 'A shabby, overconfident thief reads the newspaper in his modest apartment.',
  paper: `[Front page: ${NAMES.emerald}! On display for one week only! A drawing of an enormous faceted emerald.]`,
  plan: 'He gets an idea. In a thought bubble a shady dealer labelled FENCE trades a mountain of Credits for the Emerald.',
  grab: 'He grins, grabs his welding gear and rushes out.',
  night: `That night, at the ${NAMES.museum}...`,
  wall: 'At night the thief studies the museum wall and its searchlight and security camera. He ignores the ordinary door.',
  arc: '[Close-up: goggles down. The torch ignites. Blinding arc.]',
  cut: 'He cuts a doorway through the wall: sparks, smoke, a heavy gas tank that bumps him, and an accidental boot-to-floor weld. The cut-out slab drops.',
  squeeze: 'He sucks in his gut, turns sideways and squeezes through the hole.',
  vault: 'He squeezes through and finds the Emerald, far bigger than he expected.',
  sack: 'A tiny sack. He pushes. He shoulders. He tries a rope. The Emerald does not move.',
  kickRun: 'He backs up. And up. And up.',
  kick: 'JUMP-KICK! BOOOONG! The Emerald stays put; the thief ends up in a heap with stars.',
  balloons: 'He finds balloons and ties more and more to the Emerald until it floats.',
  rise: 'He steers the floating Emerald out through the hole. Success! It keeps rising. He grabs for the rope.',
  pop: 'A tiny bird pecks a balloon. POP! The rest stretch, then cascade: POP POP POP-POP-POP!',
  crash: 'The Emerald plummets into a crater. The dusty thief crawls out. It is outside, but still far too heavy.',
  despair: 'In despair he looks down the long road to the fence, at the Emerald, at his torch. A lightbulb.',
  ifIcant: "If I can't bring the Emerald to a fence...",
  illBring: "I'll bring the fence to the Emerald!",
  posts: 'A welding montage: fence posts and rails go up in a shower of sparks.',
  iron: '[Close-up: decorative ironwork scrolls into being.]',
  gate: 'A gate and a ticket booth are welded together.',
  signUp: `A huge admission sign goes up: ${NAMES.emerald}, ${NAMES.price}.`,
  ready: 'The finished fence gleams around the Emerald. He is a much better welder than thief.',
  morning: 'The next morning...',
  queue: `A long line of tourists pays to see the Emerald. The thief, in a top hat and bow tie, collects a growing pile of Credits.`,
  reread: 'He rereads the newspaper: ONE WEEK ONLY! He looks at the paper, his attraction and his sign, and smiles.',
  plate: 'He carefully welds a new plate over the sign. It now reads: OPEN DAILY.',
  end: 'The End.',
};
