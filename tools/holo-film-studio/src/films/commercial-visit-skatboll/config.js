/**
 * "Visit Skatboll!" commercial - editable content (issue #491, Stage D).
 *
 * An in-world, silent, 15-second pre-roll: an over-enthusiastic tourism-board advertisement for an
 * industrial planet, built (as the owner approved on November 5, 2026) from REAL approved RuneSpace
 * 4:1 World Location art with horizontal camera pans and exaggerated title overlays.
 *
 * ART     the approved location art each segment pans across (served by the host at /location-scenes/)
 * TEXT    every string drawn on screen
 * TIMING  scene durations in ms (they sum to exactly 15000)
 * CAPTION the scene description for each scene (not closed captions: the film is silent)
 */
export const ART = {
  nightlife: { src: '/location-scenes/rusk-recovery.webp', w: 1536, h: 384 },
  scenery: { src: '/location-scenes/processing-yard.webp', w: 1920, h: 480 },
  hospitality: { src: '/location-scenes/hh-bnb-exterior.webp', w: 1536, h: 384 },
  finale: { src: '/location-scenes/holo-drive-in.webp', w: 1536, h: 384 },
};

export const TEXT = {
  nightlife: ['DAZZLING NIGHTLIFE!'],
  scenery: ['BREATHTAKING SCENERY!'],
  hospitality: ['UNFORGETTABLE', 'HOSPITALITY!'],
  finale: [{ t: 'SKATBOLL', size: 150 }, { t: "IT'S NOT ALL WORK.", size: 82 }],
  stamp: 'MOSTLY WORK.',
};

export const TIMING = {
  nightlife: 4000,
  scenery: 4000,
  hospitality: 4000,
  finale: 3000,
};

export const CAPTION = {
  nightlife: 'Dazzling nightlife! A slow pan across the lit workshops of Rusk Recovery while welding sparks fly.',
  scenery: 'Breathtaking scenery! A slow pan across the mountains and mining works of the Abandoned Processing Yard.',
  hospitality: 'Unforgettable hospitality! A slow pan across the warm, lit front of HH B&B in Holo Hollow.',
  finale: "Skatboll: it's not all work. A slow pan across the Holo Drive-In, then a small stamp lands underneath: mostly work.",
};
