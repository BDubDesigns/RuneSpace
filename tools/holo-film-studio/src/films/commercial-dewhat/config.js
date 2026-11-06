/**
 * "DeWhat?" commercial - editable content (issue #491, Stage D).
 *
 * An in-world, silent, 15-second pre-roll for the Holo Drive-In. The script is the owner-approved
 * one (Notion, "First-pass 15-second advertising storyboards", November 5, 2026): a fast,
 * escalating Who's-on-First misunderstanding between two workers, ending on the approved slogan.
 * Spoken lines are shown as speech balloons exactly as written (their capitals are the joke);
 * nothing here invents a DeWhat? product, policy or guarantee.
 *
 * TEXT    every string drawn on screen
 * TIMING  scene durations in ms (they sum to exactly 15000)
 * CAPTION the scene description for each scene (not closed captions: the film is silent)
 */
export const TEXT = {
  // Worker 1 = Pip (the round one), Worker 2 = Rex (the tall one).
  opening: ["Power's out!", 'What do we do?!'],
  lines: [
    { who: 2, lines: ['DeWhat.'] },
    { who: 1, lines: ["That's what", "I'm asking!", 'Do what?!'] },
    { who: 2, lines: ['No, DeWHAT!'] },
    { who: 1, lines: ['WHAT DO WE DO?!'] },
    { who: 2, lines: ['DEWHAT!'] },
    { who: 1, lines: ["I DON'T", 'KNOW WHAT!'] },
  ],
  sign: ['DeWhat?', 'EMERGENCY POWER ANNEX'],
  brand: 'DeWhat?',
  slogan: ['Sometimes you gotta', 'DeWhat you wanna do™.'],
};

export const TIMING = {
  dark: 3000,
  talk: 7000,
  sign: 2400,
  card: 2600,
};

export const CAPTION = {
  dark: "A workshop goes dark and an alarm flashes. Worker 1 panics: Power's out! What do we do?!",
  talk: "The two workers misunderstand each other faster and louder: DeWhat. That's what I'm asking! Do what?! No, DeWHAT! WHAT DO WE DO?! DEWHAT! I DON'T KNOW WHAT!",
  sign: 'Worker 2 gives up, grabs Worker 1 by the head and turns it toward a brightly lit sign: DeWhat? Emergency Power Annex.',
  card: 'A cheerful, cheap-looking company card: DeWhat? Sometimes you gotta DeWhat you wanna do™.',
};
