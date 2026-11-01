#!/usr/bin/env python3
"""Measure a mark against reference marks on proxies that correlate with "looks professional".

This exists because "it looks cheap" is the least actionable feedback there is. These numbers
will not tell you whether a mark is beautiful — nothing will — but they turn three specific
failures into something you can target:

  transitions/row  Silhouette complexity, i.e. rhythm. Great badge marks get visual interest
                   from REPETITION: the Starbucks siren's wavy hair strands, CHAGEE's cluster
                   of spheres, the tawara segments edging a dohyo. A mark made of two or three
                   flat blobs scores low and reads as cheap no matter how the curves are tuned.
                   Measured: Starbucks 7.4, CHAGEE 5.4. A draft that scored 2.2 was rejected
                   on sight by the client; the redraw that scored 6.4 was not.

  ink balance      Figure vs field. Wildly lopsided marks tend to read as either a blob or a
                   thin scratch. Less diagnostic than rhythm — treat as context, not a target.

  detail survival  transitions/row at 24px divided by the same at 400px. How much of the
                   silhouette still exists when it is small. Near 1.0 means the mark shrinks
                   honestly; near 0 means everything you drew turns to mud and you owe the
                   client a separate small-size drawing.

    python svg_quality.py mine.svg --against starbucks.svg chagee.svg
"""
from __future__ import annotations
import argparse, io, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import sys as _sys; _sys.dont_write_bytecode = True   # no .pyc in the skill folder
from _svgkit import Harness, read_svg, rasterize

from PIL import Image


def analyse(h, path, px):
    im = Image.open(io.BytesIO(rasterize(h, read_svg(path), px, "#ffffff"))).convert("RGB")
    p = im.load()
    xs, ys = [], []
    step = max(1, px // 200)
    for y in range(0, px, step):
        for x in range(0, px, step):
            r, g, b = p[x, y]
            if not (r > 235 and g > 235 and b > 235):
                xs.append(x); ys.append(y)
    if not xs:
        return None
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    trans, fig, fld = [], 0, 0
    for y in range(y0, y1, max(1, (y1 - y0) // 130)):
        row = []
        for x in range(x0, x1):
            r, g, b = p[x, y]
            if r > 235 and g > 235 and b > 235:
                continue                      # outside the mark
            light = r > 170 and g > 170 and b > 170
            row.append(light)
            if light: fig += 1
            else: fld += 1
        if row:
            trans.append(sum(1 for i in range(1, len(row)) if row[i] != row[i - 1]))
    if not trans or not (fig + fld):
        return None
    return {"transitions": sum(trans) / len(trans), "figure_pct": 100 * fig / (fig + fld)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mark")
    ap.add_argument("--against", nargs="*", default=[], metavar="REF",
                    help="reference marks you consider good. Without these you get numbers "
                         "with no scale, which is close to useless.")
    ap.add_argument("--small", type=int, default=24, help="small size for the survival check")
    args = ap.parse_args()

    files = [("MINE", args.mark)] + [("ref", r) for r in args.against]
    rows = []
    with Harness() as h:
        for tag, f in files:
            big = analyse(h, f, 400)
            small = analyse(h, f, max(64, args.small * 8))
            if big is None:
                print(f"{f}: nothing rendered — check the background assumption"); continue
            surv = (small["transitions"] / big["transitions"]) if small and big["transitions"] else 0.0
            rows.append((tag, Path(f).name, big["transitions"], big["figure_pct"], surv))

    print(f"{'':<5} {'file':<34} {'trans/row':>9} {'figure%':>8} {'detail survival':>16}")
    for tag, name, t, fp, s in rows:
        print(f"{tag:<5} {name:<34} {t:>9.1f} {fp:>7.1f}% {s:>15.2f}")
    print()

    if len(rows) < 2:
        print("No references given, so these numbers have no scale. Pass --against with two or "
              "three marks you actually think are good.")
        return

    mine = rows[0]
    refs = [r for r in rows[1:]]
    lo = min(r[2] for r in refs); hi = max(r[2] for r in refs)
    print(f"reference band for transitions/row: {lo:.1f} - {hi:.1f}")
    if mine[2] < lo * 0.75:
        print(f"LOW RHYTHM ({mine[2]:.1f}). The mark has markedly less silhouette structure than "
              "your references. Tuning curves will not fix this — it needs a repeating element "
              "(strands, segments, a fringe, a ring of forms) or more of the figure showing.")
    elif mine[2] > hi * 1.6:
        print(f"BUSY ({mine[2]:.1f}). Well above the references — likely too much fine detail, "
              "which will collapse at small sizes. Check the survival column.")
    elif mine[2] < lo:
        print(f"SLIGHTLY LOW ({mine[2]:.1f}, band floor {lo:.1f}). Within 25% of the lowest reference, "
              "so not a fail, but below every reference.")
    else:
        print(f"IN BAND ({mine[2]:.1f}). Silhouette complexity is comparable to the references.")

    if mine[4] < 0.45:
        print(f"POOR SHRINK ({mine[4]:.2f}). Most of the silhouette disappears by {args.small}px. "
              "Draw a separate simplified small version rather than shipping this one scaled.")

    print()
    print("These are proxies, not taste. A mark can score well and still be ugly — but a mark "
          "that scores far below its references is reliably the kind of ugly you can fix.")


if __name__ == "__main__":
    main()
