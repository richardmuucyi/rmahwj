# A6. When tracing is the answer: the measured cost

Moved word for word from `SKILL.md` on 2026-11-13, so the skill body stays short. `SKILL.md` keeps the rules that hold on every run.

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
