#!/usr/bin/env python3
"""Worked example for svg-smith Lane C: the floating tea-house village at the designer finish.

Read this before building a dense scene. It is the scene that went from "student work" (critics: 4/10)
to the designer finish (5.5/10 by three independent art-director critics, reference 8.5-9). Most Lens 10
rules are visible in it; three came later and are NOT shown here: its rim is still a smooth near-ellipse
(see "Break the rim"), it is a night scene (no daytime palette), and its rock uses columns(), which
critics found weak at hero size. Copy its STRUCTURE, not its subject:

  Iso(..., light=(-0.7, .15, .7))  one key light from the screen's upper left; the moon sits there
  columns()                        the rock underside: hanging columns that taper to teeth
  prism() + curved_tone()          drum walls that turn from lit to dark around the curve
  hedge_row() -> Iso.mass_row()    tea bushes as one scalloped three-tone mass per terrace
  inn / shed / store / well /      five building types; full detail only on the hero buildings,
    far_house / pagoda             far ones get one lit window; gold ridge trim on the pagoda only
  Iso.hip_roof() / cast_shadow()   lit-rim roofs with lantern underglow; crisp multiply shadows
  cloud() -> Iso.cel_cloud()       three-step opaque clouds, no blur
  Iso.haze()                       far islets pulled toward the sky colour
  Iso.leading_line()               the sky-lantern stream that leads the eye from the pagoda
  focal glow, plaza light pool     the warmest light sits behind and under the focal building
  back_items / front_items         stacked-level draw order (Lens 8)

Composition: hero mass left of centre, the anchor islet large at lower right, one diagonal from the
moon through the pagoda to the islet, open sky on the other side.

    python tea_village.py --out <somewhere outside the skill>/tea-village.svg

It imports the toolkit from ../scripts and never writes next to itself.
"""
import argparse
import math
import random
import sys
from pathlib import Path

sys.dont_write_bytecode = True        # do not drop a .pyc into the skill's folder
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))   # the skill's toolkit
from iso_scene import Iso, Painter, fmt, seg, hex2rgb, rgb2hex, mix, normal, hull2d  # noqa: E402

W, H = 1200, 1000
R_LEVELS = [6.6, 5.7, 4.8, 3.9, 3.1, 2.3]
LEVEL_H = .5
Z0 = -.9                      # bottom of the rock band under level 0


def lerp3(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def rad(k, th):
    R = R_LEVELS[k]
    return R * (1 + .055 * math.sin(3 * th + 1.3 + .5 * k) + .03 * math.sin(5 * th + .7 + k))


def ztop(k):
    return LEVEL_H * (k + 1)


def zbot(k):
    return Z0 if k == 0 else LEVEL_H * k


class Scene:
    def __init__(self, paint_light=.6):
        self.iso = Iso(cx=440, cy=425, scale=46, light=(-0.7, 0.15, 0.7), hilite="#fff3dc", shadow="#2a2560", ink="#1b1840",
                       paint_light=paint_light, paint_ao=.45, sheen=.24)
        self.rnd = random.Random(11)          # layout
        self.drnd = random.Random(29)         # surface detail only (Lens 7: its own stream)
        # flat finish, upper-left light: the toolkit defaults (Iso(finish="flat"))
        self.extra_defs = []
        self.clip_n = 0

    # ------------------------------------------------------------ small helpers
    def poly(self, pts3, fill, extra=""):
        return f'<polygon points="{self.iso.P(pts3)}" fill="{fill}"{extra}/>'

    def clip(self, inner):
        self.clip_n += 1
        cid = f"clip{self.clip_n}"
        self.extra_defs.append(f'<clipPath id="{cid}">{inner}</clipPath>')
        return cid

    def lantern(self, x, y, s=4.0, flicker=False, col="#d8332a"):
        r = self.drnd
        fl = ""
        if flicker:
            d = r.uniform(1.6, 3.2)
            fl = f'<animate attributeName="opacity" values=".55;1;.7;.95;.55" dur="{d:.1f}s" repeatCount="indefinite"/>'
        return (f'<circle cx="{fmt(x)}" cy="{fmt(y)}" r="{fmt(s * 3.4)}" fill="url(#lanternGlow)">{fl}</circle>'
                f'<line x1="{fmt(x)}" y1="{fmt(y - s * 1.5)}" x2="{fmt(x)}" y2="{fmt(y - s)}" stroke="#3a2420" stroke-width=".7"/>'
                f'<ellipse cx="{fmt(x)}" cy="{fmt(y)}" rx="{fmt(s * .78)}" ry="{fmt(s)}" fill="{col}"/>'
                f'<ellipse cx="{fmt(x - s * .18)}" cy="{fmt(y - s * .1)}" rx="{fmt(s * .36)}" ry="{fmt(s * .6)}" fill="#ffc46b" opacity=".75"/>'
                f'<rect x="{fmt(x - s * .42)}" y="{fmt(y - s * 1.08)}" width="{fmt(s * .84)}" height="{fmt(s * .25)}" fill="#3a2420"/>'
                f'<rect x="{fmt(x - s * .42)}" y="{fmt(y + s * .85)}" width="{fmt(s * .84)}" height="{fmt(s * .25)}" fill="#3a2420"/>'
                f'<line x1="{fmt(x)}" y1="{fmt(y + s * 1.1)}" x2="{fmt(x)}" y2="{fmt(y + s * 1.7)}" stroke="#f0b040" stroke-width=".8"/>')

    def lantern_string(self, a, b, sag, n, s=3.4, flicker_every=2):
        """A catenary-ish string between two screen points with n lanterns hung from it."""
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + sag
        out = [f'<path d="M{fmt(a[0])},{fmt(a[1])} Q{fmt(mx)},{fmt(my)} {fmt(b[0])},{fmt(b[1])}" fill="none" stroke="#2c1d22" stroke-width=".8"/>']
        for i in range(n):
            t = (i + 1) / (n + 1)
            x = (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * mx + t * t * b[0]
            y = (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * my + t * t * b[1]
            out.append(self.lantern(x, y + s * 1.5, s, flicker=(i % flicker_every == 0)))
        return "".join(out)

    def window(self, face, x, y, dx, dy, u0, u1, z0, z1, bars=2, glow=True):
        iso = self.iso
        frame = iso.on_face(face, x, y, dx, dy, u0 - .035, u1 + .035, z0 - .035, z1 + .035, eps=.008)
        c = iso.on_face(face, x, y, dx, dy, u0, u1, z0, z1, eps=.016)
        out = [self.poly(frame, "#4a2a22"), self.poly(c, "url(#winGlow)" if glow else "#39304f")]
        for i in range(1, bars + 1):
            t = i / (bars + 1)
            out.append(seg(iso.pt(*lerp3(c[0], c[1], t)), iso.pt(*lerp3(c[3], c[2], t)), stroke="#5a3426", stroke_width=".8"))
        out.append(seg(iso.pt(*lerp3(c[0], c[3], .5)), iso.pt(*lerp3(c[1], c[2], .5)), stroke="#5a3426", stroke_width=".8"))
        return "".join(out)

    def pillars(self, x, y, dx, dy, z0, z1, col="#b8322c", w=.07):
        iso = self.iso
        out = []
        for face, L in (("y", dx), ("x", dy)):
            for u in (0, L - w):
                out.append(self.poly(iso.on_face(face, x, y, dx, dy, u, u + w, z0, z1, eps=.01), col))
        return "".join(out)

    def hip_roof(self, x, y, z, dx, dy, h, col, eave=.3, lift=.2, inset=.33, steps=12, fascia="#7a2a22", ridge=False):
        return self.iso.hip_roof(x, y, z, dx, dy, h, col, eave=eave, lift=lift, inset=inset, steps=steps, fascia=fascia,
                                 ridge="#e9c46a" if ridge else None)

    def cast_shadow(self, x, y, z, w, d, h):
        return self.iso.cast_shadow(x, y, z, w, d, h)

    def shed(self, x, y, z, w, d, h):
        """Tea-drying shed: long, low, its front open behind slats, trays of leaf inside, thatch."""
        iso = self.iso
        out = [self.cast_shadow(x, y, z, w, d, h), iso.box(x, y, z, w, d, h, "#8a5a3c", rim=False)]
        out.append(self.poly(iso.on_face("y", x, y, w, d, .06, w - .06, z + .04, z + h - .04), "#3a2420"))
        for j in range(3):                                           # trays of drying leaf
            zz = z + .08 + j * (h - .12) / 3
            out.append(self.poly(iso.on_face("y", x, y, w, d, .1, w - .1, zz, zz + .045, eps=.02), "#7fa84a"))
        n = int(w / .11)
        for j in range(n):                                           # slats
            u = .06 + j * (w - .12) / n
            out.append(self.poly(iso.on_face("y", x, y, w, d, u, u + .035, z + .04, z + h - .04, eps=.03), "#c9a06a"))
        out.append(iso.gable_roof(x, y, z + h, w, d, .32, "#b88a4a", eave=.14))
        return "".join(out)

    def store(self, x, y, z, w, d, h):
        """Kura storehouse: white plaster, a dark tiled base band, one high window, dark gable."""
        iso = self.iso
        out = [self.cast_shadow(x, y, z, w, d, h), iso.box(x, y, z, w, d, h, "#efe8da", rim=False)]
        for face, L in (("y", w), ("x", d)):
            out.append(self.poly(iso.on_face(face, x, y, w, d, 0, L, z, z + h * .3), "#45425a"))
            for j in range(1, int(L / .12)):                          # namako lattice
                u = j * .12
                out.append(seg(iso.pt(*iso.on_face(face, x, y, w, d, u, u, z, z + h * .3, eps=.02)[0]),
                               iso.pt(*iso.on_face(face, x, y, w, d, u, u, z, z + h * .3, eps=.02)[2]), stroke="#d9d4e4", stroke_width=".6", opacity=".6"))
        out.append(self.poly(iso.on_face("x", x, y, w, d, d * .38, d * .62, z + h * .62, z + h * .82), "#2b2238"))
        out.append(self.poly(iso.on_face("y", x, y, w, d, w * .4, w * .62, z, z + h * .5, eps=.02), "#6b4a3a"))   # door
        out.append(iso.gable_roof(x, y, z + h, w, d, .3, "#4a4f63", eave=.1))
        return "".join(out)

    def well(self, x, y, z, w):
        """Open well pavilion: four red posts, no walls, a stone well with a bucket, a small hip roof."""
        iso = self.iso
        h = .55
        out = [self.cast_shadow(x, y, z, w, w, h), iso.box(x - .06, y - .06, z, w + .12, w + .12, .05, "#cfc6b4", rim=False)]
        out.append(iso.upright_cylinder(x + w / 2, y + w / 2, z + .05, z + .22, .2, "#9a9488"))
        c = iso.pt(x + w / 2, y + w / 2, z + .22)
        out.append(f'<ellipse cx="{fmt(c[0])}" cy="{fmt(c[1])}" rx="{fmt(.17 * iso.s)}" ry="{fmt(.085 * iso.s)}" fill="#1f2a44"/>')
        out.append(iso.box(x + w / 2 + .1, y + w / 2 + .12, z + .22, .1, .1, .1, "#8a5a3c", rim=False))
        for px, py in ((x, y), (x + w, y), (x, y + w), (x + w, y + w)):
            out.append(iso.upright_cylinder(px, py, z + .05, z + h, .035, "#b8322c"))
        out.append(self.hip_roof(x, y, z + h, w, w, .3, "#2f6f73", eave=.16, lift=.14)[0])
        return "".join(out)

    def inn(self, x, y, z, w, d, h1, h2):
        """Two-storey inn: a skirt roof between the floors, lit windows on both, lanterns up top."""
        iso = self.iso
        out = [self.cast_shadow(x, y, z, w, d, h1 + h2 + .3), iso.box(x, y, z, w, d, h1, "#f1e2c3")]
        out.append(self.pillars(x, y, w, d, z, z + h1))
        out.append(self.window("y", x, y, w, d, w * .12, w * .4, z + .06, z + h1 * .7, bars=2))
        out.append(self.window("y", x, y, w, d, w * .55, w * .85, z + h1 * .3, z + h1 * .7))
        out.append(self.window("x", x, y, w, d, d * .2, d * .75, z + h1 * .3, z + h1 * .7, bars=2))
        out.append(self.hip_roof(x, y, z + h1, w, d, .14, "#7a3a3a", eave=.2, lift=.08, inset=.02)[0])
        ins = .14
        x2, y2, w2, d2, z2 = x + ins, y + ins, w - 2 * ins, d - 2 * ins, z + h1 + .1
        out.append(iso.box(x2, y2, z2, w2, d2, h2, "#f3e6cc"))
        out.append(self.pillars(x2, y2, w2, d2, z2, z2 + h2))
        out.append(self.window("y", x2, y2, w2, d2, w2 * .12, w2 * .88, z2 + h2 * .25, z2 + h2 * .78, bars=4))
        out.append(self.window("x", x2, y2, w2, d2, d2 * .2, d2 * .8, z2 + h2 * .25, z2 + h2 * .78, bars=2))
        r, corners = self.hip_roof(x2, y2, z2 + h2, w2, d2, .42, "#7a3a3a", eave=.3, lift=.22)
        out.append(r)
        for k in ("left", "front", "right"):
            cx, cy = corners[k]
            out.append(self.lantern(cx, cy + 6, 3.4, flicker=(k == "front")))
        return "".join(out)

    def far_house(self, x, y, z, w, d, h, roof):
        """A building on the far side: wall, roof and one lit window. Detail goes to the hero."""
        iso = self.iso
        out = [iso.box(x, y, z, w, d, h, "#e6d6b6", rim=False)]
        out.append(self.poly(iso.on_face("y", x, y, w, d, w * .35, w * .62, z + h * .3, z + h * .7, eps=.02), "url(#winGlow)"))
        out.append(self.hip_roof(x, y, z + h, w, d, .34, roof, eave=.2, lift=.14)[0])
        return "".join(out)

    def house(self, x, y, z, w, d, h, wall, roof, lanterns=True, big=False):
        iso = self.iso
        out = [self.cast_shadow(x, y, z, w, d, h), iso.box(x, y, z, w, d, h, wall)]
        out.append(self.pillars(x, y, w, d, z, z + h))
        # doors and windows on the two visible faces
        out.append(self.window("y", x, y, w, d, w * .3, w * .48, z + .08, z + h * .62, bars=1))
        out.append(self.window("y", x, y, w, d, w * .6, w * .82, z + h * .35, z + h * .7))
        out.append(self.window("x", x, y, w, d, d * .25, d * .7, z + h * .3, z + h * .7))
        r, corners = self.hip_roof(x, y, z + h, w, d, .38 if not big else .5, roof, eave=.22 if not big else .3, lift=.16 if not big else .22)
        out.append(r)
        if lanterns:
            for k in ("left", "front", "right"):
                cx, cy = corners[k]
                out.append(self.lantern(cx, cy + 6, 3.0 if not big else 3.6, flicker=(k == "front")))
        return "".join(out)

    def bush(self, x, y, z, s=1.0):
        iso, r = self.iso, self.drnd
        px, py = iso.pt(x, y, z)
        rx, ry = .26 * iso.s * s, .16 * iso.s * s
        g = r.choice(["#2f7a3c", "#357f3a", "#2c6f40", "#3b8a3f"])
        hi = r.choice(["#7cc35a", "#86c95c", "#71b955"])
        return (f'<ellipse cx="{fmt(px + 1.5)}" cy="{fmt(py + 1.5)}" rx="{fmt(rx)}" ry="{fmt(ry * .8)}" fill="#1b1840" opacity=".28"/>'
                f'<ellipse cx="{fmt(px)}" cy="{fmt(py - ry * .5)}" rx="{fmt(rx)}" ry="{fmt(ry * 1.1)}" fill="{g}"/>'
                f'<ellipse cx="{fmt(px - rx * .25)}" cy="{fmt(py - ry * .95)}" rx="{fmt(rx * .55)}" ry="{fmt(ry * .5)}" fill="{hi}" opacity=".9"/>')

    def hedge_row(self, k, f, z, blocked, N=900):
        """Tea bushes along terrace k: one scalloped mass along the contour (Iso.mass_row)."""
        path = []
        for i in range(N):
            th = 2 * math.pi * i / N
            ro, ri = rad(k, th) - .12, rad(k + 1, th) + .2
            rc = ri + (ro - ri) * f
            x, y = rc * math.cos(th), rc * math.sin(th)
            path.append((x, y, not blocked(x, y)))
        return self.iso.mass_row(path, z, w=.25, h=.24, lump=.34, rng=self.drnd)

    def picker(self, x, y, z):
        iso, r = self.iso, self.drnd
        px, py = iso.pt(x, y, z)
        s = iso.s * .32
        robe = r.choice(["#3b5a9a", "#5a4a8a", "#2f6f8a", "#8a3b4a"])
        return (f'<ellipse cx="{fmt(px)}" cy="{fmt(py)}" rx="{fmt(s * .35)}" ry="{fmt(s * .12)}" fill="#1b1840" opacity=".3"/>'
                f'<path d="M{fmt(px - s * .22)},{fmt(py)} L{fmt(px - s * .14)},{fmt(py - s * .8)} L{fmt(px + s * .14)},{fmt(py - s * .8)} L{fmt(px + s * .22)},{fmt(py)} Z" fill="{robe}"/>'
                f'<rect x="{fmt(px + s * .08)}" y="{fmt(py - s * .72)}" width="{fmt(s * .26)}" height="{fmt(s * .3)}" rx="2" fill="#b07a3f"/>'
                f'<circle cx="{fmt(px)}" cy="{fmt(py - s * .92)}" r="{fmt(s * .12)}" fill="#e2b48a"/>'
                f'<path d="M{fmt(px - s * .36)},{fmt(py - s * .92)} L{fmt(px)},{fmt(py - s * 1.22)} L{fmt(px + s * .36)},{fmt(py - s * .92)} Z" fill="#f3dc9e" stroke="#b8924a" stroke-width=".5"/>')

    def stone_lantern(self, x, y, z):
        iso = self.iso
        out = iso.box(x - .07, y - .07, z, .14, .14, .3, "#cfc6b4", rim=False)
        out += iso.box(x - .13, y - .13, z + .3, .26, .26, .16, "#d8cfbd", rim=False)
        cx, cy = iso.pt(x, y + .13, z + .38)
        out += f'<circle cx="{fmt(cx)}" cy="{fmt(cy)}" r="7" fill="url(#lanternGlow)"/><rect x="{fmt(cx - 2)}" y="{fmt(cy - 2.5)}" width="4" height="4" fill="#ffd27a"/>'
        out += self.hip_roof(x - .13, y - .13, z + .46, .26, .26, .12, "#bdb4a3", eave=.06, lift=.05, steps=4, fascia="#8d8576")[0]
        return out

    def tree_at(self, x, y, z, s, seed, base):
        """Old helper kept for its callers; new code calls iso.tree(x, y, s, seed=, base=, z=) directly."""
        iso = self.iso
        with iso.frame(cx=iso.cx, cy=iso.cy - z * iso.s):
            return iso.tree(x, y, s, seed=seed, base=base)

    def blossom(self, x, y, z, s=1.0):
        """A flowering tree: trunk box, then a cloud of pink puffs lit from the upper left."""
        iso, r = self.iso, self.drnd
        out = iso.box(x - .07 * s, y - .07 * s, z, .14 * s, .14 * s, .7 * s, "#7a4a3a", rim=False)
        cx, cy = iso.pt(x, y, z + 1.0 * s)
        R = .55 * s * iso.s
        def lobe(px, py, rr, k=9):
            pts = []
            for i in range(k):
                a = 2 * math.pi * i / k + r.uniform(-.15, .15)
                q = rr * r.uniform(.78, 1.08)
                pts.append(f"{fmt(px + q * math.cos(a))},{fmt(py + q * .82 * math.sin(a))}")
            return " ".join(pts)
        lobes = [(r.uniform(-1, 1) * R * .75, r.uniform(-.55, .5) * R * .7, r.uniform(.4, .6) * R) for _ in range(7)]
        out += f'<polygon points="{lobe(cx, cy + R * .55, R * .35, 6)}" fill="#3b2230" opacity=".35"/>'
        for dx, dy, rr in lobes:
            out += f'<polygon points="{lobe(cx + dx + rr * .18, cy + dy + rr * .2, rr)}" fill="#b45a88"/>'
        for dx, dy, rr in lobes:
            out += f'<polygon points="{lobe(cx + dx - rr * .05, cy + dy - rr * .06, rr * .82)}" fill="#e48fb2"/>'
        for dx, dy, rr in lobes[:5]:
            out += f'<polygon points="{lobe(cx + dx - rr * .3, cy + dy - rr * .32, rr * .42, 7)}" fill="#f8c9da"/>'
        for _ in range(7):
            out += f'<circle cx="{fmt(cx + r.uniform(-R, R))}" cy="{fmt(cy + R * 1.4 + r.uniform(0, R))}" r="1.3" fill="#ffc0d6" opacity=".8"/>'
        return out

    # ------------------------------------------------------------ terraces
    def contour(self, k, n=56):
        return [(rad(k, 2 * math.pi * i / n) * math.cos(2 * math.pi * i / n),
                 rad(k, 2 * math.pi * i / n) * math.sin(2 * math.pi * i / n)) for i in range(n)]

    def prism(self, k):
        iso, r = self.iso, self.drnd
        poly = self.contour(k)
        z0, z1 = zbot(k), ztop(k)
        wall = "#9a7c68" if k == 0 else "#d4bb96"
        walls = []
        n = len(poly)
        for i in range(n):
            a, b = poly[i], poly[(i + 1) % n]
            mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            nx, ny = b[1] - a[1], -(b[0] - a[0])
            if nx * mx + ny * my < 0:
                nx, ny = -nx, -ny
            q = [(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)]
            if not iso.facing((nx, ny, 0)):
                continue
            wc = iso.curved_tone(wall, (nx, ny, 0))
            f = f'<polygon points="{iso.P(q)}" fill="{iso.grad(wc, "v")}" stroke="{wc}" stroke-width=".6" stroke-linejoin="round"/>'
            if not f:
                continue
            det = []
            jc = iso.darken(wall, .45)
            if k == 0:                                      # rock band: strata + specks
                for zz in (z0 + .35, z0 + .7, z0 + 1.05):
                    det.append(seg(iso.pt(a[0], a[1], zz + r.uniform(-.05, .05)), iso.pt(b[0], b[1], zz + r.uniform(-.05, .05)), stroke=jc, stroke_width=".8", opacity=".45"))
                for _ in range(2):
                    t = r.random()
                    p = iso.pt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, r.uniform(z0 + .1, z1 - .1))
                    det.append(f'<circle cx="{fmt(p[0])}" cy="{fmt(p[1])}" r="{fmt(r.uniform(.8, 1.6))}" fill="{r.choice(["#e8dccb", "#5d4a52"])}" opacity=".7"/>')
            else:                                           # dry-stone courses with staggered joints
                zm = (z0 + z1) / 2
                det.append(seg(iso.pt(a[0], a[1], zm), iso.pt(b[0], b[1], zm), stroke=jc, stroke_width=".7", opacity=".18"))
                for t, zl, zh in (((.5, zm, z1),) if i % 3 == 0 else ()):
                    x_, y_ = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                    det.append(seg(iso.pt(x_, y_, zl), iso.pt(x_, y_, zh), stroke=jc, stroke_width=".6", opacity=".45"))
            det.append(seg(iso.pt(a[0], a[1], z1), iso.pt(b[0], b[1], z1), stroke=iso.lighten(wall, .6), stroke_width="1.4", opacity=".9"))
            walls.append((mx + my, f + "".join(det)))
        walls.sort()
        top_col = "#efdfbf" if k == len(R_LEVELS) - 1 else "#a3ad6c"
        top_pts = [(x, y, z1) for x, y in poly]
        top = iso.face(top_pts, top_col, (0, 0, 1))
        extra = ""
        if k + 1 < len(R_LEVELS):
            # a pale packed-earth walkway along the terrace lip
            inner = [(x * .955, y * .955, z1) for x, y in poly]
            extra += (f'<path d="M{iso.P(top_pts)} Z M{iso.P(inner[::-1])} Z" fill="#ead8b0" fill-rule="evenodd"/>')
            # AO where the next wall meets this top
            up = [(x * 1.07, y * 1.07, z1) for x, y in self.contour(k + 1)]
            extra += self.poly(up, "#9a95c4", ' style="mix-blend-mode:multiply"')   # crisp contact shadow, no blur
        else:                                               # summit plaza paving grid, clipped to the plaza
            cid = self.clip(f'<polygon points="{iso.P(top_pts)}"/>')
            lines = []
            for v in [i * .35 for i in range(-8, 9)]:
                lines.append(seg(iso.pt(v, -3, z1), iso.pt(v, 3, z1), stroke="#b9a988", stroke_width=".6"))
                lines.append(seg(iso.pt(-3, v, z1), iso.pt(3, v, z1), stroke="#b9a988", stroke_width=".6"))
            extra = f'<g clip-path="url(#{cid})" opacity=".7">{"".join(lines)}</g>'
        return "".join(w for _, w in walls) + top + extra

    # ------------------------------------------------------------ pagoda tea house
    def pagoda(self, cx, cy, z):
        iso = self.iso
        out = [self.cast_shadow(cx - .8, cy - .8, z, 1.6, 1.6, 2.4), iso.box(cx - 1.15, cy - 1.15, z, 2.3, 2.3, .22, "#d9cdb4")]
        out.append(iso.box(cx + 1.15, cy - .35, z, .45, .7, .11, "#d9cdb4", rim=False))     # front steps
        zb = z + .22
        corners_all = []
        for i in range(4):
            w = 1.55 - .26 * i
            h = .62 - .06 * i
            x, y = cx - w / 2, cy - w / 2
            out.append(iso.box(x, y, zb, w, w, h, "#f1e2c3"))
            out.append(self.pillars(x, y, w, w, zb, zb + h))
            nwin = 3 if i == 0 else 2
            for j in range(nwin):
                u0 = w * (.16 + j * .7 / nwin)
                u1 = u0 + w * .5 / nwin
                for face in ("y", "x"):
                    out.append(self.window(face, x, y, w, w, u0, u1, zb + h * .25, zb + h * .78, bars=1 + (i == 0)))
            rh = .36
            r, corners = self.hip_roof(x, y, zb + h, w, w, rh, "#2f6f73", eave=.46 - .09 * i, lift=.3 - .04 * i, steps=14, ridge=True)
            out.append(r)
            for k in ("left", "front", "right"):
                px, py = corners[k]
                out.append(f'<path d="M{fmt(px - 3)},{fmt(py)} q3,-7 6,0" fill="#e9c46a"/>')         # upturned corner ornament
                out.append(self.lantern(px, py + 7, 3.4 - .3 * i, flicker=(i % 2 == 0)))
            corners_all.append(corners)
            zb = zb + h + rh * .55
        # spire: stacked rings and a finial
        top = zb + .1
        out.append(iso.upright_cylinder(cx, cy, zb - .2, top + .9, .05, "#d9a441"))
        for j in range(5):
            p = iso.pt(cx, cy, top + .1 + j * .14)
            out.append(f'<ellipse cx="{fmt(p[0])}" cy="{fmt(p[1])}" rx="{fmt(6 - j * .7)}" ry="{fmt(2.4 - j * .25)}" fill="#e9c46a" stroke="#9c6b20" stroke-width=".5"/>')
        p = iso.pt(cx, cy, top + 1.0)
        out.append(f'<circle cx="{fmt(p[0])}" cy="{fmt(p[1])}" r="4" fill="#ffd36e"/><circle cx="{fmt(p[0] - 1.2)}" cy="{fmt(p[1] - 1.2)}" r="1.5" fill="#fff6d8"/>')
        return "".join(out), corners_all

    # ------------------------------------------------------------ islets
    RAMP = ("#8a70a3", "#5a4680", "#30244e")          # lit, mid, dark: one plane, one value

    def columns(self, cx, cy, z, rfun, depth, seed, nsec=22, rings=(1.0, .74, .48, .22)):
        """A rock underside made of hanging columns of mixed lengths, so the silhouette ends in
        teeth. Each face takes one flat value from RAMP by its facing; downward faces pick up the
        warm sunset bounce. No strokes, no gradients."""
        iso, rr = self.iso, random.Random(seed)
        L_ = iso.light
        ln = math.sqrt(sum(c * c for c in L_))
        cols = []
        for ri, r1 in enumerate(rings):
            r0 = rings[ri + 1] if ri + 1 < len(rings) else 0.0
            n = max(4, int(nsec * r1))
            off = rr.uniform(0, 1)
            for j in range(n):
                a0, a1 = 2 * math.pi * (j + off) / n, 2 * math.pi * (j + 1 + off) / n
                am = (a0 + a1) / 2
                L = depth * (.06 + .94 * (1 - r1) ** 1.3) * rr.uniform(.6, 1.25) + .35
                tip = L * rr.uniform(.2, .5)

                def ring(r, a, zz):
                    rad_ = r * rfun(a)
                    return (cx + rad_ * math.cos(a), cy + rad_ * math.sin(a), zz)
                angs = (a0, am, a1)
                top_o = [ring(r1, a, z) for a in angs]
                bot_o = [ring(r1, a, z - L) for a in angs]
                if r0 > 0:
                    top_i = [ring(r0, a, z) for a in angs]
                    bot_i = [ring(r0, a, z - L) for a in angs]
                else:
                    top_i = [(cx, cy, z)] * 3
                    bot_i = [(cx, cy, z - L)] * 3
                cen = ring((r0 + r1) / 2, am, z - L - tip)
                faces = []
                for k in range(2):
                    faces.append([top_o[k], top_o[k + 1], bot_o[k + 1], bot_o[k]])
                    if r0 > 0:
                        faces.append([top_i[k + 1], top_i[k], bot_i[k], bot_i[k + 1]])
                faces.append([top_i[0], top_o[0], bot_o[0], bot_i[0]])
                faces.append([top_o[2], top_i[2], bot_i[2], bot_o[2]])
                bot_ring = bot_o + bot_i[::-1]
                uniq = []
                for q in bot_ring:
                    if not uniq or max(abs(q[i] - uniq[-1][i]) for i in range(3)) > 1e-6:
                        uniq.append(q)
                for k in range(len(uniq)):
                    faces.append([uniq[k], uniq[(k + 1) % len(uniq)], cen])
                ccx = sum(q[0] for q in uniq) / len(uniq)
                ccy = sum(q[1] for q in uniq) / len(uniq)
                ccz = z - L / 2
                out = []
                for f in faces:
                    if len({tuple(round(v, 6) for v in q) for q in f}) < 3:
                        continue
                    nrm = normal(*f[:3])
                    fc = [sum(q[i] for q in f) / len(f) for i in range(3)]
                    if sum(nrm[i] * (fc[i] - (ccx, ccy, ccz)[i]) for i in range(3)) < 0:
                        nrm = tuple(-v for v in nrm)
                    if not iso.facing(nrm):
                        continue
                    nl = math.sqrt(sum(c * c for c in nrm)) or 1
                    t = sum(a * b for a, b in zip(nrm, L_)) / (nl * ln)
                    col = self.RAMP[0] if t > -.05 else self.RAMP[1] if t > -.45 else self.RAMP[2]
                    down = -nrm[2] / nl
                    if down > .15:
                        col = rgb2hex(mix(hex2rgb(col), hex2rgb("#e8957a"), min(.55, down * .7)))
                    out.append(f'<polygon points="{iso.P(f)}" fill="{col}" stroke="{col}" stroke-width=".6" stroke-linejoin="round"/>')
                cols.append((ccx + ccy, "".join(out)))
        cols.sort()
        return "".join(c for _, c in cols)

    def islet(self, x, y, z, R, seed, top="#86bf5a", rock="#55467a", depth=2.6):
        iso = self.iso
        n = 18
        rr = random.Random(seed)
        ph = rr.uniform(0, 6)
        poly = [((R * (1 + .07 * math.sin(3 * (2 * math.pi * i / n) + ph))) * math.cos(2 * math.pi * i / n) + x,
                 (R * (1 + .07 * math.sin(3 * (2 * math.pi * i / n) + ph))) * math.sin(2 * math.pi * i / n) + y) for i in range(n)]
        under = self.columns(x, y, z - .3, lambda a: R * .97, depth, seed, nsec=12, rings=(1.0, .62, .28))
        walls = []
        for i in range(n):
            a, b = poly[i], poly[(i + 1) % n]
            nx, ny = b[1] - a[1], -(b[0] - a[0])
            if nx * ((a[0] + b[0]) / 2 - x) + ny * ((a[1] + b[1]) / 2 - y) < 0:
                nx, ny = -nx, -ny
            walls.append(iso.face([(a[0], a[1], z - .3), (b[0], b[1], z - .3), (b[0], b[1], z), (a[0], a[1], z)], "#9c8574", (nx, ny, 0)))
        return under + "".join(walls) + iso.face([(px, py, z) for px, py in poly], top, (0, 0, 1))


def build(paint_light=.6):
    S = Scene(paint_light)
    iso, rnd = S.iso, S.rnd

    # ================================================================ sky
    sky = ['<rect width="1200" height="1000" fill="url(#sky)"/>',
           '<circle cx="262" cy="104" r="92" fill="url(#moonHalo)"/>',
           '<circle cx="262" cy="104" r="78" fill="#fff4d6" opacity=".06"/><circle cx="262" cy="104" r="62" fill="#fff4d6" opacity=".1"/>',
           '<clipPath id="moonDisc"><circle cx="262" cy="104" r="50"/></clipPath>',
           '<circle cx="262" cy="104" r="50" fill="#f1dfb0"/>',
           '<g clip-path="url(#moonDisc)"><circle cx="262" cy="104" r="50" fill="#fff6dc"/><circle cx="280" cy="114" r="50" fill="#ead39d"/></g>',
           '<path d="M240,86 q8,-7 15,0 q3,8 -6,10 q-10,1 -9,-10 z" fill="#e2c88f" opacity=".75"/><path d="M272,116 q6,-5 12,1 q1,7 -6,8 q-7,0 -6,-9 z" fill="#d6ba82" opacity=".7"/>'
           '<path d="M260,130 q4,-3 8,0 q0,5 -4,5 q-5,0 -4,-5 z" fill="#d6ba82" opacity=".6"/>']
    fp = iso.pt(-.35, -.35, ztop(5) + 1.6)             # focal glow: the lit pagoda is the brightest warm thing
    sky.append(f'<ellipse cx="{fmt(fp[0])}" cy="{fmt(fp[1])}" rx="330" ry="260" fill="url(#focalGlow)"/>')
    sr = random.Random(5)
    for i in range(110):
        x, y = sr.uniform(0, 1200), sr.uniform(0, 430)
        r_ = sr.choice([.6, .8, 1.0, 1.4])
        tw = ""
        if i % 9 == 0:
            tw = f'<animate attributeName="opacity" values="1;.2;1" dur="{sr.uniform(2, 4):.1f}s" repeatCount="indefinite"/>'
        sky.append(f'<circle cx="{fmt(x)}" cy="{fmt(y)}" r="{r_}" fill="#fff8e6" opacity="{sr.uniform(.4, .95):.2f}">{tw}</circle>')

    def cloud(cx, cy, w, h, seed, fill, op, shade=None, drift=0, blur=False):
        ramp = iso.CLOUD_FAR if fill == "far" else iso.CLOUD_NEAR
        return iso.cel_cloud(cx, cy, w, h, seed, ramp=ramp, opacity=op, drift=drift)

    far = [cloud(120, 470, 380, 60, 1, "far", .8, None, drift=14),
           cloud(1050, 430, 420, 70, 2, "far", .8, None, drift=-16),
           cloud(640, 520, 520, 46, 3, "far", .5, None, drift=10, blur=True)]
    # scattered mid-height puffs: pale against the lavender band of the sky
    cr = random.Random(21)
    for i, (x, y) in enumerate([(60, 330), (150, 600), (40, 690), (900, 560), (1120, 610), (1010, 700), (880, 330), (1150, 300), (300, 560), (1180, 450)]):
        far.append(cloud(x, y, cr.uniform(110, 210), cr.uniform(18, 34), 30 + i, "far", cr.uniform(.45, .7), None, drift=cr.choice([-9, 8, 11, -12]), blur=True))

    # ================================================================ distant islets (behind the hero)
    distant = []
    # upper right: a tiny shrine
    distant.append(S.islet(2.06, -7.06, 3.2, 1.15, 41))
    distant.append(S.house(1.71, -7.41, 3.2, .7, .7, .45, "#f1e2c3", "#2f6f73"))
    # right: tea bushes and a stone lantern
    distant.append(S.islet(7.3, -7.1, 1.4, 1.4, 42))
    distant.append(iso.tree(6.9, -7.5, .7, seed=21, base="#2f6b4a", z=1.4) + iso.tree(7.5, -7.6, .55, seed=22, base="#2a5f45", z=1.4)
                   + iso.tree(7.2, -6.9, .8, seed=23, base="#356f4c", z=1.4))
    distant.append(S.stone_lantern(8.0, -6.5, 1.4))
    # left: a pine-ish tree
    distant.append(S.islet(-7.5, 1.54, 3.0, 1.0, 43))
    distant.append(iso.tree(-7.7, 1.35, .8, seed=3, base="#2f6b4a", z=3.0) + S.blossom(-7.1, 1.9, 3.0, .6))
    distant_svg = (f'<g id="islet-shrine"><animateTransform attributeName="transform" type="translate" values="0,0;0,-6;0,0" dur="7s" repeatCount="indefinite"/>{distant[0]}{distant[1]}</g>'
                   f'<g id="islet-tea"><animateTransform attributeName="transform" type="translate" values="0,0;0,5;0,0" dur="9s" repeatCount="indefinite"/>{"".join(distant[2:9])}</g>'
                   f'<g id="islet-pine"><animateTransform attributeName="transform" type="translate" values="0,0;0,-5;0,0" dur="8s" repeatCount="indefinite"/>{"".join(distant[9:])}</g>')

    # a hazed group is isolated (its filter), so a multiply shadow inside it would paint flat lavender:
    # bake the shadow to a solid colour, the islet grass multiplied by the shadow tint
    distant_svg = distant_svg.replace('fill="#8d86c0" style="mix-blend-mode:multiply"', 'fill="#4a6444"')

    # ================================================================ hero island
    hero = []
    # underside: hanging columns, flat planes, warm bounce on the down faces
    hero.append(S.columns(0, 0, Z0, lambda a: rad(0, a) * .99, 10.5, 17, nsec=24, rings=(1.0, .8, .6, .4, .2)))
    # hanging roots and vines off the front rim
    for i in range(16):
        th = math.radians(S.drnd.uniform(-30, 125))
        rr_ = rad(0, th) * .98
        p = iso.pt(rr_ * math.cos(th), rr_ * math.sin(th), Z0 + .05)
        L = S.drnd.uniform(25, 75)
        sw = S.drnd.uniform(-10, 10)
        col = S.drnd.choice(["#3f6d3a", "#4f7d3f", "#5d4636"])
        hero.append(f'<path d="M{fmt(p[0])},{fmt(p[1])} q{fmt(sw)},{fmt(L * .5)} {fmt(sw * .4)},{fmt(L)}" fill="none" stroke="{col}" stroke-width="1.3" stroke-linecap="round"/>')
        for j in range(3):
            yy = p[1] + L * (j + 1) / 4
            hero.append(f'<ellipse cx="{fmt(p[0] + sw * .5 + (3 if j % 2 else -3))}" cy="{fmt(yy)}" rx="3" ry="1.6" fill="#7cb85a"/>')

    # exclusion zones for rows: (x, y, r)
    houses = [  # level, theta deg, w, d, h, wall, roof, kind: five types, full detail only near the front
        (0, 47, 1.2, 1.0, .5, "#f1e2c3", "#7a3a3a", "inn"),
        (0, 150, .6, .6, .55, "", "", "well"),
        (0, 205, .85, .75, .55, "", "#2f6f73", "far"),
        (0, 262, .8, .7, .55, "", "", "store"),
        (1, 92, 1.3, .56, .38, "", "", "shed"),
        (1, 300, .8, .7, .55, "", "#7a3a3a", "far"),
        (2, 165, .8, .7, .52, "", "#2f6f73", "far"),
        (2, 268, 1.1, .5, .34, "", "", "shed"),
        (2, 330, .7, .6, .5, "", "#2f6f73", "far"),
        (3, 60, .7, .62, .52, "", "", "store"),
        (3, 235, .7, .6, .5, "", "#7a3a3a", "far"),
    ]
    excl = []
    placed = []
    for k, deg, w, d, h, wall, roof, big in houses:
        th = math.radians(deg)
        rm = (rad(k, th) + rad(k + 1, th)) / 2 if k + 1 < len(R_LEVELS) else rad(k, th) * .5
        x, y = rm * math.cos(th), rm * math.sin(th)
        placed.append((k, x, y, w, d, h, wall, roof, big))
        excl.append((x, y, max(w, d) * .85))
    # funicular corridor and waterfall channel
    TH_TRACK = math.radians(16)
    TH_FALL = math.radians(112)

    def in_corridor(x, y):
        th = math.atan2(y, x)
        r_ = math.hypot(x, y)
        dtrack = abs(math.sin(th - TH_TRACK)) * r_
        dfall = abs(math.sin(th - TH_FALL)) * r_
        return (abs(th - TH_TRACK) < 1 and dtrack < .75) or (abs(th - TH_FALL) < 1 and dfall < .45)

    back_items = {k: [] for k in range(len(R_LEVELS))}
    front_items = {k: [] for k in range(len(R_LEVELS))}
    for k in range(len(R_LEVELS) - 1):
        z = ztop(k)
        blocked = lambda x, y: in_corridor(x, y) or any(math.hypot(x - ex, y - ey) < er * 1.25 for ex, ey, er in excl)
        for f in (.5,):
            for dep, svg_ in S.hedge_row(k, f, z, blocked):
                (front_items if dep > 0 else back_items)[k].append((dep, svg_))
        # pickers among the rows
        for _ in range(3 if k < 4 else 1):
            th = rnd.uniform(-.6, 2.2)
            r_ = (rad(k, th) + rad(k + 1, th)) / 2
            x, y = r_ * math.cos(th), r_ * math.sin(th)
            if in_corridor(x, y) or any(math.hypot(x - ex, y - ey) < er for ex, ey, er in excl):
                continue
            front_items[k].append((x + y + .01, S.picker(x, y, z)))
    for k, x, y, w, d, h, wall, roof, kind in placed:
        X, Y, Z = x - w / 2, y - d / 2, ztop(k)
        if kind == "inn":
            b = S.inn(X, Y, Z, w, d, h, h * .8)
        elif kind == "shed":
            b = S.shed(X, Y, Z, w, d, h)
        elif kind == "store":
            b = S.store(X, Y, Z, w, d, h)
        elif kind == "well":
            b = S.well(X, Y, Z, w)
        else:
            b = S.far_house(X, Y, Z, w, d, h, roof)
        item = (x + y, b)
        (front_items if x + y > 0 else back_items)[k].append(item)
    # silhouette breakers: tall pines and a big blossom tree on the outer rim, so the island's outline
    # is not a clean ellipse (a cake reads as computed; broken outlines read as drawn)
    # clusters of 2-3 at the left and right edges, mixed sizes, dark against the sky
    for deg, sc, seed, dr in ((160, 1.25, 5, .35), (167, .85, 6, .7), (176, 1.05, 7, .4),
                              (290, 1.15, 8, .35), (298, .8, 9, .65), (306, 1.3, 10, .4), (312, .9, 11, .8)):
        th = math.radians(deg)
        r_ = rad(0, th) - dr
        x, y = r_ * math.cos(th), r_ * math.sin(th)
        t_svg = iso.tree(x, y, sc, seed=seed, base=S.drnd.choice(["#1f4f3c", "#24573f", "#1c4636"]), z=ztop(0)).replace(
            'fill="url(#paintSheen)"/>', 'fill="url(#paintSheen)" opacity=".35"/>')
        (front_items if x + y > 0 else back_items)[0].append((x + y, t_svg))
    for deg in (-12, 100):
        th = math.radians(deg)
        r_ = rad(0, th) - .4
        x, y = r_ * math.cos(th), r_ * math.sin(th)
        front_items[0].append((x + y, S.blossom(x, y, ztop(0), 1.5)))
    # stone lanterns on level 4's front rim
    for deg in (20, 75, 130):
        th = math.radians(deg)
        r_ = rad(4, th) - .25
        front_items[4].append((99, S.stone_lantern(r_ * math.cos(th), r_ * math.sin(th), ztop(4))))

    # summit: pagoda tea house + lantern posts around the plaza rim
    pag_svg, pag_corners = S.pagoda(-.35, -.35, ztop(5))
    back_items[5].append((0, pag_svg))
    posts = []
    for deg in range(-40, 141, 30):
        th = math.radians(deg)
        r_ = rad(5, th) - .15
        x, y = r_ * math.cos(th), r_ * math.sin(th)
        a, b = iso.pt(x, y, ztop(5)), iso.pt(x, y, ztop(5) + .55)
        posts.append((a, b))
    rim = []
    for a, b in posts:
        rim.append(f'<line x1="{fmt(a[0])}" y1="{fmt(a[1])}" x2="{fmt(b[0])}" y2="{fmt(b[1])}" stroke="#4a2a22" stroke-width="1.8"/>'
                   f'<circle cx="{fmt(b[0])}" cy="{fmt(b[1])}" r="1.6" fill="#e9c46a"/>')
    for (a1, b1), (a2, b2) in zip(posts, posts[1:]):
        rim.append(S.lantern_string(b1, b2, 9, 2, s=3.0))
    front_items[5].append((50, "".join(rim)))
    pc = iso.pt(-.35, -.35, ztop(5))
    back_items[5].insert(0, (-99, f'<ellipse cx="{fmt(pc[0])}" cy="{fmt(pc[1] + 10)}" rx="{fmt(3.2 * iso.s)}" ry="{fmt(1.6 * iso.s)}" fill="url(#lanternGlow)" opacity=".7" style="mix-blend-mode:screen"/>'))

    # waterfall: a sheet over each terrace wall at TH_FALL, then a long fall off the rim
    water = []
    for k in range(4, -1, -1):
        th = TH_FALL
        r_ = rad(k, th)
        d = .22 / r_
        a = (r_ * math.cos(th - d) + .02, r_ * math.sin(th - d) + .02)
        b = (r_ * math.cos(th + d) + .02, r_ * math.sin(th + d) + .02)
        z0, z1 = zbot(k), ztop(k)
        sheet = [(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)]
        water.append(S.poly(sheet, "url(#waterV)", ' opacity=".92"'))
        p0, p1 = iso.pt(r_ * math.cos(th), r_ * math.sin(th), z1), iso.pt(r_ * math.cos(th), r_ * math.sin(th), z0)
        water.append(S.poly(sheet, "url(#fallShimmer)"))       # moving water: a repeating gradient, not dashes
        if k < 4:   # channel across the top of the level below's ring
            ri = rad(k + 1, th)
            water.append(S.poly([(ri * math.cos(th - .2 / ri), ri * math.sin(th - .2 / ri), z1 + .01), (r_ * math.cos(th - d), r_ * math.sin(th - d), z1 + .01),
                                 (r_ * math.cos(th + d), r_ * math.sin(th + d), z1 + .01), (ri * math.cos(th + .2 / ri), ri * math.sin(th + .2 / ri), z1 + .01)], "#9fd8e8"))
        # splash foam at the foot
        water.append(f'<ellipse cx="{fmt(p1[0])}" cy="{fmt(p1[1])}" rx="7" ry="2.6" fill="#ffffff" opacity=".85"/>')
    r0 = rad(0, TH_FALL)
    top_fall = iso.pt(r0 * math.cos(TH_FALL), r0 * math.sin(TH_FALL), Z0)
    tx, ty = top_fall
    water.append(f'<polygon points="{fmt(tx - 6)},{fmt(ty)} {fmt(tx + 6)},{fmt(ty)} {fmt(tx + 16)},{fmt(ty + 260)} {fmt(tx - 16)},{fmt(ty + 260)}" fill="url(#fallFade)"/>'
                 f'<ellipse cx="{fmt(tx)}" cy="{fmt(ty + 250)}" rx="30" ry="9" fill="#ffffff" opacity=".35"/><ellipse cx="{fmt(tx + 8)}" cy="{fmt(ty + 240)}" rx="16" ry="6" fill="#ffffff" opacity=".4"/>'
                 f'<polygon points="{fmt(tx - 4)},{fmt(ty)} {fmt(tx + 4)},{fmt(ty)} {fmt(tx + 11)},{fmt(ty + 250)} {fmt(tx - 11)},{fmt(ty + 250)}" fill="url(#fallShimmer)"/>')
    # springs: thin falls leaving lit cave mouths in the rock band
    for deg, length in ((32, 120), (58, 150), (84, 210)):   # front-facing band only (Lens 8)
        th = math.radians(deg)
        r_ = rad(0, th) + .03
        m = iso.pt(r_ * math.cos(th), r_ * math.sin(th), Z0 + .45)
        water.append(f'<circle cx="{fmt(m[0])}" cy="{fmt(m[1])}" r="12" fill="url(#lanternGlow)"/>'
                     f'<path d="M{fmt(m[0] - 6)},{fmt(m[1] + 4)} v-7 a6,6 0 0 1 12,0 v7 z" fill="#2b2238"/>'
                     f'<polygon points="{fmt(m[0] - 3)},{fmt(m[1] + 2)} {fmt(m[0] + 3)},{fmt(m[1] + 2)} {fmt(m[0] + 9)},{fmt(m[1] + 2 + length)} {fmt(m[0] - 9)},{fmt(m[1] + 2 + length)}" fill="url(#fallFade)"/>'
                     f'<ellipse cx="{fmt(m[0])}" cy="{fmt(m[1] + length * .85)}" rx="15" ry="5" fill="#ffffff" opacity=".3"/>'
                     f'<polygon points="{fmt(m[0] - 2)},{fmt(m[1] + 2)} {fmt(m[0] + 2)},{fmt(m[1] + 2)} {fmt(m[0] + 6)},{fmt(m[1] + 2 + length * .9)} {fmt(m[0] - 6)},{fmt(m[1] + 2 + length * .9)}" fill="url(#fallShimmer)"/>')

    # assemble terraces: prisms + back items bottom-up, then front items top-down
    for k in range(len(R_LEVELS)):
        hero.append(S.prism(k))
        hero.extend(s for _, s in sorted(back_items[k], key=lambda t: t[0]))
    hero.append("".join(water))
    for k in range(len(R_LEVELS) - 1, -1, -1):
        hero.extend(s for _, s in sorted(front_items[k], key=lambda t: t[0]))

    # ================================================================ funicular
    # upper station sits wholly on level 1's ring (Lens 4); the track leaves through its +x face
    rc = (rad(1, TH_TRACK) + rad(2, TH_TRACK)) / 2
    scx, scy = rc * math.cos(TH_TRACK), rc * math.sin(TH_TRACK)
    SW, SD, SH = .7, .85, .7
    sx, sy = scx - SW / 2, scy - SD / 2
    up = (sx + SW + .03, scy, ztop(1) + .3)
    ISL = (9.4, 3.0, -1.1)                       # anchor islet centre, top z
    lo = (ISL[0] - 1.75, ISL[1] - .3, ISL[2] + .12)
    dx, dy, dz = lo[0] - up[0], lo[1] - up[1], lo[2] - up[2]
    L = math.hypot(dx, dy)
    ux, uy = dx / L, dy / L
    px_, py_ = -uy * .3, ux * .3                 # lateral half-gauge
    track = []

    def tp(t, lat=0.0, dzz=0.0):
        return (up[0] + dx * t + px_ * lat, up[1] + dy * t + py_ * lat, up[2] + dz * t + dzz)

    def ground_z(x, y):
        r_ = math.hypot(x, y)
        th = math.atan2(y, x)
        for k in range(len(R_LEVELS) - 1, -1, -1):
            if r_ < rad(k, th):
                return ztop(k)
        return None
    # trestles / truss
    N = 40
    for i in range(N + 1):
        t = i / N
        for lat in (-1, 1):
            x, y, z = tp(t, lat)
            g = ground_z(x, y)
            if g is not None and i % 3 == 0:
                track.append(seg(iso.pt(x, y, z), iso.pt(x, y, g), stroke="#5a2f2a", stroke_width="1.6"))
            elif g is None:
                a, b = iso.pt(x, y, z), iso.pt(x, y, z - .45)
                if i % 2 == 0:
                    track.append(seg(a, b, stroke="#7a2f2a", stroke_width="1.2"))
                if i < N:
                    x2, y2, z2 = tp((i + 1) / N, lat)
                    track.append(seg(iso.pt(x, y, z - .45), iso.pt(x2, y2, z2 - .45), stroke="#7a2f2a", stroke_width="1.4"))
                    if i % 2 == 0:
                        track.append(seg(a, iso.pt(x2, y2, z2 - .45), stroke="#7a2f2a", stroke_width=".8"))
    for i in range(N * 2 + 1):          # sleepers
        t = i / (N * 2)
        track.append(seg(iso.pt(*tp(t, -1.25)), iso.pt(*tp(t, 1.25)), stroke="#4a2a22", stroke_width="1.5"))
    for lat in (-1, 1):                 # rails
        track.append(seg(iso.pt(*tp(0, lat, .03)), iso.pt(*tp(1, lat, .03)), stroke="#2b2238", stroke_width="2.2"))
        track.append(seg(iso.pt(*tp(0, lat, .05)), iso.pt(*tp(1, lat, .05)), stroke="#d9d4e8", stroke_width=".8"))
    track.append(seg(iso.pt(*tp(0, 0, .1)), iso.pt(*tp(1, 0, .1)), stroke="#1f1a2e", stroke_width=".7"))   # haul cable

    # upper station: small platform hall + bull wheel in an x-plane
    us = []
    us.append(iso.box(sx, sy, ztop(1), SW, SD, SH, "#efe0c2"))
    us.append(S.pillars(sx, sy, SW, SD, ztop(1), ztop(1) + SH))
    us.append(S.window("y", sx, sy, SW, SD, .15, .5, ztop(1) + .15, ztop(1) + .5))
    r_, _c = S.hip_roof(sx, sy, ztop(1) + SH, SW, SD, .3, "#7a3a3a", eave=.18, lift=.14)
    us.append(r_)
    wheel_c = (sx + SW + .02, scy, ztop(1) + .52)
    spokes = "".join(f'<line x1="0" y1="0" x2="{fmt(.17 * math.cos(a))}" y2="{fmt(.17 * math.sin(a))}" stroke="#2b2238" stroke-width=".035"/>'
                     for a in [i * math.pi / 4 for i in range(8)])
    us.append(f'<g transform="{iso.x_plane(*wheel_c)}"><circle r=".2" fill="#8a3b33" stroke="#2b2238" stroke-width=".05"/>'
              f'<g>{spokes}<circle r=".05" fill="#e9c46a"/><animateTransform attributeName="transform" type="rotate" values="0;360" dur="6s" repeatCount="indefinite"/></g></g>')

    # car: an inclined box on the track, animated up and down
    def car_svg(t):
        L2, Wc, Hc = .4, .3, .55
        c = tp(t, 0, .1)
        a = (-ux * L2, -uy * L2, -dz / L * L2)          # uphill half-length vector
        l = (-uy * Wc, ux * Wc, 0)                        # lateral (+y-ish side)
        if l[0] + l[1] < 0:
            l = tuple(-v for v in l)

        def P(sa, sl, h):
            return (c[0] + a[0] * sa + l[0] * sl, c[1] + a[1] * sa + l[1] * sl, c[2] + a[2] * sa + h)
        out = []
        # stepped funicular car: the floor is level, the body leans with the track
        out.append(iso.face([P(-1, -1, Hc), P(1, -1, Hc), P(1, 1, Hc), P(-1, 1, Hc)], "#3a3550", (0, 0, 1)))
        out.append(iso.face([P(-1, 1, 0), P(1, 1, 0), P(1, 1, Hc), P(-1, 1, Hc)], "#c9413a", l))
        out.append(iso.face([P(-1, -1, 0), P(-1, 1, 0), P(-1, 1, Hc), P(-1, -1, Hc)], "#c9413a", (-a[0], -a[1], 0)))
        for j in range(3):   # windows along the side
            s0, s1 = -.8 + j * .55, -.8 + j * .55 + .4
            out.append(S.poly([P(s0, 1.02, Hc * .45), P(s1, 1.02, Hc * .45), P(s1, 1.02, Hc * .85), P(s0, 1.02, Hc * .85)], "url(#winGlow)"))
        out.append(S.poly([P(-1, 1.02, Hc * .2), P(1, 1.02, Hc * .2), P(1, 1.02, Hc * .3), P(-1, 1.02, Hc * .3)], "#f3dca0"))
        p = iso.pt(*P(-1, 0, Hc * .6))
        out.append(f'<circle cx="{fmt(p[0])}" cy="{fmt(p[1])}" r="9" fill="url(#lanternGlow)"/><circle cx="{fmt(p[0])}" cy="{fmt(p[1])}" r="2" fill="#fff2c0"/>')
        return "".join(out)
    t0, t1 = .55, .15
    d0, d1 = iso.pt(*tp(t0)), iso.pt(*tp(t1))
    mvx, mvy = d1[0] - d0[0], d1[1] - d0[1]
    car = (f'<g id="funicular-car"><animateTransform attributeName="transform" type="translate" '
           f'values="0,0;0,0;{fmt(mvx)},{fmt(mvy)};{fmt(mvx)},{fmt(mvy)};0,0" keyTimes="0;.1;.5;.6;1" dur="18s" repeatCount="indefinite"/>{car_svg(t0)}</g>')

    # ================================================================ anchor islet (lower station)
    an = []
    an.append(S.islet(ISL[0], ISL[1], ISL[2], 3.2, 77, depth=4.6))
    ax, ay, az = ISL
    # paving
    cid2 = S.clip(f'<polygon points="{iso.P([(ax + 2.5 * math.cos(a), ay + 2.5 * math.sin(a), az) for a in [i * math.pi / 12 for i in range(24)]])}"/>')
    pav = "".join(seg(iso.pt(ax - 3 + i * .4, ay - 3, az), iso.pt(ax - 3 + i * .4, ay + 3, az), stroke="#8bb860", stroke_width=".5") for i in range(16))
    an.append(f'<g clip-path="url(#{cid2})" opacity=".6">{pav}</g>')
    n_ground = len(an) + 1
    an.append(f'<path d="M{" L".join(f"{fmt(p[0])},{fmt(p[1])}" for p in [iso.pt(ax - 1.4, ay - .9, az), iso.pt(ax + 1.6, ay - .9, az), iso.pt(ax + 1.6, ay + 1.9, az), iso.pt(ax - 1.4, ay + 1.9, az)])} Z" fill="#e9dcc0"/>')
    # station hall
    st = (ax - 1.2, ay - .8, az, 2.4, 1.5, .95)
    an.append(iso.box(*st, "#f1e2c3"))
    an.append(S.pillars(st[0], st[1], st[3], st[4], az, az + st[5]))
    an.append(S.window("y", st[0], st[1], st[3], st[4], .35, .95, az + .05, az + .72, bars=2))       # big doorway
    an.append(S.window("y", st[0], st[1], st[3], st[4], 1.25, 1.65, az + .35, az + .72))
    an.append(S.window("y", st[0], st[1], st[3], st[4], 1.8, 2.15, az + .35, az + .72))
    an.append(S.window("x", st[0], st[1], st[3], st[4], .3, .7, az + .35, az + .72))
    an.append(S.window("x", st[0], st[1], st[3], st[4], .85, 1.25, az + .35, az + .72))
    rf, cs = S.hip_roof(st[0], st[1], az + st[5], st[3], st[4], .5, "#2f6f73", eave=.3, lift=.25, ridge=True)
    an.append(rf)
    for k in cs:
        an.append(S.lantern(cs[k][0], cs[k][1] + 8, 4.2, flicker=True))
    an.append(S.lantern_string(cs["left"], cs["front"], 14, 4, s=3.4))
    # banner sign over the doorway (no text: a red board with a gold roundel)
    sb = iso.on_face("y", st[0], st[1], st[3], st[4], .45, .85, az + .78, az + .9, eps=.02)
    an.append(S.poly(sb, "#b8322c"))
    pc = iso.pt(*lerp3(lerp3(sb[0], sb[1], .5), lerp3(sb[3], sb[2], .5), .5))
    an.append(f'<circle cx="{fmt(pc[0])}" cy="{fmt(pc[1])}" r="2.6" fill="#e9c46a"/>')
    # tea barrels and a tea-cart
    for i, (bx, by) in enumerate([(ax + 1.3, ay + 1.0), (ax + 1.65, ay + .7), (ax + 1.55, ay + 1.35)]):
        an.append(iso.upright_cylinder(bx, by, az, az + .38, .17, "#9a6a3e"))
        p0 = iso.pt(bx, by, az + .12)
        an.append(f'<ellipse cx="{fmt(p0[0])}" cy="{fmt(p0[1])}" rx="{fmt(.17 * iso.s)}" ry="{fmt(.085 * iso.s)}" fill="none" stroke="#3a2420" stroke-width="1" opacity=".7"/>')
    an.append(S.blossom(ax - 1.9, ay + 1.0, az, 1.0))      # behind the gate: draw first (Lens 8)
    for (fx, fy) in [(ax + .1, ay + 1.3), (ax + .6, ay + 1.55), (ax - .5, ay + 1.7)]:
        an.append(S.picker(fx, fy, az))
    # paifang gate in front
    gx0, gx1, gy = ax - .7, ax + 1.0, ay + 2.35
    for gx in (gx0, gx1):
        an.append(iso.upright_cylinder(gx, gy, az, az + 1.2, .09, "#b8322c"))
        an.append(iso.box(gx - .14, gy - .14, az, .28, .28, .14, "#d6c8b0", rim=False))
    an.append(iso.box(gx0 - .2, gy - .08, az + .88, gx1 - gx0 + .4, .16, .12, "#b8322c"))          # lower tie beam
    an.append(iso.box(gx0 - .45, gy - .1, az + 1.2, gx1 - gx0 + .9, .2, .1, "#2f6f73"))            # upper lintel
    for gx in (gx0 - .45, gx1 + .45):                                                                # upturned gold ends
        e = iso.pt(gx, gy + .1, az + 1.3)
        an.append(f'<path d="M{fmt(e[0] - 4)},{fmt(e[1] + 1)} q4,-9 8,-2" fill="none" stroke="#e9c46a" stroke-width="2.2" stroke-linecap="round"/>')
    pl = iso.on_face("y", gx0 + .4, gy - .08, .9, .16, 0, .9, az + 1.0, az + 1.18)                 # plaque between beams
    an.append(S.poly(pl, "#e9c46a"))
    b0 = iso.pt(gx0, gy, az + .9)
    b1 = iso.pt(gx1, gy, az + .9)
    an.append(S.lantern_string(b0, b1, 4, 3, s=4.0, flicker_every=1))
    # stepping stones from the gate to the teahouse, a lantern pair, a tea-drying rack
    for j in range(7):
        t = j / 6
        sx_, sy_ = ax + .15 - .1 * t + S.drnd.uniform(-.05, .05), ay + 2.2 - 1.4 * t
        c = iso.pt(sx_, sy_, az)
        an.append(f'<ellipse cx="{fmt(c[0])}" cy="{fmt(c[1])}" rx="{fmt(.13 * iso.s)}" ry="{fmt(.065 * iso.s)}" fill="#d9d1bf"/>'
                  f'<ellipse cx="{fmt(c[0] - 1)}" cy="{fmt(c[1] - 1)}" rx="{fmt(.09 * iso.s)}" ry="{fmt(.04 * iso.s)}" fill="#efe9da"/>')
    an.append(S.stone_lantern(ax - 1.6, ay + 2.0, az) + S.stone_lantern(ax + 2.3, ay + 1.9, az))
    rx0, ry0 = ax + 2.0, ay + .6
    for j in range(3):
        an.append(iso.box(rx0, ry0 + j * .3, az, .06, .06, .5, "#8a5a3c", rim=False))
    for j in range(3):
        zz = az + .15 + j * .14
        an.append(iso.box(rx0 - .25, ry0 - .05, zz, .55, .7, .03, "#c9a06a", rim=False))
        an.append(iso.box(rx0 - .2, ry0, zz + .03, .45, .6, .02, "#7fa84a", rim=False))
    # stone lantern + figures
    an.append(S.stone_lantern(ax + 2.0, ay - .2, az))

    # ================================================================ near mist + cloud sea
    mist_mid = []
    # cloud sea: one merged pale mass lower-left (the negative-space diagonal), then rolling mounds
    # to the right with the warm horizon showing between them
    sea = [cloud(70, 845, 300, 56, 11, "#fdf1ec", .95, "#b48eb4", drift=8),
           cloud(240, 950, 660, 86, 9, "#fdf3ee", .97, "#bf98bd", drift=12),
]
    mr = random.Random(61)
    for i, x in enumerate(range(600, 1260, 120)):
        y = 955 + (i % 2) * 40 + mr.uniform(-8, 8)
        sea.append(cloud(x, y, mr.uniform(150, 190), mr.uniform(40, 52), 70 + i, "#fff3ec", .97, "#b993b7", drift=mr.choice([-8, 9])))
    sea.append(cloud(1130, 905, 300, 46, 15, "#fbece6", .95, "#b48eb4", drift=10))

    # sky lanterns (kongming) drifting up from the village: warm paper, pale enough to read at a distance
    sky_l = []
    lr = random.Random(77)
    B = iso.pt(-.35, -.35, ztop(5) + 3.2)
    E, C = (1110, 50), (B[0] + 80, 110)
    spots = Iso.leading_line(B, C, E, 24, seed=77, spread=(30, 120), size=(1.5, .45))
    for _ in range(6):                                  # a few strays far off
        spots.append((lr.uniform(60, 420), lr.uniform(260, 380), lr.uniform(.35, .5)))
    for x, y, s in spots:
        rise = lr.uniform(18, 40)
        sky_l.append(f'<g transform="translate({fmt(x)},{fmt(y)}) scale({s:.2f})">'
                     f'<animateTransform attributeName="transform" type="translate" additive="sum" values="0,0;3,-{fmt(rise)};0,0" dur="{lr.uniform(10, 18):.0f}s" repeatCount="indefinite"/>'
                     f'<circle r="13" fill="url(#lanternGlow)"/><path d="M-6,-7 L6,-7 L4.5,6 L-4.5,6 Z" fill="#ffeac0"/><path d="M-6,-7 L6,-7" stroke="#8a4a2a" stroke-width="1.2"/>'
                     f'<path d="M-6,6 L6,6" stroke="#c9733a" stroke-width="1.2"/><ellipse cx="0" cy="4" rx="3" ry="1.6" fill="#ff9f3a"/></g>')
    wisp = []

    # cranes
    birds = []
    for (bx, by, s) in [(250, 140, 1.0), (292, 164, .8), (222, 172, .7)]:
        birds.append(f'<g transform="translate({bx},{by}) scale({s})"><animateTransform attributeName="transform" type="translate" additive="sum" values="0,0;-30,6;0,0" dur="14s" repeatCount="indefinite"/>'
                     f'<path d="M-16,-2 Q-8,-10 0,0 Q8,-10 18,-4 Q8,-5 0,3 Q-8,-5 -16,-2 Z" fill="#fff8ee"/>'
                     f'<path d="M-16,-2 l4,-2 M18,-4 l-4,-1" stroke="#1b1840" stroke-width="1.6"/><path d="M0,1 l7,2" stroke="#d8332a" stroke-width="1.2"/></g>')

    defs = ('<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a0f2e"/><stop offset=".34" stop-color="#18215a"/>'
            '<stop offset=".58" stop-color="#3f3a7e"/><stop offset=".76" stop-color="#b9607e"/><stop offset=".9" stop-color="#f08f63"/><stop offset="1" stop-color="#ffc178"/></linearGradient>'
            '<radialGradient id="focalGlow"><stop offset="0" stop-color="#ffd27a" stop-opacity=".55"/><stop offset=".5" stop-color="#ff9a3c" stop-opacity=".18"/><stop offset="1" stop-color="#ff7a2a" stop-opacity="0"/></radialGradient>'
            '<radialGradient id="moonHalo"><stop offset="0" stop-color="#fff2d6" stop-opacity=".55"/><stop offset=".4" stop-color="#ffe9c9" stop-opacity=".18"/><stop offset="1" stop-color="#ffe9c9" stop-opacity="0"/></radialGradient>'
            '<radialGradient id="lanternGlow"><stop offset="0" stop-color="#ffcf6b" stop-opacity=".8"/><stop offset=".45" stop-color="#ff9a3c" stop-opacity=".25"/><stop offset="1" stop-color="#ff7a2a" stop-opacity="0"/></radialGradient>'
            '<linearGradient id="winGlow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe8a8"/><stop offset="1" stop-color="#f29a4a"/></linearGradient>'
            '<linearGradient id="waterV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6fbff"/><stop offset="1" stop-color="#7fc6dd"/></linearGradient>'
            '<linearGradient id="fallShimmer" x1="0" y1="0" x2="0" y2=".18" spreadMethod="repeat"><stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset=".5" stop-color="#ffffff" stop-opacity=".6"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>'
            '<animateTransform attributeName="gradientTransform" type="translate" values="0 0;0 .18" dur=".9s" repeatCount="indefinite"/></linearGradient>'
            '<linearGradient id="fallFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9f5ff" stop-opacity=".95"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>'
            )

    body = ("".join(sky) + f'<g id="far-mist">{"".join(far)}</g><g id="sky-lanterns">{"".join(sky_l)}</g>' + f'<g id="distant-islets" filter="{iso.haze("#3a3a7c", .62)}">{distant_svg}</g>'
            + f'<g id="hero-island">{"".join(hero)}</g>'
            + f'<g id="upper-station">{"".join(us)}</g>'
            + f'<g id="mid-mist">{"".join(mist_mid)}</g>'
            + f'<g id="anchor-islet">{"".join(an[:n_ground])}'
            + f'<g id="funicular-track">{"".join(track)}</g>' + car + f'{"".join(an[n_ground:])}</g>'
            + f'<g id="wisps">{"".join(wisp)}</g>'
            + f'<g id="cloud-sea">{"".join(sea)}</g>' + f'<g id="cranes">{"".join(birds)}</g>')
    svg = iso.document(W, H, body, title="Floating cloud tea-house village",
                       desc="Stepped tea terraces on a floating rock, a pagoda tea house, a funicular from a lower islet, mist and lanterns at dusk.")
    svg = svg.replace("</defs>", defs + "".join(S.extra_defs) + "</defs>", 1)
    return svg


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="output .svg; keep it outside the skill folder")
    ap.add_argument("--paint-light", type=float, default=.6)
    a = ap.parse_args()
    svg = build(a.paint_light)
    import xml.etree.ElementTree as ET
    ET.fromstring(svg)
    Path(a.out).write_text(svg, encoding="utf-8")
    print(f"wrote {a.out} ({len(svg) // 1024} KB)")
