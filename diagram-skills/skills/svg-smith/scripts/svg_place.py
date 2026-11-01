#!/usr/bin/env python3
"""Put existing artwork on a clean canvas without breaking it.

Doing this by hand is where placement bugs come from: assume a canvas width, feed it
artwork with a wider aspect, and the art silently overflows and gets cut off. So the
canvas is DERIVED from the measured artwork unless you force a square.

Also handles the two things that bite when several logos share a page: id collisions
(every exported SVG calls its gradient "paint0_linear") and dead defs left behind
after you delete an element.

    python svg_place.py src.svg --out mark.svg --square 800 --art-height 600
    python svg_place.py src.svg --out lockup.svg --art-height 300 --pad 60
    python svg_place.py src.svg --out mark.svg --square 800 --namespace acme- --prune
"""
from __future__ import annotations
import argparse, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import sys as _sys; _sys.dont_write_bytecode = True   # no .pyc in the skill folder
from _svgkit import Harness, read_svg

PLACE_JS = r"""
(cfg) => {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.querySelector('#host svg');
  if (!svg) return {error: 'no svg root'};

  if (cfg.namespace) {
    [...svg.querySelectorAll('[id]')].map(e => e.id).forEach(old => {
      const nw = cfg.namespace + old;
      svg.querySelectorAll('[id="' + CSS.escape(old) + '"]').forEach(e => e.id = nw);
      [...svg.querySelectorAll('*')].forEach(e => {
        [...e.attributes].forEach(a => {
          if (a.value.includes('url(#' + old + ')'))
            e.setAttribute(a.name, a.value.split('url(#' + old + ')').join('url(#' + nw + ')'));
          else if (a.value === '#' + old) e.setAttribute(a.name, '#' + nw);
        });
        // A <style> block holds its references in TEXT, not attributes -- rename there too,
        // or the rule keeps pointing at the old id, the def looks unused, and pruning
        // deletes the gradient the whole mark depends on.
        if (e.tagName.toLowerCase() === 'style' && e.textContent.includes('#' + old))
          e.textContent = e.textContent.split('url(#' + old + ')').join('url(#' + nw + ')');
      });
    });

    // Classes are a GLOBAL CSS namespace -- document-wide, not scoped to the <svg> they
    // are written in. Illustrator exports `.cls-1`/`.cls-2` by default, so two unrelated
    // vendor logos inlined in one document overwrite each other's rules and whichever
    // <style> parses last wins. Measured on two real files: SAP's blue gradient vanished
    // and its letters turned Postman orange. Renaming ids does NOT help -- the collision
    // is in the stylesheet, so the class tokens have to move too.
    // Renames a class token inside selector text. Written as a scan rather than a
    // RegExp because building one needs backslashes inside a JS string inside a Python
    // string, and a lost backslash turns the escaped dot into `any character` silently.
    const rewriteSel = (txt, oldName, newName) => {
      const IDENT = /[A-Za-z0-9_-]/;
      let out = '', i = 0;
      for (;;) {
        const k = txt.indexOf('.' + oldName, i);
        if (k < 0) { out += txt.slice(i); return out; }
        const end = k + 1 + oldName.length;
        const after = txt.charAt(end);
        // `.cls-1` must not match inside `.cls-10`, so require a non-identifier next.
        out += txt.slice(i, k) + '.' + ((after && IDENT.test(after)) ? oldName : newName);
        i = end;
      }
    };
    const classes = new Set();
    svg.querySelectorAll('[class]').forEach(e =>
      (e.getAttribute('class') || '').split(/\s+/).filter(Boolean).forEach(c => classes.add(c)));
    classes.forEach(old => {
      const nw = cfg.namespace + old;
      svg.querySelectorAll('[class]').forEach(e => {
        const parts = (e.getAttribute('class') || '').split(/\s+/).filter(Boolean);
        if (parts.includes(old))
          e.setAttribute('class', parts.map(c => (c === old ? nw : c)).join(' '));
      });
      svg.querySelectorAll('style').forEach(st => {
        st.textContent = rewriteSel(st.textContent || '', old, nw);
      });
    });
  }

  const rendered = [...svg.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,line,text,image')]
    .filter(e => !e.closest('defs') && !e.closest('clipPath') && !e.closest('mask'));
  if (!rendered.length) return {error: 'nothing rendered to place'};

  const inv = svg.getScreenCTM().inverse();
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  rendered.forEach(e => {
    const b = e.getBBox(), m = inv.multiply(e.getScreenCTM());
    [[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].forEach(([x,y]) => {
      const p = svg.createSVGPoint(); p.x=x; p.y=y; const t = p.matrixTransform(m);
      x0=Math.min(x0,t.x); y0=Math.min(y0,t.y); x1=Math.max(x1,t.x); y1=Math.max(y1,t.y);
    });
  });
  const bb = {x:x0, y:y0, w:x1-x0, h:y1-y0};

  const s  = cfg.artHeight / bb.h;
  const aw = bb.w * s, ah = bb.h * s;
  // Derive the canvas from the artwork unless a square was forced. Assuming a width
  // is exactly how artwork ends up overflowing and clipped.
  const cw = cfg.square || Math.round(aw) + cfg.pad * 2;
  const ch = cfg.square || Math.round(ah) + cfg.pad * 2;
  const overflow = (aw > cw + 0.5) || (ah > ch + 0.5);
  const tx = (cw - aw) / 2 - s * bb.x;
  const ty = (ch - ah) / 2 - s * bb.y;

  const defs = svg.querySelector('defs');
  const g = document.createElementNS(NS, 'g');
  if (cfg.groupId) g.id = (cfg.namespace || '') + cfg.groupId;   // never a bare generic id
  g.setAttribute('transform', `translate(${tx.toFixed(4)},${ty.toFixed(4)}) scale(${s.toFixed(6)})`);
  [...svg.childNodes].forEach(n => {
    if (n.nodeType === 1 && n !== defs && n.tagName.toLowerCase() !== 'title'
        && n.tagName.toLowerCase() !== 'desc') g.appendChild(n);
  });
  svg.appendChild(g);

  if (cfg.prune) {
    for (let pass = 0; pass < 6; pass++) {
      const used = new Set();
      const harvest = (txt) => (txt.match(/#([^)"'\s;,}]+)/g) || [])
        .forEach(x => used.add(x.slice(1)));
      [...svg.querySelectorAll('*')].forEach(e => {
        [...e.attributes].forEach(a => harvest(a.value));
        // A <style> block references gradients from its TEXT, not an attribute:
        // .cls-1{fill:url(#linear-gradient)}. Scanning attributes alone declares that
        // gradient unused, deletes it, and the whole mark renders blank.
        if (e.tagName.toLowerCase() === 'style') harvest(e.textContent || '');
      });
      let removed = 0;
      svg.querySelectorAll('defs > *').forEach(e => {
        if (e.id && !used.has(e.id)) { e.remove(); removed++; }
      });
      if (!removed) break;
    }
  }

  svg.setAttribute('viewBox', `0 0 ${cw} ${ch}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  ['fill','style','class','data-view-component','aria-hidden'].forEach(a => svg.removeAttribute(a));
  svg.setAttribute('xmlns', NS);

  return {svg: new XMLSerializer().serializeToString(svg),
          bbox: bb, canvas: [cw, ch], artwork: [+aw.toFixed(1), +ah.toFixed(1)],
          scale: s, overflow};
}
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src"); ap.add_argument("--out", required=True)
    ap.add_argument("--square", type=int, help="force a square canvas of this size")
    ap.add_argument("--art-height", type=float, required=True, help="rendered height of the artwork")
    ap.add_argument("--pad", type=int, default=60, help="clear space when the canvas is derived")
    ap.add_argument("--namespace", help="prefix every internal id (avoids collisions when inlined)")
    ap.add_argument("--prune", action="store_true", help="drop defs nothing references any more")
    ap.add_argument("--group-id", default="artwork")
    ap.add_argument("--title"); ap.add_argument("--desc")
    args = ap.parse_args()

    cfg = {"square": args.square or 0, "artHeight": args.art_height, "pad": args.pad,
           "namespace": args.namespace or "", "prune": bool(args.prune), "groupId": args.group_id}

    with Harness() as h:
        pg = h.inline(read_svg(args.src))
        try:
            r = pg.evaluate(PLACE_JS, cfg)
        finally:
            pg.close()
    if r.get("error"):
        raise SystemExit("svg_place: " + r["error"])

    out = r["svg"]
    if args.title or args.desc:
        head, rest = out.split(">", 1)
        # Namespaced so these do not collide when several SVGs are inlined together --
        # bare id="t"/id="d" is exactly the hazard svg_probe warns about.
        pre = (args.namespace or "") + (args.group_id or "art") + "-"   # matches the group id
        meta = f'''{head} role="img" aria-labelledby="{pre}title {pre}desc">
  <title id="{pre}title">{args.title or ''}</title>
  <desc id="{pre}desc">{args.desc or ''}</desc>'''
        out = meta + rest
    Path(args.out).write_text(out + "\n", encoding="utf-8", newline="\n")

    bb = r["bbox"]
    print(f"source artwork   {bb['w']:.2f} x {bb['h']:.2f}  (aspect {bb['w']/bb['h']:.4f})")
    print(f"canvas           {r['canvas'][0]} x {r['canvas'][1]}"
          f"{'  [forced square]' if args.square else '  [derived from artwork]'}")
    print(f"placed artwork   {r['artwork'][0]} x {r['artwork'][1]}   scale {r['scale']:.6f}")
    print(f"wrote            {args.out}")
    if r["overflow"]:
        print("!! ARTWORK OVERFLOWS THE CANVAS and will be cut off. A forced --square cannot fit "
              "this aspect ratio -- drop --square and let the canvas be derived, or lower --art-height.")
    print("Now render it and look, then svg_check.py against the source, and svg_verify.py")
    print("on the result. Reading a trap does not inoculate you against it -- the vtracer")
    print("transform trap was written up and then walked into the same afternoon.")


if __name__ == "__main__":
    main()
