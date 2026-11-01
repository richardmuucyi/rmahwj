#!/usr/bin/env python3
"""Shrink an SVG by dropping needless coordinate precision -- and prove it still renders.

Exported logos are routinely 3-5x larger than they need to be, not because they are
detailed but because the exporter wrote every coordinate to 4-6 decimals on a canvas
a couple of hundred units wide. Rounding to 2dp is invisible and typically halves the
file.

The danger is that a naive rewrite silently corrupts a path. SVG path data is nastier
to re-emit than it looks: numbers may be written "-.52", exponents are legal, and
"-.52.26" is two numbers. A regex that scans backwards for the previous number cannot
disambiguate that. So this uses a real tokeniser, and then RENDERS the result against
the original -- if the diff is not clean it tells you and exits non-zero rather than
handing you a quietly broken file.

    python svg_optimize.py logo.svg --out logo.min.svg
    python svg_optimize.py logo.svg --out logo.min.svg --precision 1   # checks harder
"""
from __future__ import annotations
import argparse, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

NUM = re.compile(r"[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")
CMD = set("MmLlHhVvCcSsQqTtAaZz")


def tokenize(d: str):
    """Yield ('cmd', ch) and ('num', float) in order. A real scanner, not a regex split."""
    i, n = 0, len(d)
    while i < n:
        c = d[i]
        if c in CMD:
            yield ("cmd", c); i += 1
        elif c in " ,\t\r\n":
            i += 1
        else:
            m = NUM.match(d, i)
            if not m:
                raise ValueError(f"unparseable path data at offset {i}: {d[i:i+24]!r}")
            yield ("num", float(m.group(0))); i = m.end()


def fmt(v: float, p: int) -> str:
    s = f"{round(v, p):.{p}f}".rstrip("0").rstrip(".")
    if s in ("", "-", "-0"):
        return "0"
    if s.startswith("0.") and len(s) > 2:
        s = s[1:]                      # 0.5 -> .5
    elif s.startswith("-0.") and len(s) > 3:
        s = "-" + s[2:]                # -0.5 -> -.5
    return s


def rewrite(d: str, p: int) -> str:
    out, prev_num, prev_dot = [], False, False
    for kind, val in tokenize(d):
        if kind == "cmd":
            out.append(val); prev_num = False; prev_dot = False
        else:
            s = fmt(val, p)
            # "-" always self-delimits. "." only self-delimits when the PREVIOUS number
            # already contains a dot -- otherwise "0" + ".55" concatenates into the single
            # number "0.55" and the path silently loses a coordinate. This is the same
            # class of bug as scanning backwards for the previous number: you cannot
            # decide the separator from the next token alone.
            self_delim = s.startswith("-") or (s.startswith(".") and prev_dot)
            if prev_num and not self_delim:
                out.append(" ")
            out.append(s); prev_num = True; prev_dot = "." in s
    return "".join(out)


def optimize(text: str, p: int):
    stats = {"paths": 0, "before_chars": 0, "after_chars": 0, "failed": 0}

    def repl(m):
        head, d, tail = m.group(1), m.group(2), m.group(3)
        stats["paths"] += 1
        stats["before_chars"] += len(d)
        try:
            nd = rewrite(d, p)
        except ValueError as e:
            stats["failed"] += 1
            print(f"  ! left one path untouched: {e}", file=sys.stderr)
            nd = d
        stats["after_chars"] += len(nd)
        return head + nd + tail

    text = re.sub(r'(\sd=")([^"]+)(")', repl, text)
    return text, stats


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src"); ap.add_argument("--out", required=True)
    ap.add_argument("--precision", type=int, default=2,
                    help="decimal places to keep (default 2; 1 is usually too few -- it can "
                         "collapse short segments to zero length)")
    ap.add_argument("--bg", default="light", help="background for the verification render")
    ap.add_argument("--skip-verify", action="store_true",
                    help="not recommended: writes without proving the render is unchanged")
    args = ap.parse_args()

    src = Path(args.src).read_text(encoding="utf-8")
    out_text, st = optimize(src, args.precision)
    Path(args.out).write_text(out_text, encoding="utf-8", newline="\n")

    b, a = len(src.encode()), len(out_text.encode())
    print(f"paths rewritten   {st['paths'] - st['failed']}/{st['paths']}"
          + (f"   ({st['failed']} left as-is)" if st["failed"] else ""))
    print(f"path data         {st['before_chars']:,} -> {st['after_chars']:,} chars")
    print(f"file              {b:,} -> {a:,} bytes  ({100*(b-a)/b:.0f}% smaller)")

    if args.skip_verify:
        print("NOT VERIFIED - you asked to skip the render check.")
        return

    import sys as _sys; _sys.dont_write_bytecode = True   # no .pyc in the skill folder

    from _svgkit import Harness, rasterize, resolve_bg
    from PIL import Image
    import io as _io

    bg = resolve_bg(args.bg)
    with Harness() as h:
        A = Image.open(_io.BytesIO(rasterize(h, out_text, 1024, bg))).convert("RGB")
        B = Image.open(_io.BytesIO(rasterize(h, src, 1024, bg))).convert("RGB")
    ap_, bp_ = A.load(), B.load()
    worst = 0.0; total = 0.0; n = 0
    for y in range(0, 1024, 2):
        for x in range(0, 1024, 2):
            d = sum(abs(ap_[x, y][k] - bp_[x, y][k]) for k in range(3)) / 3.0
            total += d; n += 1
            if d > worst: worst = d
    mean = total / n
    print(f"verification      mean delta {mean:.3f}, worst pixel {worst:.0f} (0-255)")
    if mean > 1.0:
        print("REJECTED: the optimised file does not render the same. Raise --precision and "
              "retry; do not ship this. (At 1dp, short segments collapse to zero length.)")
        sys.exit(3)
    if worst > 60:
        print(f"CAUTION: the average is fine but one pixel moved by {worst:.0f}/255. A whole-image "
              "check under-samples fine detail -- microtype, hairlines and tight curves can be "
              "visibly roughened while the mean stays low. Inspect the busiest area at high zoom "
              "before shipping, or raise --precision.")
    else:
        print("verified: rendering is unchanged within antialiasing. Safe to ship.")


if __name__ == "__main__":
    main()
