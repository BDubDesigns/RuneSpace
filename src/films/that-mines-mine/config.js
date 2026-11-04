/**
 * "That Mines Mine!" – editable content.
 *
 * TEXT   : every title card and caption in one place.
 * TIMING : scene durations in milliseconds. Change a number and the film
 *          re-flows (scene start times are the running sum). Scene builders
 *          schedule their action relative to their own start, so shortening a
 *          scene trims its hold at the end - keep the action times in each
 *          scene file inside the duration you set here.
 */

export const TEXT = {
  studio: ['SKATBOLL', 'SILENT PICTURES', 'PROUDLY PRESENT'],
  title: ['THAT MINES', 'MINE!'],
  subtitle: 'A MINING MISADVENTURE IN ONE REEL',
  lonely: ['A LONELY HILLSIDE...', '...AND ONE LONELY PROSPECTOR.'],
  company: ['UNFORTUNATELY,', 'HE HAD COMPANY.'],
  thatMine: ["THAT MINE'S MINE!"],
  noThatMine: ['NO!', "THAT MINE'S MINE!"],
  work: ['NOTHING BEATS A DAY', 'OF HONEST WORK!'],
  cartPlans: ['THE CART HAD', 'OTHER PLANS.'],
  behind: ['MEANWHILE, BEHIND', 'THE MOUNTAIN...'],
  kept: ['BUT HE STILL HAD', 'THE MINE.'],
  other: ['AND THE OTHER FELLOW HAD', 'WHAT CAME OUT OF IT.'],
  end: ['THE END'],
  sign: 'MINE!',
};

/** Scene durations (ms). Title cards are timed for a relaxed read (~1 s plus ~0.4 s per word). Order of scenes lives in index.js. */
export const TIMING = {
  studio: 3000,
  title: 4200,
  lonely: 3400,

  trudge: 4600,
  glitter: 1500,
  stake: 5400,

  company: 2900,
  rival: 6800,

  argue1: 2400,
  thatMine: 2700,
  argue2: 2400,
  noThatMine: 3200,

  idea: 2600,
  bonk: 6800,

  work: 3200,
  mineIn: 2300,
  cutterUp: 1800,
  cartFull: 2800,

  cartPlans: 2800,
  runaway: 5400,

  behind: 3200,
  wake: 11200,

  proud: 4000,
  kept: 3200,
  other: 4200,
  finale: 3800,
  end: 3600,
};

/** Spoken-word-free "alt text" for captions (shown when the CC toggle is on). */
export const CAPTION = {
  studio: 'Skatboll Silent Pictures presents.',
  title: 'THAT MINES MINE! A mining misadventure in one reel.',
  lonely: 'A lonely hillside and one lonely prospector.',
  trudge: 'A scruffy prospector trudges in and spots something glittering in a mine.',
  glitter: '[The mine entrance sparkles with riches.]',
  stake: 'He trips, flops, then hammers in a stake and plants a sign: MINE!',
  company: 'Unfortunately, he had company.',
  rival: 'A tall prospector arrives and plants his own MINE! sign. The signs keep getting swapped.',
  argue1: 'The first prospector points at the mine, then at himself.',
  thatMine: "THAT MINE'S MINE!",
  argue2: 'The tall prospector points at the mine, then at himself.',
  noThatMine: "NO! THAT MINE'S MINE!",
  idea: 'The first prospector glances at his mining cutter. He gets a very bad idea.',
  bonk: 'BONK! The cutter lands on the rival\'s head. X eyes. He is dragged behind the mine.',
  work: 'Nothing beats a day of honest work!',
  mineIn: 'The victor goes to work: sparks fly and ore tumbles out of the mine into a cart.',
  cutterUp: '[Close-up: the cutter chews rock. Sparks.]',
  cartFull: 'The cart fills... and fills... to an absurd height.',
  cartPlans: 'The cart had other plans.',
  runaway: 'He pushes the cart. It rolls away downhill. He chases it and fails to catch it.',
  behind: 'Meanwhile, behind the mountain...',
  wake: 'The rival wakes. The runaway cart crashes nearby. He plants a MINE! sign on the ore.',
  proud: 'The first prospector returns and proudly guards his (empty) mine.',
  kept: 'But he still had the mine.',
  other: 'And the other fellow had what came out of it.',
  finale: 'The rival sits on a mountain of ore beside his MINE! sign.',
  end: 'The End.',
};
