#!/usr/bin/env python3
"""Tell me what this SVG actually IS before I trust it.

Answers the questions that have burned us: is it really vector, or a clipPath over
a JPEG? Does it depend on a font? What is the artwork bbox (not the viewBox)? Which
ids or classes would collide if I inline it next to another file? Is the figure a HOLE,
so the ground shows through and the mark inverts on dark?

With --set it also compares the files to EACH OTHER -- optical size, grid, stroke weight,
palette. A family of marks fails in the relationships between its members, and no
per-file check can see that.

    python svg_probe.py logo.svg [more.svg ...] [--json]
    python svg_probe.py icons/*.svg --set
"""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import sys as _sys; _sys.dont_write_bytecode = True   # no .pyc in the skill folder
from _svgkit import Harness, read_svg, measure, rasterize

# Exporter-default id names only. An earlier version listed bare "a"/"b"/"g" as prefixes,
# which matched nearly every hand-written id and turned this warning into pure noise.
GENERIC = re.compile(
    r"^(paint\d+\w*|clip\d+\w*|clipPath\d*|clippath(-\d+)?|mask\d+\w*|filter\d+\w*|"
    r"gradient\d*|linearGradient\d*|radialGradient\d*|path\d+|Layer_?\d*|SVGID\w*|"
    r"[a-zA-Z])$")

# Exporter-default CLASS names. Classes matter more than ids and were missed for a
# while: a class lives in the GLOBAL stylesheet, so two logos that both ship
# Illustrator's default .cls-1 overwrite each other outright. Measured on two real
# delivered files -- inlined together, SAP lost its gradient and took Postman's orange.
GENERIC_CLASS = re.compile(
    r"^(cls-?\d+|st\d+|fil\d+|str\d+|s\d+|c\d+|[a-z])$", re.I)


def knockout_stats(h, text, px=320):
    """Is the figure a HOLE in a filled shape, rather than a shape of its own?

    It matters because a knockout has no colour: the ground shows through it. The same file
    reads as a white bird on a teal disc over white, and inverts to a dark bird over black.
    Nothing else in the harness reports this, and it shipped once before it was noticed.

    Line icons are enclosed too -- the inside of a drawn box is a hole -- and for them
    showing the ground is the entire point, so ink coverage is the discriminator: a filled
    mark with a figure cut out of it covers a lot of its box, an outline drawing does not.
    """
    try:
        from scipy import ndimage
        import numpy as np
        from PIL import Image
        import io as _io
    except ImportError:
        return None

    # Render on two grounds and see what CHANGES. Counting enclosed holes geometrically
    # cannot tell "white because an opaque plate is there" from "white because the page is
    # showing through" -- the first version of this check flagged a mark whose whole point
    # was that it had been given a plate. What differs between the two renders is exactly
    # what the ground controls, which is the question being asked.
    def shot(bg):
        return np.asarray(Image.open(_io.BytesIO(rasterize(h, text, px, bg))).convert("RGB")).astype(int)
    on_w, on_k = shot("#ffffff"), shot("#000000")
    opaque = np.abs(on_w - on_k).sum(axis=2) < 24        # pixel unaffected by the ground
    if not opaque.any():
        return None
    ys, xs = np.where(opaque)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    boxarea = max(1, (x1 - x0 + 1) * (y1 - y0 + 1))
    # ENCLOSED and ground-dependent, not merely ground-dependent. Every non-rectangular
    # shape leaves transparent corners inside its own bounding box; counting those flagged
    # a plain solid glyph with no holes at all as a 30% knockout.
    show_through = ndimage.binary_fill_holes(opaque) & ~opaque
    show_through = show_through[y0:y1 + 1, x0:x1 + 1]
    lab, n = ndimage.label(show_through)
    sizes = [int((lab == i).sum()) for i in range(1, n + 1)]
    sizes = [s for s in sizes if s > boxarea * 0.004]
    return {"coverage": opaque.sum() / boxarea,
            "holes": len(sizes),
            "largest": (max(sizes) / boxarea) if sizes else 0.0,
            "total": (sum(sizes) / boxarea) if sizes else 0.0}


def probe_one(h, path):
    text = read_svg(path)
    m = measure(h, text)
    if m.get("error"):
        return {"file": str(path), "error": m["error"]}
    m["file"] = str(path)
    m["bytes"] = len(text.encode("utf-8"))
    m["currentColor"] = text.count("currentColor")
    m["strokeWidths"] = sorted({float(v) for v in
                                re.findall(r'stroke-width[:="\s]+([0-9.]+)', text)})
    m["fills"] = sorted({c.lower() for c in re.findall(r'#[0-9a-fA-F]{6}', text)})
    warn = []
    if m["images"]:
        kinds = ", ".join(sorted({i["kind"] for i in m["images"]}))
        warn.append(f"NOT PURE VECTOR: contains {len(m['images'])} <image> ({kinds}). "
                    "Colour/detail is raster and will not scale crisply.")
    if m["texts"]:
        warn.append(f"FONT DEPENDENCY: {len(m['texts'])} <text> element(s). Renders differently "
                    "wherever the font is missing. Convert to outlines for a portable asset.")
    if not m["viewBox"]:
        warn.append("NO viewBox: the file cannot scale responsively - width/height are fixed "
                    "pixels. Add one before shipping (svg_place.py sets it for you).")
    if m["currentColor"]:
        warn.append("Uses currentColor: colour is inherited, so standalone it falls back to black. "
                    "Pin it explicitly or document how to set it.")
    generic = [i for i in m["ids"] if GENERIC.match(i)]
    if generic:
        warn.append(f"ID COLLISION RISK: {len(generic)} generic id(s) e.g. {generic[:4]}. "
                    "Namespace them before inlining beside another SVG.")
    gcls = [c for c in m.get("classes", []) if GENERIC_CLASS.match(c)]
    if gcls and m.get("styleBlocks"):
        warn.append(f"CLASS COLLISION RISK: {len(gcls)} exporter-default class name(s) "
                    f"e.g. {gcls[:4]} used by a <style> block. CSS is scoped to the DOCUMENT, "
                    "not to this <svg>, so another file declaring the same name silently "
                    "restyles this one - whichever <style> parses last wins. "
                    "svg_place.py --namespace renames these too.")
    if m["artwork"] and m["viewBox"]:
        try:
            vb = [float(v) for v in m["viewBox"].replace(",", " ").split()]
            a = m["artwork"]
            if a["w"] > vb[2] + 0.5 or a["h"] > vb[3] + 0.5:
                how = ("relies on clipping to crop it back" if m["clipPaths"] or m["masks"]
                       else "will be CUT OFF - the canvas is too small")
                warn.append(f"ARTWORK EXCEEDS viewBox: art {a['w']:.1f}x{a['h']:.1f} "
                            f"vs viewBox {vb[2]:.1f}x{vb[3]:.1f}; {how}.")
        except Exception:
            pass
    m["knockout"] = knockout_stats(h, text)
    k = m["knockout"]
    # 0.45 separates a FILLED mark with a figure cut out of it (measured 68-80% coverage)
    # from an outline drawing, whose interior is also enclosed and ground-dependent but
    # where showing the ground is the point (measured 36-39%). The trade is real: a mark
    # more than half knocked away would slip under it.
    if k and k["holes"] and k["coverage"] > 0.45 and k["largest"] > 0.03:
        warn.append(f"KNOCKOUT: the figure is a HOLE, not a shape - {k['holes']} enclosed "
                    f"region(s), largest {100*k['largest']:.0f}% of the artwork box, in a mark "
                    f"covering {100*k['coverage']:.0f}% of it. The ground shows through, so this "
                    f"inverts on a dark background. Ship an opaque-plate variant, or say "
                    f"light-ground-only on delivery.")
    m["warnings"] = warn
    return m


def set_report(results):
    """Compare files AS A SET.

    Every other tool here measures one file. But a family of marks fails in the relationships
    BETWEEN its members, and those are invisible one file at a time: four icons each probed
    clean while their artwork ranged 29 to 44 units, which reads as a mistake the moment they
    sit in a row. Found by eye, once. This is that comparison, made cheap."""
    ok = [m for m in results if not m.get("error") and m.get("artwork")]
    if len(ok) < 2:
        return ""
    L = ["", "=== SET CONSISTENCY ==="]
    ws = [m["artwork"]["w"] for m in ok]
    hs = [m["artwork"]["h"] for m in ok]
    dom = [max(w, h) for w, h in zip(ws, hs)]
    spread = max(dom) / max(1e-9, min(dom))
    worst = max(ok, key=lambda m: max(m["artwork"]["w"], m["artwork"]["h"]))
    least = min(ok, key=lambda m: max(m["artwork"]["w"], m["artwork"]["h"]))
    L.append(f"  optical size   largest dimension {min(dom):.1f} .. {max(dom):.1f}  "
             f"(spread {spread:.2f}x)")
    if spread > 1.15:
        L.append(f"  !! SIZE MISMATCH: {Path(least['file']).name} is {100*(1-1/spread):.0f}% smaller "
                 f"than {Path(worst['file']).name}. In a set the eye compares members to each "
                 f"other, so a difference that looks fine alone reads as an error in a row. "
                 f"Match optical weight, not bounding boxes.")
    vbs = {m["viewBox"] for m in ok}
    L.append(f"  viewBox        {'all ' + list(vbs)[0] if len(vbs) == 1 else str(len(vbs)) + ' different: ' + ', '.join(sorted(vbs)[:4])}")
    if len(vbs) > 1:
        L.append("  !! MIXED GRIDS: members drawn on different canvases will not align or scale "
                 "together. Put the whole set on one grid.")
    sw = sorted({w for m in ok for w in m.get("strokeWidths", [])})
    if sw:
        L.append(f"  stroke widths  {sw}")
        if len(sw) > 1:
            L.append("  !! MIXED STROKE WEIGHTS: the fastest way for a set to look unrelated.")
    pal = sorted({c for m in ok for c in m.get("fills", [])})
    if pal:
        L.append(f"  palette        {len(pal)} colour(s): {pal[:8]}")
    return chr(10).join(L)


def render_text(m):
    if m.get("error"):
        return f"{m['file']}: ERROR {m['error']}"
    a = m["artwork"] or {}
    L = [
        f"{m['file']}  ({m['bytes']:,} bytes)",
        f"  viewBox   {m['viewBox']}   width={m['width']} height={m['height']}",
        f"  artwork   x={a.get('x')} y={a.get('y')} w={a.get('w')} h={a.get('h')}   aspect={m['aspect']}",
        f"  elements  {m['elementCount']} rendered | gradients {m['gradients']} | "
        f"clipPaths {m['clipPaths']} | masks {m['masks']} | filters {m['filters']}",
    ]
    if m["texts"]:
        for t in m["texts"][:4]:
            L.append(f"  <text>    {t['content']!r}  font={t['fontFamily'][:60]}")
    if m["images"]:
        for im in m["images"][:4]:
            L.append(f"  <image>   {im['kind']}  ~{im['bytes']:,} bytes of href")
    if m["elementCount"] <= 14:
        for e in m["elements"]:
            L.append(f"    [{e['i']:>2}] {e['tag']:<8} id={str(e['id']):<22} fill={str(e['fill'])[:20]:<20} "
                     f"{e['w']:.2f}x{e['h']:.2f} @({e['x']:.2f},{e['y']:.2f})")
    for w in m["warnings"]:
        L.append(f"  !! {w}")
    if not m["warnings"]:
        L.append("  ok: pure vector, no font dependency, no obvious id or class hazards")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of the readable report")
    ap.add_argument("--set", action="store_true", dest="as_set",
                    help="also compare the files AS A SET - optical size, grid, stroke weight, palette")
    args = ap.parse_args()
    with Harness() as h:
        out = [probe_one(h, f) for f in args.files]
    if args.json:
        print(json.dumps(out, indent=2))
    else:
        print("\n\n".join(render_text(m) for m in out))
        if args.as_set:
            print(set_report(out))


if __name__ == "__main__":
    main()
