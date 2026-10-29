#!/usr/bin/env python3
"""Build the reading companions' 64 x 64 pixel masters.

Every pet is drawn from shapes lit from the top left in four tones of their own
colour ramp and outlined in the ramp's darkest colour; faces, stripes and text
lines go on top. Every colour carries the grey a black-and-white screen shows
instead, so one master serves both kinds of screen.

Run from the repository root. Only the Python standard library is required.
The Lua output is the shipped asset; no generator runs on the reader.
"""

import argparse
import math
from pathlib import Path

SIZE = 64
POSES = ("read", "sleep", "party", "ribbon", "yawn", "wait")
PETS = ("cat", "dog", "rabbit", "owl", "penguin", "robot", "vampire", "dragon", "ghost",
        "mimic", "mummy", "witch", "skeleton", "candle", "alien")
OUT = Path(__file__).resolve().parents[1] / "bookorbit.koplugin/bookorbit_pets"


def _norm(x, y, z):
    n = math.sqrt(x * x + y * y + z * z)
    return x / n, y / n, z / n


LIGHT = _norm(-0.55, -0.8, 0.95)
# Lit value at which a pixel steps up to base, light and highlight.
STEPS = (0.22, 0.66, 0.93)

# ------------------------------------------------------------------ palette
PAL = {}
RAMPS = {}
GREY = {}


def _rgb(hexv):
    return tuple(int(hexv[i:i + 2], 16) for i in (1, 3, 5))


def _hex(rgb):
    return "#" + "".join("%02x" % max(0, min(255, round(v))) for v in rgb)


def _mix(a, b, t):
    ra, rb = _rgb(a), _rgb(b)
    return _hex([ra[i] + (rb[i] - ra[i]) * t for i in range(3)])


def ramp(name, line, shadow, base, light, hi=None, inner=None):
    PAL[name + ":line"] = line
    PAL[name + ":inner"] = inner or _mix(line, shadow, 0.3)
    for i, tone in enumerate((shadow, base, light, hi or light)):
        PAL[name + ":" + str(i)] = tone
    RAMPS[name] = name


def solid(name, hexv, grey=None):
    PAL[name] = hexv
    if grey is not None:
        GREY[name] = grey


def grey_of(name):
    """The 16-level grey a mono panel shows: KOReader's own RGB to grey
    conversion (Rec. 601 luma), unless the palette overrides it."""
    if name in GREY:
        return GREY[name]
    r, g, b = _rgb(PAL[name])
    return max(0, min(15, round((0.299 * r + 0.587 * g + 0.114 * b) / 17)))


# Shared materials.
solid("ink", "#1d1a22")
solid("white", "#ffffff")
solid("eye", "#221c26")
solid("blush", "#f59aa6", grey=13)
solid("mouth", "#5b1a2a")
solid("tongue", "#ef7489", grey=9)
solid("tear", "#8cc8f0", grey=12)
solid("text", "#b3a68e", grey=10)
solid("zzz", "#5f86c4", grey=6)
solid("zzz2", "#9bb6dd", grey=10)
ramp("paper", "#6b5b47", "#e4d8c0", "#fbf4e4", "#ffffff")
ramp("red", "#4a1311", "#94281f", "#c63b2e", "#e2604f", "#f08a78")
ramp("teal", "#0f3a36", "#1d6d65", "#2a958a", "#4cb8ab")
ramp("mustard", "#4d3608", "#b0811c", "#e0ab35", "#f3cb63")
ramp("plum", "#2b1533", "#5d3470", "#7d4b94", "#9f6db5")
ramp("gold", "#5a3d05", "#c58d17", "#f0b62e", "#fbd66a", "#fff1b8")
ramp("blue", "#13265c", "#2c4fae", "#3f6fd8", "#6a92ea")
ramp("pink", "#5e1a35", "#c7426f", "#ec5f8f", "#f68cb0")
ramp("yellow", "#5a4508", "#e0b52a", "#ffd54f", "#ffe58a")
ramp("cream", "#6e5538", "#e0c8a2", "#f6e6c8", "#fff6e6", "#ffffff")
ramp("snow", "#5d5a63", "#d6d2d4", "#f2efee", "#ffffff")
ramp("beak", "#5d3005", "#cf7a14", "#f29b30", "#f8bd63")
solid("conf_red", "#e24a3b", grey=7)
solid("conf_blue", "#3f86e0", grey=7)
solid("conf_yellow", "#f5c623", grey=11)
solid("conf_green", "#4cb050", grey=8)
solid("conf_pink", "#ec5f8f", grey=9)

# Pet materials.
ramp("ginger", "#5a2a0e", "#c4652a", "#e88d3e", "#f5b066", "#fbd29a")
solid("ginger_stripe", "#b4561f")
solid("green_iris", "#4fa843", grey=7)
ramp("nose_pink", "#7a2a3c", "#d56479", "#ee8a9b", "#f7b3bf")
ramp("tan", "#4a2a12", "#ae6d36", "#d3904e", "#e8b277", "#f5d0a0")
ramp("brown", "#26150a", "#4b2c17", "#6b4224", "#8b5a35")
ramp("fawn", "#5b4430", "#b5937a", "#d4b596", "#e8d2b8", "#f6e8da")
ramp("earpink", "#7a3446", "#e08898", "#f3a9b6", "#fac9d1")
ramp("owl", "#331d10", "#68402a", "#8b5a37", "#aa784e", "#c89a6c")
solid("owl_mark", "#55331e")
solid("amber", "#f2a922", grey=9)
ramp("navy", "#0d1420", "#1d2a3c", "#2d3e57", "#46597a", "#6a80a3")
ramp("scarf", "#4d0f14", "#a8232d", "#d63a43", "#ec6a6f")
ramp("metal", "#25313a", "#7c8f9a", "#a7bac4", "#c9d8e0", "#eef5f8")
ramp("screen", "#0c151b", "#16242c", "#1f323d", "#2b4552")
solid("led", "#4fe3f0", grey=12)
solid("led_dim", "#2a8fa0", grey=7)
ramp("bulb", "#5c1212", "#c9302f", "#ef5350", "#ff8a80", "#ffd0cc")
ramp("pale", "#4a3a56", "#cdbfd8", "#e9e0f0", "#f7f2fb")
ramp("hair", "#0b0710", "#1c1426", "#2c2040", "#4a3866")
ramp("cape", "#0d0a12", "#1a1522", "#2a2335", "#3d344c")
ramp("lining", "#3d0812", "#8a1628", "#b8243b", "#d84a5e")
solid("red_iris", "#d42f3a", grey=6)
ramp("scale", "#1d4521", "#3d8541", "#59b05a", "#82cc7c", "#b2e6a5")
ramp("belly", "#6a5a1c", "#d9c477", "#f1e2a2", "#fbf2cc")
ramp("wing", "#2f1a55", "#6448a4", "#8667c7", "#a88be0")
ramp("horn", "#5e5236", "#d8cba8", "#f1e7cb", "#fffaf0")
ramp("spike", "#5a2508", "#d9702c", "#f08a3c", "#f8ae6c")
ramp("ghost", "#46597a", "#b5c6df", "#e2ebf8", "#f6f9ff", "#ffffff")
solid("ghost_eye", "#232a3d")
ramp("leather", "#2e110b", "#6c2a1b", "#953a24", "#b9573a", "#d27753")
ramp("wrap", "#4f3f2a", "#c6b18a", "#e3d3ae", "#f2e8cf", "#fbf6ea")
solid("wrap_gap", "#5a4634")
ramp("scarab", "#0d3b3a", "#1f7f78", "#2aa198", "#5cc4ba")
ramp("robe", "#1c0e30", "#43246e", "#5f3596", "#7c52b8")
ramp("witchhat", "#110a1d", "#221536", "#322050", "#4a3170")
ramp("skin", "#6b3f2a", "#dea687", "#f2c4a3", "#f9dcc4")
ramp("bone", "#3a3640", "#c4bfb2", "#e8e4d9", "#f7f5ee", "#ffffff")
solid("socket", "#2a2530")
ramp("wax", "#6b2a35", "#d47f8b", "#ec9fa9", "#f6c3c9", "#fde3e6")
ramp("flame", "#8a3a05", "#ef7a1c", "#ffa233", "#ffcd4d", "#fff3b8")
solid("smoke", "#a7adb8", grey=10)
ramp("alien", "#0f3d42", "#379aa1", "#58c3c5", "#8cdfdb", "#c4f3ee")
ramp("glass", "#3d5a78", "#a9cbe6", "#cfe5f5", "#eef7fd", "#ffffff")
solid("star", "#ffd54f", grey=12)


# ------------------------------------------------------------------ geometry
def ellipse(cx, cy, rx, ry):
    return {(x, y) for y in range(SIZE) for x in range(SIZE)
            if ((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2 <= 1}


def polygon(points):
    pixels = set()
    for y in range(SIZE):
        for x in range(SIZE):
            inside = False
            ax, ay = points[-1]
            for bx, by in points:
                if (ay > y + .5) != (by > y + .5):
                    if x + .5 < (bx - ax) * (y + .5 - ay) / (by - ay) + ax:
                        inside = not inside
                ax, ay = bx, by
            if inside:
                pixels.add((x, y))
    return pixels


def capsule(points, r):
    """A thick stroke along a polyline: round-capped, radius r."""
    out = set()
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        steps = max(1, int(math.hypot(x1 - x0, y1 - y0) * 2))
        for i in range(steps + 1):
            t = i / steps
            out |= ellipse(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, r)
    return out


class Canvas:
    def __init__(self):
        self.sid = [[0] * SIZE for _ in range(SIZE)]
        self.col = [[None] * SIZE for _ in range(SIZE)]
        self.meta = [None]
        self.details = []
        self.ox = self.oy = 0

    # Shapes, in this canvas's current offset.
    def ell(self, cx, cy, rx, ry):
        return ellipse(cx + self.ox, cy + self.oy, rx, ry)

    def poly(self, pts):
        return polygon([(x + self.ox, y + self.oy) for x, y in pts])

    def cap(self, pts, r):
        return capsule([(x + self.ox, y + self.oy) for x, y in pts], r)

    def fill(self, px, mat, tone=None, lines=True, soft=0.15, light=None):
        """Paint a shape. mat is a ramp (lit in four tones unless tone is
        given) or a solid colour. lines: True outlines the silhouette and
        draws an inner line where the shape covers an earlier one; "outer"
        only the silhouette; False neither."""
        px = {(x, y) for x, y in px if 0 <= x < SIZE and 0 <= y < SIZE}
        if not px:
            return px
        sid = len(self.meta)
        is_ramp = mat in RAMPS
        self.meta.append({"mat": mat, "lines": lines, "ramp": is_ramp})
        if is_ramp and tone is None:
            xs = [x for x, _ in px]
            ys = [y for _, y in px]
            cx, cy = (min(xs) + max(xs) + 1) / 2, (min(ys) + max(ys) + 1) / 2
            rx, ry = (max(xs) - min(xs) + 1) / 2, (max(ys) - min(ys) + 1) / 2
            lx, ly, lz = light or LIGHT
            for x, y in px:
                nx, ny = (x + .5 - cx) / rx, (y + .5 - cy) / ry
                nz = math.sqrt(max(0.0, 1 - min(1.0, nx * nx + ny * ny)))
                nx, ny, nz = _norm(nx * (1 - soft), ny * (1 - soft), nz + soft + 1e-6)
                v = nx * lx + ny * ly + nz * lz
                t = 0 if v < STEPS[0] else 1 if v < STEPS[1] else 2 if v < STEPS[2] else 3
                self._set(x, y, sid, mat + ":" + str(t))
        else:
            name = mat + ":" + str(tone if tone is not None else 1) if is_ramp else mat
            for x, y in px:
                self._set(x, y, sid, name)
        return px

    def _set(self, x, y, sid, colour):
        self.sid[y][x] = sid
        self.col[y][x] = colour

    # Details sit on top of every shape painted so far, under later ones.
    def dot(self, x, y, colour, inside=None):
        x, y = round(x + self.ox), round(y + self.oy)
        if inside is None or (x, y) in inside:
            self.details.append((len(self.meta) - 1, x, y, colour))

    def line(self, x0, y0, x1, y1, colour, inside=None):
        """inside: only the pixels of this shape (as fill returned it)."""
        steps = max(abs(x1 - x0), abs(y1 - y0))
        for i in range(int(steps) + 1):
            t = i / steps if steps else 0
            self.dot(round(x0 + (x1 - x0) * t), round(y0 + (y1 - y0) * t), colour, inside)

    def path(self, pts, colour):
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            self.line(x0, y0, x1, y1, colour)

    def rows(self):
        out = [row[:] for row in self.col]
        for y in range(SIZE):
            for x in range(SIZE):
                s = self.sid[y][x]
                if not s:
                    continue
                m = self.meta[s]
                if not m["lines"]:
                    continue
                outer = inner = False
                for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    nx, ny = x + dx, y + dy
                    t = self.sid[ny][nx] if 0 <= nx < SIZE and 0 <= ny < SIZE else 0
                    if t == 0:
                        outer = True
                    elif t < s and self.meta[t]["lines"] is not False:
                        inner = True
                line = m["mat"] + ":line" if m["ramp"] else "ink"
                if outer:
                    out[y][x] = line
                elif inner and m["lines"] is True:
                    out[y][x] = m["mat"] + ":inner" if m["ramp"] else "ink"
        for z, x, y, colour in self.details:
            if 0 <= x < SIZE and 0 <= y < SIZE and self.sid[y][x] <= z:
                out[y][x] = colour
        return out


class shifted:
    def __init__(self, c, dx, dy):
        self.c, self.dx, self.dy = c, dx, dy

    def __enter__(self):
        self.c.ox += self.dx
        self.c.oy += self.dy

    def __exit__(self, *exc):
        self.c.ox -= self.dx
        self.c.oy -= self.dy


# ------------------------------------------------------------------ shared parts
def eye(c, x, y, pose, iris=None, lid=None, side="l", rx=2.6, ry=3.3, line="eye"):
    """One eye centred on pixel (x, y)."""
    if pose == "sleep":
        c.path([(x - 2, y), (x - 1, y + 1), (x + 1, y + 1), (x + 2, y)], line)
        return
    if pose == "party":
        c.path([(x - 2, y + 1), (x - 2, y), (x - 1, y - 1), (x + 1, y - 1), (x + 2, y), (x + 2, y + 1)], line)
        return
    if pose == "yawn":
        k = 1 if side == "l" else -1
        c.path([(x - 2 * k, y - 2), (x + k, y), (x - 2 * k, y + 2)], line)
        return
    px = c.fill(c.ell(x + .5, y + .5, rx, ry), iris or "eye", lines=False)
    look = {"read": 1, "wait": -1}.get(pose, 0)
    if iris:
        c.fill(c.ell(x + .5, y + .5 + look, rx * .55, ry * .62), "eye", lines=False)
    if pose == "read" and lid:
        # Reading: a heavy upper lid and the gaze down on the page.
        top = min(py for _, py in px)
        for px_, py in sorted(px):
            if py == top:
                c.dot(px_ - c.ox, py - c.oy, line)
        c.line(x - 2, top - c.oy + 1, x + 2, top - c.oy + 1, line)
        c.dot(x - 1, y + 1, "white")
        c.dot(x, y + 1, "white")
        return
    hy = y - 2
    c.dot(x - 1, hy, "white")
    c.dot(x, hy, "white")
    c.dot(x - 1, hy + 1, "white")
    c.dot(x + 1, y + 2 if look >= 0 else y + 1, "white")


def blush(c, x, y):
    c.fill(c.ell(x + .5, y + .5, 2.4, 1.3), "blush", lines=False)


def feet(c, mat, xs=(24, 40), y=60, rx=5, ry=2.8, toes=True):
    for x in xs:
        c.fill(c.ell(x + .5, y + .5, rx, ry), mat)
        if toes:
            for tx in (x - 1, x + 2):
                c.dot(tx, y, mat + ":inner")


def book(c, paw, claws=None, cover="red"):
    c.fill(c.poly([(4, 47), (24, 47), (32, 50), (40, 47), (60, 47),
                   (60, 61), (40, 62), (32, 64), (24, 62), (4, 61)]), cover, soft=.5)
    c.fill(c.poly([(7, 45), (23, 45), (31, 48), (31, 62), (23, 59), (7, 59)]), "paper", tone=1)
    c.fill(c.poly([(33, 48), (41, 45), (57, 45), (57, 59), (41, 59), (33, 62)]), "paper", tone=1)
    for x0, x1 in ((8, 30), (34, 56)):
        c.line(x0, 60 if x0 < 30 else 60, x1 - 7, 60, "paper:0")
    for y in (50, 53, 56):
        c.line(11, y, 25, y, "text")
        c.line(38, y, 52, y, "text")
    c.line(11, 47, 21, 47, "text")
    c.line(43, 47, 53, 47, "text")
    c.fill(c.poly([(46, 60), (49, 60), (49, 64), (47.5, 62.5), (46, 64)]), "gold", tone=2)
    for x in (14, 50):
        if claws:
            for dx in (-2, 0, 2):
                c.line(x + dx, 44, x + dx, 47, claws + ":1")
                c.dot(x + dx, 48, claws + ":line")
        else:
            c.fill(c.ell(x + .5, 46.5, 5, 3.4), paw)
            for tx in (x - 1, x + 2):
                c.dot(tx, 48, paw + ":inner")


def stack(c):
    c.fill(c.poly([(5, 57), (59, 57), (59, 64), (5, 64)]), "teal", soft=.6)
    c.fill(c.poly([(9, 58), (57, 58), (57, 63), (9, 63)]), "paper", tone=1)
    for y in (59, 61):
        c.line(10, y, 56, y, "paper:0")
    c.line(6, 58, 6, 63, "teal:3")
    c.fill(c.poly([(10, 51), (55, 51), (55, 57), (10, 57)]), "mustard", soft=.6)
    c.fill(c.poly([(10, 52), (51, 52), (51, 56), (10, 56)]), "paper", tone=1)
    c.line(11, 54, 50, 54, "paper:0")
    c.line(53, 52, 53, 56, "mustard:3")


def hat(c, x, y, tilt=3, h=15):
    w = max(4, round(7 * h / 15))
    c.fill(c.poly([(x - w, y), (x + w, y), (x + tilt + .5, y - h)]), "pink", soft=.4)
    for t in (0.36, 0.68):
        lx, ly = x - w + (tilt + w) * t, y - h * t
        rx = x + w + (tilt - w) * t
        c.line(round(lx) + 1, round(ly), round(rx) - 1, round(ly), "yellow:2")
        if h >= 12:
            c.line(round(lx) + 1, round(ly) + 1, round(rx) - 1, round(ly) + 1, "yellow:1")
    c.line(x - w + 1, y - 1, x + w - 1, y - 1, "yellow:1")
    r = max(1.8, 2.4 * h / 15)
    c.fill(c.ell(x + tilt + .5, y - h - .5, r, r), "snow")


def sparkle(c, x, y, col="star"):
    c.dot(x, y, "white")
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        c.dot(x + dx, y + dy, col)


def confetti(c):
    bits = [(4, 9, "conf_blue", 1), (58, 7, "conf_yellow", 0), (2, 27, "conf_pink", 0),
            (61, 25, "conf_green", 1), (9, 18, "conf_yellow", 1), (55, 16, "conf_red", 0),
            (5, 41, "conf_green", 0), (59, 38, "conf_blue", 1), (15, 4, "conf_red", 1),
            (49, 3, "conf_pink", 1)]
    for x, y, col, vertical in bits:
        c.dot(x, y, col)
        c.dot(x + (0 if vertical else 1), y + (1 if vertical else 0), col)


def rosette(c, x, y):
    c.fill(c.poly([(x - 4, y + 2), (x - 1, y + 3), (x - 2, y + 13), (x - 4, y + 11), (x - 7, y + 12)]), "blue")
    c.fill(c.poly([(x + 4, y + 2), (x + 1, y + 3), (x + 2, y + 13), (x + 4, y + 11), (x + 7, y + 12)]), "blue")
    disk = c.ell(x + .5, y + .5, 6, 6)
    for i in range(10):
        a = i * math.pi / 5
        disk |= c.ell(x + .5 + 6 * math.cos(a), y + .5 + 6 * math.sin(a), 1.9, 1.9)
    c.fill(disk, "gold")
    c.fill(c.ell(x + .5, y + .5, 3.6, 3.6), "gold", tone=3)
    c.line(x, y - 2, x, y + 2, "gold:0")
    c.dot(x - 1, y - 1, "gold:0")


def zzz(c, x, y, bx=5):
    """A small z at (x, y) and a bigger one rising up and to the right."""
    c.path([(x, y), (x + 4, y), (x, y + 4), (x + 4, y + 4)], "zzz2")
    c.path([(x + bx, y - 7), (x + bx + 6, y - 7), (x + bx, y - 1), (x + bx + 6, y - 1)], "zzz")


def mouth_open(c, x, y, w=3, h=3):
    c.fill(c.ell(x + .5, y + .5, w, h), "mouth", lines="outer")
    c.fill(c.ell(x + .5, y + .5 + h * .45, w * .7, h * .5), "tongue", lines=False)


def tear(c, x, y):
    c.dot(x, y, "tear")
    c.dot(x, y + 1, "tear")
    c.dot(x - 1, y + 1, "tear")


def extras(c, pose, hat_at, rosette_at=(32, 46)):
    if pose == "party":
        if hat_at:
            hat(c, *hat_at)
        confetti(c)
    elif pose == "ribbon":
        rosette(c, *rosette_at)


# ------------------------------------------------------------------ pets
def cat(pose):
    c = Canvas()
    if pose == "sleep":
        c.fill(c.cap([(58, 58), (52, 62), (30, 62), (18, 60)], 2.6), "ginger")
        c.fill(c.ell(37, 51, 22, 11.5), "ginger")
        c.fill(c.ell(33, 57, 12, 5), "cream", lines="outer")
        for x in (42, 47, 52):
            c.line(x, 41, x - 2, 46, "ginger_stripe")
        c.fill(c.poly([(8, 44), (7, 33), (16, 38)]), "ginger")
        c.fill(c.poly([(24, 38), (31, 33), (31, 44)]), "ginger")
        c.fill(c.poly([(9, 42), (9, 36), (14, 39)]), "nose_pink", lines=False)
        c.fill(c.ell(20, 49, 14, 11), "ginger")
        c.fill(c.ell(20, 54.5, 8, 5), "cream", lines="outer")
        for x in (17, 20, 23):
            c.line(x, 39, x, 42, "ginger_stripe")
        eye(c, 14, 49, pose)
        eye(c, 26, 49, pose)
        c.fill(c.poly([(19, 52), (22, 52), (20.5, 54)]), "nose_pink", lines=False)
        blush(c, 9, 53)
        blush(c, 30, 53)
        c.fill(c.ell(16, 61, 5, 2.6), "cream")
        c.fill(c.ell(26, 61, 5, 2.6), "cream")
        zzz(c, 34, 31)
        return c
    dy = -6 if pose == "wait" else 0
    if pose == "wait":
        stack(c)
    with shifted(c, 0, dy):
        tail = [(43, 58), (51, 57), (55, 52), (56, 45), (54, 39)]
        c.fill(c.cap(tail, 2.7), "ginger")
        for x, y in ((53, 54), (55, 47), (55, 42)):
            c.line(x - 2, y, x + 2, y + 1, "ginger_stripe")
        c.fill(c.ell(32, 49, 14, 12), "ginger")
        c.fill(c.ell(32, 51, 8, 9), "cream", lines="outer")
        for y in (41, 45):
            c.line(19, y, 22, y + 1, "ginger_stripe")
            c.line(42, y + 1, 45, y, "ginger_stripe")
        if pose != "read":
            feet(c, "cream")
        c.fill(c.poly([(12, 25), (12, 7), (16, 6), (28, 16)]), "ginger")
        c.fill(c.poly([(52, 25), (52, 7), (48, 6), (36, 16)]), "ginger")
        c.fill(c.poly([(14, 21), (14, 11), (23, 17)]), "nose_pink", lines=False)
        c.fill(c.poly([(50, 21), (50, 11), (41, 17)]), "nose_pink", lines=False)
        c.fill(c.ell(32, 29, 19.5, 15), "ginger")
        for x in (28, 32, 36):
            c.line(x, 15, x, 19 if x == 32 else 18, "ginger_stripe")
        for y in (26, 30):
            c.line(13, y, 17, y + 1, "ginger_stripe")
            c.line(47, y + 1, 51, y, "ginger_stripe")
        c.fill(c.ell(32, 36, 9, 6), "cream", lines=False)
        eye(c, 24, 28, pose, iris="green_iris", lid="ginger", side="l")
        eye(c, 40, 28, pose, iris="green_iris", lid="ginger", side="r")
        blush(c, 19, 34)
        blush(c, 44, 34)
        c.fill(c.poly([(30, 32), (35, 32), (32.5, 35)]), "nose_pink", lines=False)
        c.dot(31, 32, "nose_pink:3")
        if pose == "yawn":
            mouth_open(c, 32, 38, 3, 3.5)
            tear(c, 45, 29)
        elif pose == "party":
            mouth_open(c, 32, 37, 3.5, 2.5)
        else:
            c.path([(32, 35), (32, 36), (31, 37), (30, 37), (29, 36)], "ginger:line")
            c.path([(33, 36), (34, 37), (35, 37), (36, 36)], "ginger:line")
        for y0, y1 in ((34, 33), (37, 38)):
            c.line(14, y1, 22, y0 + 1, "cream:1")
            c.line(42, y0 + 1, 50, y1, "cream:1")
        extras(c, pose, (32, 15, 3), (32, 47))
    if pose == "read":
        book(c, "cream")
    return c


def dog(pose):
    c = Canvas()
    if pose == "sleep":
        c.fill(c.cap([(57, 52), (60, 56), (58, 60)], 2.4), "tan")
        c.fill(c.ell(39, 52, 20, 10.5), "tan")
        c.fill(c.ell(45, 47, 8, 5.5), "brown", lines=False)
        c.fill(c.ell(37, 58, 12, 4.5), "snow", lines="outer")
        c.fill(c.ell(20, 49, 15, 12), "tan")
        c.fill(c.poly([(18, 37), (22, 37), (25, 50), (15, 50)]), "snow", lines=False)
        c.fill(c.ell(20.5, 55, 8.5, 5), "snow", lines=False)
        c.fill(c.poly([(9, 40), (4, 44), (3, 55), (7, 59), (11, 55), (13, 44)]), "brown")
        c.fill(c.poly([(32, 40), (37, 44), (38, 55), (34, 59), (30, 55), (28, 44)]), "brown")
        eye(c, 15, 48, pose)
        eye(c, 25, 48, pose)
        c.fill(c.ell(20.5, 52.5, 2.6, 1.8), "ink", lines=False)
        c.dot(19, 52, "snow:2")
        c.path([(20, 54), (20, 55), (18, 56)], "ink")
        c.path([(21, 55), (23, 56)], "ink")
        c.fill(c.ell(14, 61, 5, 2.6), "snow")
        c.fill(c.ell(26, 61, 5, 2.6), "snow")
        zzz(c, 35, 31)
        return c
    dy = -6 if pose == "wait" else 0
    if pose == "wait":
        stack(c)
    with shifted(c, 0, dy):
        c.fill(c.cap([(44, 55), (51, 52), (55, 45), (56, 38)], 2.4), "tan")
        c.fill(c.ell(56.5, 37, 2.6, 3), "snow")
        c.fill(c.ell(32, 49, 14, 12), "tan")
        c.fill(c.ell(32, 51, 8, 9.5), "snow", lines="outer")
        if pose != "read":
            feet(c, "snow")
        c.fill(c.ell(32, 28, 18, 15.5), "tan")
        c.fill(c.poly([(30, 13), (34, 13), (33, 22), (38, 32), (26, 32), (31, 22)]), "snow", lines=False)
        c.fill(c.ell(32, 36, 10, 6.5), "snow", lines=False)
        c.fill(c.poly([(19, 15), (12, 16), (7, 25), (6, 38), (10, 43), (16, 40), (20, 26)]), "brown")
        c.fill(c.poly([(45, 15), (52, 16), (57, 25), (58, 38), (54, 43), (48, 40), (44, 26)]), "brown")
        c.line(10, 24, 9, 36, "brown:3")
        c.line(54, 24, 55, 36, "brown:3")
        eye(c, 25, 28, pose, lid="tan", side="l")
        eye(c, 39, 28, pose, lid="tan", side="r")
        c.fill(c.ell(32.5, 33, 3.6, 2.5), "ink", lines=False)
        c.dot(31, 32, "snow:2")
        c.dot(32, 32, "snow:1")
        if pose == "yawn":
            mouth_open(c, 32, 39, 3, 3.5)
            tear(c, 44, 29)
        elif pose == "party":
            mouth_open(c, 32, 38, 3.5, 2.5)
            c.fill(c.ell(33, 42, 2.2, 2.6), "tongue", lines="outer")
        else:
            c.path([(32, 35), (32, 37), (30, 38), (28, 37)], "ink")
            c.path([(32, 37), (34, 38), (36, 37)], "ink")
        blush(c, 21, 35)
        blush(c, 43, 35)
        c.fill(c.cap([(20, 42), (32, 44), (44, 42)], 1.6), "red", tone=2)
        c.fill(c.ell(32.5, 46, 2.3, 2.3), "gold")
        extras(c, pose, (32, 14, 3), (32, 51))
    if pose == "read":
        book(c, "snow")
    return c


def rabbit(pose):
    c = Canvas()
    if pose == "sleep":
        c.fill(c.ell(38, 53, 20, 10), "fawn")
        c.fill(c.ell(57, 54, 4, 4), "snow")
        c.fill(c.ell(34, 59, 11, 4), "cream", lines="outer")
        c.fill(c.poly([(13, 46), (5, 37), (3, 31), (7, 29), (16, 39)]), "fawn")
        c.fill(c.poly([(22, 44), (27, 31), (32, 30), (32, 35), (27, 45)]), "fawn")
        c.fill(c.poly([(12, 43), (6, 35), (7, 33), (14, 40)]), "earpink", lines=False)
        c.fill(c.poly([(24, 43), (28, 33), (30, 34), (27, 43)]), "earpink", lines=False)
        c.fill(c.ell(20, 52, 13, 10), "fawn")
        c.fill(c.ell(20, 56, 7, 4.5), "cream", lines=False)
        eye(c, 15, 51, pose)
        eye(c, 25, 51, pose)
        c.fill(c.ell(20.5, 54.5, 1.6, 1.2), "nose_pink", lines=False)
        blush(c, 10, 55)
        blush(c, 29, 55)
        c.fill(c.ell(15, 61, 5, 2.6), "cream")
        c.fill(c.ell(25, 61, 5, 2.6), "cream")
        zzz(c, 36, 28)
        return c
    dy = -6 if pose == "wait" else 0
    if pose == "wait":
        stack(c)
    with shifted(c, 0, dy):
        c.fill(c.ell(47.5, 56, 4.5, 4.5), "snow")
        c.fill(c.ell(32, 50, 13, 11.5), "fawn")
        c.fill(c.ell(32, 52, 7.5, 8.5), "cream", lines="outer")
        if pose != "read":
            feet(c, "cream", rx=5.5)
        c.fill(c.poly([(21, 24), (17, 11), (17, 5), (21, 3), (25, 6), (28, 22)]), "fawn")
        c.fill(c.poly([(36, 22), (39, 7), (43, 3), (47, 5), (47, 11), (43, 24)]), "fawn")
        c.fill(c.poly([(21, 21), (19, 10), (20, 7), (23, 8), (25, 20)]), "earpink", lines=False)
        c.fill(c.poly([(39, 20), (41, 9), (44, 7), (45, 10), (42, 21)]), "earpink", lines=False)
        c.fill(c.ell(32, 31, 17, 13.5), "fawn")
        c.fill(c.ell(32, 37, 8, 5.5), "cream", lines=False)
        eye(c, 25, 30, pose, lid="fawn", side="l")
        eye(c, 39, 30, pose, lid="fawn", side="r")
        blush(c, 20, 36)
        blush(c, 43, 36)
        c.fill(c.poly([(30, 34), (35, 34), (32.5, 36)]), "nose_pink", lines=False)
        if pose == "yawn":
            mouth_open(c, 32, 40, 2.6, 3)
            tear(c, 44, 31)
        elif pose == "party":
            mouth_open(c, 32, 39, 3, 2.2)
        else:
            c.path([(32, 36), (32, 37), (30, 38)], "fawn:line")
            c.path([(33, 37), (35, 38)], "fawn:line")
            c.fill(c.poly([(31, 38), (34, 38), (34, 40), (31, 40)]), "snow", tone=2)
            c.line(32, 38, 32, 40, "snow:0")
        for y0, y1 in ((36, 35), (38, 39)):
            c.line(13, y1, 21, y0 + 1, "fawn:inner")
            c.line(43, y0 + 1, 51, y1, "fawn:inner")
        extras(c, pose, (32, 18, 2), (32, 49))
    if pose == "read":
        book(c, "cream")
    return c


def owl(pose):
    c = Canvas()
    asleep = pose == "sleep"
    dy = -6 if pose == "wait" else 0
    if pose == "wait":
        stack(c)
    with shifted(c, 0, dy + (5 if asleep else 0)):
        if not asleep and pose != "read":
            for x in (25, 39):
                for dx in (-2, 0, 2):
                    c.line(x + dx, 58, x + dx, 61, "beak:1")
                    c.dot(x + dx, 62, "beak:line")
        c.fill(c.ell(32, 45, 17, 15 if not asleep else 13), "owl")
        c.fill(c.ell(32, 48, 10, 10 if not asleep else 8), "cream", lines="outer")
        for x, y in ((28, 43), (36, 43), (32, 46), (27, 49), (37, 49), (32, 52)):
            c.path([(x - 1, y), (x, y + 1), (x + 1, y)], "owl_mark")
        c.fill(c.poly([(17, 34), (12, 42), (12, 53), (17, 57), (21, 49)]), "owl", tone=0)
        c.fill(c.poly([(47, 34), (52, 42), (52, 53), (47, 57), (43, 49)]), "owl", tone=0)
        for x in (14, 50):
            c.line(x, 45, x, 51, "owl:line")
        c.fill(c.ell(32, 24, 21, 14.5) | c.poly([(11, 22), (10, 7), (21, 13), (43, 13), (54, 7), (53, 22)]), "owl")
        c.fill(c.ell(24, 25, 8.5, 8.5), "cream", tone=1)
        c.fill(c.ell(40, 25, 8.5, 8.5), "cream", tone=1)
        if pose in ("sleep", "party", "yawn"):
            eye(c, 23, 24, pose, line="owl:line", side="l")
            eye(c, 40, 24, pose, line="owl:line", side="r")
        else:
            eye(c, 23, 24, pose, iris="amber", lid="cream", side="l", rx=3.6, ry=3.8)
            eye(c, 40, 24, pose, iris="amber", lid="cream", side="r", rx=3.6, ry=3.8)
        c.fill(c.poly([(29.5, 29), (35.5, 29), (32.5, 35)]), "beak")
        if pose == "yawn":
            mouth_open(c, 32, 37, 2.6, 2.4)
            tear(c, 48, 25)
        for x in (15, 49):
            c.line(x - 1, 31, x + 1, 31, "blush")
        extras(c, pose, (32, 14, 3), (32, 46))
        if asleep:
            zzz(c, 56, 17, bx=1)
    if pose == "read":
        book(c, None, claws="beak")
    return c


def penguin(pose):
    c = Canvas()
    asleep = pose == "sleep"
    dy = -6 if pose == "wait" else 0
    if pose == "wait":
        stack(c)
    with shifted(c, 0, dy + (4 if asleep else 0)):
        if pose != "read" and not asleep:
            feet(c, "beak", xs=(24, 40), rx=5.5, ry=2.5, toes=False)
        if pose == "party":
            c.fill(c.poly([(16, 38), (6, 27), (3, 29), (7, 39), (15, 46)]), "navy")
            c.fill(c.poly([(48, 38), (58, 27), (61, 29), (57, 39), (49, 46)]), "navy")
        else:
            c.fill(c.poly([(15, 36), (8, 44), (8, 54), (12, 53), (18, 44)]), "navy")
            c.fill(c.poly([(49, 36), (56, 44), (56, 54), (52, 53), (46, 44)]), "navy")
        c.fill(c.ell(32, 37 if not asleep else 40, 18, 23 if not asleep else 20), "navy", soft=.25)
        c.fill(c.ell(32, 47 if not asleep else 48, 12, 12 if not asleep else 10), "snow", lines=False)
        face = c.ell(25, 27, 7.5, 8) | c.ell(39, 27, 7.5, 8) | c.ell(32, 33, 10, 7)
        c.fill(face, "snow", lines=False)
        c.path([(30, 15), (31, 13), (33, 14), (34, 12)], "navy:3")
        eye(c, 25, 27, pose, lid="snow", side="l", line="navy:line")
        eye(c, 39, 27, pose, lid="snow", side="r", line="navy:line")
        blush(c, 20, 33)
        blush(c, 43, 33)
        if pose == "yawn":
            c.fill(c.poly([(28, 31), (37, 31), (32.5, 33)]), "beak")
            mouth_open(c, 32, 35, 2.4, 2)
            c.fill(c.poly([(28, 37), (37, 37), (32.5, 39)]), "beak")
            tear(c, 45, 28)
        else:
            c.fill(c.poly([(28, 31), (37, 31), (32.5, 36)]), "beak")
            if pose == "party":
                c.line(29, 33, 36, 33, "beak:0")
        c.fill(c.cap([(16, 40), (32, 42), (48, 40)], 2.2), "scarf")
        c.fill(c.poly([(41, 41), (46, 42), (48, 53), (43, 53)]), "scarf")
        for y in (45, 49):
            c.line(43, y, 47, y, "snow:2")
        for x in (22, 30, 38):
            c.line(x, 40, x + 1, 43, "snow:2")
        extras(c, pose, (32, 15, 3), (27, 50))
        if asleep:
            zzz(c, 44, 14)
    if pose == "read":
        book(c, "navy")
    return c


def robot(pose):
    c = Canvas()
    asleep = pose == "sleep"
    dy = -4 if pose == "wait" else 0
    if pose == "wait":
        stack(c)
    with shifted(c, 0, dy):
        sag = 4 if asleep else 0
        if pose != "read":
            for x in (25, 39):
                c.fill(c.poly([(x - 3, 53), (x + 3, 53), (x + 3, 58), (x - 3, 58)]), "metal", tone=0)
                c.fill(c.poly([(x - 5, 58), (x + 5, 58), (x + 6, 62), (x - 6, 62)]), "screen")
        if pose == "party":
            for side in (-1, 1):
                x = 32 + side * 17
                c.fill(c.cap([(x, 45), (x + side * 6, 37), (x + side * 7, 30)], 2), "metal", tone=0)
                c.fill(c.ell(32 + side * 24 + .5, 28.5, 3.2, 3.2), "metal")
        else:
            for side in (-1, 1):
                x = 32 + side * 18
                c.fill(c.cap([(x, 43 + sag), (x + side * 2, 50 + sag)], 2.6), "metal", tone=0)
                c.fill(c.ell(x + side * 2 + .5, 53.5 + sag, 3.2, 2.6), "metal")
        c.fill(c.poly([(17, 39 + sag), (47, 39 + sag), (48, 41 + sag), (48, 54), (46, 56), (18, 56), (16, 54), (16, 41 + sag)]), "metal", soft=.5)
        c.fill(c.poly([(22, 43 + sag), (42, 43 + sag), (42, 52), (22, 52)]), "screen", tone=1)
        for x, col in ((26, "yellow:2"), (30, "conf_green"), (34, "bulb:2")):
            c.dot(x, 47 + sag // 2, col)
            c.dot(x + 1, 47 + sag // 2, col)
        c.line(37, 46 + sag // 2, 40, 46 + sag // 2, "led_dim")
        c.line(37, 49 + sag // 2, 39, 49 + sag // 2, "led_dim")
        with shifted(c, 0, sag):
            for side in (-1, 1):
                x = 32 + side * 22
                c.fill(c.poly([(x - 3, 19), (x + 3, 19), (x + 3, 31), (x - 3, 31)]), "metal", soft=.6)
                c.line(x, 21, x, 29, "metal:3" if side < 0 else "metal:0")
            c.line(32, 7, 32, 10, "metal:line")
            c.line(33, 7, 33, 10, "metal:0")
            c.fill(c.ell(33, 6.5, 2.7, 2.7), "bulb")
            c.fill(c.poly([(13, 9), (51, 9), (54, 12), (54, 34), (51, 37), (13, 37), (10, 34), (10, 12)]), "metal", soft=.45)
            c.line(14, 11, 49, 11, "metal:3")
            c.fill(c.poly([(15, 14), (49, 14), (50, 15), (50, 31), (49, 32), (15, 32), (14, 31), (14, 15)]), "screen", tone=1)
            c.line(16, 15, 26, 15, "screen:3")
            for x, y in ((12, 11), (52, 11), (12, 35), (52, 35)):
                c.dot(x, y, "metal:0")
            for x in (24, 40):
                if pose in ("read", "sleep"):
                    c.line(x - 2, 24, x + 2, 24, "led")
                    if pose == "read":
                        c.dot(x - 3, 23, "led_dim")
                        c.dot(x + 3, 23, "led_dim")
                elif pose == "party":
                    c.path([(x - 3, 25), (x, 22), (x + 3, 25)], "led")
                elif pose == "yawn":
                    k = 1 if x < 32 else -1
                    c.path([(x - 2 * k, 21), (x + k, 23), (x - 2 * k, 25)], "led")
                else:
                    for dx in (-1, 0, 1):
                        c.line(x + dx, 20 if pose == "wait" else 21, x + dx, 25 if pose == "wait" else 26, "led")
                    c.dot(x - 1, 21 if pose != "wait" else 20, "white")
            if pose == "yawn":
                c.fill(c.ell(32.5, 28.5, 2.6, 2.4), "led_dim", lines=False)
                c.fill(c.ell(32.5, 28.5, 1.4, 1.2), "led", lines=False)
            elif pose == "party":
                c.path([(28, 27), (30, 29), (35, 29), (37, 27)], "led")
            else:
                c.line(29, 28, 36, 28, "led" if pose != "sleep" else "led_dim")
            for x in (18, 46):
                c.dot(x, 28, "blush")
                c.dot(x + 1, 28, "blush")
        extras(c, pose, (32, 9, 3), (32, 47))
        if asleep:
            zzz(c, 44, 7)
    if pose == "read":
        book(c, "metal")
    return c


def vampire(pose):
    c = Canvas()
    asleep = pose == "sleep"
    dy = -6 if pose == "wait" else 0
    if pose == "wait":
        stack(c)
    with shifted(c, 0, dy):
        sag = 3 if asleep else 0
        c.fill(c.poly([(10, 38), (20, 40), (44, 40), (54, 38), (51, 48), (58, 62), (47, 59),
                       (40, 63), (32, 59), (24, 63), (17, 59), (6, 62), (13, 48)]), "cape", soft=.4)
        c.fill(c.poly([(18, 41), (46, 41), (49, 58), (40, 61), (32, 57), (24, 61), (15, 58)]), "lining", soft=.4)
        if pose != "read":
            feet(c, "cape", rx=4.5, ry=2.4, toes=False)
        c.fill(c.poly([(21, 40), (43, 40), (44, 57), (20, 57)]), "cape", tone=2)
        c.fill(c.poly([(27, 40), (37, 40), (32, 50)]), "snow", tone=1)
        c.fill(c.poly([(29, 41), (35, 41), (35, 44), (29, 44)]) | c.ell(32, 42.5, 2, 2), "lining", tone=2)
        c.fill(c.ell(32.5, 46.5, 1.6, 1.6), "red_iris", lines="outer")
        c.fill(c.poly([(12, 20), (20, 34), (24, 40), (17, 40), (9, 30)]), "lining", soft=.3)
        c.fill(c.poly([(52, 20), (44, 34), (40, 40), (47, 40), (55, 30)]), "lining", soft=.3)
        with shifted(c, 0, sag):
            c.fill(c.poly([(19, 26), (9, 20), (12, 31), (19, 33)]), "pale")
            c.fill(c.poly([(45, 26), (55, 20), (52, 31), (45, 33)]), "pale")
            c.fill(c.ell(32, 27, 16, 14.5), "pale")
            c.fill(c.poly([(15, 27), (15, 17), (20, 11), (27, 8), (37, 8), (44, 11), (49, 17), (49, 27),
                           (45, 20), (39, 17), (32, 24), (25, 17), (19, 20)]), "hair", soft=.3)
            c.path([(22, 12), (26, 10), (30, 10)], "hair:3")
            eye(c, 25, 28, pose, iris="red_iris", lid="pale", side="l", line="hair:line")
            eye(c, 39, 28, pose, iris="red_iris", lid="pale", side="r", line="hair:line")
            blush(c, 20, 33)
            blush(c, 43, 33)
            if pose == "yawn":
                mouth_open(c, 32, 36, 3.2, 3)
                c.dot(30, 34, "white")
                c.dot(34, 34, "white")
                tear(c, 44, 29)
            else:
                c.path([(28, 34), (30, 35), (34, 35), (36, 34)], "hair:line")
                for x in (30, 34):
                    c.dot(x, 36, "white")
                    c.dot(x, 37, "pale:line")
        extras(c, pose, (32, 9, 3), (32, 49))
        if asleep:
            zzz(c, 44, 7)
    if pose == "read":
        book(c, "pale")
    return c


def dragon(pose):
    c = Canvas()
    if pose == "sleep":
        c.fill(c.poly([(36, 44), (44, 33), (54, 35), (59, 44), (51, 43)]), "wing")
        c.line(44, 35, 51, 43, "wing:line")
        c.fill(c.cap([(55, 56), (60, 59), (54, 62), (40, 62)], 2.6), "scale")
        for x in (58, 50, 44):
            c.fill(c.poly([(x - 2, 59), (x, 55), (x + 2, 59)]), "spike")
        for x in (33, 41, 49):
            c.fill(c.poly([(x - 3, 44), (x, 38), (x + 3, 44)]), "spike")
        c.fill(c.ell(38, 52, 20, 10.5), "scale")
        c.fill(c.ell(36, 58, 12, 4), "belly", lines="outer")
        c.fill(c.poly([(9, 41), (4, 30), (8, 31), (14, 38)]), "horn")
        c.fill(c.poly([(26, 38), (30, 28), (32, 31), (30, 40)]), "horn")
        c.fill(c.ell(20, 48, 15, 12), "scale")
        c.fill(c.ell(17, 55, 10, 5.5), "scale", tone=2)
        c.dot(13, 53, "scale:line")
        c.dot(20, 53, "scale:line")
        c.path([(10, 57), (13, 58), (21, 58), (24, 57)], "scale:line")
        eye(c, 13, 46, pose, line="scale:line")
        eye(c, 25, 46, pose, line="scale:line")
        blush(c, 29, 51)
        c.fill(c.ell(14, 62, 4.5, 2.2), "scale", tone=0)
        c.fill(c.ell(26, 62, 4.5, 2.2), "scale", tone=0)
        zzz(c, 36, 29)
        return c
    dy = -6 if pose == "wait" else 0
    if pose == "wait":
        stack(c)
    with shifted(c, 0, dy):
        for side in (-1, 1):
            wing = [(32 + side * 12, 44), (32 + side * 20, 33), (32 + side * 29, 31), (32 + side * 30, 43),
                    (32 + side * 26, 41), (32 + side * 25, 48), (32 + side * 20, 46), (32 + side * 16, 52)]
            c.fill(c.poly(wing), "wing", soft=.4)
            c.line(32 + side * 20, 34, 32 + side * 26, 42, "wing:line")
            c.line(32 + side * 20, 34, 32 + side * 20, 46, "wing:line")
        c.fill(c.cap([(42, 58), (50, 58), (55, 55), (58, 50)], 2.6), "scale")
        c.fill(c.poly([(56, 49), (61, 45), (60, 52)]), "spike")
        for x, y in ((50, 55), (55, 52)):
            c.fill(c.poly([(x - 1, y), (x + 1, y - 4), (x + 3, y)]), "spike")
        c.fill(c.ell(32, 49, 13, 12), "scale")
        c.fill(c.ell(32, 51, 7.5, 9), "belly", lines="outer")
        for y in (46, 50, 54):
            c.line(27, y, 37, y, "belly:0")
        if pose != "read":
            feet(c, "scale")
            for x in (24, 40):
                for dx in (-2, 0, 2):
                    c.dot(x + dx, 62, "horn:2")
        c.fill(c.poly([(17, 19), (11, 6), (15, 7), (22, 15)]), "horn")
        c.fill(c.poly([(47, 19), (53, 6), (49, 7), (42, 15)]), "horn")
        for x in (27, 32, 37):
            c.fill(c.poly([(x - 3, 15), (x, 9 if x == 32 else 11), (x + 3, 15)]), "spike")
        c.fill(c.poly([(15, 27), (8, 23), (10, 31)]), "wing")
        c.fill(c.poly([(49, 27), (56, 23), (54, 31)]), "wing")
        c.fill(c.ell(32, 27, 18, 13.5), "scale")
        c.fill(c.ell(32, 35, 11, 6.5), "scale", tone=2)
        c.dot(28, 33, "scale:line")
        c.dot(36, 33, "scale:line")
        eye(c, 24, 25, pose, iris="amber", lid="scale", side="l", line="scale:line")
        eye(c, 40, 25, pose, iris="amber", lid="scale", side="r", line="scale:line")
        blush(c, 18, 32)
        blush(c, 45, 32)
        if pose == "yawn":
            mouth_open(c, 32, 38, 3.4, 2.6)
            c.dot(29, 36, "white")
            tear(c, 46, 26)
        elif pose == "party":
            mouth_open(c, 32, 38, 3.6, 2)
        else:
            c.path([(26, 37), (28, 38), (36, 38), (38, 37)], "scale:line")
            c.dot(35, 39, "white")
        extras(c, pose, (32, 10, 3), (32, 49))
    if pose == "read":
        book(c, "scale")
    return c


def ghost(pose):
    c = Canvas()
    asleep = pose == "sleep"
    dy = -6 if pose == "wait" else 0
    if pose == "wait":
        stack(c)
    with shifted(c, 0, dy + (6 if asleep else 0)):
        if pose == "party":
            c.fill(c.ell(12, 33, 4.5, 3), "ghost")
            c.fill(c.ell(52, 31, 4.5, 3), "ghost")
        elif pose != "read":
            c.fill(c.ell(15, 42, 4, 3), "ghost")
            c.fill(c.ell(49, 42, 4, 3), "ghost")
        body = c.ell(32, 27, 17, 17) | c.poly([(15, 27), (49, 27), (49, 46), (52, 52), (46, 54),
                                                 (41, 50), (37, 55), (32, 51), (27, 55), (23, 50),
                                                 (18, 54), (12, 52), (15, 46)])
        c.fill(body, "ghost", soft=.3)
        c.path([(45, 22), (46, 26), (46, 34)], "ghost:0")
        if pose in ("sleep", "party", "yawn"):
            eye(c, 25, 29, pose, line="ghost_eye", side="l")
            eye(c, 39, 29, pose, line="ghost_eye", side="r")
        else:
            eye(c, 25, 29, pose, lid="ghost", side="l", line="ghost_eye", rx=3, ry=3.8)
            eye(c, 39, 29, pose, lid="ghost", side="r", line="ghost_eye", rx=3, ry=3.8)
        blush(c, 20, 35)
        blush(c, 43, 35)
        if pose == "yawn":
            mouth_open(c, 32, 38, 2.6, 3.2)
            tear(c, 44, 30)
        elif pose == "party":
            mouth_open(c, 32, 36, 3, 2.2)
        else:
            if asleep:
                c.line(31, 36, 33, 36, "ghost_eye")
            else:
                c.fill(c.ell(32.5, 36.5, 1.8, 1.4), "ghost_eye", lines=False)
        extras(c, pose, (32, 11, 3), (32, 44))
        if asleep:
            zzz(c, 44, 3)
    if pose == "read":
        book(c, "ghost")
    return c


def mimic(pose):
    c = Canvas()
    gap = {"sleep": 0, "read": 4, "wait": 4, "ribbon": 5, "party": 7, "yawn": 10}[pose]
    dy = -6 if pose == "wait" else 0
    if pose == "wait":
        stack(c)
    with shifted(c, 0, dy):
        top = 43
        lid_bot = top - gap
        lid_top = lid_bot - 19
        if pose != "read":
            c.fill(c.poly([(17, 59), (22, 59), (22, 63), (15, 63)]), "leather", tone=0)
            c.fill(c.poly([(42, 59), (47, 59), (49, 63), (42, 63)]), "leather", tone=0)
        for side in (-1, 1):
            c.fill(c.ell(32 + side * 24 + .5, 51.5, 3.2, 3.8), "leather")
        if gap:
            c.fill(c.poly([(12, lid_bot - 2), (52, lid_bot - 2), (52, top + 2), (12, top + 2)]), "mouth", lines=False)
            c.fill(c.ell(32.5, top - 1, 9, 2.4), "tongue", lines=False)
        c.fill(c.poly([(9, 57), (55, 57), (55, 61), (9, 61)]), "leather", soft=.6)
        c.fill(c.poly([(11, top), (53, top), (53, 58), (11, 58)]), "paper", tone=1)
        for y in range(top + 3, 57, 3):
            c.line(12, y, 52, y, "paper:0")
        for x0, x1 in ((9, 13), (51, 55)):
            c.fill(c.poly([(x0, 57), (x1, 57), (x1, 61), (x0, 61)]), "gold", soft=.6)
        if gap >= 4:
            for x in (17, 25, 33, 41, 49):
                c.fill(c.poly([(x - 2, top + 1), (x + 2, top + 1), (x, top - 3)]), "snow", tone=2)
        c.fill(c.poly([(9, lid_top + 2), (11, lid_top), (53, lid_top), (55, lid_top + 2),
                       (55, lid_bot), (9, lid_bot)]), "leather", soft=.5)
        c.path([(13, lid_top + 3), (51, lid_top + 3), (51, lid_bot - 3), (13, lid_bot - 3), (13, lid_top + 3)], "gold:1")
        c.fill(c.poly([(9, lid_top + 2), (11, lid_top), (17, lid_top), (9, lid_top + 8)]), "gold")
        c.fill(c.poly([(55, lid_top + 2), (53, lid_top), (47, lid_top), (55, lid_top + 8)]), "gold")
        if gap >= 4:
            for x in (21, 29, 37, 45):
                c.fill(c.poly([(x - 2, lid_bot - 1), (x + 2, lid_bot - 1), (x, lid_bot + 3)]), "snow", tone=2)
        ey = lid_top + 9
        eye(c, 24, ey, pose, iris="amber", lid="leather", side="l", line="leather:line", rx=3.2, ry=3.6)
        eye(c, 40, ey, pose, iris="amber", lid="leather", side="r", line="leather:line", rx=3.2, ry=3.6)
        if pose in ("wait", "ribbon", "read"):
            c.line(20, ey - 5, 26, ey - 6, "leather:line")
            c.line(38, ey - 6, 44, ey - 5, "leather:line")
        c.fill(c.poly([(40, top - 1), (45, top - 1), (45, top + 11), (42.5, top + 8.5), (40, top + 11)]), "red", tone=2)
        if pose == "party":
            for x, y, flip in ((6, 30, 0), (57, 26, 1), (10, 18, 1)):
                c.fill(c.poly([(x, y), (x + 4, y - 1 + flip * 2), (x + 5, y + 4), (x + 1, y + 5 - flip)]), "paper", tone=2)
            hat(c, 32, lid_top + 1, 3, h=14)
            confetti(c)
        elif pose == "ribbon":
            rosette(c, 26, 49)
        elif pose == "yawn":
            tear(c, 45, ey + 1)
        elif pose == "sleep":
            zzz(c, 46, lid_top - 3)
    if pose == "read":
        book(c, "leather", cover="teal")
    return c


def mummy(pose):
    c = Canvas()
    asleep = pose == "sleep"
    dy = -6 if pose == "wait" else 0
    if pose == "wait":
        stack(c)
    with shifted(c, 0, dy + (4 if asleep else 0)):
        if pose == "party":
            c.fill(c.cap([(48, 30), (54, 24), (57, 16), (55, 9)], 1.5), "wrap")
        elif not asleep:
            trail = [(47, 30), (51, 37), (50, 44)] + ([(53, 52), (52, 58)] if pose == "yawn" else [])
            c.fill(c.cap(trail, 1.5), "wrap")
        body = c.fill(c.ell(32, 49, 13, 12 if not asleep else 10), "wrap")
        for y in (42, 46, 50, 54, 58):
            c.line(18, y + 2, 46, y - 1, "wrap:0", inside=body)
        if pose != "read" and not asleep:
            feet(c, "wrap", toes=False)
        if asleep:
            c.fill(c.cap([(21, 45), (40, 51)], 2.4), "wrap")
            c.fill(c.cap([(21, 51), (40, 45)], 2.4), "wrap")
        else:
            c.fill(c.ell(32.5, 46.5, 3.2, 2.6), "scarab")
            c.dot(32, 44, "gold:2")
            c.dot(33, 44, "gold:2")
            for side in (-1, 1):
                arm = c.fill(c.ell(32 + side * 14.5 + .5, 49.5, 3.4, 5), "wrap")
                c.line(32 + side * 12, 47, 32 + side * 17, 50, "wrap:0", inside=arm)
        head = c.fill(c.ell(32, 28, 17, 15), "wrap")
        inset = {(x, y) for x, y in head if all((x + dx, y + dy_) in head for dx, dy_ in ((-2, 0), (2, 0)))}
        slot = c.poly([(15, 23), (24, 21), (33, 22), (41, 20), (49, 22), (49, 30), (40, 32), (31, 30), (23, 32), (15, 30)])
        c.fill(slot & inset, "wrap_gap", lines=False)
        for y in (15, 19):
            c.line(14, y + 1, 50, y - 1, "wrap:0", inside=head)
        for y in (36, 40):
            c.line(14, y, 50, y + 1, "wrap:0", inside=head)
        if pose in ("sleep", "party", "yawn"):
            eye(c, 25, 26, pose, line="wrap:3", side="l")
            eye(c, 39, 26, pose, line="wrap:3", side="r")
        else:
            eye(c, 25, 26, pose, iris="snow", side="l", rx=3, ry=3.2)
            eye(c, 39, 26, pose, iris="snow", side="r", rx=3, ry=3.2)
        strip = c.fill(c.cap([(37, 19), (48, 31)], 1.7), "wrap")
        c.line(38, 21, 46, 30, "wrap:0", inside=strip)
        blush(c, 20, 34)
        blush(c, 43, 34)
        if pose == "yawn":
            mouth_open(c, 32, 37, 3, 2.8)
            tear(c, 21, 30)
        elif pose == "party":
            mouth_open(c, 32, 36, 3.2, 2.2)
        else:
            c.path([(30, 36), (32, 37), (34, 36)], "wrap:line")
        extras(c, pose, (31, 14, -3), (27, 51))
        if asleep:
            zzz(c, 46, 7)
    if pose == "read":
        book(c, "wrap")
    return c


def witch(pose):
    c = Canvas()
    asleep = pose == "sleep"
    dy = -6 if pose == "wait" else 0
    if pose == "wait":
        stack(c)
    with shifted(c, 0, dy):
        if pose != "read":
            c.fill(c.poly([(29, 57), (23, 57), (17, 61), (22, 63), (29, 63)]), "witchhat")
            c.fill(c.poly([(35, 57), (41, 57), (47, 61), (42, 63), (35, 63)]), "witchhat")
        c.fill(c.poly([(17, 26), (47, 26), (50, 42), (44, 45), (20, 45), (14, 42)]), "ginger")
        c.fill(c.poly([(22, 39), (42, 39), (47, 50), (51, 59), (13, 59), (17, 50)]), "robe", soft=.4)
        for x, y in ((20, 54), (41, 51), (30, 56), (26, 47)):
            c.dot(x, y, "star")
        c.line(14, 58, 50, 58, "gold:1")
        raised = pose in ("party", "ribbon")
        for side in (-1, 1):
            if raised and side > 0:
                c.fill(c.cap([(41, 42), (47, 38)], 2.8), "robe")
                c.fill(c.ell(49.5, 37, 2.6, 2.6), "skin")
            else:
                c.fill(c.cap([(32 + side * 9, 42), (32 + side * 14, 48)], 2.8), "robe")
                c.fill(c.ell(32 + side * 15.5 + .5, 50, 2.6, 2.4), "skin")
        if raised:
            c.line(50, 35, 55, 26, "gold:0")
            c.line(51, 35, 56, 26, "gold:1")
            sparkle(c, 56, 24)
            for x, y in ((60, 20), (52, 19), (59, 29)):
                c.dot(x, y, "star")
        c.fill(c.poly([(28, 38), (36, 38), (32, 42)]), "gold", tone=2)
        c.fill(c.ell(32, 31, 13.5, 12), "skin")
        c.fill(c.poly([(19, 24), (45, 24), (44, 29), (39, 27), (34, 30), (29, 27), (24, 30), (20, 29)]), "ginger")
        eye(c, 27, 32, pose, iris="green_iris", lid="skin", side="l", line="robe:line")
        eye(c, 37, 32, pose, iris="green_iris", lid="skin", side="r", line="robe:line")
        for x, y in ((22, 35), (24, 36), (40, 36), (42, 35)):
            c.dot(x, y, "ginger:1")
        blush(c, 22, 37)
        blush(c, 41, 37)
        if pose == "yawn":
            mouth_open(c, 32, 39, 2.6, 2.6)
            tear(c, 41, 32)
        elif pose == "party":
            mouth_open(c, 32, 38, 2.8, 2)
        else:
            c.path([(30, 38), (32, 39), (34, 38)], "skin:line")
        hd = 9 if asleep else 0
        c.fill(c.poly([(21, 21 + hd), (43, 21 + hd), (40, 13 + hd), (46, 5 + hd), (49, 1 + hd),
                       (39, 5 + hd), (31, 9 + hd), (25, 14 + hd)]), "witchhat", soft=.4)
        c.fill(c.poly([(22, 16 + hd), (42, 16 + hd), (43, 20 + hd), (21, 20 + hd)]), "gold", tone=1)
        c.path([(30, 16 + hd), (34, 16 + hd), (34, 19 + hd), (30, 19 + hd), (30, 16 + hd)], "witchhat:2")
        c.fill(c.ell(32, 22 + hd, 22, 3.6), "witchhat")
        if pose == "party":
            hat(c, 27, 13, -4, h=10)
            confetti(c)
        elif pose == "ribbon":
            rosette(c, 32, 49)
        elif asleep:
            zzz(c, 48, 22)
    if pose == "read":
        book(c, "skin", cover="teal")
        for x, y in ((10, 39), (54, 38), (19, 35), (46, 34)):
            sparkle(c, x, y)
    return c


def skeleton(pose):
    c = Canvas()
    asleep = pose == "sleep"
    dy = -6 if pose == "wait" else 0
    if pose == "wait":
        stack(c)
    with shifted(c, 0, dy + (3 if asleep else 0)):
        if pose != "read" and not asleep:
            for x in (27, 37):
                c.fill(c.cap([(x, 56), (x, 59)], 1.6), "bone")
                c.fill(c.ell(x + (-1.5 if x < 32 else 2.5), 61, 3.8, 2), "bone")
        c.fill(c.cap([(32, 42), (32, 55)], 1.6), "bone")
        c.fill(c.ell(32, 56.5, 8, 3), "bone")
        c.fill(c.ell(32, 49, 10.5, 7.5), "bone")
        for y in (46, 49, 52):
            c.line(24, y, 30, y, "socket")
            c.line(34, y, 40, y, "socket")
        for side in (-1, 1):
            if pose == "party":
                c.fill(c.cap([(32 + side * 9, 44), (32 + side * 15, 37), (32 + side * 17, 30)], 1.5), "bone")
                c.fill(c.ell(32 + side * 17 + .5, 28.5, 2.4, 2.4), "bone")
                for k in (0, 3):
                    c.line(32 + side * (21 + k), 28 + k, 32 + side * (22 + k), 30 + k, "smoke")
            else:
                c.fill(c.cap([(32 + side * 9, 44), (32 + side * 13, 50), (32 + side * 13, 54)], 1.5), "bone")
                c.fill(c.ell(32 + side * 13 + .5, 56, 2.4, 2.2), "bone")
        c.fill(c.poly([(26, 40), (31, 42), (26, 45)]), "red")
        c.fill(c.poly([(38, 40), (33, 42), (38, 45)]), "red")
        c.fill(c.ell(32.5, 42.5, 1.8, 1.8), "red", tone=2)
        jd = {"yawn": 4, "party": 2}.get(pose, 0)
        if jd:
            c.fill(c.poly([(25, 34), (39, 34), (39, 36 + jd), (25, 36 + jd)]), "socket", lines=False)
        c.fill(c.poly([(23, 34 + jd), (41, 34 + jd), (40, 38 + jd), (36, 40 + jd), (28, 40 + jd), (24, 38 + jd)]), "bone")
        for x in (28, 31, 34, 37):
            c.line(x, 35 + jd, x, 37 + jd, "socket")
        c.fill(c.ell(32, 24.5, 16, 12.5), "bone")
        for x in (28, 31, 34, 37):
            c.line(x, 34, x, 35, "socket")
        if pose in ("sleep", "party", "yawn"):
            for x, side in ((25, "l"), (38, "r")):
                eye(c, x, 24, pose, line="socket", side=side)
                eye(c, x, 25, pose, line="socket", side=side)
        else:
            look = {"read": 1, "wait": -1}.get(pose, 0)
            for x in (25.5, 38.5):
                c.fill(c.ell(x, 24.5, 4, 4.5), "socket", lines=False)
                c.dot(x - 1.5, 23 + look, "white")
                c.dot(x - .5, 23 + look, "white")
                c.dot(x - 1.5, 24 + look, "white")
        c.fill(c.poly([(30.5, 29), (34.5, 29), (32.5, 32)]), "socket", lines=False)
        blush(c, 18, 29)
        blush(c, 45, 29)
        extras(c, pose, (32, 15, 2, 12), (32, 49))
        if asleep:
            zzz(c, 48, 9)
    if pose == "read":
        book(c, "bone")
    return c


def candle(pose):
    c = Canvas()
    asleep = pose == "sleep"
    dy = -6 if pose == "wait" else 0
    if pose == "wait":
        stack(c)
    with shifted(c, 0, dy):
        c.fill(c.ell(54, 55, 4.6, 4.6) - c.ell(54, 55, 2, 2), "gold")
        c.fill(c.ell(32, 58, 20, 4.5), "gold", soft=.5)
        for side in (-1, 1):
            c.fill(c.ell(32 + side * 14.5 + .5, 45.5, 3, 2.6), "wax")
        c.fill(c.poly([(21, 27), (43, 27), (44, 29), (44, 57), (20, 57), (20, 29)]), "wax", soft=.4)
        c.fill(c.ell(32, 27.5, 12, 3), "wax", tone=3)
        for x, y0, y1, r in ((23, 29, 37, 1.6), (40, 29, 34, 1.5), (35, 29, 31, 1.3)):
            c.fill(c.cap([(x, y0), (x, y1)], r), "wax", tone=2, lines="outer")
        eye(c, 27, 40, pose, lid="wax", side="l", line="wax:line")
        eye(c, 37, 40, pose, lid="wax", side="r", line="wax:line")
        blush(c, 23, 45)
        blush(c, 40, 45)
        if pose == "yawn":
            mouth_open(c, 32, 46, 2.6, 2.6)
            tear(c, 41, 40)
        elif pose == "party":
            mouth_open(c, 32, 45, 3, 2)
        else:
            c.path([(30, 45), (32, 46), (34, 45)], "wax:line")
        c.line(32, 21, 32, 25, "ink")
        if asleep:
            c.path([(32, 19), (31, 16), (33, 13), (32, 10), (34, 7)], "smoke")
            zzz(c, 40, 14)
        else:
            s = {"yawn": .5, "party": 1.25}.get(pose, 1)
            fh = 15 * s
            base = 23.5
            outer = c.ell(32.5, base - fh * .4, 4.8 * s + .6, fh * .45) | c.poly(
                [(32.5 - 3.6 * s, base - fh * .5), (32.5 + 3.6 * s, base - fh * .5), (32.5, base - fh)])
            c.fill(outer, "flame", tone=1)
            c.fill(c.ell(32.5, base - fh * .33, 2.6 * s + .4, fh * .3), "flame", tone=3, lines=False)
            c.fill(c.ell(32.5, base - fh * .2, 1.1, max(1, 1.6 * s)), "white", lines=False)
            if pose == "party":
                for x, y in ((22, 9), (43, 7), (25, 2), (40, 14)):
                    sparkle(c, x, y)
        extras(c, pose, None, (32, 50))
    if pose == "read":
        book(c, "wax", cover="blue")
    return c


def alien(pose):
    c = Canvas()
    if pose == "sleep":
        c.fill(c.ell(32, 44, 14, 12), "glass", tone=2)
        c.line(26, 37, 24, 33, "alien:line")
        c.line(38, 37, 40, 33, "alien:line")
        c.fill(c.ell(23.5, 32.5, 1.8, 1.8), "yellow")
        c.fill(c.ell(40.5, 32.5, 1.8, 1.8), "yellow")
        c.fill(c.ell(32, 45, 10.5, 8.5), "alien")
        eye(c, 27, 45, pose, line="eye")
        eye(c, 37, 45, pose, line="eye")
        blush(c, 23, 48)
        blush(c, 40, 48)
        c.path([(20, 40), (21, 37), (23, 35)], "glass:3")
        c.fill(c.ell(32, 57, 13, 3), "metal", tone=0)
        c.fill(c.ell(32, 52, 28, 5.5), "metal", soft=.5)
        for x in (12, 22, 32, 42, 52):
            c.dot(x, 53, "yellow:2")
            c.dot(x + 1, 53, "yellow:2")
        zzz(c, 46, 22)
        return c
    dy = -4 if pose == "wait" else 0
    if pose == "wait":
        stack(c)
    with shifted(c, 0, dy):
        if pose != "read":
            c.fill(c.ell(26, 60, 4.5, 2.4), "metal", tone=0)
            c.fill(c.ell(38, 60, 4.5, 2.4), "metal", tone=0)
        for side in (-1, 1):
            if pose == "party":
                c.fill(c.cap([(32 + side * 9, 45), (32 + side * 14, 38), (32 + side * 15, 32)], 1.7), "alien")
                c.fill(c.ell(32 + side * 15 + .5, 30.5, 2.4, 2.4), "alien")
            else:
                c.fill(c.cap([(32 + side * 9, 45), (32 + side * 14, 51)], 1.7), "alien")
                c.fill(c.ell(32 + side * 14.5 + .5, 52.5, 2.5, 2.5), "alien")
        c.fill(c.ell(32, 51, 10.5, 9.5), "metal", soft=.4)
        c.line(23, 54, 41, 54, "metal:0")
        sparkle(c, 32, 48)
        c.fill(c.ell(32.5, 42, 7, 2), "metal", tone=3)
        for side in (-1, 1):
            c.line(32 + side * 7, 15, 32 + side * 11, 8, "alien:line")
            c.fill(c.ell(32 + side * 11.5 + .5, 6.5, 2.4, 2.4), "pink" if pose == "party" and side > 0 else "yellow")
        c.fill(c.ell(32, 25, 20, 13.5) | c.poly([(15, 29), (49, 29), (39, 41), (25, 41)]), "alien")
        left = [(15, 23), (20, 20), (29, 24), (28, 30), (22, 31), (16, 28)]
        right = [(64 - x, y) for x, y in left]
        if pose in ("sleep", "party", "yawn"):
            if pose == "party":
                for pts in ([(17, 27), (19, 24), (23, 23), (27, 25), (28, 27)], [(47, 27), (45, 24), (41, 23), (37, 25), (36, 27)]):
                    c.path(pts, "eye")
                    c.path([(x, y + 1) for x, y in pts], "eye")
            else:
                for x, k in ((22, 1), (42, -1)):
                    c.path([(x - 3 * k, 22), (x + 2 * k, 26), (x - 3 * k, 30)], "eye")
                    c.path([(x - 2 * k, 22), (x + 3 * k, 26), (x - 2 * k, 30)], "eye")
        else:
            for pts, hx in ((left, 19), (right, 41)):
                px = c.fill(c.poly(pts), "eye", lines=False)
                if pose == "read":
                    top = min(y for _, y in px)
                    c.fill({(x, y) for x, y in px if y <= top + 2}, "alien", tone=1, lines=False)
                    c.line(min(x for x, _ in px), top + 3, max(x for x, _ in px), top + 3, "alien:line")
                    c.dot(hx + 1, 28, "white")
                else:
                    hy = 21 if pose == "wait" else 23
                    c.dot(hx, hy, "white")
                    c.dot(hx + 1, hy, "white")
                    c.dot(hx, hy + 1, "white")
                    c.dot(hx + 5 if hx < 32 else hx + 3, 28, "white")
        blush(c, 17, 33)
        blush(c, 46, 33)
        if pose == "yawn":
            mouth_open(c, 32, 36, 2.6, 2.6)
            tear(c, 48, 26)
        elif pose == "party":
            mouth_open(c, 32, 35, 2.8, 2)
        else:
            c.path([(30, 35), (32, 36), (34, 35)], "alien:line")
        extras(c, pose, (32, 13, 3, 11), (32, 50))
    if pose == "read":
        book(c, "alien", cover="mustard")
    return c


DRAW = {"cat": cat, "dog": dog, "rabbit": rabbit, "owl": owl, "penguin": penguin,
        "robot": robot, "vampire": vampire, "dragon": dragon, "ghost": ghost,
        "mimic": mimic, "mummy": mummy, "witch": witch, "skeleton": skeleton,
        "candle": candle, "alien": alien}


# ------------------------------------------------------------------ output
# Printable ASCII without quotes or backslashes, so rows need no escaping.
CHARS = [ch for ch in (chr(i) for i in range(33, 127)) if ch not in "\"'\\`"]


def encode(pet):
    """The pet's palette (colour name to character) and its rows per pose."""
    names, poses = {}, {}
    for pose in POSES:
        rows = []
        for row in DRAW[pet](pose).rows():
            line = ""
            for name in row:
                if name is None:
                    line += " "
                    continue
                if name not in names:
                    if len(names) == len(CHARS):
                        raise SystemExit(pet + " uses more than " + str(len(CHARS)) + " colours")
                    names[name] = CHARS[len(names)]
                line += names[name]
            rows.append(line)
        poses[pose] = rows
    return names, poses


def lua_source(pet):
    names, poses = encode(pet)
    lines = ["-- Generated by tools/build_buddy_sprites.py; edit the pixel masters there.",
             "-- Six poses of 64 x 64 cells. The palette maps each character to its colour",
             "-- (0xRRGGBB) and the grey (0-255) a black-and-white screen shows instead.",
             "return {",
             "    palette = {"]
    for name, ch in names.items():
        lines.append('        ["%s"] = { 0x%s, %d },' % (ch, PAL[name][1:], grey_of(name) * 17))
    lines.append("    },")
    for pose in POSES:
        lines.append("    %s = {" % pose)
        lines.extend('        "%s",' % row for row in poses[pose])
        lines.append("    },")
    lines.append("}")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check the shipped sprites without writing them")
    args = parser.parse_args()
    wanted = {pet + ".lua": lua_source(pet) for pet in PETS}
    if args.check:
        present = {p.name for p in OUT.glob("*.lua")} if OUT.is_dir() else set()
        stale = [name for name, text in wanted.items() if name not in present or (OUT / name).read_text() != text]
        extra = sorted(present - set(wanted))
        if stale or extra:
            raise SystemExit("Companion sprites are stale (" + ", ".join(stale + extra) + "). Run tools/build_buddy_sprites.py.")
        print("Companion sprites match the pixel masters.")
    else:
        OUT.mkdir(exist_ok=True)
        for old in OUT.glob("*.lua"):
            if old.name not in wanted:
                old.unlink()
        for name, text in wanted.items():
            (OUT / name).write_text(text)
