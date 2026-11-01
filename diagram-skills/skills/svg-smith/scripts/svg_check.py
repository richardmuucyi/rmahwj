#!/usr/bin/env python3
"""Compare an SVG against a reference, and prove the comparison can actually fail.

A checker that returns "match" on everything checks nothing. So this always runs a
sensitivity control -- the reference against ITSELF, sampled a few pixels off -- and
reports the ratio between that and your real score. If the ratio is not comfortably
above 1, the number is noise and you should not quote it.

Both images are normalised to their own ink bounding box first, so this compares
SHAPE AND COLOUR, not canvas padding: a correct mark on a differently-sized canvas
still scores near zero.

    python svg_check.py mine.svg official.svg
    python svg_check.py mine.svg official.svg --bg dark          # white-on-dark marks
    python svg_check.py mine.svg official.svg --control other.svg
"""
from __future__ import annotations
import argparse, io, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import sys as _sys; _sys.dont_write_bytecode = True   # no .pyc in the skill folder
from _svgkit import Harness, read_svg, rasterize, resolve_bg

from PIL import Image

THRESH = 16          # per-pixel RGB delta counted as "visibly different"
GRID = 400           # normalised sampling grid


def ink_box(img, bg_rgb, tol=18):
    px = img.load()
    W, H = img.size
    x0, y0, x1, y1 = W, H, -1, -1
    for y in range(H):
        for x in range(W):
            r, g, b = px[x, y][:3]
            if abs(r-bg_rgb[0]) + abs(g-bg_rgb[1]) + abs(b-bg_rgb[2]) > tol:
                if x < x0: x0 = x
                if x > x1: x1 = x
                if y < y0: y0 = y
                if y > y1: y1 = y
    if x1 < 0:
        return None
    return (x0, y0, x1 - x0 + 1, y1 - y0 + 1)


def compare(a_img, a_box, b_img, b_box, offset=0):
    ap, bp = a_img.load(), b_img.load()
    ax, ay, aw, ah = a_box
    bx, by, bw, bh = b_box
    total = 0.0
    bad = 0
    n = GRID * GRID
    for j in range(GRID):
        v = j / (GRID - 1)
        for i in range(GRID):
            u = i / (GRID - 1)
            axx = ax + round(u * (aw - 1)); ayy = ay + round(v * (ah - 1))
            bxx = min(bx + bw - 1, max(bx, bx + round(u * (bw - 1)) + offset))
            byy = by + round(v * (bh - 1))
            r1, g1, b1 = ap[axx, ayy][:3]
            r2, g2, b2 = bp[bxx, byy][:3]
            d = (abs(r1-r2) + abs(g1-g2) + abs(b1-b2)) / 3.0
            total += d
            if d > THRESH:
                bad += 1
    return total / n, 100.0 * bad / n


def load(h, path, px, bg):
    img = Image.open(io.BytesIO(rasterize(h, read_svg(path), px, bg))).convert("RGB")
    bg_rgb = tuple(int(bg[k:k+2], 16) for k in (1, 3, 5))
    box = ink_box(img, bg_rgb)
    if box is None:
        raise SystemExit(
            f"{path}: rendered as a blank {bg} canvas -- nothing to compare.\n"
            f"  A white mark on --bg light is the usual cause. Try --bg dark.")
    return img, box


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mine"); ap.add_argument("reference", nargs="?")
    ap.add_argument("--mirror", action="store_true",
                    help="symmetry test: compare the file against its own horizontal mirror. "
                         "A mark meant to be symmetric should come back MATCH; drift of a unit or "
                         "two is glaring in a face and invisible in the XML. Read it as a strong "
                         "POSITIVE check only - dense asymmetric artwork overlaps its own mirror "
                         "by chance, so a low score does not prove asymmetry.")
    ap.add_argument("--bg", default="light", help="light | dark | mid | #hex (default light)")
    ap.add_argument("--px", type=int, default=460, help="raster size for the comparison")
    ap.add_argument("--control", help="a DIFFERENT mark, to show the scale of a real mismatch")
    ap.add_argument("--shift", type=int, default=4, help="sensitivity-control offset in px")
    args = ap.parse_args()

    bg = resolve_bg(args.bg)

    if args.mirror:
        import re as _re, tempfile
        src = read_svg(args.mine)
        vb = _re.search(r'viewBox="[\d.\-]+ [\d.\-]+ ([\d.]+)', src)
        if not vb:
            raise SystemExit("--mirror needs a viewBox to know where the centre line is")
        w = float(vb.group(1))
        head, body = src.split(">", 1)
        body = body.rsplit("</svg>", 1)[0]
        mirrored = f'{head}><g transform="matrix(-1 0 0 1 {w} 0)">{body}</g></svg>'
        tmp = Path(tempfile.mkdtemp()) / "mirrored.svg"
        tmp.write_text(mirrored, encoding="utf-8")
        args.reference = str(tmp)
        print("symmetry test: comparing the file against its own mirror")
        print()
    elif not args.reference:
        raise SystemExit("give a reference file, or use --mirror for a symmetry test")

    with Harness() as h:
        mine, mbox = load(h, args.mine, args.px, bg)
        ref,  rbox = load(h, args.reference, args.px, bg)
        real_mean, real_pct = compare(mine, mbox, ref, rbox)
        sens_mean, sens_pct = compare(ref, rbox, ref, rbox, offset=args.shift)
        ctrl = None
        if args.control:
            c, cbox = load(h, args.control, args.px, bg)
            ctrl = compare(mine, mbox, c, cbox)

    print(f"background        {args.bg} ({bg})   raster {args.px}px   grid {GRID}x{GRID}")
    print(f"ink box  mine     {mbox[2]}x{mbox[3]}")
    print(f"ink box  ref      {rbox[2]}x{rbox[3]}")
    print()
    # Labelled MEASURED, not MATCH. This row is the measurement, not the verdict, and
    # hardcoding "MATCH" here printed it even on a run whose verdict was MISMATCH -- the
    # first word on screen contradicting the conclusion four lines below it.
    print(f"MEASURED mine vs reference         mean RGB delta {real_mean:7.2f}   over-{THRESH} {real_pct:6.2f}%")
    print(f"CONTROL reference vs itself +{args.shift}px     mean RGB delta {sens_mean:7.2f}   over-{THRESH} {sens_pct:6.2f}%")
    if ctrl:
        print(f"CONTROL mine vs --control          mean RGB delta {ctrl[0]:7.2f}   over-{THRESH} {ctrl[1]:6.2f}%")
    print()

    if sens_mean < 0.5:
        print("HARNESS NOT TRUSTWORTHY: shifting the reference barely changed the score, so this "
              "comparison cannot detect a mismatch. Do not quote the match number. Likely both "
              "renders are near-blank or near-uniform -- check --bg.")
        sys.exit(2)

    # Signal-to-noise: how big is the observed difference compared with the cost of a
    # small misalignment? Below 1 means "smaller than a 4px nudge" = indistinguishable.
    snr = real_mean / sens_mean
    print(f"signal/noise: your difference is {snr:.2f}x the cost of a {args.shift}px misalignment.")
    if ctrl:
        print(f"              a genuinely different mark scores {ctrl[0]/sens_mean:.1f}x on the same scale.")
    print()

    if snr <= 0.6:
        v = ("MATCH - the difference is well below what a tiny misalignment costs. "
             "Geometry and colour agree; residual is antialiasing.")
    elif snr <= 1.5:
        v = ("CLOSE - same order as a few-pixel nudge, which is what resampling fine detail "
             "looks like. Render both and confirm the diff is edge outlines, not solid areas.")
    elif snr <= 3:
        v = ("BORDERLINE - bigger than resampling should explain. Look at both renders before "
             "calling this good; check placement, canvas size, and colour.")
    else:
        v = (f"MISMATCH - {snr:.0f}x the noise floor. These are not the same artwork. "
             "Expect a real difference in shape, colour, or framing - or that one of them is "
             "simply the wrong file.")
    print("verdict:", v)

if __name__ == "__main__":
    main()
