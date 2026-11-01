#!/usr/bin/env python3
"""Render SVGs to a labelled contact sheet so a human (or you) can LOOK at them.

Looking is not optional. Every failure worth catching in this workflow -- a mark
that is the wrong logo entirely, a white wordmark invisible on white, a shape that
collapses at 48px -- was invisible in the XML and obvious in a render.

    python svg_render.py mark.svg --sizes 512,128,48 --bg light,dark --out sheet.png
    python svg_render.py mine.svg official.svg --sizes 400 --out compare.png
"""
from __future__ import annotations
import argparse, io, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import sys as _sys; _sys.dont_write_bytecode = True   # no .pyc in the skill folder
from _svgkit import Harness, read_svg, rasterize, rasterize_inline, resolve_bg

from PIL import Image, ImageDraw


def label_height(px):
    return 18 if px >= 96 else 14


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+")
    ap.add_argument("--sizes", default="512,128,48", help="comma-separated px sizes (default 512,128,48)")
    ap.add_argument("--bg", default="light,dark", help="comma-separated: light,dark,mid or #hex")
    ap.add_argument("--scheme", default="",
                    help="emulate OS colour scheme: light | dark | light,dark. Painting a dark "
                         "--bg does NOT fire prefers-color-scheme; use this for self-theming SVGs.")
    ap.add_argument("--magnify", type=int, default=1, metavar="N",
                    help="upscale tiles under 128px by N with nearest-neighbour, so the actual "
                         "pixel grid is visible. At 16px every candidate looks like the same "
                         "smudge until you magnify it.")
    ap.add_argument("--out", default="svg-contact-sheet.png")
    ap.add_argument("--gap", type=int, default=14)
    ap.add_argument("--inline", action="store_true",
                    help="render the SVG inline in the DOM instead of via <img>. Required to "
                         "test fill=\"currentColor\": an SVG inside <img> inherits nothing, so "
                         "the <img> path always shows it as black and cannot prove a recolour.")
    ap.add_argument("--color", default="#111111",
                    help="the inherited colour to use with --inline (default #111111)")
    args = ap.parse_args()

    sizes = [int(s) for s in args.sizes.split(",") if s.strip()]
    bgs = [b.strip() for b in args.bg.split(",") if b.strip()]
    schemes = [x.strip() for x in args.scheme.split(",") if x.strip()] or [None]
    files = [Path(f) for f in args.files]
    mag = max(1, args.magnify)

    tiles, disp = {}, {}
    with Harness() as h:
        for f in files:
            text = read_svg(f)
            for bg in bgs:
                for sch in schemes:
                    for px in sizes:
                        png = (rasterize_inline(h, text, px, resolve_bg(bg), args.color, sch)
                               if args.inline else
                               rasterize(h, text, px, resolve_bg(bg), scheme=sch))
                        im = Image.open(io.BytesIO(png)).convert("RGB")
                        tiles[(f, bg, sch, px)] = im
                        if mag > 1 and px < 128:
                            disp[(f, bg, sch, px)] = im.resize((px*mag, px*mag), Image.NEAREST)
                        else:
                            disp[(f, bg, sch, px)] = im

    gap = args.gap
    dw = lambda px: px*mag if (mag > 1 and px < 128) else px
    rows = [(f, bg, sch) for f in files for bg in bgs for sch in schemes]
    tallest = max(dw(px) for px in sizes)
    sheet_w = sum(dw(px) + gap for px in sizes) + gap + 240
    sheet_h = len(rows) * (tallest + label_height(tallest) + 6 + gap) + gap
    sheet = Image.new("RGB", (sheet_w, sheet_h), "#f0f0f0")
    d = ImageDraw.Draw(sheet)

    y = gap
    for (f, bg, sch) in rows:
        d.text((8, y + 6), f"{f.name}", fill="#111")
        d.text((8, y + 20), f"on {bg}" + (f"  scheme:{sch}" if sch else ""), fill="#666")
        x = 240
        for px in sizes:
            t = disp[(f, bg, sch, px)]
            sheet.paste(t, (x, y))
            d.rectangle([x, y, x + t.size[0] - 1, y + t.size[1] - 1], outline="#bbb")
            tag = f"{px}px" + (f" x{mag}" if t.size[0] != px else "")
            d.text((x, y + t.size[1] + 2), tag, fill="#444")
            x += dw(px) + gap
        y += tallest + label_height(tallest) + 6 + gap

    sheet.save(args.out)
    print(f"contact sheet -> {args.out}  ({sheet_w}x{sheet_h}, {len(rows)} row(s) x {len(sizes)} size"
          + (f", magnified x{mag}" if mag > 1 else "") + ")")
    print("LOOK AT IT before delivering. Check: right artwork? legible at the smallest size? "
          "visible on every background you claim to support?")


if __name__ == "__main__":
    main()
