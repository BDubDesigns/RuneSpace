/**
 * "FedHex" commercial - editable content (issue #491, Stage D).
 *
 * An in-world, silent, 15-second pre-roll: a tiny bolt is carefully overpackaged, flown across
 * space and unwrapped, safe. FedHex is genuinely competent but excessively earnest: the joke is the
 * disproportionate packaging, never a failure of the service. The ending line is approved for this
 * spot only. No postage rates, transit promises, company-wide slogans or claims about
 * player-to-player shipping appear anywhere.
 *
 * TEXT    every string drawn on screen
 * TIMING  scene durations in ms (they sum to exactly 15000)
 * CAPTION the scene description for each scene (not closed captions: the film is silent)
 */
/** The approved FedHex art the closing ident sits on (served by the host at /location-scenes/). */
export const ART = { hub: { src: '/location-scenes/fedhex-parcel-hub.webp', w: 1536, h: 384 } };

export const TEXT = {
  matters: 'EVERY PARCEL MATTERS.',
  brand: ['Fed', 'Hex'],
  line: ['We take the little', 'things seriously.'],
};

export const TIMING = {
  counter: 3000,
  boxes: 4000,
  load: 1300,
  fly: 1400,
  arrive: 1300,
  unwrap: 2000,
  ident: 2000,
};

export const CAPTION = {
  counter: 'At the FedHex counter a customer carefully presents a single tiny bolt. The straight-faced clerk accepts it like a precious artifact. Every parcel matters.',
  boxes: 'The bolt is boxed. That box goes into a bigger box, and those go into a huge crate. Each one gets an official stamp.',
  load: 'The huge crate is secured in a freighter.',
  fly: 'The freighter streaks through space past a moon.',
  arrive: 'The freighter lands at a FedHex delivery station on another planet.',
  unwrap: 'The recipient opens the crate and quickly unwraps the nested boxes to find the single bolt, safely intact.',
  ident: 'The FedHex wordmark, in Fed purple and Hex orange: FedHex. We take the little things seriously.',
};
