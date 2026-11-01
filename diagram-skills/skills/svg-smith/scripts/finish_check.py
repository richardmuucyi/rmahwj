#!/usr/bin/env python3
"""finish_check.py - flag the signs that make a dense scene read as student work (Lane C, Lens 10).

    python finish_check.py scene.svg [more.svg ...] [--route flat|lines|painting] [--json]

It reads the SVG text only (no browser) and counts five things a tester's critics named on a real
scene. Each is a rule from references/dense-scenes.md Lens 10. The rules hold for the FLAT route
(flat planes in a few tones: the toolkit's default finish, the 1.3 isometric truck, the 1.2
geometric lion). Two other routes use on purpose what the flat route forbids: LINE ART carries form
in fine strokes (the 1.3 machine lineart: 32% hairlines), and LAYERED PAINTING stacks translucent
shadows and blur (the 1.0 and 1.3 castle screens). `--route lines` and `--route painting` check only
the three things that are wrong in any style: the toolkit's airbrush overlays, isolated blends and
clip-g.

  airbrush     faces painted with the toolkit's soft overlays (paintLight / paintAO / paintSheen).
               The flat finish has none.
  alpha-shadow dark shapes (luminance < 70) made see-through with opacity < .6 and no blend mode:
               a grey smudge where a crisp multiply shadow belongs.
  hairline     unfilled strokes thinner than 1 px (roof ribs, tile grids, facet edges, dashes), as a
               share of all drawn shapes. Lines carry the detail where planes should.
  blur         shapes that use a filter with feGaussianBlur (airbrushed clouds and mist).
  dashes       dashed strokes (stroke-dasharray): on a waterfall or a road they read as road markings;
               two critics in two scenes flagged them. Moving water is a repeating gradient.
  isolated     a mix-blend-mode shape (a multiply shadow) inside a group that has a clip-path, mask,
               filter or opacity: that group is isolated, the blend has nothing beneath it to darken,
               and the shadow paints as flat pale paint (tested in Chromium: (156,156,178) where the
               same shadow outside the group gives (137,117,67)). Clip the shape itself instead
               (Iso.cast_shadow(clip=...)), or move the shadow out of the group.
  clip-g       a <clipPath> in use whose shapes sit inside <g>: a browser clips everything away, so
               the clipped art draws nothing (tested in Chromium; Inkscape still draws it, so even
               contest files carry this defect).

Limits come from files measured when this was written (the table in Lens 10): on the flat route
the student scene fails, and the designer pass and a flat contest reference (the 1.3 isometric
truck) pass. A pass is not a verdict on taste:
it says the cheap tells are gone, and the critic step and the owner's eye still decide.
Exit code 1 if any file fails.
"""
from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

SVG = "{http://www.w3.org/2000/svg}"
DRAWN = {"path", "polygon", "polyline", "line", "rect", "circle", "ellipse"}
LIMITS = {"airbrush": 0, "alpha-shadow": .01, "hairline": .15, "blur": 2, "dashes": 0, "isolated": 0, "clip-g": 0}   # alpha-shadow, hairline: share of drawn shapes
PAINTING = ("airbrush", "isolated", "clip-g")


def lum(col: str) -> float | None:
    col = col.strip().lower()
    m = re.fullmatch(r"#([0-9a-f]{3}|[0-9a-f]{6})", col)
    if not m:
        return None
    h = m.group(1)
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return .2126 * r + .7152 * g + .0722 * b


def style_map(el) -> dict:
    d = dict(el.attrib)
    for part in el.attrib.get("style", "").split(";"):
        if ":" in part:
            k, v = part.split(":", 1)
            d[k.strip()] = v.strip()
    return d


def num(v, default=1.0):
    try:
        return float(str(v).replace("px", ""))
    except (TypeError, ValueError):
        return default


def check(path: Path, route: str = "flat") -> dict:
    text = path.read_text(encoding="utf-8")
    root = ET.fromstring(text)
    blur_ids = {f.get("id") for f in root.iter(SVG + "filter") if f.find(f".//{SVG}feGaussianBlur") is not None}
    counts = {k: 0 for k in LIMITS}
    drawn = 0
    parent = {c: p for p in root.iter() for c in p}

    def isolating(g):
        a = style_map(g)
        return (any(a.get(k, "none") not in ("none", "") for k in ("clip-path", "mask", "filter"))
                or num(a.get("opacity"), 1) < 1 or a.get("isolation") == "isolate")
    for el in root.iter():
        tag = el.tag.replace(SVG, "")
        if tag == "clipPath" and el.find(SVG + "g") is not None and f"url(#{el.get('id')})" in text:
            if not any(c.tag.replace(SVG, "") in DRAWN | {"use", "text"} for c in el):
                counts["clip-g"] += 1
        if tag not in DRAWN and tag != "g":
            continue
        a = style_map(el)
        fil = a.get("filter", "")
        m = re.search(r"url\(#([^)]+)\)", fil)
        if m and m.group(1) in blur_ids:
            counts["blur"] += 1
        if tag not in DRAWN:
            continue
        drawn += 1
        fill = a.get("fill", "")
        if re.search(r"url\(#(paintLight|paintAO|paintSheen)\)", fill):
            counts["airbrush"] += 1
        op = num(a.get("opacity"), 1) * num(a.get("fill-opacity"), 1)
        L = lum(fill)
        if L is not None and L < 70 and op < .6 and "mix-blend-mode" not in a:
            counts["alpha-shadow"] += 1
        else:                           # a see-through dark LINE (strata, cracks at opacity .5) is the same tell
            sop = num(a.get("opacity"), 1) * num(a.get("stroke-opacity"), 1)
            Ls = lum(a.get("stroke", ""))
            if Ls is not None and Ls < 70 and sop < .6 and "mix-blend-mode" not in a:
                counts["alpha-shadow"] += 1
        if a.get("mix-blend-mode", "normal") != "normal":
            q = parent.get(el)
            while q is not None and q is not root:
                if isolating(q):
                    counts["isolated"] += 1
                    break
                q = parent.get(q)
        if a.get("stroke-dasharray", "none") not in ("none", "0", ""):
            counts["dashes"] += 1
        stroke = a.get("stroke", "none")
        if stroke not in ("none", "") and (tag in ("line", "polyline") or fill == "none"):
            if num(a.get("stroke-width"), 1) < 1.0:
                counts["hairline"] += 1
    res = {"file": path.name, "drawn": drawn, **counts,
           "hairline": round(counts["hairline"] / max(drawn, 1), 3),
           "alpha-shadow": round(counts["alpha-shadow"] / max(drawn, 1), 4)}
    keys = LIMITS if route == "flat" else PAINTING      # lines, painting
    res["fails"] = [k for k in keys if res[k] > LIMITS[k]]
    return res


def main():
    argv = sys.argv[1:]
    route = "flat"
    if "--route" in argv:
        route = argv[argv.index("--route") + 1]
        argv = [a for i, a in enumerate(argv) if a != "--route" and (i == 0 or argv[i - 1] != "--route")]
    args = [a for a in argv if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 2
    rows = [check(Path(a), route) for a in args]
    if "--json" in sys.argv:
        print(json.dumps(rows, indent=2))
    else:
        cols = ["drawn", "airbrush", "alpha-shadow", "hairline", "blur", "dashes", "isolated", "clip-g"]
        print(f"route: {route}" + ("" if route == "flat" else " (checks airbrush and clip-g only)"))
        print(f"{'file':40s}" + "".join(f"{c:>13s}" for c in cols) + "  verdict")
        print(f"{'limit':40s}{'':>13s}" + "".join(f"{('<=' + str(LIMITS[c])):>13s}" for c in cols[1:]))
        for r in rows:
            print(f"{r['file'][:40]:40s}" + "".join(f"{r[c]:>13}" for c in cols)
                  + ("  PASS" if not r["fails"] else "  FAIL: " + ", ".join(r["fails"])))
    return 1 if any(r["fails"] for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
