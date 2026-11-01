---
name: svg-smith
description: Create, reproduce, fix or verify any SVG — brand logos, product marks, icons, emblems, badges, simple illustrations, and dense richly detailed illustrated scenes (isometric islands, towns, machines) designed and reviewed through craft lenses. Use whenever someone wants an SVG or vector made, a logo recreated/vectorised/recoloured/resized, an icon or badge designed, or an existing SVG cleaned up, split, shrunk or debugged — including symptom-phrased problems like a logo file that is absurdly large, artwork that breaks or blurs at small sizes, or two SVGs on one page corrupting each other's colours. Fires even when nobody says "SVG". NOT when a raster image is itself the deliverable (raster image generation), though for figurative marks this skill takes a flat generated image and vectorises it. NOT for editing or upscaling photos, NOT for diagrams generated from structure or data (d2-diagram / mermaid-visual-review), NOT for multi-page HTML documents or walkthroughs.
---

# SVG Smith

Produce vector files that are actually right, and know they are right before handing them over.

## Two rules that carry the whole skill

**1. Never draw a mark you could have fetched.**
A logo drawn from a text description looks plausible and is wrong in ways nobody can predict.
A real case: working from a prompt that said "pearl hairpins and circular beads", the result
was a radiating sunburst headdress over a white face. The actual mark has a cloud of
overlapping spheres and a *red* face — inverted polarity, different construction,
unrecognisable. No amount of tweaking converges from there. The fix is not better drawing; it
is going and getting the file.

**2. Never ship an SVG you have not rendered and looked at.**
Another real case: the largest logo-shaped SVG on github.com's homepage turned out to be
**the Vodafone logo**, from a customer carousel. The XML gave no hint. One render did.
Rendering also catches white-on-white, marks that dissolve at 48px, and the moment you
discover that the colourway you built is not the colourway the brand actually ships.

Everything below is machinery for obeying these two.

## Which lane are you in

| The request | Lane | What dominates |
|---|---|---|
| "make me the X logo", "vectorise this brand mark", "recreate the Y icon" | **A — Reproduce** | Finding the real artwork; fidelity is measurable |
| "design an icon for my app", "a badge for this project" - geometric or iconographic | **B — Author by hand** | Design intent; fidelity is a judgement call |
| "an SVG of a fox reading", a face, a figure, an animal, a mascot - anything **figurative** | **B4 — Generate, then vectorise** | Go there FIRST; do not open with hand-drawing |
| "clean up / recolour / resize / split this SVG I have" | **A, minus the hunt** | You already hold the reference — probe, transform, verify |
| "vectorise this image / make this PNG into an SVG" | **A, with the image as the target** | Identify what the image *is*, then fetch it — see below |
| "a dense, richly detailed scene", "an isometric town / island / machine", "make it as rich as that illustration" | **C — Dense scene** | Density built on purpose, reviewed lens by lens against a reference |

If a request mixes them ("our logo but as a flat mono icon"), fetch first, then author from
the real geometry. Never author the part you could have fetched.

**Being handed a raster does not mean you should trace it.** "Here is a PNG of the Acme logo,
make it a vector" is still Lane A: identify the mark, fetch the official vector, then confirm
it is the same thing by rendering your result beside their image. Tracing throws away the
vendor's real curves and gradients to reproduce a lossy screenshot of them. Trace only when
the artwork is genuinely unpublished — someone's own sketch, a screenshot of something dead —
and say on delivery that it is a trace.

---

## Lane A — reproduce an existing mark

### A1. Find the real artwork

Work down this list and stop at the first thing that yields a true vector:

1. **The brand's own asset pack.** `<brand>.com/logos`, `/press`, `/brand`, `/media-kit`,
   `brand.<domain>.com`. Often a zip of proper SVG/PDF/PNG in every variant. This is the
   authoritative source, and it also settles colour questions that guesswork gets wrong.
2. **Inline `<svg>` in the site's own header or nav.** Load the homepage and enumerate `<svg>`
   elements with their `viewBox`, path count and fills.
3. **The product's own `favicon.svg`.** On a product domain this is very often the real mark,
   already isolated and pure vector — `copilot.microsoft.com/static/cmc/favicon.svg` is the
   whole Copilot ribbon, gradients and all, in 3.4 KB.
4. **Linked `.svg` assets — and walk the stylesheets, not just the HTML.** Scrape `img[src]`
   and any `.svg` URL in the raw markup, then *also* iterate `document.styleSheets` and every
   element's computed `backgroundImage`/`maskImage`. One retail brand carries 159 inline SVGs,
   none of them the logo: the mark is a CSS `background-image` on an empty `<span>`, so its URL
   lives only in a stylesheet and is invisible to markup scraping. That sweep also tends to
   surface variants (a desktop and a mobile cut), which then need A3 treatment.
5. **Only if all of that fails**, trace with `scripts/svg_trace.py` — and say plainly on delivery
   that it is a trace, not the official geometry. See "When tracing is actually the answer" below
   for what it costs.

Do not stop at the first plausible file. **Two "identical" logos are often not the same logo**,
and the difference is invisible in the XML — see A3.

### A2. Interrogate what you found

```bash
python scripts/svg_probe.py candidate.svg
```

This answers the questions that decide whether the file is usable at all:

- **Is it really vector?** One major vendor's flagship mark is a `clipPath` over an embedded
  base64 **JPEG** — 27 KB of photo. The path is vector; the colour is not, and it will not scale.
- **Does it depend on a font?** A `<text>` element renders differently anywhere the font is
  missing. Outline it, or say so on delivery.
- **What is the *artwork* bbox**, as opposed to the viewBox? Everything downstream — placement,
  canvas size, comparison — keys off the artwork box, and the two are rarely equal.
- **Will its ids collide?** Every exporter names its gradient `paint0_linear`. Two such files
  inlined on one page silently corrupt each other.

### A3. Assume variants differ until you prove otherwise

Brands ship the same mark at several sizes, and sometimes those are **different drawings**.
Two sparkle marks from one vendor are both perfectly square, so aspect ratio cannot separate
them — but normalised and diffed they are **37.7% apart**: one plump, one thin. Picking the
wrong one ships the wrong logo. Another vendor's 24px and 16px marks, through the same check,
came out **1.03% apart** — genuinely one logo at two grid optimisations.

So when you find more than one candidate, diff them against each other:

```bash
python scripts/svg_check.py variant_a.svg variant_b.svg
```

MATCH means either is fine — take the higher-precision one. MISMATCH means you have a decision
to make, and the answer is usually whichever the brand uses as its primary product mark, not
the one buried in a docs site.

### A4. Place it on a clean canvas

```bash
python scripts/svg_place.py src.svg --out mark.svg --square 800 --art-height 600 \
    --namespace acme- --prune --title "Acme mark"
```

Use `--square` for square-ish marks; **omit it for lockups** and let the canvas be derived.
This matters: a reversed lockup that drops its tagline is *wider* than the primary one, and
forcing both into one assumed canvas width silently overflows and clips the wider. That exact
bug scored 49.5 on the diff below, versus 8.5 once the canvas was derived from the artwork.
The script warns when artwork exceeds canvas — which is why it is a script rather than
arithmetic done in your head.

`--namespace` whenever more than one SVG might share a page. `--prune` after deleting elements;
it took one emblem lockup from 107 KB to 64 KB by dropping defs nothing referenced any more.

### A5. Verify, and prove the verification works

```bash
python scripts/svg_render.py mark.svg src.svg --sizes 512,128,48 --bg light,dark --out sheet.png
python scripts/svg_check.py mark.svg src.svg
```

Read the contact sheet yourself — that is the step that catches wrong-artwork and
invisible-on-background. Then `svg_check` gives a number and, more importantly, a *scale* for
that number: it always compares the reference against itself nudged a few pixels, so you can
see what a trivial misalignment costs. Your difference is reported as a multiple of that.

- **≤ 0.6x** — match; residual is antialiasing.
- **~1x** — consistent with resampling fine detail. Confirm by eye that the diff is edge
  outlines, not solid regions. Marks with microscopic type (an emblem with circular lettering)
  legitimately sit here.
- **> 3x** — not the same artwork. Stop and look.

That last verdict is also usable in reverse, as *positive* evidence. If you redraw a mark for
small sizes, the redraw should score as a MISMATCH against the original — that is proof you
actually redrew it rather than rescaling it. One run measured its 16px drawing at 4.98x the
noise floor and used that to justify shipping it as a separate file.

If it reports the harness is untrustworthy, believe it: a nudged reference barely changed the
score, so the comparison can detect nothing. Usually both renders are blank — a white mark on
a white background. Re-run with `--bg dark`.

**A check that cannot fail proves nothing.** That is why the control is built in and always
runs, rather than being something you remember to do.

**And one number cannot fail in a second way: by measuring the wrong thing.** `svg_check`
answers "is this the same artwork?". Once you are producing geometry rather than fetching it,
the live question becomes "is this *good* geometry?", and a whole-image mean cannot see it — a
staircased edge, a 1px rim, a 20px kink each touch a fraction of a percent of pixels. On one
reconstruction the score read 0.58x, 0.52x, 0.49x, 0.27x — inside MATCH throughout — while the
file successively held all three, plus a joint the blur had rounded off. Every one was caught by
measuring something else. Run `svg_verify.py` on anything you drew, traced or reconstructed, and
look at a magnified crop; keep `svg_check` for the question it is actually good at.

### A6. When tracing is actually the answer

Almost never, for anything a company still publishes. Here is the cost, measured on one mark
where both routes were available — the same artwork, fetched versus traced from a 1200px PNG:

| | bytes | paths | gradient stops |
|---|---|---|---|
| fetched from the vendor | 3,436 | 6 | 17 |
| traced from the raster | 386,587 | 280 | 0 |

**112x the size, 47x the paths, and no gradients at all** — the tracer approximates smooth colour
ramps as hundreds of flat bands, which is plainly visible at 5x zoom. It still only scored CLOSE against the real vector,
never MATCH. A trace cannot recover curves the tracer never saw.

So trace when the artwork genuinely has no published vector — a defunct brand, a scan, a client's
own sketch, a screenshot of something dead:

```bash
python scripts/svg_trace.py sketch.png --out mark.svg --mono     # flat/line art
python scripts/svg_trace.py logo.png  --out mark.svg --colors 8  # colour art
```

It reports fidelity against the source raster rather than assuming a good result, and tells you
when the trace is too poor to ship. Two things it cannot fix: an anti-aliased low-resolution
source becomes mush, and a traced gradient stays banded no matter the settings. If the result
matters, the answer is to look harder for real vector artwork, not to tune the tracer.

**But read that 112x penalty correctly — it is a GRADIENT problem, not a tracing problem.** The
tracer blew up because it had to approximate smooth colour ramps as hundreds of flat bands. Give
it genuinely flat two-colour art and it behaves completely differently: the same tool traced a
flat two-tone roundel into a **single path**, and the optimised file verified at mean delta 0.000
against its source. That distinction is what makes B4 below viable.

---

## Lane B — author something new

### Before anything: is this figurative?

This decides the method, and getting it wrong is expensive. The split is evidence from real
work, not taste:

- **Geometric or iconographic** — icons, abstract marks, badges built from primitives, anything
  you could describe as shapes and spacing. **Hand-author it** (B1-B3). Hand-drawn marks in this
  register have come out clean first or second time.
- **Figurative** — a face, a body, an animal, a mascot, anything with anatomy. Two routes work,
  and the thing that kills you is neither of them:

  **What fails is hand-TYPING path coordinates.** One figure took eight drafts that way, peaked
  well below its references, and was rejected on sight. You cannot see what you are drawing, so
  each fix breaks something else.

  **B4 — generate, then vectorise.** Fastest and cheapest. Measured head-to-head: 182k tokens,
  27 minutes. The cost is provenance (the base is machine-generated, which matters for a
  commercial brand) and file size — tens of KB, not single digits.

  **Parametric authoring.** Write a small script that *generates* the geometry — splines, tapers,
  computed periods — and render every iteration. This converges too: a run that took this route
  produced native geometry and eleven deliverables, at 239k tokens and 33 minutes. Its first five
  versions were as bad as any hand-typed attempt (it read as a goat, then the ears fused, then it
  read as tusks, then wings) — the difference is that a fast render loop let it keep correcting.

  Pick B4 for speed, or parametric when provenance matters, when you want native compact geometry,
  or when the mark needs many coordinated variants. Do not pick hand-typed path data.
  `references/authoring.md` has the parametric method in detail — read it before choosing that
  route, because doing it badly collapses back into hand-typing.

### B0. When there is nobody to ask

You will sometimes run where no human can answer — a subagent, a scheduled job, a batch. Do
not stall, and do not pretend a default was a decision. Write the questions you would have
asked into your notes under a clear heading, state the assumption you are proceeding on for
each, and deliver anyway. A delivered artefact plus four honest open questions is useful; a
blocked task is not. When a human *is* present, ask — the whole point of B1 is that some
answers change the drawing rather than refine it.

### B1. Decide what actually needs asking

Ask only where a wrong guess wastes real work, and ask **once**, batched. These usually
qualify, because they change the artwork rather than refine it:

- **Where it will be used, and how small it will get.** A 16px favicon and a hero mark are
  different drawings, not one drawing scaled.
- **Colour commitment.** Mono and recolourable by the consumer (`currentColor`), or fixed
  brand colours? That changes the file's structure, not just its fills.
- **Style register**, when the brief is open — "an icon of a fox" could be geometric flat,
  single-weight line, or filled silhouette, and they share no geometry.

These usually do *not* qualify — decide, and state the assumption in one line: canvas size,
exact padding, id naming, whether to include `<title>`. If the user gave a reference image or
named a style, infer from it rather than re-asking.

Two failure modes to avoid, in both directions. **Asking what you could check** wastes the
user's turn — never ask whether something is legible at 16px, whether a colour has contrast, or
whether two variants are the same shape; those are measurements, and you have the scripts.
**Not asking what only they know** wastes the whole drawing — the business name, who it is for,
where it will physically appear. If you cannot name what a question would change about the
artwork, it is not worth asking.

**When a question is unanswerable and would change the geometry, build both answers.** Style
register is the usual one. Guessing wastes the drawing and asking is impossible in a headless
run, so finish two genuine directions and let the client pick. That is cheaper than a wrong
single direction and it makes the choice concrete instead of abstract.

**Some things you cannot settle for them, and should say so rather than imply otherwise.**
Trademark clearance needs their real name and jurisdiction. And whether a silhouette reads as
intended — one run built an arch-on-plinth mark and flagged that it wanted a few naive viewers
asked whether they saw a window or a headstone. No script answers that; naming it is the
honest move.

### B2. Construct

This is the **hand-authoring** path. If the mark is figurative, you should not be here — go to
B4. Hand-drawing a face or a figure does not converge, and no amount of care in this section
substitutes for using the right method.

Build on a square viewBox (800×800 is a good default) with the artwork inset ~10–12% for clear
space. Prefer a few deliberate paths over many fragments — someone will open this file. Group
semantically with ids that say what a thing *is* (`#body`, `#leaf`), never where it sits
(`#path12`).

Read `references/authoring.md` before drawing anything with symmetry, strokes that must survive
scaling, or geometry you would otherwise hand-compute.

**Drawing a figure reserved out of a filled disc — a siren, a face, a crest — is the hardest
thing in this lane. Read `references/figurative-marks.md` first.** It costs a minute and saves
several drafts: the proportion ratios that decide whether a topknot reads as a topknot or a hat,
why a small figure floating in disc colour can never be fixed by tweaking features, and why any
line you place near a face gets recruited into the expression.

### B3. Verify

**If the client named marks to be like — "something like Starbucks and CHAGEE" — those are the
acceptance gate, not flavour text.** Fetch them (Lane A) and measure against them BEFORE you
deliver:

```bash
python scripts/svg_quality.py mark.svg --against starbucks.svg chagee.svg
```

This is not optional politeness. In the case that produced this rule, the references were named
in the opening request and sat on disk the whole time, and the mark was delivered without ever
being compared to them. It came back rejected, the comparison took two minutes, and it showed a
silhouette-structure gap of nearly 2x that no amount of curve-tuning would have closed. Running
it first would have saved three drafts and the rejection.

If the mark scores far below the named references, say so and change approach — do not deliver
it with a hopeful note attached. Delivering something you have not checked against the client's
own stated bar puts the burden of quality control on them.

Beyond that comparison, the render is the verification:

```bash
python scripts/svg_render.py icon.svg --sizes 512,128,48,24 --bg light,dark,mid --out sheet.png
```

**Proof it in the place it will actually live.** A size ladder on a neutral square tells you the
mark still has pixels; it does not tell you the mark still works. Mock it onto the real artefact —
the can, the shopfront, the nav bar, the tab strip — at the real size. One run did exactly this
and found a badge that survived its size ladder collapsed into an insect-like smudge at 16-32px
in situ, which is what drove three separate small-size tiers instead of one scaled file.

Look at the smallest size first — that is where designs fail. Check it survives every ground
you intend to claim. If you built something meant to be symmetric, prove it:

```bash
python scripts/svg_check.py mark.svg --mirror
python scripts/svg_quality.py mark.svg --against ref-a.svg ref-b.svg
```

`svg_quality` will not tell you whether a mark is beautiful. It will tell you whether it has
markedly less silhouette structure than the marks you are being compared to — which is the most
common, most fixable reason original work reads as cheap.

### B4. Generate, then vectorise — the route for figurative marks

Hand-authoring Bezier coordinates works for geometric marks and icons. For **figurative**
artwork — a face, a figure, anything with anatomy — it is a poor method, because you cannot see
what you are drawing until you render it, and each fix breaks something else.

In one real case eight hand-typed drafts of a figure peaked at 3.9 transitions/row against
references at 5.4 and 7.4 and were rejected on sight; one generation plus a trace scored 7.5 and
cleared both. If you have started typing path data by hand and two or three drafts have not
converged, stop — the method is wrong, not the effort.

**This is not the only route that works.** In a head-to-head, parametric authoring converged as well (see the Lane B gate above); it costs
about 30% more and buys native geometry and free provenance. Choose deliberately rather than
assuming generation is always right.

The route is one command once you have a generation you like:

```bash
python scripts/svg_vectorise.py generated.png --out mark.svg --ink "#1A3566" --square 800
```

It posterises, traces, recolours, optimises and places, and it refuses to hand you a broken
file. Three gates, each aimed at something a mean score cannot see:

- **Flatness** — refuses a source that is not genuinely two-tone, because tracing gradients is
  what produces huge banded files. The gradient mark that established the 112x penalty measures
  52% mid-tone here and is rejected outright.
- **Blob count** — counts distinct ink shapes before and after. This is the one that matters:
  discarding small blobs is *literally* what the speckle filter does, and on the real failure it
  reads 18 -> 8. A tile-grid check was tried first and missed it, because a face's features are
  a few percent of one tile, under the antialiasing noise elsewhere in the mark.
- **Worst tile** — a second net for gross regional differences.

The generation step is still yours: use any image generator you have, or ask the user for a
flat two-colour PNG. Either way, ask for **absolutely flat colours, exactly two, no gradients,
no shading, no texture, no drop shadow, hard edges**. That constraint is the whole reason the
trace comes out clean rather than banded.

Be straight with the client about what they are getting. The geometry is looser than hand-drawn
work and the files are an order of magnitude larger (tens of KB, not single-digit). And the base
was machine-generated, which is a real provenance question if the mark becomes a brand — say so
rather than letting them assume you drew it.

---

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
asked for sheen it must not have. Decide the
density route out loud: **line and pattern** (few gradients, repeated linework) or **layered painting**
(many stacked translucent light and shadow shapes). They share no technique.

### C2. Plan the composition in words

Before any code: the hero mass, one big foreground anchor, the connective tissue that makes the large
parts one machine, the curved forms that break box monotony, the negative-space diagonal, and the
small life (a turning fan, falling water). Ask the client only what changes the drawing (B1 rules
apply): the subject, the mood, where it will be seen.

### C3. Build with `scripts/iso_scene.py`, starting from the worked example

**Read `examples/tea_village.py` first.** It is a finished scene at the designer finish (critics: 5.5/10
against a 9 reference, up from 4), and its docstring maps every Lens 10 rule to the code that does it.
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
`curved_tone()`, `frustum()` (a round, tapering tower: lighthouse, chimney, funnel) and `y_plane()`
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

## The harness

Headless Chromium via Playwright, because `getBBox()` resolves transforms, clips and text
metrics that no XML parse can. Every script takes `--help`. Script paths in this file are
relative to this skill's folder.

| Script | Question it answers |
|---|---|
| `scripts/svg_probe.py` | What is this file really — vector or raster, font-dependent, what's the artwork box, will its ids or classes collide, is the figure a knockout? `--set` compares several files to each other. |
| `scripts/svg_render.py` | What does it *look* like, at every size and on every background I claim to support? |
| `scripts/svg_check.py` | Is this the same artwork as the reference — and can this comparison actually detect that it isn't? |
| `scripts/svg_verify.py` | Is the geometry itself sound — corners where none were intended, per-feature size errors, staircased edges? |
| `scripts/svg_place.py` | Put artwork on a canvas at the right size, ids namespaced, dead defs pruned. |
| `scripts/svg_optimize.py` | Strip needless coordinate precision, and refuse to write the file if the render changed. |
| `scripts/svg_trace.py` | Raster to vector, with fidelity measured against the source. |
| `scripts/svg_quality.py` | Is this mark as visually structured as the marks I am aiming at? |
| `scripts/svg_vectorise.py` | Generated flat raster to delivered vector in one gated command. |
| `scripts/finish_check.py` | Lane C gate: fails a scene on student-work tells (airbrush overlays, see-through grey shadows, hairline share, blur, clip paths that draw nothing). `--route flat\|lines\|painting`. No browser. |
| `scripts/scene_compare.py` | Lane C: `sheet` lays out reference \| before \| now at one height; `crops` saves zoom crops by fraction boxes (run twice with the same boxes for before/now); `measure` prints strip scores (Lens 2), subject frame fill from group ids (Lens 3) and whether the animation runs (Lens 9). |
| `examples/tea_village.py` | Lane C worked example at the designer finish: run with `--out` outside the skill; read its docstring before building a scene. |
| `scripts/iso_scene.py` | A toolkit (not a command) for Lane C: isometric projection, culled faces in crisp plane tones (flat finish, the default), cast shadows, columnar rock undersides, rounded machinery, depth sorting. `--demo out.svg` builds a sample scene and checks it is well-formed. |

If Playwright is missing: `pip install playwright && playwright install chromium`.

These run headless and write only where told. Prefer them over driving a browser through an
MCP for this work — that route blocks `file://`, needs a local web server, and scatters
screenshots through the working directory.

---

## Delivery

Save finished files where the user asks. If they name no place, save next to the source file,
or in the current folder when there is no source file. Name each file after the brand or
subject and its variant (`acme-mark.svg`, `acme-lockup-reversed.svg`).

Then say plainly, a line or two each:

- **What it is and where it came from.** If the file contains a brand's actual published
  artwork, say so — that is materially different from an original drawing and it changes what
  the user may do with it. Note the trademark reality once, without lecturing.
- **What you verified, and what you did not.** Quote the diff number *with* its control so it
  means something. Never call a resampling-limited result "pixel perfect".
- **Any constraint baked into the file**: a wordmark that is white and vanishes on white; a
  background shape that is load-bearing rather than decorative; a `<text>` element needing
  outlines for portability.

Clean up scratch renders and probe output. Leave the working tree as you found it.

## Traps

`references/svg-traps.md` — specific technical failures worth reading before editing anyone
else's SVG: split subpaths and relative `moveto`, `currentColor`, load-bearing backgrounds, id
collisions, gradient coordinate spaces, complex-script glyphs.

`references/sourcing.md` — extended notes on hunting official artwork, and what each kind of
source tends to get wrong.

`references/authoring.md` — constructing original marks: symmetry, small-size legibility,
stroke handling, icon-set systems, and the design questions worth asking.

`references/figurative-marks.md` — figures reserved from a filled disc: proportion ratios,
filling the roundel, why same-fill-on-same-fill reads as a hat, and what survives a shrink.

`references/critic-brief.md` — Lane C's critic brief, word for word, and the rules for using its
answers (fresh agent each round, check its crops, stop at a plateau).

`references/dense-scenes.md` — Lane C's ten craft lenses (density routes, tonal rhythm, frame fill,
one-machine integration, rounded machinery, painted light, surface detail, hidden faces, life, the
designer finish), the
16-scene reference set with its measured density band, and the review pass.

`references/reconstruction.md` — the narrow case where the hunt genuinely comes up empty and a
vendor ships a mark only as raster. Read it before tracing anything with gradients: whole-image
tracing collapses them (measured: 1 path, 459 bytes, "POOR"), and the per-region route that does
work has about ten ways to go subtly wrong, most of which render as a confident, plausible,
wrong drawing rather than an error.
