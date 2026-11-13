# Lane C: dense illustrated scenes, steps C1 to C5

Moved word for word from `SKILL.md` on 2026-11-13, so the skill body stays short. `SKILL.md` keeps the rules that hold on every run.

## Lane C — dense illustrated scenes

For scenes whose job is to inspire through density and rich detail: floating islands, isometric
towns and harbours, machines, fantasy cities. Build them **by script, never by typed coordinates**:
a dense scene is hundreds of shaded faces, and only a generator you re-render after every change
converges. Read `references/dense-scenes.md` first — it holds the ten craft lenses, each with the
ideas it gives while designing, the check it runs while reviewing, and the number or failure that
earned it.

### C1. Pick the reference and the route

Fetch one or two **dense references** (the contest set in `references/dense-scenes.md` scores 12–33
on `svg_quality.py`; or one the client names — then it is the acceptance gate, as in B3). Include
one on the route you will draw: a flat-route scene judged only against a layered painting gets
asked for sheen it must not have. Pick the subject reference by what it shares with your subject:
floating islands and cities, the 1.0 floating island; castles, mountains and climbing towns, the 1.3
castle journey; machines and vehicles, the 1.3 disco machine or isometric truck; forests and nature,
the 1.3 sunset forest or 1.2 jungle island. The flat reference is the 1.3 isometric truck. Decide the
density route out loud: **line and pattern** (few gradients, repeated linework) or **layered painting**
(many stacked translucent light and shadow shapes). They share no technique.

### C2. Plan the composition in words

Before any code: the hero mass, one big foreground anchor, the connective tissue that makes the large
parts one machine, the curved forms that break box monotony, the negative-space diagonal, and the
small life (a turning fan, falling water). Ask the client only what changes the drawing (B1 rules
apply): the subject, the mood, where it will be seen.

### C3. Build with `scripts/iso_scene.py`, starting from the worked example

**Read `examples/tea_village.py` first.** It is a finished scene at the designer finish (critics: 5.5/10
against an 8.5–9 reference, up from 4), and its docstring says which Lens 10 rules it shows and which
it does not.
Copy its structure, not its subject: a new subject needs its own buildings and props, but the light,
the rock, the masses, the clouds, the haze, the leading line and the draw order carry over.

`Iso` gives the projection, culled and shaded faces with registered gradients and painted light,
boxes with rim light, roofs, low-poly bodies, tube and hangar strips, end caps, upright cylinders and
in-plane detail rectangles; `Painter` sorts by depth. Run `python scripts/iso_scene.py --demo out.svg`
once to see it work. Write the scene's own generator next to its output, import the toolkit, and
**render after every change** — look at the whole frame and at 2.5× crops. Import it without
leaving bytecode in the skill folder: set `sys.dont_write_bytecode = True` before
`sys.path.insert(0, <skill>/scripts)` and `import iso_scene`. Beyond solid geometry the toolkit now
draws the designer-finish pieces: `hip_roof()` (lit-rim roofs with lantern underglow),
`mass_row()` (any repeated row, such as bushes, crates or reeds, as one scalloped three-tone mass),
`cel_cloud()`, `haze()`, `leading_line()`, `cast_shadow()` with `ground_clip()`, `columns()`,
`curved_tone()`, `crag()` (a mountain or rock spire with ledges, snow and cracks) with
`facet_shadow()` (shadows projected onto its sloping facets), `shadow_union()` (overlapping shadows
darken once), `value_budget()` (whites stepped down by distance from the focal object, so nothing
outshines it), `battered_box()` (masonry that leans inward; windows drawn on it follow the lean),
`subdivide()` (ledges and pilasters that break a large wall), `stairs()`, `figure()`, `truss()`,
`frustum()` (a round, tapering tower: lighthouse, chimney, funnel) and `y_plane()`
(flat art on a +y face, the twin of `x_plane()`). Inside `Iso.frame(swap=True)` every name is local:
`on_face("y")` is the local +y face. Pass
`Iso(prefix="x-")` when two scenes may share a page, so their ids do not collide. Anything else
(glows, water, subject props) is yours to write, through `Iso.face()` so it shades like the rest.

**Keep the default flat finish.** `Iso` lights from the screen's upper left and gives every face one
crisp plane tone; `cast_shadow()` throws hard multiply shadows and `columns()` builds a rock
underside that tapers to teeth. The older soft look (`finish="airbrush"`: light patches, sheen,
continuous ramps) is what a tester called "student work instead of designer master". Lens 10 lists
what moved the scene from student to designer.

### C4. Review lens by lens

Run the review pass at the end of `references/dense-scenes.md`, in order: route, tonal rhythm
(`svg_quality.py --against` the reference; judge the number, not its verdict line: aim for about 12 on
the painting route, while a flat-route dusk or night scene lands near 8–10 and a flat daytime scene
near 11 (the sky-ship test: 11.4), and that is fine; below that, `scripts/scene_compare.py measure` shows which band is thin), frame fill (`measure` with the
subject's group ids),
one-machine integration, curved masses, painted light with its glare control, surface detail crops,
hidden faces and depth order, animation alive (`measure` again), then the Lens 10 finish checklist. Fix and re-render
until each passes.

Then run `python scripts/finish_check.py scene.svg --route flat` (or `lines` / `painting`, per Lens 1).
It fails on the cheap tells of student work: airbrush overlays, see-through grey shadows, hairline
detail, blur, and clip paths that draw nothing. It must pass before any critic sees the scene.

Then the critic rounds, with the brief in `references/critic-brief.md`, word for word. Each round
uses a **fresh** agent: it scores reference and scene 1–10 for "could ship as commercial illustration"
and ranks the faults left, each with crop evidence and a drawing fix. Open its crops and fix only the
faults they show. Stop when the score plateaus. The author never grades its own scene.

### C5. Show it beside the reference

Deliver a side-by-side (reference | flat reference, for a flat-route scene | before | now) at the same size and 2.5× before/now crops of the
areas you changed: `python scripts/scene_compare.py sheet out.png "REFERENCE=ref.svg" "BEFORE=a.svg"
"NOW=b.svg"` and `scene_compare.py crops`. The numbers support the judgement; the client's eye on the side-by-side is the
judgement.

---
