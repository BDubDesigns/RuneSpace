# RuneSpace Art Cookbook

This document records RuneSpace's proven art-production workflow and the visual
acceptance rules that make generated assets feel like they belong in the game.
It is practical guidance for product/design work first and an implementation
reference second.

This cookbook describes **current proven production defaults, not immutable file
specifications**. Asset dimensions, encoding choices, compression, and runtime
optimization may change when a dedicated optimization pass proves a better
contract. When that happens, update this document instead of preserving obsolete
requirements for compatibility.

The durable rules are the intent, continuity, and QA boundaries: what an asset
must communicate, how related assets stay coherent, and how they are reviewed in
the real RuneSpace UI.

## Art direction

RuneSpace is blue-collar industrial science fiction.

Its environments should feel used rather than pristine: mining infrastructure,
improvised repairs, work vehicles, aging businesses, practical equipment, faded
signage, and communities adapting to whatever industry currently keeps them
alive.

Science-fiction elements should feel ordinary to the people who live around
them. A speeder can occupy the visual role an old work truck would occupy today.
A mining settlement should feel like a working town in space, not a generic
futuristic city.

Art may contain humor, commercial clutter, cheap signage, awkward retrofitting,
and visual evidence that places have changed purpose over time.

Visual continuity matters, but identical composition does not. Related locations
should look like they belong to the same world without appearing to be the same
background with a different building pasted into it.

## Human review is part of the pipeline

Image generation is an iterative design process, not an automatic asset-production
step.

An asset is not finished because an image model returned a technically valid
image. Review whether it actually belongs in RuneSpace.

Common reasons to reject or revise an otherwise clean image include:

- incorrect technology level;
- generic or overly sleek science-fiction design;
- inappropriate lighting or time of day;
- contemporary-Earth visual vocabulary where a space-coded equivalent is
  required;
- poor mobile composition;
- broken generated text;
- inconsistent character identity;
- incorrect environmental storytelling;
- composition or mood that clashes with neighboring assets.

When an image feels wrong but the reason is not immediately obvious, stop and
identify the mismatch before generating more variations. Repeating the same
prompt is not a substitute for diagnosing the art-direction problem.

The useful questions are both:

> Is this image good?

and:

> Does this image belong here?

## Asset categories

### World Location scenes

Wide environmental scenes representing a full World Location such as the Crash
Site, The Jag, or Holo Hollow.

These establish the overall identity of a location and may contain infrastructure,
vehicles, terrain, structures, and anonymous background people.

A settlement overview may contain anonymous residents or workers when population
is part of the environmental storytelling. Named or interactable NPCs should
normally remain separate assets.

### Local Place scenes

Wide scenes representing a place inside a World Location, such as a shop,
Assistance Center, or inn.

A Local Place should feel like a distinct physical destination within its parent
location. Related Local Places should share climate, architecture, materials,
and cultural details without reusing nearly identical surrounding composition.

If several Local Places appear to occupy the same stretch of road, background,
or camera position, the batch needs more environmental variation.

### Dialogue backgrounds

Environmental backgrounds used behind NPC conversation.

These should support the NPC and conversation without competing with the
portrait. Important environmental storytelling is welcome, but the scene should
leave useful visual space for the dialogue composition.

Named NPCs generally should not be baked into dialogue backgrounds because their
portrait and expression assets are rendered separately.

### NPC portraits and expressions

NPC portrait sets represent the same character across multiple emotional beats.

One approved neutral portrait is the visual identity master. Expression variants
should be created independently from that approved base rather than sequentially
from one expression into the next.

The character does **not** need to remain perfectly frozen.

Small pose changes are desirable when they help communicate emotion. A character
may tilt or turn their head slightly, shift their shoulders, reposition an arm
or hand, or make another controlled gesture.

The important constraint is **spatial continuity**.

Most of the character's body, scale, framing, clothing, and overall silhouette
position should remain stable enough that switching between expression assets
feels like the same person reacting in place.

For RuneSpace's near-full-body portraits, some controlled body language is
preferable to changing only facial features. The goal is a living character whose
reactions animate naturally, not a rigid paper doll and not a sequence of
unrelated poses.

Before accepting an expression set, flip rapidly between the images. Large
position, scale, clothing, or identity drift becomes much easier to notice this
way.

### Map identifiers

Map art is a compact visual identifier, not a miniature environmental scene.

It should communicate the location quickly at small display size through a strong
silhouette and a few recognizable details. The UI owns map labels and status, so
the art should not contain baked text.

The identifier should represent the World Location itself rather than a future
attraction, Mission objective, temporary state, or nearby feature.

### Item and equipment art

Item art is read primarily at small UI sizes. The runtime inventory tile currently
renders artwork at about 80x80 CSS pixels while supplying a larger intrinsic
image, so a strong silhouette and clear material/shape read matter more than fine
detail that disappears at gameplay scale.

Use transparent artwork with enough empty margin that the object does not feel
cramped, but do not leave so much canvas that the object becomes tiny when
rendered.

Equipment and unique items should read as distinct objects: recognizable shape,
construction, and major identifying features. Stackable materials should read as
a material category or useful quantity rather than as an over-designed hero prop.

Examples from the current set:

- Salvage Cutter: recognizable improvised tool silhouette;
- MYKEA SCHLEPPRAUM-8: clear container/storage identity;
- Power Cell: distinct industrial energy-cell form and repair history;
- Ferrite Shale: raw mined material;
- Refined Ferrite: visibly processed/valuable material;
- Slag: visibly undesirable refining byproduct without becoming unreadable noise.

Keep larger approved masters when useful for future reveals or edits, but judge
the game-ready result at actual inventory scale before accepting it.

### Public Update hero images

Public Updates should use a relevant hero when there is an obvious existing
approved asset that materially supports the release being announced.

Do not omit a strong relevant image merely because hero art is technically
optional. However, an Update should not be blocked when no suitable image exists,
and filler art should not be generated solely to satisfy the convention.

## Related-environment generation order

When several assets describe the same physical area, generation order matters.

Design specific places that need recognizable identities **before** generating
the larger overview that must contain them.

For a settlement such as Holo Hollow, establish the important building identities
first. The settlement overview can then incorporate recognizable versions of
those structures into the wider town.

The wider scene does not need to reproduce every Local Place perfectly. It needs
enough recognizable architecture, signage, shape, or other identity that the
player believes they are seeing the same place from another viewpoint.

Consistency should come from shared design language and recognizable landmarks,
not from copying the same camera background repeatedly.

## Dimensions, aspect ratios, and formats

Dimensions exist to support the presentation component. They are not an excuse
to upscale an approved asset merely to match an older convention.

Prefer the correct **aspect ratio, composition, and delivered quality** over an
arbitrary pixel target.

| Asset | Current practical contract |
| --- | --- |
| World Location scene | 4:1 composition. Existing scenes may be 1920x480; 1536x384 is also accepted when that is the approved delivered asset. |
| Local Place scene | 4:1. Holo Hollow established 1536x384 as a proven production size. |
| Dialogue background/interior | Compose for the production 15:8 DialogueScene. 1536x864 source art has worked well; keep crop tolerance around important content. |
| NPC portrait | Approximately 4:5, transparent. Production currently renders through a 400x500 intrinsic contract; higher-resolution masters may be retained separately. |
| Map identifier | Transparent, tightly cropped, lossless WebP, no more than 512 px on the long edge. |
| Item artwork | Transparent square-oriented master/derivative with strong readability at about 80 px display size; current inventory rendering supplies 160x160 intrinsic dimensions. |
| Public Update hero | Use the approved source image and record its actual intrinsic dimensions accurately. |

World Location and Local Place art belongs under `public/location-scenes/`.
Current schemas accept WebP or PNG; prefer WebP for opaque environment art unless
there is a concrete reason to use PNG.

Do not upscale a 1536x384 approved image to 1920x480 merely because older
location art uses that size. Upscaling adds pixels, not useful detail.

Metadata committed with an asset must describe the **actual file**, not the
desired size.

## Environment-generation workflow

Before generating an environment, establish what the image is supposed to
communicate.

A useful brief answers:

- **What is this place for?** Mining site, failing tourist town, repair yard,
  shop, municipal building, wreck site, etc.
- **Who uses it?** Workers, families, contractors, travelers, nobody anymore,
  or some combination.
- **How healthy is it?** Prosperous, declining, abandoned, barely maintained,
  repurposed, improvised.
- **What is the familiar real-world analogue?** RuneSpace often works best when
  futuristic technology fills a recognizable blue-collar role.
- **What time/activity state serves the game?** Lighting should support the
  location's narrative role rather than being randomized between assets.
- **What must not appear?** Wrong era, overly sleek architecture, contemporary
  Earth vehicles, named NPCs baked into reusable backgrounds, another hex's
  landmark, etc.

For related environments, approve important building identities first and then
use them as references for the wider settlement view.

Related places should feel like:

> different places in the same town

not:

> the same place with a different building swapped in.

Holo Hollow exposed this failure mode clearly: the individual buildings
communicate their intended businesses, but their surrounding exterior
compositions are too similar. They are accepted production placeholders, not the
model for future batches.

## NPC portrait production

Start with one approved neutral portrait.

That neutral image is the **identity master** for the expression set. It
establishes face, body proportions, clothing/accessories, general pose, camera
distance, approximate canvas position, lighting, and rendering style.

Every expression variant should be created independently from that neutral
master.

Do not generate a chain such as:

`neutral -> amused -> concerned -> angry`

Small errors compound through chained edits. Clothing changes, body proportions
drift, faces mutate, and the character gradually stops being the same person.

Instead use:

`neutral -> amused`  
`neutral -> concerned`  
`neutral -> angry`

The character may move. A convincing reaction may include a modest head turn or
tilt, shoulder movement, an arm or hand changing position, posture tightening or
relaxing, or another controlled gesture.

The objective is **spatial continuity, not perfect pixel alignment**.

Reject or revise variants where the character moves substantially left/right,
appears much closer/farther from the camera, changes to an unrelated stance,
gains or loses clothing/accessory details, changes body proportions or identity,
or rotates so dramatically that playback feels like unrelated pictures.

Before accepting a set, rapidly flip between all variants as a crude animation
test.

Production portrait files live under `public/npc-art/` and should use predictable
identity/expression names such as `<npc>-neutral.png` and
`<npc>-concerned.png`.

## Dialogue backgrounds

Dialogue backgrounds are environment art, not character art.

RuneSpace's production DialogueScene uses a 15:8 frame with `object-cover` and
composites the active NPC portrait separately.

Compose accordingly:

- keep the environmental identity readable behind a foreground character;
- avoid placing crucial signs, faces, or narrative objects where the portrait
  will cover them;
- leave crop tolerance around image edges;
- avoid backgrounds so busy or high-contrast that they fight the portrait.

A dedicated interior is appropriate when conversation meaningfully happens
inside a Local Place. Exterior location scenes can still be reused when that is
truthful and visually appropriate.

## Map identifier pipeline

Map identifiers are small decorative location identifiers and must remain
recognizable at map scale.

Current production assets are local `public/map-icons/<slug>.webp` files that
are tightly cropped, transparent, lossless, and no more than 512 px on the long
edge.

The proven raster workflow is:

1. Generate the desired compact object/location silhouette against a **flat,
   saturated hot-pink key background**.
2. Review and approve the subject before processing.
3. Use Sharp to remove the pink and near-pink background into transparency.
4. Clean remaining pink fringe or contaminated alpha edges.
5. **Only after transparency cleanup**, convert the subject to grayscale.
6. Tightly trim transparent space while preserving the intentional silhouette.
7. Downsample when necessary so the long edge is no more than 512 px.
8. Export as lossless transparent WebP.
9. Inspect both on transparency and in the actual RuneSpace map.

The ordering matters.

**Grayscale is not background removal.**

If the hot-pink background is converted to grayscale first, it becomes gray
contamination that can no longer be cleanly identified as the key color.
Likewise, a technically transparent asset with a visible pink halo is not done.

The finished identifier should communicate the location itself. The UI owns
labels and status.

## Signage and generated text

Signs are useful environmental storytelling in RuneSpace.

They can communicate history and adaptation without exposition: an old business
name underneath a newer bolted-on sign, obsolete tourist branding still visible
on a municipal building, repair notices, industrial warnings, or faded
advertising.

Generated text must be manually inspected.

If wording is canonically important, spelling and phrasing need to be correct.
Reject nearly-correct business names, pseudo-letters masquerading as readable
text, accidental extra words, incorrect capitalization where it matters, and
signage that contradicts gameplay.

When wording is wrong but the rest of the image works, prefer a focused
edit/correction pass instead of regenerating an otherwise successful scene from
scratch.

If a sign is only visual texture and does not need to be read, avoid making it
look almost like important canonical text.

Map identifiers should not contain baked labels.

## Mobile composition and crop QA

RuneSpace is mobile-first.

Every important asset must be judged inside the component that actually renders
it. A beautiful standalone image can still be a bad RuneSpace asset.

For wide scene art, verify:

- the focal building/object survives the real mobile crop;
- major signage is not accidentally cut off;
- important environmental storytelling remains understandable;
- UI overlays do not obscure the only useful part of the image;
- the scene still reads at phone scale rather than only when enlarged.

Authored focal metadata may fine-tune a good composition, but should not rescue a
bad one.

For dialogue, test the image with the actual NPC composited over it, not only as
a bare background.

For portraits, test expression changes during real dialogue playback.

For map identifiers, test at actual rendered size and opacity rather than only
evaluating the 512 px source.

For items, test at the inventory tile's real 80 px artwork size and in any larger
dialogue/reward reveal that reuses the asset.

## Public Update hero art

The full publishing contract remains in `docs/public-updates.md`; this cookbook
owns the visual-production rule.

When a player-facing Update has an obvious, strong, already-approved image that
materially represents the release, use it.

"Hero is optional" does not mean "skip the image unless somebody remembers."

If no appropriate existing asset exists, publish without a hero. Do not block a
worthwhile Update and do not generate meaningless filler solely so an article
has a picture.

Update-specific copies belong under `public/updates/` according to the publishing
contract.

## Masters and game-ready derivatives

Do not confuse the source used for future generation/editing with the optimized
file shipped to the game.

A **master** is the best approved source for future work. Examples include:

- an NPC's approved neutral portrait;
- an original full-resolution location generation;
- a color map-identifier source before pink-key removal/grayscale;
- an approved building design used as reference for a wider settlement scene.

A **game-ready derivative** is transformed for the runtime contract. Examples
include:

- keyed, cleaned, grayscale, trimmed map WebP;
- resized/compressed environment WebP;
- transparent NPC expression PNG;
- an Update-specific copy of approved location art.

Never destroy or overwrite a useful master merely because a derivative shipped.
Runtime repository paths are the production contract. Source-master storage is a
working-art concern and does not need to mirror runtime directories.

## Naming and runtime storage

Use predictable names that describe identity rather than generation history.

Good:

- `bix-weller-neutral.png`
- `bix-weller-amused.png`
- `holo-hollow-souvenirs-exterior.webp`
- `holo-hollow-souvenirs-interior.webp`
- `holo-hollow.webp`

Bad:

- `image-final2.webp`
- `bix-new-new.png`
- `town-good-one.png`
- `output_173.png`

Current production conventions:

- environment and conversation backgrounds -> `public/location-scenes/`
- NPC expressions -> `public/npc-art/`
- item/equipment art -> `public/item-art/`
- map identifiers -> `public/map-icons/`
- Update-specific heroes -> `public/updates/`

Canonical content registries should reference these assets rather than UI
components inventing paths ad hoc.

## Common failure modes

### Generic clean sci-fi

If an image could belong to any polished space game, it probably needs more
RuneSpace specificity. Look for work-worn materials, practical retrofits,
improvised repairs, labor/economic context, and believable use.

### Wrong vehicle vocabulary

Do not solve a blue-collar composition by dropping contemporary pickup trucks or
other present-day Earth vehicles into the scene. Translate the role, not the
object: work speeder, space-coded utility jeep, hauler, etc.

### Unmotivated lighting mismatch

Do not randomize day/night/weather between related assets. Different lighting is
fine when it reflects how the place is experienced; unexplained mismatch makes a
batch feel like unrelated worlds.

### Same-background syndrome

Shared town identity does not mean repeating the same roadside/background/camera
composition for every building. Vary approach, neighboring structures, terrain,
activity, and framing while preserving the settlement's design language.

### Expression drift

If changing expressions makes the character jump sideways, change scale, mutate
clothing, or become a different person, revise the set. Some body movement is
good; spatial discontinuity is not.

### Broken generated signage

Do not accept almost-correct canonical text. Correct it with a focused edit or
replace it.

### Grayscale before key removal

For pink-key map assets, remove the key color and clean edges **before**
grayscale. Reversing the order destroys the useful color separation.

### Regenerating before diagnosing

When an image feels wrong, identify why before asking for another one. A better
prompt only follows from a better diagnosis.

### Reviewing only the standalone file

Always check assets in the real component at mobile width and alongside their
neighbors. Standalone quality is not enough.

## Automation and QC Studio

This cookbook describes the production contract, not a requirement that every
step remain manual forever.

Repetitive mechanical steps should be automated when doing so preserves the same
creative and QA boundaries.

QC Studio is expected to grow from dialogue authoring into a broader content/art
workspace. A future image workflow may encode RuneSpace-specific defaults such
as:

- asset category and required aspect ratio;
- approved reference images or character masters;
- prompt/art-direction context;
- expression generation from the canonical neutral portrait;
- output dimensions;
- runtime naming and destination;
- map hot-pink keying;
- Sharp transparency/fringe cleanup;
- grayscale conversion, trim, resize, and encoding;
- mobile/component previews;
- side-by-side or rapid-flip expression comparison.

Image generation in that editor may use a metered external API/provider. That is
an implementation and product-cost concern for the future QC Studio image-workflow
issue, not a reason to weaken or duplicate the art contract here.

Automation exists to remove repetitive work and accidental inconsistency. It does
**not** remove the human visual-acceptance checkpoint.

## Optimization passes

A future dedicated art-optimization pass may change preferred dimensions,
encodings, compression, derivative generation, or runtime delivery.

That work should:

- measure the real asset/performance problem before changing production files;
- preserve approved visual identity and masters;
- avoid lossy conversions that materially damage small details, alpha edges, or
  mobile readability;
- update this cookbook and any affected asset contracts in the same change.

Do not treat current byte sizes or codecs as sacred once a better measured
pipeline is proven.

## Final visual acceptance

Before an asset batch is ready for implementation, perform one deliberate visual
acceptance pass.

Check individual files for:

- identity consistency;
- correct world/narrative meaning;
- technology level;
- lighting;
- generated text;
- composition;
- transparency/fringing;
- crop tolerance;
- filename/path correctness.

Then check the batch **together**.

A batch can contain individually good images that fail collectively. Look for
repeated camera angles, repeated backgrounds, inconsistent weather/time of day
without narrative reason, buildings that no longer resemble their wider
settlement versions, portraits that jump during expression changes, and one
asset whose rendering style is noticeably different from everything around it.

Finally, check the assets in the actual game surface at mobile width.

**"The image generated successfully" is not an acceptance criterion.**

**"It looks good by itself" is not an acceptance criterion.**

The asset is done when it communicates the intended RuneSpace content, works in
its real UI, and visually belongs beside the assets around it.
