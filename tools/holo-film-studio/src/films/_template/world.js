/**
 * Template film - one location. Static art only; characters/props are added per shot.
 * `defs` must include FX_DEFS (the effects paint with #g-dust / #g-smoke from it).
 */
import { FX_DEFS } from '../../fx/effects.js';
import { INK } from '../../art/props.js';

export const WORLD_DEFS = `
  ${FX_DEFS}
  <linearGradient id="t-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f4f4"/><stop offset="1" stop-color="#b9b9b9"/></linearGradient>
  <linearGradient id="t-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b4b4b4"/><stop offset="1" stop-color="#6d6d6d"/></linearGradient>
`;

/** y of the ground line characters stand on (their root origin is between their feet). */
export const GROUND_Y = 604;

/** Wide backdrop: sky plus ground, extended past the frame so camera pans never show an edge. */
export function field() {
  return `<rect x="-1200" width="3680" height="720" fill="url(#t-sky)"/>
    <path d="M-1200 588 L2480 588 L2480 720 L-1200 720Z" fill="url(#t-ground)" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`;
}
