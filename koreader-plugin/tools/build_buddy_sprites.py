"""Build the reading companions' 40 x 40, five-tone pixel masters.

Run from any directory. Only the Python standard library is required.
The Lua output is the shipped asset; no generator runs on the reader.
"""

import argparse
from pathlib import Path

SIZE = 40
POSES = ("read", "sleep", "party", "ribbon", "yawn", "wait")


def ellipse(cx, cy, rx, ry):
    return {(x, y) for y in range(SIZE) for x in range(SIZE)
            if ((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2 <= 1}


def polygon(points):
    pixels = set()
    for y in range(SIZE):
        for x in range(SIZE):
            inside = False
            previous = points[-1]
            for current in points:
                ax, ay = previous
                bx, by = current
                if (ay > y + .5) != (by > y + .5):
                    if x + .5 < (bx - ax) * (y + .5 - ay) / (by - ay) + ax:
                        inside = not inside
                previous = current
            if inside:
                pixels.add((x, y))
    return pixels


class Sprite:
    def __init__(self):
        self.grid = [[" "] * SIZE for _ in range(SIZE)]

    def dot(self, x, y, ink="#"):
        assert 0 <= x < SIZE and 0 <= y < SIZE
        self.grid[y][x] = ink

    def line(self, x0, y0, x1, y1, ink="#"):
        steps = max(abs(x1 - x0), abs(y1 - y0))
        for i in range(steps + 1):
            t = i / steps if steps else 0
            self.dot(round(x0 + (x1 - x0) * t), round(y0 + (y1 - y0) * t), ink)

    def shape(self, pixels, fill="l", outline="#"):
        for x, y in pixels:
            edge = any((x + dx, y + dy) not in pixels
                       for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)))
            self.dot(x, y, outline if outline and edge else fill)

    def oval(self, cx, cy, rx, ry, fill="l", outline="#"):
        self.shape(ellipse(cx, cy, rx, ry), fill, outline)

    def poly(self, points, fill="l", outline="#"):
        self.shape(polygon(points), fill, outline)

    def rows(self):
        return ["".join(row) for row in self.grid]


def eyes(s, pose, left=14, right=25, y=16):
    for x in (left, right):
        if pose in ("sleep", "read", "yawn"):
            s.line(x - 2, y, x - 1, y + 1)
            s.line(x - 1, y + 1, x + 1, y + 1)
            s.dot(x + 2, y)
        elif pose == "party":
            s.line(x - 2, y + 1, x, y - 1)
            s.line(x, y - 1, x + 2, y + 1)
        else:
            s.oval(x + .5, y + .5, 1.5, 2.5, "#")
            s.dot(x, y - 1, ".")


def book(s, paw="l", bird=False):
    s.poly([(4, 29), (15, 29), (20, 31), (25, 29), (36, 29),
            (36, 37), (24, 38), (20, 39), (16, 38), (4, 37)], "d")
    s.poly([(5, 27), (14, 28), (20, 30), (26, 28), (35, 27),
            (35, 35), (26, 36), (20, 38), (14, 36), (5, 35)], ".")
    s.line(19, 30, 19, 36)
    s.line(20, 30, 20, 36, "m")
    for y in (30, 33):
        s.line(8, y, 16, y + 1, "m")
        s.line(23, y + 1, 31, y, "m")
    s.line(29, 28, 29, 31, "d")
    s.dot(30, 30, "d")
    for x in (7, 32):
        s.oval(x, 28, 3, 2.5, paw)
        if not bird:
            s.dot(x - 1, 29, "m")


def stack(s):
    s.poly([(5, 34), (34, 34), (34, 38), (5, 38)], "d")
    s.line(9, 35, 31, 35, ".")
    s.line(9, 36, 31, 36, "l")
    s.line(7, 35, 7, 36, "m")


def celebration(s, pose, top=7):
    if pose == "party":
        s.poly([(20, 0), (14, top), (26, top)], ".")
        s.line(17, top - 2, 22, top - 2, "d")
        s.dot(20, 2, "d")
        for x, y in ((4, 9), (34, 8), (2, 22), (36, 20)):
            s.dot(x, y)
            s.dot(x + 1, y + 1, "m")
        s.line(30, 1, 30, 5, "m")
        s.line(28, 3, 32, 3, "m")
    elif pose == "ribbon":
        s.poly([(29, 28), (35, 28), (36, 36), (32, 34), (29, 37)], "d")
        s.oval(32, 27, 5, 5, "m")
        s.oval(32, 27, 3, 3, ".")
        s.line(31, 26, 31, 28)
        s.line(30, 28, 32, 28)


def zzz(s, side=False):
    if side:
        s.line(34, 2, 38, 2, "d")
        s.line(38, 3, 34, 6, "d")
        s.line(34, 7, 38, 7, "d")
        s.line(36, 10, 38, 10, "m")
        s.dot(37, 11, "m")
        s.line(36, 12, 38, 12, "m")
        return
    s.line(29, 5, 34, 5, "d")
    s.line(34, 6, 29, 10, "d")
    s.line(29, 11, 34, 11, "d")
    s.line(23, 14, 26, 14, "m")
    s.line(26, 15, 23, 17, "m")
    s.line(23, 18, 26, 18, "m")


def dog(pose):
    s = Sprite()
    if pose == "sleep":
        s.oval(25, 30, 12, 8, "l")
        s.oval(29, 29, 6, 5, "m", None)
        s.poly([(26, 34), (35, 30), (38, 31), (37, 35), (31, 38), (22, 38)], "l")
        s.oval(13, 27, 10, 9, "l")
        s.oval(6, 28, 4, 8, "d")
        s.oval(19, 28, 4, 7, "d")
        s.oval(13, 33, 6, 4, ".", None)
        eyes(s, pose, 10, 16, 27)
        s.oval(13, 31, 2, 1.5, "#")
        s.oval(12, 36, 5, 2, ".")
        s.line(10, 36, 10, 37, "m")
        zzz(s)
        return s
    if pose == "wait":
        stack(s)
    s.poly([(28, 31), (33, 28), (34, 23), (36, 21), (38, 23),
            (37, 30), (34, 34), (28, 35)], "l")
    s.oval(20, 29, 9, 9, "l")
    s.oval(20, 28, 5, 7, ".", None)
    for x in (14, 25):
        s.oval(x, 35 if pose != "wait" else 33, 4, 3, ".")
        s.dot(x - 1, 36 if pose != "wait" else 34, "m")
    s.oval(20, 24, 7, 3, "d")
    s.oval(20, 26, 2, 2, ".")
    s.oval(20, 15, 12, 11, "l")
    s.oval(12, 13, 5, 7, "m", None)
    s.poly([(18, 6), (22, 6), (21, 11), (23, 18), (17, 18), (19, 11)], ".", None)
    s.poly([(10, 7), (6, 9), (3, 17), (4, 23), (7, 25), (10, 22), (12, 12)], "d")
    s.line(6, 14, 5, 20, "m")
    s.poly([(29, 7), (33, 9), (36, 17), (35, 23), (32, 25), (29, 22), (27, 12)], "d")
    s.line(32, 12, 34, 19, "m")
    s.oval(20, 21, 7, 4, ".", None)
    eyes(s, pose)
    s.oval(20, 19, 3, 2, "#")
    s.dot(19, 18, "m")
    if pose == "yawn":
        s.oval(20, 23, 3, 3, "#")
        s.line(19, 24, 20, 24, "l")
    else:
        s.dot(19, 21)
        s.line(17, 22, 19, 23)
        s.line(20, 23, 22, 22)
        if pose == "party":
            s.line(19, 24, 20, 24, "m")
    if pose == "read":
        book(s, ".")
    celebration(s, pose)
    return s


def rabbit(pose):
    s = Sprite()
    if pose == "sleep":
        s.oval(25, 30, 11, 8, "l")
        s.oval(35, 32, 4, 4, ".")
        s.oval(14, 28, 10, 8, "l")
        s.poly([(10, 22), (4, 15), (3, 9), (5, 8), (10, 13), (15, 23)], "l")
        s.poly([(13, 22), (11, 12), (13, 9), (16, 12), (18, 22)], "l")
        s.line(5, 12, 9, 19, "m")
        s.line(14, 13, 15, 19, "m")
        eyes(s, pose, 10, 18, 28)
        s.dot(14, 31, "d")
        s.oval(13, 36, 5, 2, ".")
        zzz(s)
        return s
    if pose == "wait":
        stack(s)
    s.oval(31, 31, 4, 4, ".")
    s.oval(20, 29, 8, 8, "l")
    s.oval(20, 29, 4, 5, ".", None)
    for x in (13, 26):
        s.oval(x, 35 if pose != "wait" else 33, 5, 3, ".")
        s.dot(x, 36 if pose != "wait" else 34, "m")
    silhouette = (ellipse(20, 20, 12, 9)
                  | polygon([(10, 16), (8, 6), (9, 1), (12, 0), (15, 4), (16, 14)])
                  | polygon([(24, 14), (25, 4), (28, 0), (31, 1), (32, 6), (30, 16)]))
    s.shape(silhouette)
    s.poly([(11, 3), (13, 5), (14, 13), (12, 11)], "m", None)
    s.poly([(28, 4), (30, 3), (28, 12), (26, 14)], "m", None)
    s.oval(20, 24, 7, 4, ".", None)
    eyes(s, pose, 14, 25, 20)
    s.line(18, 23, 21, 23, "d")
    s.line(19, 24, 20, 24, "d")
    if pose == "yawn":
        s.oval(20, 27, 2, 3, "#")
        s.dot(20, 28, "l")
    else:
        s.line(19, 25, 17, 26, "d")
        s.line(20, 25, 22, 26, "d")
    for x in (7, 29):
        s.line(x, 24, x + 3, 25, "m")
    if pose == "read":
        book(s, ".")
    celebration(s, pose, 10)
    return s


def owl(pose):
    s = Sprite()
    asleep = pose == "sleep"
    if pose == "wait":
        stack(s)
    base = 35 if pose != "wait" else 33
    for x in (14, 25):
        s.line(x - 2, base + 1, x + 2, base + 1)
        s.line(x, base - 1, x, base + 2)
    s.oval(20, 26 if not asleep else 29, 12, 10 if not asleep else 8, "m")
    s.oval(20, 29, 8, 6, "l", None)
    for x, y in ((16, 28), (23, 28), (19, 31), (15, 32), (24, 32)):
        s.dot(x, y, "d")
        s.dot(x + 1, y + 1, "d")
    s.oval(9, 27 if not asleep else 30, 3, 7 if not asleep else 5, "d")
    s.oval(31, 27 if not asleep else 30, 3, 7 if not asleep else 5, "d")
    cy = 17 if not asleep else 25
    silhouette = ellipse(20, cy, 14, 11) | polygon([
        (7, cy), (6, cy - 11), (14, cy - 8), (26, cy - 8), (34, cy - 11), (33, cy)])
    s.shape(silhouette, "m")
    s.oval(14, cy + 1, 7, 8, ".", "l")
    s.oval(26, cy + 1, 7, 8, ".", "l")
    eyes(s, pose, 14, 25, cy + 1)
    s.poly([(17, cy + 3), (23, cy + 3), (20, cy + 7)], "d")
    if pose == "yawn":
        s.oval(20, cy + 7, 2, 2, "#")
    if pose == "read":
        book(s, "d", True)
    if asleep:
        zzz(s)
    celebration(s, pose)
    return s


def penguin(pose):
    s = Sprite()
    asleep = pose == "sleep"
    if pose == "wait":
        stack(s)
    base = 36 if pose != "wait" else 34
    for x in (13, 26):
        s.oval(x, base, 5, 2, "m")
    s.oval(20, 24 if not asleep else 29, 12, 13 if not asleep else 8, "d")
    s.oval(20, 28 if not asleep else 31, 9, 8 if not asleep else 6, ".", None)
    if pose == "party":
        s.poly([(10, 24), (3, 17), (1, 18), (3, 25), (9, 29)], "d")
        s.poly([(30, 24), (37, 17), (39, 18), (37, 25), (31, 29)], "d")
    else:
        s.poly([(9, 22 if not asleep else 27), (5, 27), (5, 33), (8, 32), (12, 26)], "d")
        s.poly([(31, 22 if not asleep else 27), (35, 27), (35, 33), (32, 32), (28, 26)], "d")
    cy = 15 if not asleep else 25
    s.oval(20, cy, 11, 11, "d")
    s.shape(ellipse(15, cy + 2, 5, 7) | ellipse(25, cy + 2, 5, 7)
            | ellipse(20, cy + 5, 7, 5), ".", None)
    s.line(17, cy - 8, 19, cy - 9, "m")
    eyes(s, pose, 14, 25, cy + 2)
    s.poly([(16, cy + 4), (24, cy + 4), (22, cy + 7), (18, cy + 7)], "m")
    if pose == "yawn":
        s.line(18, cy + 5, 21, cy + 5)
        s.line(19, cy + 6, 20, cy + 6)
    if pose == "read":
        book(s, "d", True)
    if asleep:
        zzz(s)
    celebration(s, pose)
    return s


def robot(pose):
    s = Sprite()
    asleep = pose == "sleep"
    if pose == "wait":
        stack(s)
    shift = 5 if asleep else 0
    # The hinged body folds down while charging; the head stays square.
    s.poly([(11, 25 + shift), (29, 25 + shift), (29, 34), (11, 34)], "m")
    s.poly([(15, 27 + (2 if asleep else 0)), (25, 27 + (2 if asleep else 0)), (25, 32), (15, 32)], "d")
    s.line(18, 29 + (1 if asleep else 0), 21, 29 + (1 if asleep else 0), ".")
    for x in (13, 26):
        s.poly([(x-3, 33), (x+2, 33), (x+3, 37), (x-4, 37)], "d")
        s.line(x-2, 35, x+1, 35, "l")
    if pose == "party":
        s.line(9, 26, 5, 21, "d")
        s.line(30, 26, 34, 21, "d")
        for x in (4, 35):
            s.oval(x, 19, 3, 3, "m")
            s.line(x, 18, x, 19, ".")
    else:
        for x in (8, 31):
            s.oval(x, 28 + (3 if asleep else 0), 3, 4, "d")
            s.oval(x, 32 + (2 if asleep else 0), 3, 2, "m")
    for x in (6, 33):
        s.poly([(x-2, 11+shift), (x+2, 11+shift), (x+2, 20+shift), (x-2, 20+shift)], "m")
        s.line(x, 13+shift, x, 17+shift, "l")
    s.poly([(9, 6+shift), (31, 6+shift), (33, 9+shift), (33, 22+shift),
            (30, 25+shift), (10, 25+shift), (7, 22+shift), (7, 9+shift)], "l")
    s.line(10, 8+shift, 28, 8+shift, ".")
    s.poly([(10, 11+shift), (30, 11+shift), (30, 21+shift), (10, 21+shift)], "d")
    for x in (14, 25):
        if pose in ("read", "sleep", "yawn"):
            s.line(x-1, 16+shift, x+1, 16+shift, ".")
            if pose == "read":
                s.dot(x+1, 17+shift, ".")
        elif pose == "party":
            s.line(x-2, 16+shift, x, 14+shift, ".")
            s.line(x, 14+shift, x+2, 16+shift, ".")
        else:
            s.line(x, 14+shift, x, 17+shift, ".")
            s.line(x+1, 14+shift, x+1, 17+shift, ".")
    if pose == "yawn":
        s.oval(20, 20, 2, 2, ".", None)
    else:
        s.line(18, 19+shift, 21, 19+shift, "l")
    for x in (10, 29):
        s.dot(x, 22+shift, "d")
    s.line(19, 3+shift, 19, 5+shift)
    s.oval(19.5, 2.5+shift, 2, 2, "m")
    if pose == "read":
        book(s, "m", True)
    if asleep:
        zzz(s, side=True)
    celebration(s, pose, 7)
    return s


def vampire(pose):
    s = Sprite()
    asleep = pose == "sleep"
    shift = 4 if asleep else 0
    if pose == "wait":
        stack(s)
    # A high collar and scalloped cape retain the silhouette in grayscale.
    s.poly([(6, 21), (13, 24), (27, 24), (34, 21), (31, 28), (36, 37),
            (29, 35), (25, 38), (20, 35), (15, 38), (11, 35), (4, 37), (9, 28)], "d")
    s.poly([(12, 24), (28, 24), (28, 34), (12, 34)], "m")
    s.poly([(16, 25), (24, 25), (20, 32)], ".", None)
    s.line(19, 29, 19, 32, "d")
    for x in (14, 25):
        s.oval(x, 36 if pose != "wait" else 33, 4, 2, "#")
    s.poly([(9, 13+shift), (4, 11+shift), (5, 17+shift), (11, 21+shift)], "l")
    s.poly([(31, 13+shift), (36, 11+shift), (35, 17+shift), (29, 21+shift)], "l")
    s.oval(20, 15+shift, 11, 11, ".")
    s.poly([(9, 16+shift), (8, 10+shift), (11, 5+shift), (17, 3+shift),
            (25, 4+shift), (30, 7+shift), (32, 12+shift), (30, 17+shift),
            (27, 10+shift), (23, 10+shift), (20, 14+shift), (16, 10+shift), (12, 11+shift)], "d")
    s.line(14, 6+shift, 18, 5+shift, "m")
    eyes(s, pose, 14, 25, 17+shift)
    if pose == "yawn":
        s.oval(20, 23+shift, 4, 3, "#")
        s.dot(20, 24+shift, "m")
    else:
        s.poly([(15, 21+shift), (25, 21+shift), (23, 25+shift), (17, 25+shift)], "d", None)
    s.line(17, 22+shift, 17, 23+shift, ".")
    s.line(22, 22+shift, 22, 23+shift, ".")
    if asleep:
        s.oval(15, 32, 4, 2, ".")
        s.oval(25, 32, 4, 2, ".")
        zzz(s, side=True)
    elif pose == "read":
        book(s, ".")
    else:
        s.oval(10, 29, 3, 2, ".")
        s.oval(29, 29, 3, 2, ".")
    celebration(s, pose, 6)
    return s


def dragon(pose):
    s = Sprite()
    asleep = pose == "sleep"
    if pose == "wait":
        stack(s)
    if asleep:
        s.oval(25, 30, 12, 8, "m")
        s.poly([(21, 29), (23, 22), (28, 24), (33, 30), (28, 29), (24, 33)], "d")
        s.oval(13, 28, 10, 8, "l")
        s.poly([(6, 23), (4, 17), (8, 19), (10, 24)], ".")
        s.poly([(17, 22), (18, 17), (21, 19), (21, 25)], ".")
        s.oval(11, 32, 8, 4, "l")
        eyes(s, pose, 9, 17, 27)
        s.dot(6, 31, "d")
        s.dot(10, 31, "d")
        s.poly([(22, 34), (30, 34), (35, 31), (38, 31), (37, 35), (31, 38), (21, 38)], "m")
        zzz(s)
        return s
    s.poly([(26, 31), (33, 31), (35, 26), (38, 24), (39, 28), (37, 33), (31, 37), (25, 36)], "m")
    for mirror in (False, True):
        wing = [(12, 23), (6, 17), (2, 19), (1, 29), (5, 27), (7, 31), (12, 30)]
        if mirror:
            wing = [(39-x, y) for x, y in wing]
        s.poly(wing, "d")
        x = 31 if mirror else 8
        s.line(x, 23, x + (4 if mirror else -4), 26, "m")
    s.oval(20, 29, 9, 9, "m")
    s.oval(20, 29, 5, 7, "l", None)
    for y in (28, 31, 34):
        s.line(17, y, 22, y, "m")
    for x in (13, 26):
        s.oval(x, 36 if pose != "wait" else 33, 4, 2, "l")
    s.oval(20, 15, 12, 10, "l")
    s.poly([(9, 10), (8, 2), (11, 3), (14, 9)], ".")
    s.poly([(26, 9), (28, 3), (31, 2), (30, 10)], ".")
    s.poly([(16, 8), (18, 4), (20, 8), (22, 4), (24, 8)], "d", None)
    eyes(s, pose, 14, 25, 15)
    s.oval(20, 22, 9, 5, "l")
    for x in (15, 24):
        s.dot(x, 20, "d")
    if pose == "yawn":
        s.oval(20, 25, 4, 3, "#")
        s.line(19, 26, 21, 26, "m")
        s.dot(17, 24, ".")
    else:
        s.line(15, 24, 23, 24, "d")
        s.dot(24, 23, "d")
        s.dot(16, 24, ".")
    if pose == "read":
        book(s, "l")
    celebration(s, pose, 8)
    return s


def ghost(pose):
    s = Sprite()
    asleep = pose == "sleep"
    shift = 7 if asleep else 0
    if pose == "wait":
        stack(s)
    # A lifted hem and empty space beneath make the ghost float in every pose.
    silhouette = ellipse(20, 16+shift, 11, 11) | polygon([
        (9, 16+shift), (31, 16+shift), (31, 27+shift), (34, 30+shift),
        (28, 32+shift), (23, 29+shift), (19, 32+shift), (14, 30+shift),
        (9, 32+shift), (6, 30+shift), (9, 26+shift)])
    s.shape(silhouette, ".")
    s.line(29, 18+shift, 29, 26+shift, "l")
    s.line(27, 28+shift, 30, 29+shift, "l")
    eyes(s, pose, 14, 25, 17+shift)
    if pose == "yawn":
        s.oval(20, 24, 3, 4, "#")
    else:
        s.oval(20, 22+shift, 2, 2, "d", None)
    for x in (10, 29):
        s.dot(x, 20+shift, "l")
    if pose == "read":
        book(s, ".", True)
    elif pose == "party":
        s.oval(7, 23, 4, 2, ".")
        s.oval(33, 21, 4, 2, ".")
    elif not asleep:
        s.oval(10, 26, 3, 2, ".")
        s.oval(30, 26, 3, 2, ".")
    if asleep:
        zzz(s, side=True)
    celebration(s, pose)
    return s


def build():
    return {name: {pose: draw(pose).rows() for pose in POSES}
            for name, draw in (("dog", dog), ("rabbit", rabbit), ("owl", owl), ("penguin", penguin),
                                    ("robot", robot), ("vampire", vampire), ("dragon", dragon), ("ghost", ghost))}


def lua_source(animals):
    lines = ["-- Generated by tools/build_buddy_sprites.py; edit the pixel masters there.",
             "-- Every pose has a fixed 40 x 40 canvas and uses the board's five-tone palette.",
             "return {"]
    for animal, poses in animals.items():
        lines.append(f"    {animal} = {{")
        for pose, rows in poses.items():
            lines.append(f"        {pose} = {{")
            lines.extend(f'            "{row}",' for row in rows)
            lines.append("        },")
        lines.append("    },")
    lines.append("}")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check the shipped sprites without writing them")
    args = parser.parse_args()
    target = Path(__file__).resolve().parents[1] / "bookorbit.koplugin/bookorbit_board_animal_sprites.lua"
    source = lua_source(build())
    if args.check:
        if target.read_text() != source:
            raise SystemExit("Companion sprites are stale. Run tools/build_buddy_sprites.py.")
        print("Companion sprites match the pixel masters.")
    else:
        target.write_text(source)
