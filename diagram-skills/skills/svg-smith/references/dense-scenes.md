# Dense scenes: the craft lenses

For Lane C: illustrated scenes meant to inspire through **density and rich detail** — floating
islands, isometric cities, machines, harbours, fantasy towns. Each lens is used twice: **while
designing** (the ideas it suggests) and **while reviewing** (the check it runs, with a number
where one exists). Every number below was measured, not assumed; where a lens records a failure,
that failure really happened while building the worked example.

**The worked example.** One scene went through every lens: a flat first draft (density 7.6) to a
docked-barge island with painted light (16.3). Its generator grew into `scripts/iso_scene.py`; the
contest scenes it was measured against are the reference set at the end of this file.

---

## The reference set — what "dense" actually measures

The 16 Inkscape about-screen contest winners (all pure vector, no embedded images) span
`svg_quality.py` transitions/row from **1.0 to 32.6**. That spread is *style*, not quality:

| Scene | trans/row | paths | gradients | translucent |
|---|---|---|---|---|
| 1.2 geometric lion | 32.6 | 204 | 114 | 26 |
| 1.3 isometric truck | 32.1 | 437 | 0 | 4 |
| 1.3 disco machine | 29.7 | 1,862 | 19 | 13 |
| 1.3 machine lineart | 26.8 | 1,826 | 7 | 2 |
| 1.4.4 artist's blossom | 24.5 | 38 | 2 | 1 |
| 1.3 castle journey | 23.7 | 2,791 | 1,609 | 668 |
| 1.3 flower vase | 13.6 | 187 | 5 | 8 |
| 1.3 creative growth | 13.4 | 904 | 575 | 517 |
| 1.0 floating island city | 12.2 | 1,100 | 225 | 543 |
| 1.3 sunset forest | 10.2 | 372 | 265 | 39 |
| 1.2 jungle island | 9.5 | 893 | 644 | 338 |
| 1.1 ink astronaut | 8.3 | 518 | 2 | 8 |
| 1.1 robot painter | 8.0 | 404 | 272 | 49 |
| 1.1 painter portrait | 6.1 | 150 | 24 | 2 |
| 1.3 space city | 3.9 | 695 | 29 | 132 |
| 1.5dev gradient creature | 1.0 | 90 | 56 | 53 |

**Dense pieces sit at 12–33.** Below 10, a scene reads as calm or graphic, which can be right — but it
is not this mode.

**Getting the reference files** (fetch them; never draw a reference from memory). From the Inkscape
repository on GitLab (`gitlab.com/inkscape/inkscape`), raw files:
- `share/screens/about/about00.svgz` … `about12.svgz` on `master` — gzip-compressed SVG; gunzip first;
- `share/screens/about.svg` on tags `INKSCAPE_1_0` … `INKSCAPE_1_3`;
- `share/screens/about/about00.svgz` on tag `INKSCAPE_1_4_4`.
Two of the `master` files repeat the 1.1 and 1.2 screens (`svg_check.py` reports MATCH); drop them. Some
files embed Inkscape's mesh-gradient polyfill `<script>`: read it before rendering (it makes no network
calls). Licences differ per artist; check before reusing any of them publicly.

---

## Lens 1 — Two routes to density

**Design.** Pick the route before drawing, because they share no technique:

- **Line and pattern** — the lion, the truck, the machine lineart: few gradients (0–114), density from
  repeated linework, hatching, panel seams, pattern fills. Cheap in file size, crisp, graphic.
- **Layered painting** — the castle (1,609 gradients, 668 translucent shapes), the 1.0 island (543
  translucent): density from many stacked, semi-transparent light and shadow shapes. Rich, soft, heavy.

A third route sits between them and is the toolkit's default: **flat planes**, with each solid in three
or four flat tones and few lines (the 1.3 isometric truck, the 1.2 geometric lion, the worked example).
`scripts/finish_check.py` takes the route: `--route flat`, `lines` or `painting`.

**Review.** Name the route in one line. A scene that half-does two routes reads as muddy.

## Lens 2 — Tonal rhythm (what the density score really sees)

`svg_quality.py` rasterises at **400 px**, calls a pixel *light* when all of R, G, B exceed **170**,
and counts light/dark switches per row. So it sees **large-scale value alternation** only.

**Design.** Alternate pale and dark across big areas: pale lit facets beside shaded ones, pale
machinery against dark sky, light roofs against mid-tone grass.

**Review.** Run `svg_quality.py scene.svg --against <two or three dense references>`. The target
depends on the route and the light (SKILL.md C4): about 12 on the painting route, 8–10 for a flat dusk
or night scene, about 11 for a flat daytime scene. Judge by that number, not by the script's verdict line: it allows 0.75× below the lowest reference,
so it printed "IN BAND (7.7)" against a 9.5–12.2 band on a real run, and with one reference the band
collapses to a single value.
- *Where is it thin?* The score is a mean over rows; to find the weak band, score horizontal strips:
  `scripts/scene_compare.py measure scene.svg`. On a real run the top 22% (a dark night sky) and the cloud sea
  scored near 0 while the island scored well.
- *A mostly dark sky scores about 0.* Lift it with small light things worth having: lanterns, stars in
  clusters, a moon halo, lit windows on distant islets — not noise.
- *Measured:* covering the dark rock underside with stacked cloud dropped a scene 11.4 → 10.7: hiding a
  dark mass removes alternation as surely as adding pale ones creates it.
- *Measured:* roots, cliff windows and a cable car added nothing (10.9 → 10.8): too small at 400 px.
- *Measured:* lightening the palette — an ice-blue peak instead of teal, lavender rock instead of violet,
  light-grey deck — moved it 10.8 → **11.6**, because lit facets now crossed the 170 line.
- *Measured:* rim lines 1.6 px wide added nothing: at a third of the size they blur to mid-grey.
- **Stop targeting it above ~12.** The worked example ended at 16.3 against the reference's 12.2 and was
  not better for it. Past the band, the number measures busyness, not craft.
- **A night palette and flat planes lower it, and that can be right.** The second scene's designer
  pass (Lens 10) dropped it 12.3 → 7.8 while three independent critics moved their score up, 4 → 5.5
  out of 10. Dark grounds and mid-value planes cross the 170 line less often. Below ~9, check the
  subject's lit planes really are light; do not add noise to win the number back.

## Lens 3 — Frame fill and the anchor

**Design.** The subject should fill the frame like the reference: the worked example's island and
machine covered **66%** of the frame after scaling. Give it one big foreground anchor (the reference's
red ship; the example's docked barge) and leave one deliberate negative-space diagonal (white paper,
lower-left in the reference).

**Review.** Measure the subject's bounding box against the frame:
`scripts/scene_compare.py measure scene.svg hero-id,anchor-id,...` (the union of `getBBox()`). **The subject is the connected main mass**: the hero
plus everything physically joined to it (a docked ship, an islet reached by a funicular). Satellites
floating free are context, not subject. Measured on two scenes: 66% (island + docked barge) and 51%
(tea island + its funicular islet; 70% with the free satellites) — both read as filled; below ~45%
the frame starts to read as empty.
- *Measured:* docking the barge at true scale left the corner empty and density fell 11.6 → 10.4;
  scaling the whole scene 12% brought it to 12.0.
- *Failure:* **screen-space props do not scale with the world.** After scaling, an islet touched the
  island, the balloon sat on a windmill, a plane crossed the ring. Re-place every fixed-position prop
  after any scale change.

## Lens 4 — One machine, not a collage

**Design.** Large parts must share the world: same projection, same scale, same light. Join them with
connective tissue the eye can follow — a quay, a gantry standing on one and reaching over the other,
a cable, a pipe, a bridge. Clear the ground where they meet.

**Review.** Look for anything that floats over something it should stand on.
- *Failure:* a barge drawn in its own frame sat on top of the village and read as pasted on. Fixed by
  building it in the island's coordinates with its deck flush with the grass, a quay with bollards,
  and a gantry whose legs stand on the island and whose arms reach over the deck.

## Lens 5 — Rounded machinery against box monotony

**Design.** A scene of boxes reads as a toy. Break it with curved forms built as shaded strips
(`Iso.x_strips` + `Iso.x_cap`): a quonset hangar, engine nacelles with bands and a turning intake fan,
tanks, pipes, mushroom and cowl vents (`Iso.upright_cylinder`).

**Review.** Count the curved masses: at least one per major structure.
- *Failure:* the hangar's arched door faced a stack of containers and was hidden. **Before placing an
  object, check what its open or decorated side faces.** Moving it to the bow bay opened the door onto
  clear deck.

## Lens 6 — Painted light inside each face (airbrush finish only)

> The toolkit now defaults to the **flat finish** (Lens 10), which skips these overlays. A tester
> judged the soft look "student work". Use this lens only when a brief asks for a soft, painterly
> finish (`Iso(finish="airbrush")`).

**Design.** Flat faces read as computed. Layer, on every face: a gradient around its shade, an
ambient-occlusion overlay darkening walls toward the ground, and a soft light patch near the lit upper
corner. Facets get a gentle sheen. `Iso` does this in `face()`; tune with `paint_light` and `paint_ao`.

**Review.** Compare before/now crops at 2.5×, and measure inside the subject's bounding box (Lens 3),
not the whole frame, so sky and paper do not dilute the count.
- *Measured:* patch 0.42 → 0.60 → 0.75 and AO 0.30 → 0.40 → 0.50: contrast rose while mean brightness
  stayed within 1 level (176.8 → 177.2), because the patches and the AO cancel.
- **Glare check, with its control.** Near-white pixels (≥ 250) on the subject must not rise. At 0.75
  they did not (0.89% → 0.89%); a deliberately extreme patch (1.0) on a *copy* raised them to 1.18%,
  so the check can fail. Above ~0.75 the patches read as shine, not paint.
- The reference does this by hand: each highlight is its own semi-transparent shape (543 of them), placed
  where the artist decides light falls. A rule cannot copy that intent — vary patch position and size
  per object when the scene still reads uniform.

## Lens 7 — Hand-made surface detail

**Design.** Detail that belongs to the surface, computed in that face's own plane (`Iso.on_face`):
- machines: panel seams, double rivet rows, alternate panel tints, draft marks, decals (roundels,
  hazard chevrons), labels with logos on cargo;
- buildings: window trim, glazing bars, sills, doors with a pane, knob and step;
- rock: strata following the rock's profile, branching cracks, light and dark mineral specks.

**Review.** Crops at 2.5× of each area.
- *Failure:* strata clipped to a convex hull spilled onto the sky where the rock is concave. **Clip to
  the real facets** (`Iso.facets(..., as_clip=True)` inside a `<clipPath>`).
- *Failure risk:* adding detail that draws from the shared random stream reshuffles every later
  placement (trees, flowers, lamps). **Give detail its own seeded `random.Random`.**

## Lens 8 — Hidden faces and draw order

**Design.** Every solid face goes through `Iso.face()` (culled, shaded). Sort objects by depth `x + y`
with `Painter`. Split anything that wraps another (a ring around a peak) into back and front halves.

**Review.** After any rotation, swap or move, look for parts that should now be invisible.
- *Failure:* after the barge was swapped onto the other axis, its stern propeller — now on a face
  pointing away — still drew as a stray blade on the hull. Draw a decoration only on a facing plane.
- *Failure:* glass towers drawn after the peak covered it; the peak had to join the depth sort.
- **Props too, not just buildings.** On a second scene all three depth bugs were props: a blossom tree
  drawn in front of the gate it stands behind, tea pickers drawn over a gate beam, and decorations on
  wall faces turned away from the camera. Every tree, figure, lamp and sign goes into the `Painter`
  with its own x + y.
- **Stacked levels** (terraces, tiers, decks): x + y alone cannot order things on different heights.
  What worked: draw each level's walls and back items from the bottom level up, then its front items
  from the top level down.
- **A peak is the reverse.** On terraces that rise toward the centre the rule above holds. On a steep
  peak whose ground rises toward the BACK, sort by x + y + z (higher things are further away): the
  monastery test found the terrace rule draws them in the wrong order.

## Lens 9 — Life (optional, but it inspires)

**Design.** Small SMIL loops make a still scene feel inhabited: turning fans and windmill sails, a
running waterfall (`stroke-dashoffset`), twinkling stars, a blinking beacon, bobbing islets, a cable car
on `animateMotion`. Keep docked or heavy things still.

**Review.** `scripts/scene_compare.py measure scene.svg` screenshots twice 1.5 s apart and counts the
changed pixels; zero means the animation is dead.
The worked example changed 30,000+ pixels.

## Lens 10 — The designer finish (student work vs commercial)

The owner's verdict on the first proof scene: *"looking good, just … like student work instead of
designer master"*. The fixes below came from three independent art-director critics in turn. Each
critic ranked faults with crop evidence against the reference. Scores for "could ship as commercial
illustration" were reference 8.5, first proof 4, and after this lens 5.5, with the last fixes not yet
re-scored. Each item is a drawing rule with the failure that earned it.

**Design.**
- **One key light, and the scene agrees with it.** Light from the screen's upper left: tops lightest,
  left faces base, right faces darker and bluer. Put the visible moon or sun on that side.
  - *Failure:* the old default light came from the front-left, so both visible faces of every box were
    lit, and the scene had no value structure.
  - *Failure:* the moon sat upper-right while the faces were lit from the left.
- **Planes, not lines or airbrush.** Give each solid three or four flat tones by facing
  (`Iso.plane_tone`), spaced in lightness: each tone at least 10 L* from the next, and the shadow face
  at least 22 L* below the top (`Iso.TONE_GAP`; the toolkit enforces it).
  - *Failure:* on pale bases, mixing toward the highlight changes nothing: a cream airship's "three
    tones" sat 1–5 L* apart and the hull had no shadow side.
  - Delete hairline roof ribs, even tile grids, facet strokes and dashed "road-marking" waterfalls.
  - Delete gradient washes, sheen and light-patch overlays.
  - A thin pale lip on light-facing top edges is the only line worth keeping.
- **Hard shadows.** Every building and tree throws a crisp shadow away from the light
  (`Iso.cast_shadow`, a multiply fill). A grey alpha polygon reads as a smudge. A shadow must lower
  its ground by at least 20 L*; one that lowered it by 7 read as pink paving.
  - **A shadow lands on the receiving surface's own plane**, clipped to that surface. On a mountain the
    ground-plane hexagon of `cast_shadow()` is wrong: project the base edge down the slope's fall line
    and clip it to the rock facet it lands on (a narrow sliver, not a pool). `Iso.facet_shadow(box,
    facets)` does this for a crag from `Iso.crag()`: it projects the box's corners along the light
    onto each nearby lit facet's plane and clips each piece to its facet (on the monastery, 297 pieces
    from 29 platforms replaced the flat-ground hexagons).
  - *Failure, and a silent one:* a multiply shadow inside a group that has a clip-path, mask, filter
    or opacity paints as flat pale paint, because that group is isolated and the blend has nothing
    beneath it. It broke 29 of 89 shadows in the monastery test and all 44 in the harbour test, and
    every check passed. Clip the shadow itself (`cast_shadow(clip=...)`), keep it out of such groups,
    or bake it to a solid colour (ground × tint). `finish_check.py` now counts these as `isolated`.
  - *Failure:* near a rim the shadows spilled off the island into the sky. Clip them to the ground
    they fall on: `cast_shadow(..., clip=iso.ground_clip(top_polygon))`.
  - *Failure:* on pale paving the default tint read as lavender paint. Darken the ground's own colour
    toward the shadow hue instead.
- **Masses, not dots, and not ribbons.**
  - Rows of identical round bushes read as polka dots.
  - One continuous neon strip per row read as cardboard stripes.
  - What worked: one thick row per terrace, cut into segments with gaps, and a scalloped top of
    rounded bushes. Use three tones: a lit top, a body, and a dark underside band with a seam.
  - Lower the saturation, so the vegetation never outshines the focal building.
  - Drop any run seen edge-on: it renders as an upright slab.
- **A rock that tapers.** Build the underside as hanging columns, longest in the middle
  (`Iso.columns`), in three flat values. Give downward faces a warm bounce from the sunset.
  - *Failure:* translucent low-poly facets with a sheen read as glass.
  - *Failure:* equal-length columns read as a drum.
- **Clouds as designed shapes.**
  - Draw a flat base and a crown of mixed puff sizes.
  - Fill with three opaque steps: a violet underside, a mid tone, and a lit cap clipped inside the
    shape.
  - Do not use one gradient per puff (it bands), blur (it reads as airbrush) or white circles stuck
    on top (they read as balls).
  - `<clipPath>` may not contain `<g>`: put the transform on each shape, or the clip draws nothing.
  - Moving water is not dashes. A dashed white stroke down a waterfall reads as a road marking, and two
    critics in two scenes flagged it. Use a tapered ribbon in three bands and animate a repeating
    gradient (see the worked example's falls); `finish_check.py` counts dashed strokes.
- **Frame and depth.**
  - Let the hero fill most of the frame, and let at most one thing run off an edge on purpose.
  - Keep the satellites inside the frame with a margin, and push them back with a haze filter
    (`feFlood` + `feComposite in`, about 60% toward the sky colour).
  - Lead the eye with one line, such as sky lanterns rising in a curve and shrinking with distance,
    not confetti.
  - Put the warmest light behind the focal building.
- **Night and dusk: only light sources glow.** Daytime pastels on lit walls sit at the same value as
  the window glow, so the windows read as yellow paint. Take lit wall tones 20–30% darker and toward a
  dusk mauve, shadow faces to blue-violet, and keep near-white for windows, lamps and the lighthouse.
  Put a flat, warmer pool of light on the ground under each lamp. (Harbour critic, confidence 0.75.)
- **Break the rim.** Both test scenes were "a cake on a plate": a smooth elliptical rim, centred. Make the
  rim a 16–24-point polygon with ±10–15% radius, two or three bays and one headland; tilt the long axis
  off horizontal; let one large hero object (a ship, a tower) clearly outrank the houses.
- **Distinct building silhouettes.** Five types at minimum, each readable at thumbnail size, varying
  storeys, roof pitch and ridge direction; keep a motif (an oculus, a chimney) on three buildings at
  most; thin the detail in the back third.
- **Light effects and the sky are the exceptions to "no translucency" and "no gradients".** Emitted
  light (lamp and window glows, a lighthouse beam, the moon's halo), atmospheric haze on far objects
  and the sky's own backdrop gradient are allowed. Shadows, form, clouds and water never use them.
- **Nothing outshines the focal object: give the scene a value budget.** A cloud top, a wall or a sky
  patch brighter than the focal building's lit face pulls the eye away. On the monastery, about 40
  white roofs (L* 95) and the clouds (L* 97–100) out-shone a gold-and-red hall (L* 49–75). Keep the
  brightest white for the focal building, and step every other white down by distance from it:
  `tone = Iso.value_budget(focal_xyz, ("#ece4d4", "#e2d8c5", "#d8cdb9"), (3.2, 6.0))` gives L* 91 / 87
  / 83, then `iso.box(..., tone(x, y, z))` per building. Turn clouds into haze capped at about L* 91.
  Measured on the monastery: pixels brighter than the hall's white went from 15.6% of the frame to
  1.5%.
- **Let masonry lean.** A vertical whitewashed box reads as a die; the inward-tapering (battered) wall is
  the defining silhouette of Himalayan, Pueblo and fortress building, and a critic searched the
  monastery for it and found none. `Iso.battered_box(..., batter=.07)` insets the top 7% of the
  width on each side; it registers itself, so windows, bands and doors drawn later with `on_face()`
  on the same box follow the lean (they become trapezoids) with no extra code. 7% reads on small
  houses; 5% on big blocks is subtle.
- **Break big planes with geometry, not lines.** A podium or retaining wall left as one tone reads as
  "two huge flat planes". `Iso.subdivide(face, box..., bands=2, strips=3)` paints setback ledges (a
  pale lip over a dark strip) and buttress pilasters a step lighter, and follows a battered wall. On
  the flat route this is the answer to "the flat reference outlines its panels": the panels come from
  tone steps, not dark outlines. Keep the strip count low (about one per 0.9 units of width), or the
  wall turns into a grid.
- **Overlapping shadows darken once.** Two multiply shapes that overlap stack: tested, the overlap
  went from (119,105,126) to (66,55,95), a dark seam no light makes. Paint all the shadows that fall
  on one set of surfaces through `Iso.shadow_union(shadows)`: flat shapes inside one group, and the
  group multiplies once. The union is drawn at one place in the order, so it suits shadows whose
  receiving surfaces are all drawn before it (a crag's facets, a terrace layer). Shadows on surfaces
  drawn later (a platform top inside its own item) stay single. On the monastery, 2,585 overlap
  pixels lightened from L 107 to 149.
- **Day scenes need their own palette.** The toolkit's defaults (cloud ramps, the rock ramp and its
  warm bounce, the roof underglow) are tuned for dusk. For daylight use `Iso.CLOUD_DAY` /
  `CLOUD_DAY_FAR`, pass `columns(..., ramp=, bounce=None)` and `hip_roof(..., underglow=None)`, and
  give the subject a clear figure/ground: the sky-ship test's mid-value deck on a mid-value sky was
  its top fault.
- **Props get the same treatment as the hero.**
  - The moon: a two-tone crescent, irregular craters, and hard halo rings rather than a blur.
  - Trees: faceted cones and lobed canopies in three tones, not stacked circles or ellipses.

- **Vary the buildings, and spend detail on the hero.** One template stamped about 12 times flattened
  the detail hierarchy. What worked was five types: a two-storey inn, an open-slatted drying shed under
  thatch, a plaster storehouse with a dark base band, an open well pavilion, and plain far houses that
  get one lit window and nothing else. Gold trim goes on the pagoda and the teahouse only.
- **Roofs:** a pale rim only on the eave the light hits, a darker fascia on the other side, and a
  warm underglow line under every eave near lanterns.
- **Curved walls turn; boxes split.** A drum wall in four tone bands reads as one hard split. Give
  curved surfaces `Iso.curved_tone`, which ramps around the curve.
- **One diagonal.** Moon, then the focal building, then a large foreground islet, with open sky on
  the other side.
- **Fill empty ground with small props:** stepping stones, a lantern pair, a drying rack.

**Second cold test: a sky-ship workshop, daytime**, on the skill after the harbour fixes. Its critics
scored "now" 5, 6, 5 against 9; the last round said its final fixes made two areas worse. It passed
`finish_check`. Its 14 gap reports became the full placeholder list and the plateau and rollback rules
in the critic brief, the truly flat finish (no faint face gradients, no airbrush defs), `truss`,
`figure`, `frustum(cap=False)`, the day palettes, and the stroke half of the grey-shadow count.
An independent critic with the route rules scored it 6, against 8 for both references (its reply is
condensed in the test folder as critic-independent.md); its tone-gap finding became `TONE_GAP`. The
fixes from this test came after it, so the skill in its present form has not had a cold test of its
own. The tea village's 4 → 5.5 and the harbour agent's own rounds rest on chat replies, from before
the rule to save each critic's answer to a file. So the skill as it stands lands scenes at about 5–6 out of 10 against an
8–9 reference on new subjects, reliably above the 4 of the first proof, and not yet at commercial
level.

**Third cold test: a mountain monastery** (halls and stairs on a peak, prayer flags, a bell tower,
monks and pilgrims), on the skill as pushed in 0.4.1, every critic reply saved word for word in the
test folder. Its critics scored "now" 4.5, 5, 5 against 8 (the first draft 3), below the 5.5 bar; an independent
critic scored it 5 against 7 and 8 (its reply is saved in the test folder). Its top fault, "a flat
lavender plaza", was the isolated-shadow bug; moving the clip onto each shadow fixed it (15,469 flat
pixels to 0), and that version has not been re-scored. Its
gaps became the isolated-blend check (critic 3 found the 29 broken shadows; the check confirms the same
29), the peak draw order, the shadow-darkness floor, the sky exception, reference choice in C1,
`stairs()`, `figure(pose=)` and `face_tone()`; then the test's own mountain code moved into the
toolkit as `crag()` (it rebuilds the monastery's rock byte-for-byte) and `facet_shadow()` added the
slope shadows.

**The cold test.** A fresh agent given only this skill built a harbour town at dusk (boats, piers,
warehouses, a lighthouse). Its three critic rounds scored 6, 5.5 and 5.5; an independent critic with
the route rules in its brief scored it 6, against 8 for the reference. That is the worked example's
level (5.5) on a new subject. The agent's 12 gap reports became `scene_compare.py measure`,
`frustum()`, `y_plane()`, `ground_clip()`, the dashes count and the brief's route rules. The four
items above came from the independent critic. Those fixes came AFTER the test, so the skill in its
current form has not itself been cold-tested; the scores are the critics' replies, not files.

**Where the critics stalled.** Three rounds scored 4 → 5.5 → 5.5. Two critics gave opposite advice
on frame fill: one said shrink the hero to 70% of the width, the next said scale it up and bleed it off
an edge. One critic also reported faults that were not in the file (a "dead-centre" pagoda after it had
moved). So open each critic's crops before acting, and fix only the faults the crops show. When the
score plateaus, stop and hand the side-by-side to the owner: past that point the critic's taste is the
variable, not the scene.

**Still weak in the toolkit** (the sky-ship test): `columns()` at hero size reads as slabs over
near-equal teeth, and there is no hull primitive (a body lying on its side whose underside turns
dark); both were rewritten by hand and still drew critic faults.

**Tools.** Every rule above has code: the worked example `examples/tea_village.py` (read it first)
and the toolkit's `hip_roof`, `mass_row`, `cel_cloud`, `haze`, `leading_line`, `cast_shadow` with
`ground_clip`, `columns`, `crag` (a faceted mountain with ledges, snow and cracks) with
`facet_shadow` and `facet_clip`, `curved_tone`, `frustum` (with `cap=False` for painted bands), `y_plane`,
`plane_tone`, `truss` (cranes, gantries, masts: chords of 2 px or more read as steel, 1 px as wire),
`figure` (small people for scale), `value_budget` (tones by distance from the focal object),
`shadow_union` (overlapping shadows darken once), `battered_box` (walls that lean inward) and
`subdivide` (ledges and pilasters on a large wall).

**The finish check, calibrated.** `scripts/finish_check.py` counts the cheap tells. Its limits were
set on these files: the student scene must fail, the designer pass and the flat contest pieces must
pass. The pure line-art piece fails the flat limits by design, and passes with `--route lines`.

| File | Route | Airbrush | Grey shadows | Hairlines | Blur | Verdict |
|---|---|---|---|---|---|---|
| tea village, first proof | flat | 794 | 8.4% | 21.5% | 13 | FAIL |
| tea village, designer pass | flat | 0 | 0.3% | 10.4% | 0 | PASS |
| 1.3 isometric truck | flat | 0 | 0% | 2.7% | 0 | PASS |
| 1.2 geometric lion | flat | 0 | 0% | 6.1% | 0 | PASS |
| 1.3 machine lineart | lines | 0 | 0% | 32% | 7 | PASS |
| 1.0 floating island | painting | 0 | 5% | 9% | 0 | PASS |
| 1.3 castle journey | painting | 0 | 1.2% | 1.3% | 89 | FAIL: clip-g |

A sixth count, dashed strokes, was added after the harbour test (below): the student scene has 9 and
fails, the designer pass has 0, and the harbour has 4, so it FAILS the check as it stands today.

The castle fails for a real browser defect: four `<clipPath>`s that hold only a `<g>`. Chromium
clips such art away entirely (tested: 0 of 4,962 pixels drawn), while Inkscape still draws it.

**Review.** Run the finish check, then hand reference | before | now to a **fresh** critic agent each
round with the brief in `references/critic-brief.md`, word for word. Its score and ranked faults, with crops, are the check. The author's own eye is not. Use a
new agent per round, so its read is not anchored on the last list.

---

## Review pass, in order

1. Route named (Lens 1). 2. `svg_quality.py` against a dense reference: ≥ 12, and stop chasing it past
the band (Lens 2). 3. Subject bounding box vs frame, props re-placed (Lens 3). 4. Nothing floating that
should stand (Lens 4). 5. Curved masses present, open sides facing open space (Lens 5). 6. Before/now
crops at 2.5×, glare count with its control (Lens 6). 7. Detail crops, clips tight, layout unchanged
(Lens 7). 8. No stray hidden-face decoration, depth order right (Lens 8). 9. Animation alive (Lens 9).
10. Designer finish: one light agreeing with the visible source, plane tones, hard shadows, masses,
a tapered rock, designed clouds, props at hero quality; then a fresh critic's score (Lens 10).
Then the one check no script can make: the user's eye, side by side with the reference.
