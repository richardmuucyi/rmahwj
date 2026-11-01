#!/usr/bin/env python3
"""Generated flat raster -> delivered vector, in one command, with the gates that matter.

This is the B4 route (SKILL.md) as a pipeline. Run by hand it is five steps, and it is easy
to get one of them wrong in a way that looks fine: tracing with a high speckle filter once
deleted an entire face from a logo while the fidelity score still read "close", because the
face was a fraction of a percent of the pixels.

Three gates, each aimed at a failure that a mean score cannot see:

  FLATNESS   Refuses a source that is not really two-tone. A gradient-y generation should be
             regenerated, not traced -- tracing ramps is what produces 300-path banded files.
             Measured on the real gradient logo that started this: 52% mid-tone, refused.
  BLOB COUNT Counts distinct ink shapes in the source and in the trace. This is the gate that
             catches the missing face, because discarding small blobs is literally what the
             speckle filter does. On the real failure it read 18 -> 8. A tile grid was tried
             first and did NOT catch it: the face lines are a few percent of one tile, below
             the antialiasing noise on the busier ring, so the tile score barely moved.
  WORST TILE Kept anyway as a second net, for gross regional differences the blob count misses.

    python svg_vectorise.py generated.png --out mark.svg --ink "#1A3566" --square 800
    python svg_vectorise.py generated.png --out mark.svg --ink "#006241" --pad 60 --art-height 700
"""
from __future__ import annotations
import argparse, io, re, subprocess, sys, tempfile
from pathlib import Path
HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

import numpy as np
from PIL import Image
import sys as _sys; _sys.dont_write_bytecode = True   # no .pyc in the skill folder
from _svgkit import Harness, read_svg, rasterize

GRID = 8            # tiles per side for the worst-tile check


def posterise(src: Path, thresh: int, work: Path):
    im = Image.open(src)
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
        plate = Image.new("RGB", im.size, (255, 255, 255))
        plate.paste(im, mask=im.split()[-1])
        im = plate
    im = im.convert("RGB")
    a = np.asarray(im).astype(int)
    lum = a.sum(axis=2) / 3.0
    ambiguous = float(((lum > thresh - 50) & (lum < thresh + 50)).mean())
    mask = lum < thresh
    out = np.where(mask[..., None], 0, 255).astype("uint8").repeat(3, axis=2)
    flat = work / "flat.png"
    Image.fromarray(out).save(flat)
    return flat, ambiguous, float(mask.mean()), im.size


def ink_mask(im: Image.Image) -> np.ndarray:
    """True where there is ink. Compared as SHAPE, not colour -- the source is posterised to
    black while the output is whatever --ink was, so a colour comparison would be dominated
    by the recolour and tell us nothing about lost detail."""
    a = np.asarray(im.convert("RGB")).astype(int)
    return a.sum(axis=2) < 600


def components(mask: np.ndarray, min_px: int = 6) -> int:
    """Count distinct ink blobs above a minimum size.

    This is the gate that actually catches speckle loss, because removing small blobs is
    LITERALLY what the speckle filter does. A whole-image average cannot see it, and neither
    can a coarse tile grid: a face's eyes and mouth are a few percent of one tile, below the
    antialiasing noise on a busier part of the mark. Counting blobs measures the thing directly.
    """
    try:
        from scipy import ndimage
    except ImportError:
        return -1
    lab, n = ndimage.label(mask)
    if n == 0:
        return 0
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    return int((np.asarray(sizes) >= min_px).sum())


def worst_tile(a: Image.Image, b: Image.Image):
    """Percentage of disagreeing pixels per tile. Returns (overall %, worst tile %, (row, col))."""
    ma, mb = ink_mask(a), ink_mask(b)
    H, W = ma.shape
    th, tw = H // GRID, W // GRID
    diff = ma != mb
    overall = 100.0 * diff.mean()
    worst, where = 0.0, (0, 0)
    for r in range(GRID):
        for c in range(GRID):
            tile = diff[r*th:(r+1)*th, c*tw:(c+1)*tw]
            if tile.size:
                t = 100.0 * tile.mean()
                if t > worst:
                    worst, where = t, (r, c)
    return overall, worst, where


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", help="the generated raster (flat, two-colour)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--ink", default="#000000", help="colour for the traced ink")
    ap.add_argument("--square", type=int, help="force a square canvas of this size")
    ap.add_argument("--pad", type=int, default=60, help="clear space when the canvas is derived")
    ap.add_argument("--art-height", type=float, default=700.0)
    ap.add_argument("--namespace", default="mk-")
    ap.add_argument("--group-id", default="mark")
    ap.add_argument("--title", default=""); ap.add_argument("--desc", default="")
    ap.add_argument("--threshold", type=int, default=140, help="luminance split for posterising")
    ap.add_argument("--speckle", type=int, default=2,
                    help="keep this LOW. It cannot tell noise from small deliberate detail.")
    ap.add_argument("--smooth", type=int, default=45)
    ap.add_argument("--precision", type=int, default=1)
    ap.add_argument("--max-ambiguous", type=float, default=3.0,
                    help="refuse sources with more than this %% mid-tone pixels")
    args = ap.parse_args()

    src = Path(args.src)
    if not src.exists():
        sys.exit(f"{src}: not found")
    work = Path(tempfile.mkdtemp())

    # ---- 1. flatness gate ------------------------------------------------------
    flat, ambig, ink_frac, size = posterise(src, args.threshold, work)
    print(f"source            {src.name}  {size[0]}x{size[1]}")
    print(f"flatness          {100*ambig:.2f}% ambiguous mid-tone, ink covers {100*ink_frac:.1f}%")
    if 100 * ambig > args.max_ambiguous:
        sys.exit(
            f"REFUSED: {100*ambig:.1f}% of pixels are mid-tone, so this is not flat two-colour art.\n"
            "  Tracing gradients is what produces huge banded files. Regenerate with the flatness\n"
            "  constraint stated explicitly (flat colours, exactly two, no gradients, no shading,\n"
            "  no drop shadow, hard edges), or raise --max-ambiguous if you accept the cost.")

    # ---- 2. trace --------------------------------------------------------------
    traced = work / "traced.svg"
    r = subprocess.run([sys.executable, str(HERE / "svg_trace.py"), str(flat),
                        "--out", str(traced), "--mono",
                        "--speckle", str(args.speckle), "--smooth", str(args.smooth)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("trace failed:\n" + r.stdout + r.stderr)
    for line in r.stdout.splitlines():
        if line.startswith(("traced", "fidelity")):
            print(line)

    # ---- 3. recolour -----------------------------------------------------------
    t = traced.read_text(encoding="utf-8")
    t = re.sub(r'fill="#0{3,6}"', f'class="ink" fill="{args.ink}"', t, flags=re.I)
    t = re.sub(r'fill="black"', f'class="ink" fill="{args.ink}"', t, flags=re.I)
    traced.write_text(t, encoding="utf-8", newline="\n")

    # ---- 4. optimise (its own render check refuses a broken file) --------------
    mini = work / "min.svg"
    r = subprocess.run([sys.executable, str(HERE / "svg_optimize.py"), str(traced),
                        "--out", str(mini), "--precision", str(args.precision)],
                       capture_output=True, text=True)
    print("\n".join(l for l in r.stdout.splitlines() if l.startswith(("file", "verification"))))
    if r.returncode != 0:
        print("optimiser rejected that precision; shipping the unoptimised trace instead")
        mini = traced

    # ---- 5. place --------------------------------------------------------------
    cmd = [sys.executable, str(HERE / "svg_place.py"), str(mini), "--out", args.out,
           "--art-height", str(args.art_height), "--namespace", args.namespace,
           "--prune", "--group-id", args.group_id]
    if args.square: cmd += ["--square", str(args.square)]
    else:           cmd += ["--pad", str(args.pad)]
    if args.title:  cmd += ["--title", args.title]
    if args.desc:   cmd += ["--desc", args.desc]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("place failed:\n" + r.stdout + r.stderr)
    for line in r.stdout.splitlines():
        if line.startswith(("canvas", "placed", "wrote", "!!")):
            print(line)

    # ---- 6. the gate that matters: worst tile, not mean -------------------------
    N = 512

    def ink_crop(im):
        """Crop to the artwork's own bounding box. The placed SVG carries clear space the
        source raster does not, so comparing them un-normalised measures the margin, not
        the artwork."""
        a = np.asarray(im.convert("RGB")).astype(int)
        notwhite = a.sum(axis=2) < 700
        ys, xs = np.where(notwhite)
        if not len(xs):
            return im
        return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)).resize((N, N))

    ref = ink_crop(Image.open(flat))
    with Harness() as h:
        raw = Image.open(io.BytesIO(rasterize(h, read_svg(args.out), 900, "#ffffff"))).convert("RGB")
    got = ink_crop(raw)
    mean, worst, (wr, wc) = worst_tile(ref, got)
    src_blobs, out_blobs = components(ink_mask(ref)), components(ink_mask(got))
    print(f"\nshape fidelity    {mean:.2f}% of pixels differ overall; worst tile {worst:.2f}% "
          f"at row {wr+1}/{GRID}, col {wc+1}/{GRID}")

    if src_blobs >= 0:
        print(f"ink blobs         source {src_blobs}  ->  traced {out_blobs}")

    lost = src_blobs > 0 and out_blobs < src_blobs * 0.75
    if lost:
        print()
        print(f"SMALL-FEATURE LOSS: the trace kept {out_blobs} of {src_blobs} distinct ink "
              f"shapes. Discarded blobs are exactly what --speckle removes, and it cannot tell "
              f"deliberate detail from noise. Lower --speckle (currently {args.speckle}) and "
              "rerun, then zoom into the most detailed area and confirm it came back.")
        sys.exit(4)
    if worst > max(4 * mean, 10):
        print()
        print(f"REGIONAL DIFFERENCE at row {wr+1}, col {wc+1} - that tile differs far more "
              "than the rest. Render it against the source before shipping.")
        sys.exit(4)
    print("no detail loss detected. Still look at the result before delivering.")


if __name__ == "__main__":
    main()
