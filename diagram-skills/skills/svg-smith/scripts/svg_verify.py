#!/usr/bin/env python3
"""Check the geometry you PRODUCED, not just whether it resembles a reference.

svg_check.py answers "is this the same artwork?" and it is good at that. It cannot answer
"is this good geometry?", and the difference is not academic: across one reconstruction it
read 0.58x -> 0.52x -> 0.49x -> 0.27x, comfortably inside MATCH the whole time, while the
file contained a staircased edge, a 1px dark rim, a rounded joint, and a 135-degree kink.
Nothing was wrong with that number. A defect touching a fraction of a percent of pixels is
invisible to any whole-image mean, so the answer is to measure other quantities.

Three of them:

  CORNERS    Tangent discontinuity at every bezier join. A kink is a C1 break, and sampling
             a rendered curve at 1px can straddle one without seeing it -- on the case above
             the pixel diff said +/-1px and the curvature RMS was LOWER than the reference's,
             while the path held a 135.67-degree corner.
  FEATURES   Per-feature boxes and per-row widths against a reference, instead of one mean
             over everything. This surfaced an opening 10% too narrow, and a silhouette
             inflated 2px on every side.
  EDGES      High-frequency wander along each contour, with design curvature filtered out,
             plus a magnified sheet of the worst spots. Looking at the worst spots is what
             actually found things; the sheet exists to make looking cheap.

    python svg_verify.py mark.svg
    python svg_verify.py mark.svg --reference official.png --zoom-sheet spots.png
    python svg_verify.py mark.svg --gate            # exit 4 on a failing check
"""
from __future__ import annotations
import argparse, io, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import numpy as np
from PIL import Image, ImageDraw
import sys as _sys; _sys.dont_write_bytecode = True   # no .pyc in the skill folder
from _svgkit import Harness, read_svg, rasterize

# No escapes anywhere in these patterns on purpose: this file gets written through several
# layers of quoting, and a lost backslash turns an escaped dot into "any character" silently.
TOKEN = re.compile(r"[A-Za-z]|[-+]?[0-9]*[.]?[0-9]+(?:[eE][-+]?[0-9]+)?")


def attr(chunk: str, name: str):
    """Pull one attribute out of an element's text.

    The preceding character must be whitespace, or the name matches inside another
    attribute: `id="apple-body"` literally contains `d="`, so a naive find() returns the id
    as the path data and the shape parses to zero segments while looking perfectly fine."""
    key = name + '="'
    i = -1
    while True:
        i = chunk.find(key, i + 1)
        if i < 0:
            return None
        if i == 0 or chunk[i - 1] in " \t\r\n":
            j = chunk.find('"', i + len(key))
            return chunk[i + len(key):j] if j > 0 else None


def path_elements(text: str):
    """Every <path>, as (label, d), where the label falls back to the enclosing group's id.

    Worth the extra bookkeeping: exporters put ids on the <g>, not the <path>, so labelling
    by the path alone reports every finding as "(no id)" and you cannot tell which shape has
    the corner -- which is the entire question you came here to answer."""
    out = []
    pos = 0
    group = None
    while True:
        p = text.find("<path", pos)
        g = text.find("<g ", pos)
        if p < 0:
            break
        if 0 <= g < p:                      # a group opens before the next path
            head = text[g:text.find(">", g)]
            group = attr(head, "id") or group
            pos = g + 3
            continue
        end = text.find(">", p)
        head = text[p:end] if end > 0 else text[p:]
        d = attr(head, "d")
        if d:
            out.append((attr(head, "id") or group or "(no id)", d))
        pos = p + 5
    return out


# ---------------------------------------------------------------- corners --
def parse_path(d: str):
    """M C L H V S Q Z, absolute and relative, into a list of (p0,c1,c2,p3) cubics.
    Unknown commands are skipped rather than guessed at."""
    t = TOKEN.findall(d)
    i = 0
    cmd = None
    cur = (0.0, 0.0)
    start = cur
    segs = []
    subs = []
    closed = False

    def flush():
        """Close every subpath, adding the implicit closing edge when the author left one out.

        A FILLED path is closed whether or not it says Z -- the renderer joins the last point
        back to the first and fills that. Skipping the wrap-around join therefore hides the
        corners at a real, visible edge: one brand mark reported max 3.08 degrees and zero
        corners while its letterforms plainly met at sharp points, because every one of them
        sat on the implicit closing segment. Stroked art would want the opposite treatment;
        this tool is for filled artwork."""
        nonlocal segs, closed
        if segs:
            if not closed and cur != start:
                segs.append((cur, cur, start, start))
            subs.append((segs, True))
        segs = []
        closed = False

    def nums(k):
        nonlocal i
        v = [float(x) for x in t[i:i + k]]
        i += k
        return v

    while i < len(t):
        if t[i].isalpha():
            cmd = t[i]
            i += 1
            continue
        if cmd is None:
            i += 1
            continue
        rel = cmd.islower()
        C = cmd.upper()
        ox, oy = cur if rel else (0.0, 0.0)
        if C == "M":
            flush()
            x, y = nums(2)
            cur = (x + ox, y + oy)
            start = cur
            cmd = "l" if rel else "L"
        elif C == "L":
            x, y = nums(2)
            nxt = (x + ox, y + oy)
            segs.append((cur, cur, nxt, nxt))
            cur = nxt
        elif C == "H":
            x, = nums(1)
            nxt = (x + ox, cur[1])
            segs.append((cur, cur, nxt, nxt))
            cur = nxt
        elif C == "V":
            y, = nums(1)
            nxt = (cur[0], y + oy)
            segs.append((cur, cur, nxt, nxt))
            cur = nxt
        elif C in ("C", "S"):
            k = 6 if C == "C" else 4
            v = nums(k)
            if C == "C":
                p1 = (v[0] + ox, v[1] + oy); p2 = (v[2] + ox, v[3] + oy); p3 = (v[4] + ox, v[5] + oy)
            else:
                p1 = cur; p2 = (v[0] + ox, v[1] + oy); p3 = (v[2] + ox, v[3] + oy)
            segs.append((cur, p1, p2, p3))
            cur = p3
        elif C == "Q":
            v = nums(4)
            p1 = (v[0] + ox, v[1] + oy); p3 = (v[2] + ox, v[3] + oy)
            segs.append((cur, p1, p1, p3))
            cur = p3
        elif C == "Z":
            if cur != start:
                segs.append((cur, cur, start, start))
            cur = start
            closed = True
            flush()
        else:
            i += 1
    flush()
    return subs


def bez(seg, t):
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = seg
    u = 1.0 - t
    a, b, c, d = u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t
    return (a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3)


def seg_tangents(seg, eps=0.02):
    """Direction entering the segment's end, and leaving its start, by SAMPLING the curve.

    Reading tangents off the control polygon instead looks equivalent and is not: when a
    control point sits on (or very near) its endpoint the difference vector is tiny and its
    direction is noise. One brand mark is drawn that way throughout, and control-point
    tangents reported max 3 degrees across 49 joins for a logo whose terminals are plainly
    sharp -- every real corner was hidden behind a degenerate handle."""
    p_end = np.array(bez(seg, 1.0)); p_pre = np.array(bez(seg, 1.0 - eps))
    p_beg = np.array(bez(seg, 0.0)); p_nxt = np.array(bez(seg, eps))
    return p_nxt - p_beg, p_end - p_pre          # (outgoing at start, incoming at end)


def corner_angles(subpaths):
    """Angle between one segment's incoming tangent and the next's outgoing tangent.

    Joins are compared only WITHIN a subpath. Treating a whole `d` as one loop links the end
    of one subpath to the start of the next -- two unrelated points -- and invents a corner
    that is not there."""
    out = []
    for segs, closed in subpaths:
        n = len(segs)
        T = [seg_tangents(s) for s in segs]
        joins = range(n) if closed else range(n - 1)
        for i in joins:
            vin = T[i][1]
            vout = T[(i + 1) % n][0]
            na, nb = np.linalg.norm(vin), np.linalg.norm(vout)
            if na < 1e-9 or nb < 1e-9:
                continue
            c = float(np.clip(float(np.dot(vin, vout)) / (na * nb), -1.0, 1.0))
            out.append((float(np.degrees(np.arccos(c))), segs[i][3]))
    return out


CTM_JS = r"""
() => {
  const svg = document.querySelector('#host svg');
  const inv = svg.getScreenCTM().inverse();
  return [...svg.querySelectorAll('path')].map(p => {
    const m = inv.multiply(p.getScreenCTM());
    return [m.a, m.b, m.c, m.d, m.e, m.f];
  });
}
"""


def path_transforms(h, text):
    """Composite transform per <path>, in viewBox units.

    Parsed coordinates are in each path's OWN space -- exporters routinely normalise a
    contour to the origin and carry its placement in a transform, so a raw coordinate can
    be hundreds of units from where the shape actually sits. Reporting an unlocatable
    coordinate makes a real finding useless, and the browser is the only thing that
    resolves nested transforms correctly."""
    pg = h.inline(text)
    try:
        return pg.evaluate(CTM_JS)
    finally:
        pg.close()


def apply_ctm(m, pt):
    a, b, c, d, e, f = m
    return (a * pt[0] + c * pt[1] + e, b * pt[0] + d * pt[1] + f)


def check_corners(text, limit, ctms=None):
    print("CORNERS  tangent continuity at every bezier join")
    worst = 0.0
    for idx, (pid, d) in enumerate(path_elements(text)):
        subs = parse_path(d)
        nseg = sum(len(sp) for sp, _ in subs)
        if nseg < 3:
            continue
        A = corner_angles(subs)
        if not A:
            continue
        arr = np.array([a for a, _ in A])
        sharp = sorted([x for x in A if x[0] > limit], reverse=True)
        worst = max(worst, float(arr.max()))
        flag = "   <-- CORNERS" if sharp else ""
        print(f"  {pid:22} {nseg:4} segs  median {np.median(arr):5.2f}  "
              f"p90 {np.percentile(arr, 90):5.2f}  max {arr.max():6.2f} deg"
              f"  joins>{limit:g}: {len(sharp)}{flag}")
        for a, pt in sharp[:4]:
            if ctms and idx < len(ctms):
                x, y = apply_ctm(ctms[idx], pt)
                where = f"at ({x:.1f},{y:.1f})"
            else:
                where = f"at ({pt[0]:.1f},{pt[1]:.1f}) in this path's OWN units (unmapped)"
            print(f"  {'':22}   {a:6.2f} deg {where}")
    if worst > limit:
        print("  A traced or smoothed outline should be nearly corner-free. Real designs do have\n"
              "  some -- a shackle meeting a body -- so read the coordinates before assuming a bug.\n"
              "  An unintended join this sharp is a visible kink.")
    else:
        print("  No tangent breaks. Note this measures JOINS, not curvature: a terminal drawn as\n"
              "  one very tight arc is visually sharp with perfectly smooth joins (one brand mark\n"
              "  turns up to 89 degrees INSIDE single sub-unit segments). Zero corners here means\n"
              "  'nothing is accidentally kinked', not 'nothing looks sharp'.")
    return worst


# --------------------------------------------------------------- features --
def ink_of(a, thr=160):
    """Ink at roughly the 50% point of an antialiased edge against white.

    "Anything not almost pure white" looks equivalent and is not: it swallows the soft halo
    and inflates a silhouette about 2px per side. Measured on one mark, that rule reported
    590x722 where the real geometry was 586x719. Assumes dark-on-light art; pass --ink-thr
    for anything else."""
    return a[..., 0] < thr


def box(m):
    ys, xs = np.where(m)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def feature_report(mine: Image.Image, ref: Image.Image, thr: int):
    A = np.asarray(mine.convert("RGB")).astype(int)
    B = np.asarray(ref.convert("RGB")).astype(int)
    ia, ib = ink_of(A, thr), ink_of(B, thr)
    ba, bb = box(ia), box(ib)
    wa, ha = ba[2] - ba[0], ba[3] - ba[1]
    wb, hb = bb[2] - bb[0], bb[3] - bb[1]
    print("FEATURES vs reference")
    print(f"  silhouette   mine {wa}x{ha} aspect {wa/ha:.4f}    ref {wb}x{hb} aspect {wb/hb:.4f}"
          f"    aspect delta {100*((wa/ha)/(wb/hb)-1):+.2f}%")
    rows = []
    for f in np.linspace(0.02, 0.98, 49):
        ya, yb = int(ba[1] + f * ha), int(bb[1] + f * hb)
        xa, xb = np.where(ia[ya])[0], np.where(ib[yb])[0]
        if not len(xa) or not len(xb):
            continue
        wA = (xa.max() - xa.min() + 1) / wa * 100
        wB = (xb.max() - xb.min() + 1) / wb * 100
        rows.append((abs(wA - wB), float(f), wA, wB))
    if rows:
        rows.sort(reverse=True)
        print(f"  row widths   mean |delta| {sum(r[0] for r in rows)/len(rows):.2f}% of width."
              f"  Worst rows:")
        for dv, f, wA, wB in rows[:3]:
            print(f"                 {100*f:5.1f}% down:  mine {wA:5.2f}%  ref {wB:5.2f}%   ({dv:.2f})")
    try:
        from scipy import ndimage
        for lab, m, bx, W in (("mine", ia, ba, wa), ("ref ", ib, bb, wb)):
            hole = ndimage.binary_fill_holes(m) & ~m
            L, n = ndimage.label(hole)
            big = [(int((L == i).sum()), i) for i in range(1, n + 1) if (L == i).sum() > 200]
            if not big:
                print(f"  openings     {lab}: none enclosed")
                continue
            _, idx = max(big)
            ys, xs = np.where(L == idx)
            print(f"  openings     {lab}: {len(big)} enclosed; largest spans "
                  f"{(xs.max()-xs.min()+1)/W*100:.2f}% of width, "
                  f"{(ys.max()-ys.min()+1)/(bx[3]-bx[1])*100:.2f}% of height")
    except ImportError:
        pass
    dis = 100.0 * float((ia ^ ib).sum()) / float(ib.sum())
    print(f"  disagreement {dis:.2f}% of the mark's area")
    return dis


# ------------------------------------------------------------------ edges --
def edge_report(img: Image.Image, thr: int, zoom_sheet):
    try:
        import cv2
        from scipy.signal import savgol_filter
    except ImportError:
        print("EDGES    skipped -- needs opencv-python and scipy")
        return
    a = np.asarray(img.convert("RGB")).astype(int)
    m = (ink_of(a, thr) * 255).astype("uint8")
    cs, _ = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    cs = [c[:, 0, :].astype(float) for c in cs if len(c) >= 250]
    print("EDGES    high-frequency wander along each contour (slow design curvature removed)")
    if not cs:
        print("  no contours long enough to score")
        return
    spots = []
    for j, c in enumerate(cs):
        k = min(31, max(5, (len(c) // 8) | 1))
        sm = np.stack([savgol_filter(np.r_[c[-k:, i], c[:, i], c[:k, i]], k, 2)[k:-k]
                       for i in range(2)], axis=1)
        dev = np.hypot(*(c - sm).T)
        print(f"  contour {j}   {len(c):6,} pts   mean {dev.mean():5.3f}px   p99 "
              f"{np.percentile(dev, 99):5.3f}px")
        w = int(np.argmax(dev))
        spots.append((float(dev[w]), (float(c[w][0]), float(c[w][1]))))
    if zoom_sheet and spots:
        spots.sort(reverse=True)
        picks = spots[:4]
        W = 300
        sheet = Image.new("RGB", (len(picks) * (W + 8), W + 22), "white")
        d = ImageDraw.Draw(sheet)
        for i, (v, (x, y)) in enumerate(picks):
            bx = (int(x - W // 2), int(y - W // 2), int(x + W // 2), int(y + W // 2))
            d.text((i * (W + 8) + 4, 4), f"wander {v:.2f}px", fill="black")
            sheet.paste(img.crop(bx), (i * (W + 8) + 4, 18))
        sheet.save(zoom_sheet)
        print(f"  worst spots -> {zoom_sheet}.  LOOK AT IT: a number cannot tell you whether a"
              " bump is a defect or the design.")


# -------------------------------------------------------------------- cli --
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("svg")
    ap.add_argument("--reference", help="raster or SVG of the intended artwork")
    ap.add_argument("--px", type=int, default=1024, help="size for the feature comparison")
    ap.add_argument("--zoom", type=int, default=4000, help="render size for the edge scan")
    ap.add_argument("--zoom-sheet", help="write a magnified sheet of the worst edge spots")
    ap.add_argument("--ink-thr", type=int, default=160, help="red-channel ink cutoff")
    ap.add_argument("--max-corner", type=float, default=10.0, help="report joins sharper than this")
    ap.add_argument("--gate", action="store_true", help="exit 4 if a check fails")
    args = ap.parse_args()

    text = read_svg(args.svg)
    print(f"{args.svg}\n")

    dis = None
    with Harness() as h:
        try:
            ctms = path_transforms(h, text)
        except Exception:
            ctms = None
        worst = check_corners(text, args.max_corner, ctms)
        print()
        big = Image.open(io.BytesIO(rasterize(h, text, args.zoom, "#ffffff"))).convert("RGB")
        edge_report(big, args.ink_thr, args.zoom_sheet)
        if args.reference:
            print()
            small = Image.open(io.BytesIO(rasterize(h, text, args.px, "#ffffff"))).convert("RGB")
            rp = Path(args.reference)
            if rp.suffix.lower() == ".svg":
                ref = Image.open(io.BytesIO(rasterize(h, read_svg(rp), args.px, "#ffffff")))
            else:
                ref = Image.open(rp).convert("RGB").resize((args.px, args.px), Image.LANCZOS)
            dis = feature_report(small, ref.convert("RGB"), args.ink_thr)

    print("\nNone of this replaces looking at the render. It exists because one fidelity number\n"
          "stayed inside MATCH through four real defects.")
    if args.gate and (worst > args.max_corner or (dis is not None and dis > 3.0)):
        sys.exit(4)


if __name__ == "__main__":
    main()
