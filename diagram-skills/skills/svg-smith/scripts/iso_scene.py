#!/usr/bin/env python3
"""iso_scene.py - a small toolkit for dense, isometric illustrated scenes, built by script.

Why a toolkit: a dense scene is hundreds of shaded faces. Typing them by hand never converges;
computing them from a few primitives does, as long as you render after every change. This is the
machinery from a scene that went from a flat first draft to a contest-density result
(references/dense-scenes.md tells that story and the lenses it produced).

    from iso_scene import Iso, Painter
    iso = Iso(cx=600, cy=455, scale=39)          # world unit -> px, origin on screen
    p = Painter()
    p.add(depth, iso.box(0, 0, 0, 1.4, 1.2, 1.1, "#ffd9a8"))   # any SVG string, keyed by depth
    svg = iso.document(1200, 1000, body=p.render(), title="My scene")

Conventions (keep them, the shading depends on them):
  * World axes: +x runs right-down on screen, +y left-down, +z up. Visible faces of a box are
    its top, its +y face and its +x face.
  * Depth for the painter's algorithm is x + y (bigger = nearer). Add objects with that key.
  * Every face goes through Iso.face(): it culls faces that point away from the camera, shades
    them from LIGHT, fills them with a registered gradient and lays the painted-light overlays on
    top. Do not emit raw polygons for solid geometry, or the culling and the look both break.
  * Finish (finish="flat", the default): one key light from the screen's upper left, and every
    face takes a crisp plane tone (top lighter, left face base, right face darker and bluer), with
    no airbrushed light patches. A tester called the older soft look (finish="airbrush") student
    work; dense-scenes.md Lens 10 has the story. Put any visible sun or moon on the light's side.
  * Iso.frame(...) temporarily moves the origin, changes the scale and can swap x and y (to lay a
    long object along the other axis). The light swaps with the axes, so shading stays consistent.

Run `python iso_scene.py --demo out.svg` to build and render a small sample scene: it doubles as a
smoke test that the module still works.
"""
from __future__ import annotations

import math
import re
import random
import sys
from contextlib import contextmanager
from pathlib import Path


def fmt(v: float) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".")


def hex2rgb(h):
    h = h.lstrip("#")
    if len(h) == 3:                      # short form: #abc means #aabbcc
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb2hex(c):
    return "#" + "".join(f"{max(0, min(255, int(round(v)))):02x}" for v in c)


def lstar(col):
    """CIE L* (0-100) of a hex colour: perceived lightness, for spacing flat tones."""
    def lin(v):
        v /= 255
        return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4
    r, g, b = (lin(v) for v in hex2rgb(col))
    y = .2126 * r + .7152 * g + .0722 * b
    return 116 * (y ** (1 / 3) if y > .008856 else 7.787 * y + 16 / 116) - 16


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def normal(a, b, c):
    u = [b[i] - a[i] for i in range(3)]
    v = [c[i] - a[i] for i in range(3)]
    return (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])


def seg(a, b, **attrs):
    """A screen-space line between two (x, y) points; keyword args become attributes (stroke_width=...)."""
    extra = "".join(f' {k.replace("_", "-")}="{v}"' for k, v in attrs.items())
    return f'<line x1="{fmt(a[0])}" y1="{fmt(a[1])}" x2="{fmt(b[0])}" y2="{fmt(b[1])}"{extra}/>'


def hull2d(points):
    """Convex hull (monotone chain) of screen points. Prefer clipping to the real facets (see
    Iso.facets(..., as_clip=True)); a hull is too loose wherever the outline is concave."""
    pts = sorted(set(points))

    def half(seq):
        h = []
        for p in seq:
            while len(h) >= 2 and (h[-1][0] - h[-2][0]) * (p[1] - h[-2][1]) - (h[-1][1] - h[-2][1]) * (p[0] - h[-2][0]) <= 0:
                h.pop()
            h.append(p)
        return h
    lo, hi = half(pts), half(pts[::-1])
    return lo[:-1] + hi[:-1]


class Painter:
    """Collect SVG fragments with a depth key and emit them far to near."""

    def __init__(self):
        self.items = []

    def add(self, depth: float, svg: str):
        self.items.append((depth, len(self.items), svg))

    def render(self) -> str:
        return "".join(s for _, _, s in sorted(self.items))


class Iso:
    def __init__(self, cx=600.0, cy=450.0, scale=35.0, light=(-0.7, 0.15, 0.7), view=(1.0, 1.0, 1.15),
                 shadow="#2b2466", hilite="#fff8ec", ink="#1d1846", paint_light=.75, paint_ao=.5, sheen=.26,
                 finish="flat", prefix=""):
        self.cx, self.cy, self.s = cx, cy, scale
        n = math.sqrt(sum(c * c for c in light))
        self.light = tuple(c / n for c in light)
        self.view = view
        self.swap = False
        self.shadow_rgb, self.hilite_rgb, self.ink = hex2rgb(shadow), hex2rgb(hilite), ink
        self.paint_light, self.paint_ao, self.sheen = paint_light, paint_ao, sheen
        self.finish = finish            # "flat" = crisp plane tones; "airbrush" = the older soft look
        self._grads = {}
        self.prefix = prefix            # put in front of every id this Iso makes: two scenes on one page do not collide
        self._extra = []                # clip paths and filters registered by the helpers below

    # ---------------------------------------------------------------- projection
    def pt(self, x, y, z):
        if self.swap:
            x, y = y, x
        return (self.cx + (x - y) * 0.866 * self.s, self.cy + (x + y) * 0.5 * self.s - z * self.s)

    def P(self, pts3):
        return " ".join(f"{fmt(a)},{fmt(b)}" for a, b in (self.pt(*p) for p in pts3))

    @contextmanager
    def frame(self, cx=None, cy=None, scale=None, swap=False):
        """Draw a sub-object in its own frame: new screen origin, scale, and optionally x<->y swapped.
        With swap, its local +x runs along the world's y; the light swaps too, so faces shade the same.
        Everything inside works in LOCAL axes: box(), on_face("x"/"y") and x_plane() name the local
        faces, so a window drawn with on_face("y", ...) lands on the face that is local +y."""
        keep = (self.cx, self.cy, self.s, self.swap, self.light)
        if cx is not None:
            self.cx, self.cy = cx, cy
        if scale is not None:
            self.s = scale
        if swap:
            self.swap = not self.swap
            self.light = (self.light[1], self.light[0], self.light[2])
        try:
            yield self
        finally:
            self.cx, self.cy, self.s, self.swap, self.light = keep

    # ---------------------------------------------------------------- colour
    def facing(self, n):
        return sum(a * b for a, b in zip(n, self.view)) > 0

    def shade(self, base, n):
        if self.finish == "flat":
            return self.plane_tone(base, n)
        ln = math.sqrt(sum(c * c for c in n)) or 1
        d = sum(a * b for a, b in zip(n, self.light)) / ln
        c = hex2rgb(base)
        if d >= 0.55:
            return rgb2hex(mix(c, self.hilite_rgb, (d - 0.55) * 0.55))
        return rgb2hex(mix(c, self.shadow_rgb, (0.55 - d) * 0.62))

    def plane_tone(self, base, n):
        """Four crisp tones by facing: top, light side, base, away side (darker, shifted to the
        shadow hue). Flat planes in three or four values are what make a vector scene read as
        designed; a continuous ramp reads as airbrushed. The tones keep a minimum lightness gap
        (TONE_GAP): on a pale base, mixing toward the highlight changes almost nothing, and a critic
        found a cream airship whose 'three tones' sat 1-5 L* apart and had no shadow side."""
        ln = math.sqrt(sum(c * c for c in n)) or 1
        nz = n[2] / ln
        hl = math.hypot(n[0], n[1]) or 1
        lh = math.hypot(self.light[0], self.light[1]) or 1
        hd = (n[0] * self.light[0] + n[1] * self.light[1]) / (hl * lh)
        top, lit, mid, dark = self.tone_set(base)
        if nz > .8:
            return top
        if hd > .1:                     # turned toward the light (left faces, the lit roof slope)
            return lit
        if hd > -.25:
            return mid
        return dark

    TONE_GAP = (10, 22)                 # L*: next tone at least 10 below; the dark face at least 22 below the top

    def tone_set(self, base):
        """(top, lit side, base side, dark side) for a colour, spaced by TONE_GAP in L*."""
        if not hasattr(self, "_tones"):
            self._tones = {}
        if base in self._tones:
            return self._tones[base]
        c = hex2rgb(base)
        top = rgb2hex(mix(c, self.hilite_rgb, .2))
        lit = rgb2hex(mix(c, self.hilite_rgb, .1))
        Lt = lstar(top)
        mid, t = base, 0.0
        while Lt - lstar(mid) < self.TONE_GAP[0] and t < .6:      # pale base: step the side face down
            t += .03
            mid = rgb2hex(mix(c, self.shadow_rgb, t))
        t2 = max(.5, t + .1)
        dark = rgb2hex(mix(c, self.shadow_rgb, t2))
        while (Lt - lstar(dark) < self.TONE_GAP[1] or lstar(mid) - lstar(dark) < self.TONE_GAP[0]) and t2 < .9:
            t2 += .03
            dark = rgb2hex(mix(c, self.shadow_rgb, t2))
        self._tones[base] = (top, lit, mid, dark)
        return self._tones[base]

    def curved_tone(self, base, n):
        """Continuous tone for a curved surface (a drum wall, a tank): it turns from lit to dark
        around the curve instead of splitting into bands."""
        hl = math.hypot(n[0], n[1]) or 1
        lh = math.hypot(self.light[0], self.light[1]) or 1
        hd = (n[0] * self.light[0] + n[1] * self.light[1]) / (hl * lh)
        c = hex2rgb(base)
        return rgb2hex(mix(c, self.hilite_rgb, .14 * hd)) if hd > 0 else rgb2hex(mix(c, self.shadow_rgb, .5 * -hd))

    def lighten(self, col, t):
        return rgb2hex(mix(hex2rgb(col), (255, 255, 255), t))

    def darken(self, col, t):
        return rgb2hex(mix(hex2rgb(col), hex2rgb(self.ink), t))

    def grad(self, col, kind="v"):
        """Register (once) and return a gradient fill around a flat colour: v = top-lit, h = across,
        d = diagonal sheen for crystal facets."""
        if self.finish == "flat":
            return col                  # flat finish: every face one flat tone, no gradient at all
        key = (col, kind)
        if key not in self._grads:
            gid = f"{self.prefix}g{len(self._grads)}"
            if kind == "v" and self.finish == "flat":      # a faint top-to-foot falloff, nothing more
                body = (f'<linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{self.lighten(col, .04)}"/>'
                        f'<stop offset="1" stop-color="{self.darken(col, .12)}"/></linearGradient>')
            elif kind == "v":
                body = (f'<linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{self.lighten(col, .16)}"/>'
                        f'<stop offset="1" stop-color="{self.darken(col, .14)}"/></linearGradient>')
            elif kind == "h":
                body = (f'<linearGradient id="{gid}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="{self.lighten(col, .25)}"/>'
                        f'<stop offset=".45" stop-color="{col}"/><stop offset="1" stop-color="{self.darken(col, .3)}"/></linearGradient>')
            else:
                body = (f'<linearGradient id="{gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{self.lighten(col, .3)}"/>'
                        f'<stop offset=".5" stop-color="{col}"/><stop offset="1" stop-color="{self.darken(col, .12)}"/></linearGradient>')
            self._grads[key] = (gid, body)
        return f"url(#{self._grads[key][0]})"

    def defs(self):
        """Every registered gradient plus the shared painted-light overlays. Put it in <defs>."""
        pl, ao = self.paint_light, self.paint_ao
        paint = (f'<radialGradient id="paintLight" cx=".3" cy=".22" r=".8"><stop offset="0" stop-color="#ffffff" stop-opacity="{pl}"/>'
                 f'<stop offset=".55" stop-color="#ffffff" stop-opacity="{pl / 4:.2f}"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>'
                 f'<linearGradient id="paintAO" x1="0" y1="0" x2="0" y2="1"><stop offset=".4" stop-color="{self.ink}" stop-opacity="0"/>'
                 f'<stop offset="1" stop-color="{self.ink}" stop-opacity="{ao}"/></linearGradient>'
                 f'<radialGradient id="paintSheen" cx=".35" cy=".3" r=".7"><stop offset="0" stop-color="#ffffff" stop-opacity="{self.sheen}"/>'
                 f'<stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>'
                 '<filter id="softglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>')
        if self.finish == "flat":
            paint = ""                  # the flat finish uses none of the airbrush overlays or the blur
        return "".join(b for _, b in self._grads.values()) + paint + "".join(self._extra)

    # ---------------------------------------------------------------- faces
    def paint(self, pts3, n):
        """Hand-painted look on one flat face: walls get ambient occlusion at the base plus a light
        patch; tops get the light patch. The flat finish skips it."""
        if self.finish == "flat":
            return ""
        pts = self.P(pts3)
        nz = abs(n[2]) / (math.sqrt(sum(c * c for c in n)) or 1)
        if nz < .35:
            return f'<polygon points="{pts}" fill="url(#paintAO)"/><polygon points="{pts}" fill="url(#paintLight)" opacity=".6"/>'
        return f'<polygon points="{pts}" fill="url(#paintLight)"/>'

    def face(self, pts3, base, hint, grad="v", painted=True):
        """A planar face. `hint` is roughly its outward normal; the face is culled if it points away."""
        n = normal(*pts3[:3])
        if sum(a * b for a, b in zip(n, hint)) < 0:
            n = tuple(-v for v in n)
        if not self.facing(n):
            return ""
        col = self.shade(base, n)
        return (f'<polygon points="{self.P(pts3)}" fill="{self.grad(col, grad)}" stroke="{col}" stroke-width=".6" stroke-linejoin="round"/>'
                + (self.paint(pts3, n) if painted else ""))

    def box(self, x, y, z, dx, dy, dz, base, rim=True):
        """An axis box: top, +y and +x faces, plus a rim light on its top-front edges and corner."""
        out = [self.face([(x, y, z + dz), (x + dx, y, z + dz), (x + dx, y + dy, z + dz), (x, y + dy, z + dz)], base, (0, 0, 1)),
               self.face([(x, y + dy, z), (x + dx, y + dy, z), (x + dx, y + dy, z + dz), (x, y + dy, z + dz)], base, (0, 1, 0)),
               self.face([(x + dx, y, z), (x + dx, y + dy, z), (x + dx, y + dy, z + dz), (x + dx, y, z + dz)], base, (1, 0, 0))]
        if rim:
            rc = self.lighten(base, .7)
            tl, tc, tr = self.pt(x, y + dy, z + dz), self.pt(x + dx, y + dy, z + dz), self.pt(x + dx, y, z + dz)
            bc = self.pt(x + dx, y + dy, z)
            out.append(f'<polyline points="{fmt(tl[0])},{fmt(tl[1])} {fmt(tc[0])},{fmt(tc[1])} {fmt(tr[0])},{fmt(tr[1])}" fill="none" '
                       f'stroke="{rc}" stroke-width="1.6" stroke-linejoin="round" opacity=".95"/>' + seg(tc, bc, stroke=rc, stroke_width="1.2", opacity=".75"))
        return "".join(out)

    def on_face(self, face, x, y, dx, dy, u0, u1, z0, z1, eps=.012):
        """Corners of a rectangle drawn ON a box's visible face (for windows, doors, labels, panels).
        face 'y' = the plane y+dy (u runs along x); face 'x' = the plane x+dx (u runs along y)."""
        if face == "y":
            return [(x + u0, y + dy + eps, z0), (x + u1, y + dy + eps, z0), (x + u1, y + dy + eps, z1), (x + u0, y + dy + eps, z1)]
        return [(x + dx + eps, y + u0, z0), (x + dx + eps, y + u1, z0), (x + dx + eps, y + u1, z1), (x + dx + eps, y + u0, z1)]

    def gable_roof(self, x, y, z, dx, dy, h, base, eave=.15):
        ym = y + dy / 2
        a, b = (x - eave, y - eave, z), (x + dx + eave, y - eave, z)
        c, d = (x + dx + eave, y + dy + eave, z), (x - eave, y + dy + eave, z)
        r0, r1 = (x - eave, ym, z + h), (x + dx + eave, ym, z + h)
        p0, p1 = self.pt(*r0), self.pt(*r1)
        return (self.face([a, b, r1, r0], base, (0, -1, 1)) + self.face([d, c, r1, r0], base, (0, 1, 1))
                + self.face([b, c, r1], base, (1, 0, 0))
                + seg(p0, p1, stroke=self.lighten(base, .7), stroke_width="1.8", stroke_linecap="round"))

    # ---------------------------------------------------------------- low-poly bodies
    def lowpoly(self, rings, seed, n=10, jitter=.18):
        """A faceted body from rings [(z, radius), ...] (radius 0 = a tip). Returns (triangles, z-centre).
        Rocks, crystals, mountains, tree crowns, island undersides."""
        rr = random.Random(seed)
        pts = []
        for z, r in rings:
            if r == 0:
                tip = (rr.uniform(-.15, .15), rr.uniform(-.15, .15), z)
                pts.append([tip] * n)
                continue
            off = rr.uniform(-.25, .25)
            pts.append([(r * math.cos(2 * math.pi * (i + off + rr.uniform(-jitter, jitter)) / n) * rr.uniform(.86, 1.1),
                         r * math.sin(2 * math.pi * (i + off + rr.uniform(-jitter, jitter)) / n) * rr.uniform(.86, 1.1),
                         z + rr.uniform(-.22, .22) * (1 if z else 0)) for i in range(n)])
        tris = []
        for A, B in zip(pts, pts[1:]):
            for i in range(n):
                a1, a2, b1, b2 = A[i], A[(i + 1) % n], B[i], B[(i + 1) % n]
                if a1 != a2:
                    tris.append((a1, a2, b1))
                if b1 != b2:
                    tris.append((a2, b2, b1))
        return tris, sum(z for z, _ in rings) / len(rings)

    def facets(self, body, base, offset=(0, 0, 0), cap_from=None, cap_col=None, stroke=.7, as_clip=False):
        """Render a low-poly body: back facets culled, front ones shaded, sorted far to near, each with
        a painted sheen. as_clip=True returns bare polygons for a <clipPath> of the exact silhouette."""
        tris, zc = body
        items = []
        for a, b, c in tris:
            a, b, c = [(p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]) for p in (a, b, c)]
            n = normal(a, b, c)
            cen = ((a[0] + b[0] + c[0]) / 3 - offset[0], (a[1] + b[1] + c[1]) / 3 - offset[1], (a[2] + b[2] + c[2]) / 3 - offset[2] - zc)
            if sum(p * q for p, q in zip(n, cen)) < 0:
                n = tuple(-v for v in n)
            if not self.facing(n):
                continue
            col = cap_col if (cap_from is not None and min(a[2], b[2], c[2]) >= cap_from + offset[2]) else base
            items.append((sum(p[0] + p[1] for p in (a, b, c)) / 3, a, b, c, self.shade(col, n)))
        items.sort()
        if as_clip:
            return "".join(f'<polygon points="{self.P([a, b, c])}"/>' for _, a, b, c, _ in items)
        sheen = self.finish != "flat"
        return "".join(f'<polygon points="{self.P([a, b, c])}" fill="{self.grad(col, "d")}" stroke="{col}" stroke-width="{stroke}" stroke-linejoin="round"/>'
                       + (f'<polygon points="{self.P([a, b, c])}" fill="url(#paintSheen)"/>' if sheen else "") for _, a, b, c, col in items)

    # ---------------------------------------------------------------- designer-finish helpers (Lens 10)
    def hip_roof(self, x, y, z, dx, dy, h, col, eave=.3, lift=.2, inset=.33, steps=12, fascia="#7a2a22",
                 ridge=None, underglow="#ffb060"):
        """A hip roof with upswept corners over the box (x, y, dx, dy) at height z. Its slopes take
        plane tones; the eave the light hits gets a pale rim and a lit fascia, the other a dark fascia;
        `underglow` draws a warm line under every visible eave (lanterns below), None for none;
        `ridge` (a colour) traces the ridge, for the hero building only. Returns (svg, corners) with
        the screen points of the left, front and right eave corners, for hanging lanterns."""
        X0, Y0, X1, Y1 = x - eave, y - eave, x + dx + eave, y + dy + eave
        tx0, tx1, ty0, ty1 = x + dx * inset, x + dx * (1 - inset), y + dy * inset, y + dy * (1 - inset)
        zt = z + h

        def eave_pts(p, q):
            return [(p[0] + (q[0] - p[0]) * i / steps, p[1] + (q[1] - p[1]) * i / steps, z + lift * (2 * i / steps - 1) ** 2)
                    for i in range(steps + 1)]
        sides = [((X0, Y1), (X0, Y0), (-1, 0), (tx0, ty1), (tx0, ty0)),
                 ((X0, Y0), (X1, Y0), (0, -1), (tx0, ty0), (tx1, ty0)),
                 ((X0, Y1), (X1, Y1), (0, 1), (tx0, ty1), (tx1, ty1)),
                 ((X1, Y0), (X1, Y1), (1, 0), (tx1, ty0), (tx1, ty1))]
        out, fronts = [], []
        for p, q, o, ta, tb in sides:
            ep = eave_pts(p, q)
            f = self.face([(ta[0], ta[1], zt), (tb[0], tb[1], zt)] + ep[::-1], col, (o[0], o[1], 1.1))
            out.append(f)
            if f and o[0] + o[1] > 0:
                fronts.append((ep, o))
        for ep, o in fronts:
            lit = o[0] * self.light[0] + o[1] * self.light[1] > 0
            lo = [(px, py, pz - .07) for px, py, pz in ep]
            out.append(f'<polygon points="{self.P(ep + lo[::-1])}" fill="{fascia if lit else self.darken(fascia, .35)}"/>')
            if lit:
                out.append(f'<polyline points="{self.P(ep)}" fill="none" stroke="{self.lighten(col, .62)}" stroke-width="1.4" stroke-linecap="round"/>')
            if underglow:
                out.append(f'<polyline points="{self.P(lo)}" fill="none" stroke="{underglow}" stroke-width="1.2" opacity=".45"/>')
        out.append(self.face([(tx0, ty0, zt), (tx1, ty0, zt), (tx1, ty1, zt), (tx0, ty1, zt)], self.darken(col, .15), (0, 0, 1), painted=False))
        if ridge:
            out.append(seg(self.pt(tx0, ty1, zt), self.pt(tx1, ty1, zt), stroke=ridge, stroke_width="1.6"))
            out.append(seg(self.pt(tx1, ty0, zt), self.pt(tx1, ty1, zt), stroke=ridge, stroke_width="1.6"))
        corners = {"left": self.pt(X0, Y1, z + lift), "front": self.pt(X1, Y1, z + lift), "right": self.pt(X1, Y0, z + lift)}
        return "".join(out), corners

    MASS_GREEN = {"top": "#98bd62", "rim": "#c9e08c", "body": "#6a9444", "under": "#3e6640",
                  "body_away": "#557a3a", "under_away": "#334f33", "seam": "#24391f", "shadow": "#b4b0d6"}

    def mass_row(self, path, z, w=.25, h=.24, lump=.34, colors=None, rng=None, seg_len=(40, 90), gap=5,
                 closed=True, min_px=1.0):
        """A row of repeated things (tea bushes, hedges, crates, reeds) drawn as ONE scalloped mass, not
        a row of dots and not a flat ribbon. `path` is a list of (x, y, ok) ground samples, dense
        enough (about 0.03 units apart); ok=False leaves a gap (a doorway, a path, a house). The row is
        cut into segments of random length with small gaps; each segment has a rounded bush top every
        `lump` units, three tones (lit top, body, dark underside band) plus a seam and a lit rim, and
        throws a crisp multiply shadow. Runs seen edge-on (screen width under min_px x height) are
        dropped, because they render as upright slabs. Returns [(depth, svg)] for a Painter."""
        col = dict(self.MASS_GREEN, **(colors or {}))
        rng = rng or random.Random(0)
        n = len(path)
        samples, arc = [], 0.0
        for i, (x, y, ok) in enumerate(path):
            a = path[(i - 1) % n] if (closed or i > 0) else path[i]
            b = path[(i + 1) % n] if (closed or i < n - 1) else path[i]
            tx, ty = b[0] - a[0], b[1] - a[1]
            tl = math.hypot(tx, ty) or 1
            if i:
                arc += math.hypot(x - path[i - 1][0], y - path[i - 1][1])
            u = (arc / lump) % 1
            samples.append([x, y, ok, ty / tl, -tx / tl, h * (.5 + .5 * math.sqrt(max(0.0, 1 - (2 * u - 1) ** 2)))])
        runs, i = [], 0
        while i < n:
            L = rng.randint(*seg_len)
            cur = []
            for q in samples[i:i + L] + [[0, 0, False, 0, 0, 0]]:
                if q[2]:
                    cur.append(list(q))
                    continue
                if len(cur) > 3:
                    cur[0][5] = cur[-1][5] = h * .35
                    runs.append(cur)
                cur = []
            i += L + gap
        out = []
        lx, ly = self.light[0], self.light[1]
        for run in runs:
            m = run[len(run) // 2]
            sgn = 1 if m[3] * self.view[0] + m[4] * self.view[1] > 0 else -1      # the side facing us
            edge = [(x + sgn * nx * w, y + sgn * ny * w) for x, y, _, nx, ny, _ in run]
            far = [(x - sgn * nx * w, y - sgn * ny * w) for x, y, _, nx, ny, _ in run]
            shd = [(x + sgn * nx * w * 2.1, y + sgn * ny * w * 2.1) for x, y, _, nx, ny, _ in run]
            hs = [q[5] for q in run]
            sp = [self.pt(x, y, z) for x, y in edge]
            if max(q[0] for q in sp) - min(q[0] for q in sp) < h * self.s * min_px:
                continue
            away = sgn * (m[3] * lx + m[4] * ly) < -.3
            body, under = (col["body_away"], col["under_away"]) if away else (col["body"], col["under"])
            g = [f'<polygon points="{self.P([(x, y, z) for x, y in edge] + [(x, y, z) for x, y in shd[::-1]])}" fill="{col["shadow"]}" style="mix-blend-mode:multiply"/>']
            g.append(f'<polygon points="{self.P([(x, y, z) for x, y in edge] + [(x, y, z + hh) for (x, y), hh in zip(edge[::-1], hs[::-1])])}" fill="{body}"/>')
            g.append(f'<polygon points="{self.P([(x, y, z) for x, y in edge] + [(x, y, z + hh * .32) for (x, y), hh in zip(edge[::-1], hs[::-1])])}" fill="{under}"/>')
            g.append(f'<polyline points="{self.P([(x, y, z) for x, y in edge])}" fill="none" stroke="{col["seam"]}" stroke-width="1"/>')
            g.append(f'<polygon points="{self.P([(x, y, z + hh) for (x, y), hh in zip(far, hs)] + [(x, y, z + hh) for (x, y), hh in zip(edge[::-1], hs[::-1])])}" fill="{col["top"]}"/>')
            g.append(f'<polyline points="{self.P([(x, y, z + hh) for (x, y), hh in zip(edge, hs)])}" fill="none" stroke="{col["rim"]}" stroke-width="1.1"/>')
            out.append((sum(x + y for x, y in edge) / len(edge), "".join(g)))
        return out

    CLOUD_NEAR = ("#c08cb4", "#f3c7c3", "#fff2e6")     # underside, mid, lit cap
    CLOUD_FAR = ("#4f4180", "#715e9c", "#9a7fae")
    CLOUD_DAY = ("#a9bfdc", "#dfe9f5", "#ffffff")       # a daytime scene: cool blue belly, white cap
    CLOUD_DAY_FAR = ("#8fa9cc", "#b8cbe3", "#d9e5f2")

    def cel_cloud(self, cx, cy, w, h, seed, ramp=CLOUD_NEAR, opacity=1.0, drift=0):
        """A cumulus in SCREEN space: flat base, a crown of mixed puff sizes, a smaller second tier,
        filled in three opaque steps (a violet underside, a mid tone, a lit cap clipped inside the
        shape). No blur, no per-puff gradient, no white balls on top. drift (px) adds a slow sway."""
        cr = random.Random(seed)
        circ = []
        k = max(6, int(w / (h * .45)))
        base = cy + h * .3
        for x in sorted(cx - w / 2 + w * (i + cr.uniform(-.35, .35)) / (k - 1) for i in range(k)):
            t = min(max((x - (cx - w / 2)) / w, 0), 1)
            r = h * (.45 + .55 * math.sin(math.pi * t) ** .7) * cr.uniform(.55, 1.1)
            circ.append(f'<circle cx="{fmt(x)}" cy="{fmt(base - r * .75)}" r="{fmt(r)}"/>')
        for _ in range(max(2, k // 3)):
            t = cr.uniform(.2, .8)
            r = h * cr.uniform(.45, .75) * math.sin(math.pi * t) ** .5
            circ.append(f'<circle cx="{fmt(cx - w / 2 + w * t)}" cy="{fmt(base - h * 1.05 - r * .3)}" r="{fmt(r)}"/>')
        foot = (f'<rect x="{fmt(cx - w / 2 + h * .2)}" y="{fmt(base - h * .55)}" width="{fmt(w - h * .4)}" '
                f'height="{fmt(h * .55)}" rx="{fmt(h * .25)}"/>')
        under, mid, lit = ramp
        mt = f'transform="translate({fmt(-h * .06)},{fmt(-h * .2)})"'
        cid = f"{self.prefix}cc{seed}_{len(self._extra)}"     # unique even when a seed is reused
        # a clipPath may not contain <g>: the transform goes on each shape, or the clip draws nothing
        self._extra.append(f'<clipPath id="{cid}">{"".join(c.replace("<circle", "<circle " + mt) for c in circ)}</clipPath>')
        anim = (f'<animateTransform attributeName="transform" type="translate" values="0,0;{drift},0;0,0" '
                f'dur="{abs(drift) * 1.4 + 20:.0f}s" repeatCount="indefinite"/>' if drift else "")
        return (f'<g opacity="{opacity}">{anim}<g fill="{under}">{"".join(circ)}{foot}</g>'
                f'<g fill="{mid}" {mt}>{"".join(circ)}</g>'
                f'<g clip-path="url(#{cid})"><g fill="{lit}" transform="translate({fmt(-h * .2)},{fmt(-h * .42)})">{"".join(circ)}</g></g></g>')

    def haze(self, color="#3a3a7c", amount=.62):
        """Register an atmospheric-perspective filter and return its url(): it pulls a group about
        `amount` of the way to the sky colour, so distant islets sit back. Use on far groups only."""
        fid = f"{self.prefix}haze{len(self._extra)}"
        self._extra.append(f'<filter id="{fid}" x="-5%" y="-5%" width="110%" height="110%"><feFlood flood-color="{color}" flood-opacity="{amount}"/>'
                           '<feComposite in2="SourceGraphic" operator="in"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode/></feMerge></filter>')
        return f"url(#{fid})"

    @staticmethod
    def leading_line(start, ctrl, end, n, seed=0, spread=(30, 120), size=(1.5, .45), start_t=.08):
        """Points for a stream of small things (sky lanterns, birds, sparks, leaves) along one curve
        from the focal object outwards: the spread widens and the size shrinks with distance, so the
        stream reads as one line leading the eye, not confetti. Returns [(x, y, scale)] in screen px."""
        r = random.Random(seed)
        out = []
        for i in range(n):
            t = start_t + (1 - start_t) * (i + r.uniform(0, .8)) / n
            bx = (1 - t) ** 2 * start[0] + 2 * (1 - t) * t * ctrl[0] + t * t * end[0]
            by = (1 - t) ** 2 * start[1] + 2 * (1 - t) * t * ctrl[1] + t * t * end[1]
            sp = spread[0] + (spread[1] - spread[0]) * t
            out.append((bx + r.uniform(-sp, sp), by + r.uniform(-sp, sp) * .6, size[0] + (size[1] - size[0]) * t))
        return out

    def cast_shadow(self, x, y, z, dx, dy, dz, tint="#8d86c0", clip=None):
        """A crisp shadow of a box (x, y, z, dx, dy, dz) thrown on the plane z, away from the light.
        Drawn with multiply so what it falls on stays readable; put it BEFORE the object.
        Near an edge the shadow runs off the ground into the sky: pass clip=ground_clip(...) for the
        surface it falls on. On pale ground the default tint reads as lavender paving; pick a tint
        that is the ground colour darkened toward the shadow hue."""
        lx, ly, lz = self.light
        k = (dz + .35) / max(lz, .2)
        ox, oy = -lx * k, -ly * k
        foot = [(x, y), (x + dx, y), (x + dx, y + dy), (x, y + dy)]
        hull = hull2d([self.pt(px, py, z) for px, py in foot] + [self.pt(px + ox, py + oy, z) for px, py in foot])
        cp = f' clip-path="{clip}"' if clip else ""
        return f'<polygon points="{" ".join(f"{fmt(a)},{fmt(b)}" for a, b in hull)}" fill="{tint}" style="mix-blend-mode:multiply"{cp}/>'

    def face_tone(self, col, face):
        """The tone a colour takes on a box's visible face ("x", "y" or "top"), so a window, band or
        sign painted on a dark face darkens with it instead of glowing untoned."""
        n = {"x": (1, 0, 0), "y": (0, 1, 0), "top": (0, 0, 1)}[face]
        return self.plane_tone(col, n)

    def stairs(self, x, y, z, n, run=.22, rise=.14, width=.6, axis="x", col="#cfc6b4", sign=1):
        """A straight flight of n steps starting at (x, y, z), climbing along +axis (sign=-1 to climb
        toward -axis), each step `run` deep and `rise` high, `width` wide. Treads take the top tone,
        risers the face tone; drawn far to near so they overlap correctly."""
        out = []
        order = range(n) if sign > 0 else range(n - 1, -1, -1)      # far to near: x + y grows toward us
        for i in order:
            z0, z1 = z + i * rise, z + (i + 1) * rise
            if axis == "x":
                bx = x + sign * i * run if sign > 0 else x - (i + 1) * run
                out.append(self.box(bx, y, z0, run, width, rise, col, rim=False))
            else:
                by = y + sign * i * run if sign > 0 else y - (i + 1) * run
                out.append(self.box(x, by, z0, width, run, rise, col, rim=False))
        return "".join(out)

    # ---------------------------------------------------------------- mountains and slope shadows
    def crag(self, cx, cy, rings, seed, n=14, rock="#b7a28b", snow=None, snow_col="#eef2f8", top=None,
             shelves=.84, shelf_col="#a9a46c", rock_dark=None, crack=True):
        """A mountain, crag or rock spire as a faceted mass. `rings` = [(z, R), ...] from the base up
        (R = 0 makes a summit point). Every facet takes a flat plane tone; with `shelves` a near-flat
        ledge ring follows each middle ring, so pale up-facing ledges alternate with cliff bands;
        faces above z `snow` (jagged) turn `snow_col`; `top` (a colour) caps it with a flat summit
        plateau; `rock_dark` overrides the rock's shadow tone (keep it well below the sky); `crack`
        adds dark slivers on some rock faces.
        Returns (svg, rad, facets): rad(theta, z) is the mass's radius at that height (to seat
        buildings on it), and facets lists the visible faces as (triangle_pts3, normal), for
        facet_shadow() and for a clip path of the exact silhouette (facet_clip())."""
        r = random.Random(seed)
        off = [r.uniform(-.22, .22) for _ in range(n)]
        mul = [r.uniform(.86, 1.12) for _ in range(n)]
        if shelves:
            rr_ = []
            for k, (z, R) in enumerate(rings):
                rr_.append((z, R))
                if 0 < k < len(rings) - 1 and R > 0 and not (top and k == len(rings) - 1):
                    rr_.append((z + .06, R * shelves))
            rings = rr_
        pts, last = [], len(rings) - 1
        for k, (z, R) in enumerate(rings):
            if R == 0:
                pts.append([(cx + r.uniform(-.2, .2), cy + r.uniform(-.2, .2), z)] * n)
                continue
            ring = []
            for i in range(n):
                a = 2 * math.pi * (i + off[i] + .07 * k) / n
                q = R * mul[i] * r.uniform(.93, 1.07)
                zz = z if (k == 0 or (k == last and top)) else z + r.uniform(-.3, .3)
                ring.append((cx + q * math.cos(a), cy + q * math.sin(a), zz))
            pts.append(ring)
        tris = []
        for A, B in zip(pts, pts[1:]):
            for i in range(n):
                a1, a2, b1, b2 = A[i], A[(i + 1) % n], B[i], B[(i + 1) % n]
                if a1 != a2:
                    tris.append((a1, a2, b1))
                if b1 != b2:
                    tris.append((a2, b2, b1))
        sr = random.Random(seed + 1)
        items, facets = [], []
        dark_rock = rock_dark or self.tone_set(rock)[3]
        for t in tris:
            nrm = normal(*t)           # ring winding gives the outward normal (shelves face up)
            cen = [sum(p[i] for p in t) / 3 for i in range(3)]
            if not self.facing(nrm):
                continue
            col = rock
            up = nrm[2] / (math.sqrt(sum(c * c for c in nrm)) or 1)
            if up > .75 and shelves:
                col = snow_col if (snow is not None and cen[2] > snow - 3.5) else shelf_col
            if snow is not None and cen[2] > snow + sr.uniform(-.7, .7):
                col = snow_col
            tone = self.shade(col, nrm)
            if col == rock and rock_dark and tone == self.tone_set(rock)[3]:
                tone = rock_dark
            svg = f'<polygon points="{self.P(t)}" fill="{tone}" stroke="{tone}" stroke-width=".6" stroke-linejoin="round"/>'
            if crack and col == rock and sr.random() < .45:
                a, b, c = t
                u = sr.uniform(.3, .7)          # one draw per crack (keeps scenes reproducible)
                m = tuple(b[i] + (c[i] - b[i]) * u for i in range(3))
                f = sr.uniform(.55, .85)
                tip = tuple(a[i] + (m[i] - a[i]) * f for i in range(3))
                c2 = tuple(a[i] + (c[i] - a[i]) * .1 for i in range(3))
                if tone != dark_rock:
                    svg += f'<polygon points="{self.P([a, tip, c2])}" fill="{dark_rock}"/>'
            items.append((cen[0] + cen[1] + cen[2], svg))
            facets.append((t, nrm))
        if top:
            items.append((1e9, self.face(pts[-1], top, (0, 0, 1))))
        items.sort(key=lambda q: q[0])
        zs, Rs = [z for z, _ in rings], [R for _, R in rings]

        def rad(theta, z):
            for k in range(len(zs) - 1):
                if zs[k] <= z <= zs[k + 1]:
                    R = Rs[k] + (Rs[k + 1] - Rs[k]) * (z - zs[k]) / ((zs[k + 1] - zs[k]) or 1)
                    break
            else:
                R = Rs[0] if z < zs[0] else Rs[-1]
            return R * mul[int(round((theta / (2 * math.pi)) * n)) % n]
        return "".join(svg for _, svg in items), rad, facets

    def facet_clip(self, facets):
        """Register a clip path shaped like a crag's whole visible silhouette; return its url()."""
        cid = f"{self.prefix}fc{len(self._extra)}"
        self._extra.append(f'<clipPath id="{cid}">{"".join(f"<polygon points={chr(34)}{self.P(t)}{chr(34)}/>" for t, _ in facets)}</clipPath>')
        return f"url(#{cid})"

    def facet_shadow(self, box, facets, tint="#8d86c0", reach=4.0):
        """The shadow a box (x, y, z, dx, dy, dz) throws onto sloping rock: its corners are projected
        along the light onto the PLANE of each nearby lit facet and clipped to that facet, so on a
        steep face the shadow is a narrow sliver running down the slope, not a flat-ground pool.
        Facets turned away from the light are skipped: they are in shadow already. Each piece is a
        crisp multiply shape clipped on itself (never inside a clipped group: that isolates the blend).
        Put it after the crag and before the box. Returns svg."""
        x, y, z, dx, dy, dz = box
        L = self.light
        corners = [(x + i * dx, y + j * dy, z + k * dz) for i in (0, 1) for j in (0, 1) for k in (0, 1)]
        bx, by = x + dx / 2, y + dy / 2
        if not hasattr(self, "_fclip"):
            self._fclip = {}
        out = []
        for t, nrm in facets:
            cen = [sum(p[i] for p in t) / 3 for i in range(3)]
            if math.hypot(cen[0] - bx, cen[1] - by) > reach or cen[2] > z + dz:
                continue
            nl = math.sqrt(sum(c * c for c in nrm)) or 1
            n = tuple(c / nl for c in nrm)
            ndl = sum(a * b for a, b in zip(n, L))
            if ndl <= .05:
                continue
            p0 = t[0]
            above = [sum(n[i] * (c[i] - p0[i]) for i in range(3)) for c in corners]
            if max(above) <= 1e-6:      # the box is wholly behind this facet's plane: no shadow lands here
                continue
            proj = []
            for c, h in zip(corners, above):
                tt = max(0.0, h / ndl)
                proj.append(self.pt(*(c[i] - tt * L[i] for i in range(3))))
            hull = hull2d(proj)
            tri = [self.pt(*q) for q in t]
            if (max(q[0] for q in hull) < min(q[0] for q in tri) or min(q[0] for q in hull) > max(q[0] for q in tri)
                    or max(q[1] for q in hull) < min(q[1] for q in tri) or min(q[1] for q in hull) > max(q[1] for q in tri)):
                continue
            key = tuple(round(v, 4) for q in t for v in q)
            if key not in self._fclip:
                cid = f"{self.prefix}fs{len(self._extra)}"
                self._extra.append(f'<clipPath id="{cid}"><polygon points="{self.P(t)}"/></clipPath>')
                self._fclip[key] = cid
            out.append(f'<polygon points="{" ".join(f"{fmt(a)},{fmt(b)}" for a, b in hull)}" fill="{tint}" '
                       f'style="mix-blend-mode:multiply" clip-path="url(#{self._fclip[key]})"/>')
        return "".join(out)

    # ---------------------------------------------------------------- value budget and shadow union
    @staticmethod
    def value_budget(focal, tones, radii):
        """A value budget by distance from the focal object, so nothing outshines it. `focal` is its
        world point (x, y, z); `tones` are colours from the nearest tier to the farthest, each one
        a step darker (whitewash L* 91 / 87 / 83 against a focal white of 95); `radii` are the outer
        distances of every tier but the last. Returns tone(x, y, z) -> colour: call it per building
        and give the focal building its own, brighter colour. A critic found ~40 white roofs and the
        clouds out-shining a gold-and-red hall until whites were stepped down like this.

            tone = Iso.value_budget(hall_centre, ("#ece4d4", "#e2d8c5", "#d8cdb9"), (3.2, 6.0))
            iso.box(x, y, z, w, d, h, tone(x + w / 2, y + d / 2, z))"""
        assert len(tones) == len(radii) + 1, "one radius per tier except the last"

        def tone(x, y, z):
            dist = math.dist((x, y, z), focal)
            for col, r in zip(tones, radii):
                if dist < r:
                    return col
            return tones[-1]
        return tone

    @staticmethod
    def shadow_union(shadows, tint=None):
        """Paint a set of multiply shadows so that where they overlap they darken ONCE. Each shadow
        is drawn as a plain flat shape inside one group, and the group is multiplied onto the scene.
        Separate multiply shapes stack: tested, an overlap of two went (119,105,126) -> (66,55,95).
        `shadows` are svg strings from cast_shadow() / facet_shadow() (their own clip paths are
        kept); `tint` overrides their fill. Every shadow in one union must fall on surfaces drawn
        BEFORE the union, and the group must not sit inside a clipped/filtered/faded group (that
        isolates the blend: see finish_check's `isolated`)."""
        body = "".join(shadows).replace(' style="mix-blend-mode:multiply"', "")
        if tint:
            body = re.sub(r'fill="#[0-9a-fA-F]{3,6}"', f'fill="{tint}"', body)
        return f'<g style="mix-blend-mode:multiply">{body}</g>' if body else ""

    def ground_clip(self, pts3):
        """Register a clip path shaped like a ground polygon (a terrace top, a deck, a quay) and
        return its url(), for shadows and props that must not spill off that surface."""
        cid = f"{self.prefix}gc{len(self._extra)}"
        self._extra.append(f'<clipPath id="{cid}"><polygon points="{self.P(pts3)}"/></clipPath>')
        return f"url(#{cid})"

    def columns(self, cx, cy, z, rfun, depth, seed, nsec=22, rings=(1.0, .8, .6, .4, .2),
                ramp=("#8a70a3", "#5a4680", "#30244e"), bounce="#e8957a"):
        """A floating rock's underside as hanging columns, longer toward the middle, so it tapers
        and ends in teeth. rfun(angle) is the rim radius. Each face takes one of three flat values
        (ramp = lit, mid, dark) by facing; faces turned downward pick up `bounce` (light from below,
        e.g. a sunset). Thresholds are tuned to the default light."""
        rr = random.Random(seed)
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
                    q = r * rfun(a)
                    return (cx + q * math.cos(a), cy + q * math.sin(a), zz)
                angs = (a0, am, a1)
                top_o, bot_o = [ring(r1, a, z) for a in angs], [ring(r1, a, z - L) for a in angs]
                if r0 > 0:
                    top_i, bot_i = [ring(r0, a, z) for a in angs], [ring(r0, a, z - L) for a in angs]
                else:
                    top_i, bot_i = [(cx, cy, z)] * 3, [(cx, cy, z - L)] * 3
                cen = ring((r0 + r1) / 2, am, z - L - tip)
                faces = []
                for k in range(2):
                    faces.append([top_o[k], top_o[k + 1], bot_o[k + 1], bot_o[k]])
                    if r0 > 0:
                        faces.append([top_i[k + 1], top_i[k], bot_i[k], bot_i[k + 1]])
                faces.append([top_i[0], top_o[0], bot_o[0], bot_i[0]])
                faces.append([top_o[2], top_i[2], bot_i[2], bot_o[2]])
                uniq = []
                for q in bot_o + bot_i[::-1]:
                    if not uniq or max(abs(q[i] - uniq[-1][i]) for i in range(3)) > 1e-6:
                        uniq.append(q)
                for k in range(len(uniq)):
                    faces.append([uniq[k], uniq[(k + 1) % len(uniq)], cen])
                cc = (sum(q[0] for q in uniq) / len(uniq), sum(q[1] for q in uniq) / len(uniq), z - L / 2)
                out = []
                for f in faces:
                    if len({tuple(round(v, 6) for v in q) for q in f}) < 3:
                        continue
                    nrm = normal(*f[:3])
                    fc = [sum(q[i] for q in f) / len(f) for i in range(3)]
                    if sum(nrm[i] * (fc[i] - cc[i]) for i in range(3)) < 0:
                        nrm = tuple(-v for v in nrm)
                    if not self.facing(nrm):
                        continue
                    nl = math.sqrt(sum(c * c for c in nrm)) or 1
                    t = sum(a * b for a, b in zip(nrm, self.light)) / nl
                    col = ramp[0] if t > -.05 else ramp[1] if t > -.45 else ramp[2]
                    down = -nrm[2] / nl
                    if down > .15 and bounce:
                        col = rgb2hex(mix(hex2rgb(col), hex2rgb(bounce), min(.55, down * .7)))
                    out.append(f'<polygon points="{self.P(f)}" fill="{col}" stroke="{col}" stroke-width=".6" stroke-linejoin="round"/>')
                cols.append((cc[0] + cc[1], "".join(out)))
        cols.sort()
        return "".join(c for _, c in cols)

    def tree(self, x, y, s=1.0, seed=0, base="#5fb83a", z=0.0):
        """A low-poly conifer standing at height z (raise z for trees on terraces or islets)."""
        return (self.box(x - .08 * s, y - .08 * s, z, .16 * s, .16 * s, .45 * s, "#8a5a3c", rim=False)
                + self.facets(self.lowpoly([(0, .55 * s), (1.5 * s, 0)], seed, n=5), base, offset=(x, y, z + .35 * s), stroke=.5)
                + self.facets(self.lowpoly([(0, .38 * s), (1.0 * s, 0)], seed + 1, n=5), base, offset=(x, y, z + 1.05 * s), stroke=.5))

    # ---------------------------------------------------------------- rounded machinery
    def x_strips(self, x0, x1, cy, cz, R, th0, th1, base, n=14):
        """Curved surface of a cylinder lying along x, as shaded strips (hidden strips culled).
        th 0..pi = a half-cylinder roof (hangar); 0..2pi = a full tube (engine, pipe, tank)."""
        out = []
        for i in range(n):
            a1 = th0 + (th1 - th0) * i / n
            a2 = th0 + (th1 - th0) * (i + 1) / n
            p = lambda x, a: (x, cy - R * math.cos(a), cz + R * math.sin(a))
            mid = (a1 + a2) / 2
            out.append(self.face([p(x0, a1), p(x1, a1), p(x1, a2), p(x0, a2)], base, (0, -math.cos(mid), math.sin(mid))))
        return "".join(out)

    def x_cap(self, x, cy, cz, R, th0, th1, base, steps=24, outward=1):
        """The flat end of an x-axis cylinder at x (outward=+1 faces +x, -1 faces -x; culled if hidden).
        For a half-cylinder (th 0..pi) this is the arched end wall of a hangar."""
        pts = [(x, cy - R * math.cos(a), cz + R * math.sin(a)) for a in [th0 + (th1 - th0) * i / steps for i in range(steps + 1)]]
        return self.face(pts, base, (outward, 0, 0))

    def ring_arc(self, x, cy, cz, R, th0, th1, steps=24):
        """Screen points of a ring around the x axis, kept only where it faces the camera (ribs, bands)."""
        pts = []
        for i in range(steps + 1):
            a = th0 + (th1 - th0) * i / steps
            if self.facing((0, -math.cos(a), math.sin(a))):
                pts.append(self.pt(x, cy - R * math.cos(a), cz + R * math.sin(a)))
        return pts

    def x_plane(self, x, y, z):
        """SVG transform mapping 2-D (u along y, v along z) into the plane x = const: fans, intakes, portholes."""
        o = self.pt(x, y, z)
        ux = (.866 if self.swap else -.866) * self.s
        return f"matrix({fmt(ux)} {fmt(.5 * self.s)} 0 {fmt(-self.s)} {fmt(o[0])} {fmt(o[1])})"

    def y_plane(self, x, y, z):
        """SVG transform mapping 2-D (u along x, v along z) into the plane y = const: sails, wheels and
        signs on a +y face (the companion of x_plane)."""
        o = self.pt(x, y, z)
        ux = (-.866 if self.swap else .866) * self.s
        return f"matrix({fmt(ux)} {fmt(.5 * self.s)} 0 {fmt(-self.s)} {fmt(o[0])} {fmt(o[1])})"

    def frustum(self, x, y, z0, z1, r0, r1, col, n=24, cap=True):
        """A round tower that may taper (lighthouse, chimney, funnel, silo): vertical strips shaded
        with curved_tone, so it turns from lit to dark around its body, plus a lit top ellipse."""
        out = []
        for i in range(n):
            a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            am = (a0 + a1) / 2
            nrm = (math.cos(am), math.sin(am), (r0 - r1) / max(z1 - z0, 1e-6))
            if not self.facing(nrm):
                continue
            q = [(x + r0 * math.cos(a0), y + r0 * math.sin(a0), z0), (x + r0 * math.cos(a1), y + r0 * math.sin(a1), z0),
                 (x + r1 * math.cos(a1), y + r1 * math.sin(a1), z1), (x + r1 * math.cos(a0), y + r1 * math.sin(a0), z1)]
            c = self.curved_tone(col, nrm)
            out.append(f'<polygon points="{self.P(q)}" fill="{c}" stroke="{c}" stroke-width=".5" stroke-linejoin="round"/>')
        if cap:                         # cap=False for a painted band partway up a tower
            top = [(x + r1 * math.cos(2 * math.pi * i / n), y + r1 * math.sin(2 * math.pi * i / n), z1) for i in range(n)]
            out.append(f'<polygon points="{self.P(top)}" fill="{self.plane_tone(col, (0, 0, 1))}"/>')
        return "".join(out)

    def truss(self, a, b, width=.18, panels=None, col="#5a4a6a", chord=2.2, web=1.2, rim="#b9b0d0"):
        """A lattice member (crane jib, gantry, mast, bridge girder) from world point a to b: two
        chords and a zigzag web, in SCREEN space so it stays crisp. The upper chord gets a pale lip
        (the lit edge). Steel reads as steel when the chords are 2 px or more; 1 px reads as wire."""
        ax, ay, az = a
        bx, by, bz = b
        L = math.dist(a, b)
        panels = panels or max(2, int(L / (width * 1.6)))
        up = (0, 0, width)
        pa, pb = self.pt(*a), self.pt(*b)
        qa, qb = self.pt(ax + up[0], ay + up[1], az + up[2]), self.pt(bx + up[0], by + up[1], bz + up[2])
        out = [seg(pa, pb, stroke=col, stroke_width=f"{chord}", stroke_linecap="round"),
               seg(qa, qb, stroke=col, stroke_width=f"{chord}", stroke_linecap="round")]
        for i in range(panels):
            t0, t1 = i / panels, (i + 1) / panels
            lo0 = (pa[0] + (pb[0] - pa[0]) * t0, pa[1] + (pb[1] - pa[1]) * t0)
            hi1 = (qa[0] + (qb[0] - qa[0]) * t1, qa[1] + (qb[1] - qa[1]) * t1)
            hi0 = (qa[0] + (qb[0] - qa[0]) * t0, qa[1] + (qb[1] - qa[1]) * t0)
            out.append(seg(lo0, hi1 if i % 2 == 0 else hi0, stroke=col, stroke_width=f"{web}"))
            out.append(seg(lo0, hi0, stroke=col, stroke_width=f"{web}"))
        out.append(seg((qa[0], qa[1] - .8), (qb[0], qb[1] - .8), stroke=rim, stroke_width="1", opacity=".9"))
        return "".join(out)

    def figure(self, x, y, z, s=1.0, body="#3b5a9a", skin="#e2b48a", hat=None, carry=None, pose="stand"):
        """A small person at (x, y, z): contact shadow, body, head, optional hat colour and carried box
        colour. pose: "stand", or "bow" (kneeling or prostrate, for worship or work on the ground).
        People give scale; mix poses and sizes, never one stamped figure. At 1200 px wide a figure
        under about 8 px tall cannot be read: use s=1.5-2 near the focal building."""
        px, py = self.pt(x, y, z)
        h = self.s * .34 * s
        if pose == "bow":
            return (f'<ellipse cx="{fmt(px + h * .15)}" cy="{fmt(py)}" rx="{fmt(h * .4)}" ry="{fmt(h * .1)}" fill="#8d86c0" style="mix-blend-mode:multiply"/>'
                    f'<path d="M{fmt(px - h * .3)},{fmt(py)} Q{fmt(px - h * .05)},{fmt(py - h * .55)} {fmt(px + h * .3)},{fmt(py - h * .12)} L{fmt(px + h * .3)},{fmt(py)} Z" fill="{body}"/>'
                    f'<circle cx="{fmt(px + h * .36)}" cy="{fmt(py - h * .1)}" r="{fmt(h * .12)}" fill="{skin}"/>')
        out = [f'<ellipse cx="{fmt(px + h * .12)}" cy="{fmt(py)}" rx="{fmt(h * .3)}" ry="{fmt(h * .1)}" fill="#8d86c0" style="mix-blend-mode:multiply"/>',
               f'<path d="M{fmt(px - h * .2)},{fmt(py)} L{fmt(px - h * .13)},{fmt(py - h * .78)} L{fmt(px + h * .13)},{fmt(py - h * .78)} L{fmt(px + h * .2)},{fmt(py)} Z" fill="{body}"/>',
               f'<path d="M{fmt(px + h * .02)},{fmt(py)} L{fmt(px + h * .06)},{fmt(py - h * .78)} L{fmt(px + h * .13)},{fmt(py - h * .78)} L{fmt(px + h * .2)},{fmt(py)} Z" fill="{self.plane_tone(body, (1, 0, 0))}"/>',
               f'<circle cx="{fmt(px)}" cy="{fmt(py - h * .92)}" r="{fmt(h * .13)}" fill="{skin}"/>']
        if hat:
            out.append(f'<path d="M{fmt(px - h * .2)},{fmt(py - h * .95)} L{fmt(px)},{fmt(py - h * 1.18)} L{fmt(px + h * .2)},{fmt(py - h * .95)} Z" fill="{hat}"/>')
        if carry:
            out.append(f'<rect x="{fmt(px + h * .05)}" y="{fmt(py - h * .72)}" width="{fmt(h * .28)}" height="{fmt(h * .26)}" fill="{carry}"/>')
        return "".join(out)

    def upright_cylinder(self, x, y, z0, z1, r, col):
        """A vertical cylinder (stack, tank, pillar, vent stem) with an open top."""
        c0, c1 = self.pt(x, y, z0), self.pt(x, y, z1)
        rx, ry = r * self.s, r * self.s * .5
        return (f'<path d="M{fmt(c0[0] - rx)},{fmt(c0[1])} L{fmt(c1[0] - rx)},{fmt(c1[1])} A{fmt(rx)},{fmt(ry)} 0 0 0 {fmt(c1[0] + rx)},{fmt(c1[1])} '
                f'L{fmt(c0[0] + rx)},{fmt(c0[1])} A{fmt(rx)},{fmt(ry)} 0 0 1 {fmt(c0[0] - rx)},{fmt(c0[1])} Z" fill="{self.grad(col, "h")}"/>'
                f'<ellipse cx="{fmt(c1[0])}" cy="{fmt(c1[1])}" rx="{fmt(rx)}" ry="{fmt(ry)}" fill="{self.lighten(col, .25)}"/>'
                f'<ellipse cx="{fmt(c1[0])}" cy="{fmt(c1[1])}" rx="{fmt(rx * .7)}" ry="{fmt(ry * .7)}" fill="#2b2a55"/>')

    # ---------------------------------------------------------------- document
    def document(self, w, h, body, title="Scene", desc="", background=""):
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">'
                f'<title>{title}</title>' + (f'<desc>{desc}</desc>' if desc else "")
                + f'<defs>{self.defs()}</defs>{background}{body}</svg>')


# ---------------------------------------------------------------- smoke test / example
def demo(out: Path):
    iso = Iso(cx=400, cy=330, scale=34)
    p = Painter()
    rim = [(4.2 * math.cos(2 * math.pi * i / 24), 4.2 * math.sin(2 * math.pi * i / 24)) for i in range(24)]
    under = iso.columns(0, 0, 0, lambda a: 4.2, 5.0, 3, nsec=16)
    ground = f'<polygon points="{iso.P([(x, y, 0) for x, y in rim])}" fill="#8fd14f"/>'
    tone = Iso.value_budget((-.9, -.6, .5), ("#ffd9a8", "#f0cc9c"), (2.5,))           # the house is the focal object
    p.add(-1, Iso.shadow_union([iso.cast_shadow(-1.6, -1.2, 0, 1.4, 1.2, 1.1), iso.cast_shadow(-1.3, -.4, 0, .5, .5, .9)])
          + iso.box(-1.6, -1.2, 0, 1.4, 1.2, 1.1, tone(-.9, -.6, 0)) + iso.gable_roof(-1.6, -1.2, 1.1, 1.4, 1.2, .8, "#e8555d"))
    p.add(2.6, iso.tree(1.6, 1.0, 1.0, seed=7))
    p.add(-3.6, iso.facets(iso.lowpoly([(0, 1.6), (1.8, 1.1), (3.4, 0)], 11, n=8), "#86d6e4", offset=(-1.4, -2.6, 0), cap_from=2.0, cap_col="#d8f6ff"))
    p.add(1.0, iso.x_strips(.2, 1.9, -.4, 0, .9, 0, math.pi, "#d5d9ea", 12)            # a small hangar:
          + iso.x_cap(1.9, -.4, 0, .9, 0, math.pi, "#e3e6f1"))                           # shell, then its arched end
    p.add(3.5, iso.upright_cylinder(2.4, .9, 0, 1.6, .25, "#3d4270"))
    p.add(.2, iso.frustum(-2.4, 1.6, 0, 2.2, .45, .28, "#f2ece0"))                     # a tapered tower
    crag, _, facets = iso.crag(3.6, -3.2, [(0, 1.3), (1.2, 1.0), (2.4, .55), (3.2, 0)], 5, n=10, snow=2.4)
    p.add(-4.0, crag + iso.facet_shadow((3.0, -2.6, 1.2, .45, .45, .6), facets)
          + iso.box(3.0, -2.6, 1.2, .45, .45, .6, "#f2ece0"))                              # a crag, a hut, its slope shadow
    sail = "".join(f'<rect x="-.04" y="0" width=".08" height=".7" fill="#e9dcc0" transform="rotate({a})"/>' for a in (0, 90, 180, 270))
    p.add(1.9, f'<g transform="{iso.y_plane(-.9, .02, .62)}">{sail}</g>')                # sails on a +y face
    svg = iso.document(800, 640, ground + p.render(), title="iso_scene demo", background=f'<rect width="800" height="640" fill="#1a1d5c"/>{under}')
    out.write_text(svg, encoding="utf-8")
    import xml.etree.ElementTree as ET
    ET.fromstring(svg)  # raises if the document is not well-formed
    print(f"wrote {out} ({len(svg) // 1024} KB), well-formed XML")


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--demo":
        demo(Path(sys.argv[2] if len(sys.argv) > 2 else "iso_scene_demo.svg"))
    else:
        print(__doc__)
