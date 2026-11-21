---
name: d2-diagram
description: Author diagrams as D2 (declarative diagramming) and compile them to SVG with the local d2 CLI, always delivering both the .d2 source and the rendered .svg. Use whenever someone wants a diagram drawn, generated, refreshed, or fixed — architecture and system diagrams, flowcharts, sequence diagrams, ERDs and database schemas, UML class diagrams, C4 models, network or deployment topology, state machines, pipelines, org charts — and whenever a diagram would explain a multi-part system better than prose, even if they never say "D2". Also fires on "render this .d2", requests naming a layout engine or theme (--layout=elk, --theme=300, sketch mode), and converting an existing mermaid / graphviz / plantuml diagram into D2. NOT for reviewing or polishing an existing mermaid diagram (use mermaid-visual-review), NOT for generative or illustrative imagery, posters and infographics (raster image generation), NOT for a multi-page HTML walkthrough.
---

# D2 diagrams

D2 is a declarative diagramming language: you describe what the diagram contains and a
layout engine decides where everything goes. That trade is the whole point — you give up
pixel control and get diagrams that stay editable, diffable and re-layoutable as the thing
they describe changes.

Tested with `d2` v0.9.0 (most measurements were first made on v0.7.1). `d2 layout` reports **dagre** and **elk** only; TALA is
proprietary and not installed, so treat TALA-only features as unavailable.

## The delivery contract

Every diagram this skill produces ships **two artefacts**. Neither is optional, because
each fails without the other: the `.d2` is what the user edits next time, and the `.svg`
is the only proof it actually compiles and looks right.

1. **The source** — the `.d2` script, saved to `<name>.d2`, and shown inline in a
   `d2` code fence so it can be read without opening a file.
2. **The render** — the compiled image on disk, reported with its path. SVG by default;
   **PNG when the diagram is headed for a deck, a document, or anywhere an `<img>` tag
   will freeze it** (`scripts/rasterize.py`). Keep the `.d2` either way — the raster is
   the output, the source is what gets edited next time, and the SVG in between
   regenerates in one command.

Show the source *and* name the file. A code fence alone leaves nothing to iterate on; a
file path alone makes the user open something to see what you did.

If a render cannot be produced, say so plainly and hand over the `.d2` with the compiler
error. Never present an uncompiled script as if it were finished — an unrendered D2 file
is a guess.

## The pipeline

Eight stages. The shape of it matters more than any individual step: **two stages of
proposing and one of declaring facts come before any `.d2` is written, and a stage of
looking comes before anything is delivered.** None of that is caught by a compiler: the
expensive mistakes in this skill are a diagram of the wrong *kind*, a label nobody can
trace to a source, and a diagram that compiled and looks broken.

| # | Stage | Tool | Question it settles |
|---|---|---|---|
| 0 | Triage | — | Is D2 the right answer at all? |
| 1 | **Classify** | `scripts/advise.py` | What KIND of diagram is this? |
| 2 | **Propose** | `scripts/advise.py` | Which layout, which theme, what should it carry? |
| 2.5 | **Declare facts** | — | What on this diagram is a claim, and where did it come from? |
| 3 | Author | — | Write the `.d2` |
| 4 | Compile | `scripts/render.py` | Did it build, and did it draw what I meant? |
| 5 | **Review with eyes** | `scripts/visual_review.py` · `scripts/quality.py` · `agents/reviewer.md` · `agents/critic.md` (optional) | Does it actually *look* right, does its legend tell the truth — and, when it matters, how good is it? |
| 6 | Deliver | — | Source + render + the choices worth knowing |

Stages 1, 2, 2.5 and 5 are the ones people skip. They are the ones that decide quality.

### 0. Triage — is this D2's job?

Hand off rather than force it: illustrative or generative imagery → a raster image
generator; reviewing an existing *mermaid* diagram → `mermaid-visual-review`; a multi-page
HTML walkthrough → an HTML page, not a diagram; a logo or icon as artwork → `svg-smith`.

**Converting from mermaid?** Read `references/from-mermaid.md` first. **Count the
`alt`/`else` blocks** — that, not the diagram type, decides whether the conversion is a
win. Zero converts cleanly and often improves on the original; three or more interleaved
means D2 will misrepresent the diagram unless you split it by scenario. Converting first
and discovering that afterwards wastes the whole batch.

### 1. Classify — propose the type before writing anything

Script paths in this file are relative to this skill's folder.

```bash
python scripts/advise.py "<the request, in the user's words>"
```

It returns a proposed genre, a runner-up, and **the signals that fired** — so the
reasoning is inspectable and you can overrule it. Scored 11/11 on the corpus's own
requests (`tests/eval_advisor.py`), which is good, not infallible: it matches words, and
the person asking may have used none of them.

`references/diagram-types.md` has the full table. The short version:

| Intent | Form |
|---|---|
| Boxes, arrows, system structure | plain shapes + containers *(the default)* |
| Who calls whom, in what order | `shape: sequence_diagram` |
| Database schema, relationships | `shape: sql_table` + `--layout=elk` |
| Code structure, types | `shape: class` + `--layout=elk` |
| Matrix, grid, table | `grid-rows` / `grid-columns` |
| Same system at several zoom levels | `layers` |
| Normal vs failure mode | `scenarios` |
| A process unfolding over time | `steps` |

**Plain shapes and containers is the right default.** An architecture diagram forced into
a grid is worse than one laid out freely; reach for a special genre only when it genuinely
matches.

### 2. Propose — layout, themes and vectors, before the first line

The same command already printed the rest of the proposal. **Surface it to the user before
authoring**, because this is the last moment when changing direction is free:

- **Diagram type**, with the runner-up and when to switch to it.
- **Layout engine**, flagged when it is *required* rather than cosmetic — ELK for
  `sql_table` and `class`, because under dagre a foreign key attaches to the whole table
  instead of the exact row.
- **How many themes are available**, split into usable / caveat / discouraged *for this
  genre* — read live from the binary, so it stays true across an upgrade. Terminal (300,
  301) is discouraged for ERDs and grids because it upper-cases every label, which mangles
  column names; C4 (303) is purpose-built for C4 and odd anywhere else; Colorblind Clear
  (8) is the pick when it must survive colour-vision deficiency or print.
- **Vectors worth adding**, in both senses of the word:
  - *Information vectors* — the extra dimensions the diagram could carry: containers as
    boundaries, a class palette by role, sync-vs-async as edge style, a legend, tooltips,
    click-through links, a failure path, a second board via `scenarios`.
  - *Vector assets* — actual `.svg` artwork for nodes. Pass `--icons-dir <folder>` when the
    user has a folder of logos, and `advise.py` lists them and flags any the request
    mentions; `assets/icons/` ships a few. **Prefer a local relative path**
    (`icon: ./library-crest.svg`): it cannot 403
    and needs no network at render time. Much of `icons.terrastruct.com` returns 403, and
    a dead URL renders as a silently missing icon — verify with `--check-icons` first.

Keep the proposal proportional. One line for something trivial; the full block when the
genre is arguable, the theme matters, or there are vectors genuinely worth adding. Do not
stall waiting for approval on a two-box diagram — show the choice and keep moving.

### 2.5. Declare the facts before you draw them

Write a `# SOURCE:` block at the top of the `.d2` — one line per claim the diagram
makes that a reader could check.

```d2
# SOURCE: 8 GB RAM = README.md:24
# SOURCE: 5 regions = REGIONS, src/config.py:12
# SOURCE-EXEMPT: Person A, Person B   (deliberate generics)
```

**This validates nothing.** A fabricated SOURCE line passes, because nothing checks it —
there is no lint here and deliberately so. Its value is that writing the sources *before*
drawing makes a false label harder to author, and it gives the stage 5e reviewer
something concrete to check labels against.

Expect **15–20 lines** on a system diagram. That number is measured, not estimated: a
container view needed 18–19 and an annotated review diagram needed ~20.

The failure this prevents is real: a label that names a capability the product does not
have, while a sibling diagram in the same set states the opposite correctly.

#### Diagramming a system you did not build

When the subject is someone else's system (an engineering blog, a talk, a docs page), read
`references/external-systems.md` before drawing. Its four rules each come from a reviewer
catch: put the source's year inside the picture; number steps only when a source states the
order; a generic pattern from an interview guide is not the company's design; and write
`# NOT CLAIMED:` lines for what you left out on purpose.

### Never use `shape: person` or `shape: c4-person`

Both are **deformable**: d2 sizes the node from its label and stretches the silhouette to
fill it, so any actor name longer than about nine characters renders a wide, squat blob
(`person` caps at 1.50:1, `c4-person` at 1.05:1). There is no case where the built-in
shape is the better choice. Use an icon, which scales inside the box and keeps its shape:

```d2
customer: Returning Customer {
  shape: image
  icon: ./actor-outline.svg
  width: 54
  height: 54
}
```

Four actors ship in `assets/icons/people/` — `actor-outline.svg` (default),
`actor-solid.svg`, `actor-figure.svg`, `actor-cap.svg` (a figure in a cap) for a second role. Copy the one
you need next to the `.d2`; `icon:` resolves relative to the source file, and the render
inlines it as a `data:` URI so the exported SVG stays self-contained.

`quality.py` criterion 10 warns on any use of the built-in shapes. Background and the
measured deformation curve: `references/aesthetics.md` and `references/styling.md`.

### 3. Author the `.d2`

Save to a real file rather than piping from stdin — the user needs it afterwards, and
errors report `file:line:column` against it. Put it where the user asked; absent
instruction, alongside the thing it documents, or in the current folder. For a diagram
embedded in a Markdown note, keep the `.svg` where the note's image links can reach it.

`references/syntax.md` is the full language spec. The idioms that matter most:

- **Connect keys, not labels.** With `be: Backend`, writing `Backend -> Frontend` silently
  creates two new shapes instead of connecting the existing ones. This is the single most
  common D2 bug and it never raises an error.
- **Set `direction`** (`right` or `down`) early. It shapes the whole layout, and the
  default rarely suits a wide diagram.
- **Group with containers** rather than styling shapes into implied groups. Containers are
  what the layout engine understands.
- **Hoist repeated styling into `classes`**, or a glob (`***.style.fill: …`). A diagram
  where every shape carries its own `style` map is unmaintainable within a week.
- **Label connections** with the verb — `api -> db: writes audit rows` explains far more
  than a bare arrow, and costs one line.
- **Use `\n`** to break long labels. D2 does not wrap text, and one long label distorts
  the layout around it.
- **Title with `shape: text`, not a Markdown heading.** A long `# heading` silently clips
  (see `references/styling.md`); `shape: text` with `style.font-size` never does.

Keep it minimal at first. Extra styling is cheap to add after you have seen the render;
un-picking a wrong layout from an over-decorated script is not.

### 4. Compile

```bash
python scripts/render.py <name>.d2 -o <name>.svg
```

The script exists to make three mistakes impossible: losing d2's exit status to a pipe,
missing that a multi-board diagram wrote a *directory* instead of a file, and failing to
find `d2` when it is not on PATH. `--help` lists the flags it understands; anything
else is passed to `d2` untouched.

Honour explicit requests — `--layout=elk`, `--theme=300`, sketch mode. Absent a request,
default to dagre and the default theme, except for `sql_table` and `class` diagrams, where
ELK is materially better because it routes to the exact row.

Alternatively pin the choice inside the file so it travels with the diagram:

```d2
vars: {
  d2-config: {
    layout-engine: elk
    theme-id: 4
  }
}
```

Note that CLI flags and `D2_*` environment variables override `d2-config`, not the
reverse.

### 5. Review with eyes

**The compile is the gate. `d2 validate` is not.** Verified behaviour: `d2 validate`
returns exit 0 and prints `Success!` for a file containing `a.shape: bogus_shape`, which
does not compile. It checks that the text parses, nothing more. Trust only the exit status
of an actual render — and never the presence of an output file, since d2 deliberately
writes partial renders on some errors so you can keep iterating.

Exit 0 proves it compiled. It proves nothing about whether the diagram is any good. Six
checks, in order of how much they catch.

**a. Put a browser on it, then look yourself.** This is the stage that finds real defects.

```bash
python scripts/visual_review.py <name>.svg
```

This drives **playwright-cli** as the skill's eye. It is not taking a screenshot for
convenience — it measures the diagram's **live geometry** with `getBBox()`, which is the
only way these defects can be detected at all, because none of them exist until something
lays the file out. It reports content outside the canvas, a Markdown block clipped, an icon
drawn over its own label, colliding labels, labels overflowing their shape, unreadable
text, and a runaway aspect ratio. Exit 1 on any CRITICAL.

It always writes a PNG, and **you must open it.** The tool measures geometry; it cannot
judge balance, reading order, or whether the diagram answers the question that was asked.
Every visual defect found while building this skill was caught by looking — a Markdown
heading clipped in half, an icon sitting on its own label, a legend rendering as
meaningless rectangles, a grid filled in the wrong direction.

The script already handles the playwright-cli traps on Windows (blocked `file:`, the false
`goto` timeout, the npm `.cmd` shim, single-line JS); read `references/review.md` § 5a before
calling playwright-cli directly.

If playwright-cli is unavailable, fall back to `rasterize.py <name>.svg --scale 1` and read
the PNG yourself. Looking is the part that cannot be skipped; the automation is not.

**b. Check the inventory** — `render.py <name>.d2 -o <name>.svg --check`, and when you know the
counts, `--expect-shapes N --expect-edges M` (sequence diagrams: edges = messages + actors). A
mistyped key silently creates a shape and d2 still exits 0.

**c. ASCII, topology only** — `--ascii-preview` checks arrow direction and container membership.
It cannot see icons, Markdown, colour or overlap, so it is never the only check.

**d. Score it** when it carries a legend or you inherit it — `scripts/quality.py <name>.d2`.
Criterion 9 (legend honesty) and 11 (container label louder than its nodes) are the two no
other check sees. To choose a layout engine, `render.py ... --compare-layouts` writes both and
picks neither: open both PNGs. Details and edge cases: `references/review.md`.

**e. Dispatch the fresh-eyes reviewer** — always, except for a throwaway probe. Looking at your
own diagram is the weakest review: it encodes your model, so an error in that model reads as
correct to you.

Fill `agents/reviewer.md` and dispatch it with the `Agent` tool, `subagent_type: "Explore"` —
read-only, and ~24k tokens of base context against ~85k for `general-purpose` (measured),
paid again on every tool call. Give it the PNG and the label text — **not** your
reasoning and not the `.d2`.

- `{SVG_LABELS}`: `svg_labels()` from `scripts/quality.py` reads only `<text>` content, so the
  embedded font data never reaches the reviewer:

  ```bash
  python -c "import sys; from pathlib import Path; sys.path.insert(0, 'scripts'); from quality import svg_labels; print('\n'.join(svg_labels(Path('<name>.svg'))))"
  ```

- `{SYSTEM_DESCRIPTION}`: assembled from the `# SOURCE:` citations — quote them and name the
  files and URLs they cite — or from a linked task page. Never free-written: then the reviewer
  checks the model that drew the diagram. With no independent source, write `NO TRUSTED SOURCE`.
- `{DECLARED_FACTS}`: the SOURCE lines, plus SOURCE-EXEMPT and NOT CLAIMED lines labelled as such.

The brief lets the reviewer open each cited source once, to read the conditions around a claim.
Keep that when trimming it: in testing it caught a claim true only under a condition the
picture left out, which the declared facts alone could not show (fixture
`tests/fixtures/reviewer/cloud-merge/`). The reviewer catches semantic and boundary errors, not
geometry, and does **not** reliably catch a wrong topology (an edge to the wrong neighbour).

**f. Optional: score the design** — when the diagram is headed for other people or you are
iterating it to a quality bar, dispatch `agents/critic.md` (`subagent_type: "Explore"`) with the
light and dark PNGs, the `.d2`, the purpose in the user's words and the medium it will be read
in. Apply presentation edits; take claim-changing ones to the user. Re-run with the same brief
and no previous scores. Details: `references/review.md` § 5f.

### 6. Deliver

Present the `.d2` in a fenced block, then the render's path. One or two sentences on the
choices worth knowing about — why ELK, why that direction, what was left out. If a layer
or scenario was used, say where the extra boards landed.

Close the loop opened at stage 2: say which type was chosen **and what it was chosen over**,
and name the vectors that were offered but not taken, so accepting one later is a one-line
request rather than a re-brief. If the visual review raised anything you deliberately
accepted, say that too — a known, stated imperfection is a decision; an unmentioned one is
a defect. If the critic ran (5f), give its overall score, the medium it judged for, and the
improvements you did not take.

## When rendering fails, or renders wrong

Read `references/troubleshooting.md`: d2's error messages with their fixes, and the failures
that produce **no error at all** — a shape drawn twice, exit 0 with no output, a vanished CJK
label, a clipped heading, an icon on its label or missing, a scrambled grid, a legend that
lies — each by symptom. Read the `file:line:column` first; fix one thing, re-render, re-read.
Never hand over a diagram whose last render failed.

## Raster output

`d2 in.d2 out.png` (and PDF, PPTX, GIF) failed on d2 v0.7.1, which downloads a retired
Playwright build; on v0.9.0 a PNG export worked in a quick test. `rasterize.py` works on
either and controls the colour scheme, so it stays the default: render the SVG, then
`python scripts/rasterize.py diagram.svg --scale 2`.
PNGs come out light unless you pass `--color-scheme dark`. Keep the `.d2`. Why a headless
browser, and every flag: `references/cli.md` § Raster output.

## draw.io output

d2 has no draw.io export. `python scripts/to_drawio.py diagram.d2 --png`
writes an editable `.drawio` from d2's SVG, every object where d2 placed it, and a PNG to
look at. When someone has edited that copy, `scripts/from_drawio.py edited.drawio` brings
their edits back into the `.d2` and lists what it could not carry. Read `references/drawio.md`
first: which file stays the source, and what does not carry across in either direction.

## Multi-board diagrams

`layers`, `scenarios` and `steps` write a **directory**, not a file (`out.svg` gives `out/`).
Before splitting a diagram into boards, or when one already is, read
`references/multi-board.md`: where the boards land, and why an index board must be verified
against the detail boards in both directions.

## Reference files

Load these as needed rather than upfront — this file plus the right reference is usually
all a diagram takes.

| File | Read it when |
|---|---|
| `references/syntax.md` | writing anything non-trivial — shapes, connections, containers, text/Markdown/code/LaTeX, classes, vars, globs, imports, null/suspend, composition, reserved keywords |
| `references/from-mermaid.md` | **converting an existing mermaid diagram** — the construct-by-construct mapping, what is lost, and the `alt`/`else` rule that decides whether a sequence diagram is worth converting at all |
| `references/diagram-types.md` | the diagram is a sequence, UML class, ERD, grid or C4 diagram |
| `references/styling.md` | styling, theme IDs, sketch mode, icons, legends, fonts and non-Latin text |
| `references/aesthetics.md` | the diagram is correct but looks generated — container fill, the inverted 28/16/16 type defaults, one-accent colour, engine choice, and the starting class block |
| `references/cli.md` | flags, export formats, error taxonomy, troubleshooting, install |
| `references/review.md` | stage 5 in detail — inventory counting, ASCII limits, quality criteria, layout comparison, the critic, the playwright traps |
| `references/troubleshooting.md` | a render failed, or exited 0 and drew the wrong thing |
| `references/external-systems.md` | the subject is someone else's system (blog, talk, docs page) |
| `references/multi-board.md` | the diagram uses `layers`, `scenarios` or `steps` |
| `references/drawio.md` | the diagram must be editable in draw.io |
| `assets/example-pipeline.d2` | a known-good worked example — containers, classes, shaped nodes, a styled failure edge, a `shape: text` title. Copy it as a starting skeleton rather than inventing structure |
| `tests/README.md` | the worked corpus — eleven realistic scenarios rungs 0–10, and the verified counting rules (sequence `edges == messages + actors`, ERD rows are not shapes, grid cells are). Read a rung near your diagram before inventing structure |

## Scripts

Each one exists because a bare command got something wrong. Read the docstring before
replacing any of them with a one-liner.

| Script | Does | Encodes |
|---|---|---|
| `scripts/advise.py` | stages 1–2: propose type, layout, themes, vectors | themes read live from the binary; a local logo folder (`--icons-dir`); the hosted-icon 403 problem |
| `scripts/render.py` | stage 4: compile, `--check` the inventory | exit status lost to pipes; multi-board writing a directory; d2 not on PATH; **relative imports resolving against the cwd** |
| `scripts/visual_review.py` | stage 5: measure geometry in a browser | blocked `file:`; the false `goto` timeout; the npm `.cmd` shim; single-line JS |
| `scripts/rasterize.py` | PNG with colour-scheme control (d2's own raster export failed on v0.7.1) | natural-size wrapping so the browser cannot scale-to-fit |
| `scripts/quality.py` | scores a `.d2` against eleven criteria — label length, canvas, style centralisation, title, **legend honesty**, container labels louder than their nodes | that relative imports resolve against the cwd, so it compiles from the source's own directory |
| `scripts/from_mermaid.py` | mechanical mermaid → D2 conversion | the `alt`/`else` rule that decides whether the conversion is a win at all |
| `scripts/gallery.py` | renders every genre in `tests/all-types/` light and dark, checks each PNG's corner, writes contact sheets | that a change can break one genre while the one you looked at stays fine; a source with no dark theme gives a light "dark" PNG |
| `scripts/to_drawio.py` | d2 → editable `.drawio`, positions read from d2's SVG | IDs as URL-safe base64; label masks drawn as backgrounds; draw.io's hidden 5 px top padding |
| `scripts/from_drawio.py` | edited `.drawio` → the `.d2` with those edits, then a check | a fingerprint so a changed `.d2` is refused; sequence messages placed, not appended; per-group numbering |

## Tests

After changing any script, reference, template or palette, run the eleven suites in
`tests/README.md` § Test layers, and open every contact sheet `scripts/gallery.py` lists. Nine
of the eleven carry a case designed to fail; if one turns green, the check has stopped checking.
After changing `agents/reviewer.md`, also run the regression fixture in
`tests/fixtures/reviewer/cloud-merge/` (`fixture.py fill` → dispatch → `fixture.py grade`).
