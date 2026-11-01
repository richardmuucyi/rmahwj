#!/usr/bin/env python3
"""Trace a raster into vector -- the last resort, with the honesty built in.

Use this ONLY when the artwork genuinely was never published as vector: a defunct
brand, a scan, someone's own sketch, a screenshot of something dead. If a vendor
publishes the real thing, tracing throws away their actual curves to reproduce a lossy
photograph of them, and the result will be subtly wrong forever. Check first.

A trace is a guess, so this measures how good a guess it is: it renders the result back
and compares it to the source raster, and reports the residual alongside the path count
so you can see the fidelity/complexity trade instead of asserting a good result.

    python svg_trace.py sketch.png --out mark.svg
    python svg_trace.py logo.png --out mark.svg --mono          # flat single-colour art
    python svg_trace.py logo.png --out mark.svg --colors 6 --smooth 60
"""
from __future__ import annotations
import argparse, io, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

try:
    import vtracer
except ImportError:
    sys.exit("vtracer is not installed.  pip install vtracer")
from PIL import Image


def flatten(src: Path, bg=(255, 255, 255)) -> Path:
    """Composite alpha onto a solid ground. Tracing an RGBA image otherwise turns the
    transparent region into a giant filled shape."""
    im = Image.open(src)
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
        plate = Image.new("RGB", im.size, bg)
        plate.paste(im, mask=im.split()[-1])
        im = plate
    else:
        im = im.convert("RGB")
    tmp = Path(tempfile.mkdtemp()) / "flat.png"
    im.save(tmp)
    return tmp


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src"); ap.add_argument("--out", required=True)
    ap.add_argument("--mono", action="store_true",
                    help="flat single-colour artwork (a stamp, a silhouette, line art)")
    ap.add_argument("--colors", type=int, default=8,
                    help="colour precision for colour tracing; lower = fewer, flatter regions")
    ap.add_argument("--smooth", type=int, default=60,
                    help="corner threshold in degrees; higher = smoother, fewer corners")
    ap.add_argument("--speckle", type=int, default=2,
                    help="discard blobs smaller than this many pixels. Raise it ONLY to kill scan "
                         "noise, and look at the result: this filter cannot tell noise from small "
                         "deliberate detail. At 12 it silently deleted an entire face - eyes, "
                         "brows, nose, mouth - from a logo, and the trace still reported a good "
                         "fidelity score because the face was a tiny fraction of the pixels.")
    ap.add_argument("--bg", default="255,255,255",
                    help="ground to composite transparency onto, as R,G,B")
    ap.add_argument("--smooth-mask", type=float, default=0.0, metavar="SIGMA",
                    help="blur the binary mask and re-threshold at 0.5 before tracing "
                         "(mono only). The staircase left by a pixel boundary is "
                         "high-frequency noise around the true contour, and a symmetric "
                         "blur cancels it while leaving the curve where it was. Try 3-6 at "
                         "1-2k px. On one mark this cut the file from 68KB to 14KB AND "
                         "improved fidelity -- when removing data does both, it was noise.")
    args = ap.parse_args()

    src = Path(args.src)
    if not src.exists():
        sys.exit(f"{src}: not found")
    bg = tuple(int(v) for v in args.bg.split(","))
    flat = flatten(src, bg)
    w, h = Image.open(flat).size
    print(f"source            {src.name}  {w}x{h}")

    if args.smooth_mask > 0:
        if not args.mono:
            print("smoothing         skipped: --smooth-mask needs --mono (it works on one mask)")
        else:
            import numpy as np
            try:
                from scipy import ndimage
            except ImportError:
                sys.exit("--smooth-mask needs scipy.  pip install scipy")
            a = np.asarray(Image.open(flat).convert("L")).astype(np.float32)
            m = a < 128
            # Threshold at exactly 0.5 so the boundary does not creep in or out; anything
            # else dilates or erodes the whole shape while claiming to smooth it.
            sm = ndimage.gaussian_filter(m.astype(np.float32), args.smooth_mask) >= 0.5
            moved = int((m ^ sm).sum())
            flat = flat.parent / "smoothed.png"
            Image.fromarray(np.where(sm, 0, 255).astype("uint8")).convert("RGB").save(flat)
            print(f"smoothing         sigma {args.smooth_mask:g}: {moved:,} px reassigned "
                  f"({100.0*moved/m.size:.3f}% of the image)")

    vtracer.convert_image_to_svg_py(
        str(flat), args.out,
        colormode="binary" if args.mono else "color",
        mode="spline",
        filter_speckle=args.speckle,
        color_precision=args.colors,
        corner_threshold=args.smooth,
        path_precision=2,
    )

    text = Path(args.out).read_text(encoding="utf-8")
    paths = text.count("<path")
    # vtracer omits a viewBox; without one the file cannot scale responsively.
    # Check the <svg> element itself -- vtracer emits an XML declaration first, so
    # text.split(">")[0] would inspect that and always report the attribute missing.
    import sys as _sys; _sys.dont_write_bytecode = True   # no .pyc in the skill folder
    from _svgkit import ensure_root_attr
    text = ensure_root_attr(text, "viewBox", f"0 0 {w} {h}")
    text = text.replace('width="', 'data-src-width="', 1).replace('height="', 'data-src-height="', 1)
    text = text.replace("<svg ", '<svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet" ', 1)
    Path(args.out).write_text(text, encoding="utf-8", newline="\n")
    print(f"traced            {paths} paths, {len(text.encode()):,} bytes -> {args.out}")

    # --- fidelity: render the trace back and compare with the source raster ---------
    from _svgkit import Harness, rasterize
    N = 480
    ref = Image.open(flat).convert("RGB")
    ref = ref.resize((N, int(N * ref.size[1] / ref.size[0]))) if ref.size[0] >= ref.size[1] \
        else ref.resize((int(N * ref.size[0] / ref.size[1]), N))
    with Harness() as h:
        png = rasterize(h, text, N, "#%02x%02x%02x" % bg)
    got = Image.open(io.BytesIO(png)).convert("RGB")

    # the render is letterboxed into an NxN box; crop to the traced content's own box
    gw, gh = ref.size
    ox, oy = (N - gw) // 2, (N - gh) // 2
    got = got.crop((ox, oy, ox + gw, oy + gh))

    rp, gp = ref.load(), got.load()
    total = 0.0; worst = 0.0; n = 0
    for y in range(0, gh, 2):
        for x in range(0, gw, 2):
            d = sum(abs(rp[x, y][k] - gp[x, y][k]) for k in range(3)) / 3.0
            total += d; n += 1
            if d > worst: worst = d
    mean = total / n
    print(f"fidelity          mean delta {mean:.2f} vs the source raster, worst pixel {worst:.0f}")
    if mean < 6:
        print("close trace. Still a trace: say so on delivery, and do not present it as official geometry.")
        if args.speckle > 4:
            print(f"NOTE: --speckle {args.speckle} discards small blobs. A whole-image fidelity "
                  "score barely moves when small features vanish, so it cannot catch that. "
                  "Zoom into the most detailed area and confirm nothing was deleted.")
    elif mean < 18:
        print("loose trace - visible drift. Try --colors higher, --smooth lower, or a larger source "
              "image. Check the render before shipping.")
    else:
        print("POOR trace. The source is probably too small, too noisy, or anti-aliased into mush. "
              "Do not ship this; go back and look harder for real vector artwork.")
    print("Reminder: if the artwork exists as published vector anywhere, that beats any trace.")


if __name__ == "__main__":
    main()
