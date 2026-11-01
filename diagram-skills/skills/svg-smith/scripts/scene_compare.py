#!/usr/bin/env python3
"""scene_compare.py - the side-by-side and the zoom crops that Lane C reviews are judged on.

    python scene_compare.py sheet OUT.png "LABEL=file.svg" "LABEL=file.svg" ... [--px 900]
    python scene_compare.py crops file.svg OUT_PREFIX x0,y0,x1,y1 [...] [--px 1800]
    python scene_compare.py measure file.svg [group-id,group-id,...] [--strips 8]

sheet  renders each SVG, trims the white letterbox, scales all to one height and lays them out left
       to right under their labels: reference | before | now.
crops  renders one SVG square at --px and saves OUT_PREFIX_full.png plus OUT_PREFIX_cropN.png for
       each box, given as fractions of the square render (0..1). A non-square scene is letterboxed
       inside the square: a 1200x1000 scene spans y 0.083..0.917.
       For before/now crops, run it twice with the same boxes. With no boxes it saves only the full render.
measure  the three review numbers the lenses ask for (Lens 2, 3, 9):
       strips   transitions/row per horizontal band (the svg_quality rule: 400 px, light = R,G,B > 170),
                top to bottom, so a thin band (a dark sky, a cloud sea) shows where to work;
       fill     the union of getBBox() over the named subject groups, as a share of the frame
                (the subject = the hero plus everything joined to it, Lens 3);
       alive    pixels that change between two screenshots 1.5 s apart (0 = the animation is dead).
All render in the same browser harness as svg_render.py. Write outputs outside the skill folder.
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _svgkit import Harness, rasterize, data_uri  # noqa: E402
import re  # noqa: E402
from PIL import Image, ImageChops, ImageDraw  # noqa: E402


def _opt(argv, name, default):
    if name in argv:
        i = argv.index(name)
        val = argv[i + 1]
        del argv[i:i + 2]
        return int(val)
    return default


def render(h, path, px):
    return Image.open(io.BytesIO(rasterize(h, Path(path).read_text(encoding="utf-8"), px, "#ffffff"))).convert("RGB")


def sheet(argv):
    px = _opt(argv, "--px", 900)
    out, pairs = argv[0], [a.rsplit("=", 1) for a in argv[1:]]     # the last "=" splits, so labels may hold "="
    ims = []
    with Harness() as h:
        for label, path in pairs:
            im = render(h, path, px)
            bb = ImageChops.invert(im).getbbox()
            ims.append((label, im.crop(bb) if bb else im))
    H = max(i.size[1] for _, i in ims)
    ims = [(l, i.resize((int(i.size[0] * H / i.size[1]), H))) for l, i in ims]
    W = sum(i.size[0] for _, i in ims) + 20 * (len(ims) + 1)
    sh = Image.new("RGB", (W, H + 60), "white")
    d, x = ImageDraw.Draw(sh), 20
    for l, i in ims:
        sh.paste(i, (x, 45))
        d.text((x, 15), l, fill="black")
        x += i.size[0] + 20
    sh.save(out)
    print(f"wrote {out} {sh.size}")


def crops(argv):
    px = _opt(argv, "--px", 1800)
    src, prefix = argv[0], argv[1]
    boxes = [tuple(map(float, b.split(","))) for b in argv[2:]]
    with Harness() as h:
        im = render(h, src, px)
    im.save(f"{prefix}_full.png")
    for i, (x0, y0, x1, y1) in enumerate(boxes):
        W, H = im.size
        im.crop((int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H))).save(f"{prefix}_crop{i}.png")
    print(f"wrote {prefix}_full.png and {len(boxes)} crops")


def measure(argv):
    n = _opt(argv, "--strips", 8)
    svg = Path(argv[0]).read_text(encoding="utf-8")
    groups = argv[1].split(",") if len(argv) > 1 else []
    m = re.search(r'viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)', svg)
    W, H = (float(m.group(1)), float(m.group(2))) if m else (1200.0, 1000.0)
    with Harness() as h:
        im = render(h, argv[0], 400)
        p = im.load()
        side = 400
        if W >= H:
            top, bot = int(side * (1 - H / W) / 2), int(side - side * (1 - H / W) / 2)
        else:
            top, bot = 0, side
        rows = list(range(top, bot))
        vals = []
        for k in range(n):
            band = rows[len(rows) * k // n: len(rows) * (k + 1) // n]
            tr = []
            for y in band:
                row = [all(c > 170 for c in p[x, y]) for x in range(side)]
                tr.append(sum(1 for i in range(1, len(row)) if row[i] != row[i - 1]))
            vals.append(sum(tr) / max(len(tr), 1))
        print("strips (transitions/row, top to bottom):", " ".join(f"{v:.1f}" for v in vals))
        if groups:
            pg = h.inline(svg)
            r = pg.evaluate("""(ids) => { let X0=1e9,Y0=1e9,X1=-1e9,Y1=-1e9; const got=[];
                for (const id of ids) { const g=document.getElementById(id); if(!g) continue; const b=g.getBBox(); got.push(id);
                  X0=Math.min(X0,b.x);Y0=Math.min(Y0,b.y);X1=Math.max(X1,b.x+b.width);Y1=Math.max(Y1,b.y+b.height);}
                return {got, X0, Y0, X1, Y1}; }""", groups)
            pg.close()
            if r["got"]:
                x0, y0, x1, y1 = max(0, r["X0"]), max(0, r["Y0"]), min(W, r["X1"]), min(H, r["Y1"])
                print(f"fill: subject box {x0:.0f},{y0:.0f}-{x1:.0f},{y1:.0f} = {100 * (x1 - x0) * (y1 - y0) / (W * H):.0f}% of the frame "
                      f"({len(r['got'])}/{len(groups)} groups found)")
            else:
                print("fill: none of the named groups exist")
        pg = h.page(int(W), int(H))
        pg.set_content(f"<body style='margin:0'><img style='display:block' src='{data_uri(svg)}' width={int(W)} height={int(H)}></body>")
        pg.wait_for_timeout(800)
        a = Image.open(io.BytesIO(pg.screenshot(type="png"))).convert("L")
        pg.wait_for_timeout(1500)
        b = Image.open(io.BytesIO(pg.screenshot(type="png"))).convert("L")
        pg.close()
        changed = ImageChops.difference(a, b).point(lambda v: 255 if v > 8 else 0).histogram()[255]
        print(f"alive: {changed} pixels changed over 1.5 s" + ("  (DEAD: no animation runs)" if changed == 0 else ""))


if __name__ == "__main__":
    cmds = {"sheet": sheet, "crops": crops, "measure": measure}
    if len(sys.argv) < 3 or sys.argv[1] not in cmds:
        print(__doc__)
        sys.exit(2)
    cmds[sys.argv[1]](sys.argv[2:])
