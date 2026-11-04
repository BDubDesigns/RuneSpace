# Rare or Weld Done? — approved story

Status: **screenplay approved and locked by the project owner.** Do not change beats, the ending, or the
locked title-card wording without asking. (Implementation notes at the bottom.)

- **Genre:** black-and-white silent slapstick heist comedy, no audio needed.
- **Setting:** a museum on RuneSpace's as-yet-unnamed third planet.
- **Premise:** a thief learns a museum is displaying a priceless giant Emerald for one week and plans to sell it to
  a criminal fence. He cuts through the wall, but the Emerald is absurdly heavy. After several disastrous attempts to
  move it he realises he can build a literal fence around it and charge tourists admission.
- **Central joke:** he can't take the stolen Emerald to a fence, so he brings a fence to the Emerald. Both meanings of
  *fence* must be understood: the criminal dealer is set up clearly at the start and paid off with the physical fence.
- **Target runtime:** about 2 minutes, up to roughly 2½. Do not rush a gag to hit a number.

## Placeholder names (NOT canon)

"The Nebula Heart Emerald" is a working name and the third planet has no name yet. Both live in `NAMES` in
`config.js` (the museum label is deliberately neutral). Change them there; no scene hard-codes either.
"5 CREDITS ADMISSION" is an in-fiction gag price, **not** the Drive-In ticket price.

## Beats

1. **The newspaper.** A slightly shabby, overconfident thief reads a paper in his modest apartment. Front page:
   `THE NEBULA HEART EMERALD! / ON DISPLAY FOR ONE WEEK ONLY!` with an illustration of an enormous faceted Emerald.
   He gets an idea. A thought bubble shows a shady dealer labelled `FENCE`, then the Emerald exchanged for a mountain of
   Credits. He grins and grabs his welding equipment. The setup must be visually unmistakable.
2. **The great heist.** Night, imposing museum. The thief, in oversized welding goggles with an industrial torch,
   studies the building and its security with exaggerated seriousness. Instead of a normal door he welds/cuts through a
   fortified wall: sparks, smoke, arc flashes, dramatic close-ups, comic struggles with heavy gear, an accidental
   boot-to-floor weld. He squeezes through the person-sized hole and finds the giant Emerald, far bigger than he
   expected. Hold the astonished face.
3. **The impossible getaway.** Tiny sack: too small. Push: nothing. Shoulder: nothing. Lever or rope: nothing. He
   backs up, takes an absurdly long run-up and JUMP-KICKS THE EMERALD. `BOOOONG!` The Emerald does not move. He rebounds
   into a heap with cartoon stars. (Strong anticipation / impact / recovery.)
4. **The balloons.** He spots a bunch of balloons and ties ever more ridiculous numbers to the Emerald until it rises.
   He steers it through the hole and pushes it outside. Success! It keeps rising and rising; he grabs for the dangling
   rope. A tiny bird pecks one balloon: `POP!` The rest stretch under the load, then `POP! POP! POP-POP-POP!` The
   Emerald plummets into a crater outside the museum. The thief crawls out from cover, dusty and defeated. The Emerald is
   outside, still far too heavy to take to his fence.
5. **A brilliant realization.** He sits in despair beside the Emerald. Looks toward the distant route to the fence.
   Looks at the Emerald. Looks at his welding equipment. A lightbulb. Cards (wording locked):
   `"IF I CAN'T BRING THE EMERALD TO A FENCE..."` then `"I'LL BRING A FENCE TO THE EMERALD!"` with room to land.
   (Owner review change: the second card originally read "I'LL BRING THE FENCE ..."; it now reads "A FENCE".)
6. **The construction montage.** Over-the-top welding: fence panels, decorative ironwork, a gate, a ticket booth, a large
   admission sign. He is a much better welder than thief.
7. **The perfect crime.** Morning. A long line of tourists. The thief, in a ridiculous top hat and crooked bow tie,
   sits proudly in his booth. Sign: `THE NEBULA HEART EMERALD / 5 CREDITS ADMISSION`. Tourists file in; the pile of Credits
   grows. **No police officer buys a ticket** (that joke was rejected).
8. **The locked final punchline.** He takes out the original newspaper and rereads `ONE WEEK ONLY!`. Looks at the paper,
   the profitable attraction, the sign. Smiles. Carefully welds a replacement plate over the sign: `OPEN DAILY`. Hold the
   final image. Iris closes. THE END. **No explanatory final card.**

## Implementation notes (film 2)

- Cast: the thief is a new `kind: 'thief'` in `src/art/prospector.js` (cap, stripes, stubble, goggles, optional top hat
  and bow tie). Tourists, the Emerald, balloons, the bird, the torch, fence parts and Credits are shared art.
- The four prioritised set pieces: the balloon disaster, the jump-kick, the welding montage, the final sign replacement.
