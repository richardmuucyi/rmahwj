# The critic brief (Lane C review)

The author of a scene never grades it. Each round, a **fresh** agent, briefed as an art director, scores
the scene against its reference and ranks what is still wrong. This is the brief that moved a scene from
"student work" (4/10) to the designer finish (5.5/10) in three rounds. Fill in the brackets; keep the
rest word for word.

Every bracket:
- **[now]** the version under review; **[before]** in round 1 the first full draft, in later rounds the
  version the previous critic scored as "now".
- **[sheet.png]** made with `scene_compare.py sheet`, four panels for a flat-route scene: the subject
  reference | a flat reference | [before] | [now]; three panels (no flat reference) otherwise. Say the
  panel order in the brief's file line.
- **[reference.svg] / [before.svg] / [scene.svg]** the files behind the panels; list the flat
  reference too.
- **[skill]** the svg-smith folder; **[W]x[H]** the scene's viewBox size; **[a]-[b]** the share of the
  square render the scene's content spans (for 1200x1000: 0.083-0.917).
- **[route]** flat, lines or painting (Lens 1); **[a scratch folder]** any folder outside the skill.
- Scores from different critics are not on one scale: compare before and now within one round.
- **[route rules]:** paste the finish rules for the scene's route (below), so the critic does not ask
  for what the route forbids. Without them, all three critics on a harbour test asked for gradient
  washes, translucent overlays and blurred halos, which fail `finish_check.py`.

## The brief

```text
You are an art director. Score and critique; do not praise for its own sake. The client's words:
"[the client's request, word for word, including any verdict on an earlier version]"

Files (read PNGs with the Read tool, which shows images):
- Side-by-side: [sheet.png] (left to right: [panel order]).
- SVGs for zooming: [reference.svg], [flat reference.svg if any], [before.svg] and [scene.svg].
- Crop helper: `python [skill]/scripts/scene_compare.py crops <svg> <out-prefix> x0,y0,x1,y1 ... --px 1800`
  (boxes are fractions of a square render; a [W]x[H] scene is letterboxed, its content spans y [a]-[b]).
  Write crops only into [a scratch folder]. Edit no other file.

Answer:
1. Score 1-10 for "could ship as commercial illustration" for the reference, [before] and [now], one
   line of reason each.
2. The 4 most harmful remaining faults in [now], each with: area, evidence (your crop file + what you
   see, and the reference area that does it right), and the concrete drawing fix (shape, value,
   colour, edge, placement, scale), specific enough for someone writing SVG-generating code.
3. What [now] already does at the reference's level.
Judge craft only: composition, silhouette, value structure, colour, light, shape design, edges,
detail hierarchy. Ignore the reference's logo and text. Be blunt.
The scene is drawn on the [route] route, on purpose. Its rules: [route rules]. Propose fixes inside
those rules; if you think a rule itself is the problem, say so separately.
Before you report a fault, find it in your crop; before you say something is missing, search the SVG
for it (for example, count the shadow polygons before writing "no cast shadows").
```

Route rules for the flat route (paste as [route rules]): "one key light from the upper left; every face
one of three or four flat tones; crisp cast shadows drawn as opaque multiply shapes; no gradient
washes, no translucent grey overlays, no blur; a thin pale lip on lit top edges is the only line
worth keeping; the exceptions: emitted light (glows, beams, a halo), haze on far objects and the
sky's backdrop gradient; a cast shadow lowers its ground by at least 20 L*; nothing is brighter than
the focal object's lit face."

**Compare like with like.** The contest reference most scenes are measured against (the 1.0 floating
island) is a layered painting: 799 gradients and about 2,500 opacity declarations. A flat-route scene
will not match its sheen, and a critic who knows that judges value and composition, not finish. For a
flat scene, add a flat reference to the sheet as well (the 1.3 isometric truck or the 1.2 geometric
lion).

## Rules for using it

- **A new agent every round.** One that has seen the last list anchors on it.
- **Open its crops before acting.** Fix only the faults the crops show. On the worked example, one
  critic reported a "dead-centre" pagoda and "evenly scattered" lanterns after both had been changed;
  on the harbour test, one said "no reflections" where they existed. But check before you dismiss: the
  same harbour critic said "no cast shadows" in a file with 44 shadow shapes, and it was RIGHT: all 44
  sat in isolated groups and painted as flat lavender (`finish_check.py` now counts these). The SVG
  holding a shape is not proof the shape renders.
- **Expect conflicting taste.** One critic said "shrink the hero to 70% of the width"; the next said
  "scale it up and bleed it off the edge". Prefer faults several critics agree on, and faults with a
  crop that shows them.
- **A plateau is read inside each round.** Run at most 4 rounds. From round 2 on, stop at the first
  round whose "now" scores no higher than its "before" in that round's own reply (scores across critics are not comparable; the gains within a
  round are). The worked example's "now" went 5.5 → 5.5; the sky-ship test's 6 → 5. Past that point
  the critic's taste is the variable, not the scene: hand the side-by-side to the owner.
- **A tie** ("now" equals "before"): deliver the version with fewer open faults in the latest reply;
  if that is even, the earlier one, since the later change bought nothing.
- **Roll back a fix a later critic says made it worse.** On the sky-ship test the round-3 critic found
  two regressions that came straight from round 2's advice. Keep every scored version; deliver the one
  that scored highest as "now", not the latest.
- **When critics disagree,** neither fix is safe: keep what is there, and list the disagreement for the
  owner instead of flipping back and forth (sky-ship: round 1 "keep the cream gas cells", round 2
  "remove them").
- **Run `scripts/finish_check.py` before each round**, so the critic spends its attention on
  composition and modelling, not on tells a script can catch.
- **Report the critic's score as the critic's**, not as yours, and say that no person has checked it.
- **Save each critic's full answer** as `critic-N.md` beside its crops. The critic may write only
  crops, so the author saves the reply verbatim. A score that lives only in a chat reply cannot be
  checked later.
- **Agent type and cost.** The critic needs a shell to make crops, so use a general-purpose agent
  (a read-only agent cannot render). Each round costs about 100k–140k tokens.
