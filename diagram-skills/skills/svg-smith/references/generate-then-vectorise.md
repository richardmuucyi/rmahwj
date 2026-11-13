# B4. Generate, then vectorise: gates and reasons

Moved word for word from `SKILL.md` on 2026-11-13, so the skill body stays short. `SKILL.md` keeps the rules that hold on every run.

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
