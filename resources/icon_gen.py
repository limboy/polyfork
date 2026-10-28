"""Generate resources/icon.svg, a low-poly tree. Facet colours come from a fake 3D normal lit from the upper left.

  python3 resources/icon_gen.py resources/icon.svg && rsvg-convert -w 1024 -h 1024 resources/icon.svg -o resources/icon.png
"""
import math
import sys

LIGHT = (-0.55, -0.65, 0.75)
ln = math.sqrt(sum(c * c for c in LIGHT))
LIGHT = tuple(c / ln for c in LIGHT)


def shade(a, b, c, base, lo=0.62, hi=1.18):
    u = [b[i] - a[i] for i in range(3)]
    v = [c[i] - a[i] for i in range(3)]
    n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    m = math.sqrt(sum(x * x for x in n)) or 1
    n = [x / m for x in n]
    if n[2] < 0:
        n = [-x for x in n]
    d = max(0.0, sum(n[i] * LIGHT[i] for i in range(3)))
    k = lo + (hi - lo) * d
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(ch * k))) for ch in base)


def poly(pts, fill):
    p = " ".join(f"{x:.1f},{y:.1f}" for x, y, *_ in pts)
    return f'<polygon points="{p}" fill="{fill}" stroke="{fill}" stroke-width="1.6" stroke-linejoin="round"/>'


out = []

# Ground tile: an isometric slab.
cx, top, w, h, t = 512, 596, 236, 118, 50
G = {
    "n": (cx, top, 0), "e": (cx + w, top + h, 0), "s": (cx, top + 2 * h, 0), "w": (cx - w, top + h, 0),
    "c": (cx + 10, top + h - 4, 14),
}
out.append(poly([(cx - w, top + h), (cx, top + 2 * h), (cx, top + 2 * h + t), (cx - w, top + h + t)], "#a8693f"))
out.append(poly([(cx, top + 2 * h), (cx + w, top + h), (cx + w, top + h + t), (cx, top + 2 * h + t)], "#7d4a2b"))
grass = (126, 196, 96)
for a, b in [("n", "e"), ("e", "s"), ("s", "w"), ("w", "n")]:
    out.append(poly([G[a], G[b], G["c"]], shade(G[a], G[b], G["c"], grass, 0.8, 1.08)))

# Shadow of the canopy on the ground.
out.append(f'<ellipse cx="{cx + 22}" cy="{top + h + 4}" rx="112" ry="48" fill="#1d3a18" opacity="0.16"/>')

# Trunk: two faces of a tapered prism.
out.append(poly([(488, 714), (512, 726), (512, 560), (494, 554)], "#c08a5a"))
out.append(poly([(512, 726), (536, 714), (530, 554), (512, 560)], "#8a5a36"))

# Canopy: a ring of points at z=0 and a raised interior, triangulated by hand.
P = [(512, 170, 0), (648, 226, 0), (726, 345, 0), (712, 486, 0), (628, 588, 0),
     (512, 614, 0), (396, 588, 0), (312, 486, 0), (298, 345, 0), (376, 226, 0)]
C = (498, 404, 210)
I1, I2, I3, I4 = (566, 296, 160), (428, 312, 165), (610, 474, 150), (438, 506, 150)
# Scale the canopy down about its middle so the trunk shows.
def fit(q, k=0.84, ox=512, oy=392, dy=-6):
    return (ox + (q[0] - ox) * k, oy + (q[1] - oy) * k + dy, q[2] * k)
P = [fit(q) for q in P]
C, I1, I2, I3, I4 = map(fit, (C, I1, I2, I3, I4))
tris = [
    (P[0], P[9], I2), (P[0], I2, I1), (P[0], I1, P[1]), (P[1], I1, P[2]), (I1, I2, C), (I2, P[9], P[8]),
    (I2, P[8], C), (P[8], P[7], C), (P[7], I4, C), (P[7], P[6], I4), (P[6], P[5], I4), (I4, P[5], P[4]),
    (I4, P[4], I3), (C, I4, I3), (C, I3, I1), (I1, I3, P[2]), (P[2], I3, P[3]), (P[3], I3, P[4]),
]
leaf = (122, 196, 84)
for a, b, c in tris:
    out.append(poly([a, b, c], shade(a, b, c, leaf)))

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8ec5ff"/>
      <stop offset="1" stop-color="#3f6fd8"/>
    </linearGradient>
    <clipPath id="body"><rect x="100" y="100" width="824" height="824" rx="185"/></clipPath>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#bg)"/>
  <g clip-path="url(#body)">
    {chr(10).join("    " + s for s in out)}
  </g>
</svg>
'''
open(sys.argv[1], "w").write(svg)
