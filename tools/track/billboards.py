import numpy as np

from palette import BRAND_ASPECT, BRAND_ROWS
from pitlane import Frame, lattice, limb
from trackside import UNIT, Batch, corner_entries

BANNER_HEIGHT = 2.3
BANNER_LOW = 6.6
TOWER_MARGIN = 2.2
OVERHEAD_LEAD = 170.0
OVERHEAD_SPACING = 380.0
OVERHEAD_COUNT = 9
BRIDGE_DISTANCES = (1040.0, 3560.0)
HOARDING_LOW = 2.2
HOARDING_HEIGHT = 3.0
HOARDING_BACK = 3.0
HOARDING_LENGTH = 90.0
HOARDING_POST_SPACING = 9.0
HOARDING_COUNT = 12
HOARDING_SPACING = 300.0
HANGER_SPACING = 7.0


def side_wall(track, row, side):
    return float(track.walls[row, side])


def banner_span(boards, steel, frame, s, l0, l1, low, height, brand):
    run = l1 - l0
    tiles = max(1.0, round(run / (height * BRAND_ASPECT)))
    v0, v1 = 1 - (brand + 1) / BRAND_ROWS, 1 - brand / BRAND_ROWS
    for shift, reading in ((-0.15, (l1, l0)), (0.15, (l0, l1))):
        a, b = reading
        boards.add(
            [frame.at(s + shift, a, low), frame.at(s + shift, b, low), frame.at(s + shift, b, low + height), frame.at(s + shift, a, low + height)],
            [(0, v0), (tiles, v0), (tiles, v1), (0, v1)],
        )
    for h in (low + height + 0.12, low - 0.08):
        limb(steel, frame.at(s, l0, h), frame.at(s, l1, h), 0.09, 0.09, UNIT, 6)


def overhead(boards, tower, frame, track, s, sign, brand):
    row = int((s % track.length) / track.length * track.count) % track.count
    side = 0 if sign > 0 else 1
    other = 1 - side
    foot = sign * (side_wall(track, row, side) + TOWER_MARGIN)
    tip = -sign * float(min(track.half[row] + 1.0, side_wall(track, row, other) - 0.5))
    top = BANNER_LOW + BANNER_HEIGHT + 1.0
    lattice(tower, frame, s, foot, top)
    l0, l1 = sorted((foot, tip))
    banner_span(boards, tower, frame, s, l0, l1, BANNER_LOW, BANNER_HEIGHT, brand)


def bridge(boards, tower, frame, track, s, brand):
    row = int((s % track.length) / track.length * track.count) % track.count
    left = side_wall(track, row, 0) + TOWER_MARGIN
    right = -(side_wall(track, row, 1) + TOWER_MARGIN)
    top = BANNER_LOW + BANNER_HEIGHT + 1.2
    lattice(tower, frame, s, left, top)
    lattice(tower, frame, s, right, top)
    banner_span(boards, tower, frame, s, right, left, BANNER_LOW, BANNER_HEIGHT, brand)


def hoarding(boards, posts, frame, track, s0, sign, brand):
    side = 0 if sign > 0 else 1
    count = int(HOARDING_LENGTH / HANGER_SPACING)
    v0, v1 = 1 - (brand + 1) / BRAND_ROWS, 1 - brand / BRAND_ROWS
    positions = [s0 + index * HANGER_SPACING for index in range(count + 1)]
    lateral = []
    for s in positions:
        row = int((s % track.length) / track.length * track.count) % track.count
        lateral.append(sign * (side_wall(track, row, side) + HOARDING_BACK))
    run = 0.0
    tile = HOARDING_HEIGHT * BRAND_ASPECT
    for a, b, la, lb in zip(positions, positions[1:], lateral, lateral[1:]):
        length = float(np.linalg.norm(frame.at(b, lb)[:2] - frame.at(a, la)[:2]))
        u0, u1 = sign * run / tile, sign * (run + length) / tile
        boards.add(
            [frame.at(a, la, HOARDING_LOW), frame.at(b, lb, HOARDING_LOW), frame.at(b, lb, HOARDING_LOW + HOARDING_HEIGHT), frame.at(a, la, HOARDING_LOW + HOARDING_HEIGHT)],
            [(u0, v0), (u1, v0), (u1, v1), (u0, v1)],
        )
        run += length
    for index in range(0, len(positions), max(1, int(HOARDING_POST_SPACING / HANGER_SPACING))):
        s, l = positions[index], lateral[index]
        limb(posts, frame.at(s, l, -1.0), frame.at(s, l, HOARDING_LOW + HOARDING_HEIGHT + 0.1), 0.09, 0.09, UNIT, 6)


def build(track, smooth):
    frame = Frame(track)
    boards, tower, posts = Batch(), Batch(), Batch()
    entries = corner_entries(track, smooth)
    step = track.length / track.count
    placed = []
    brand = 4
    clear = lambda s, spacing, used: all(min((s - p) % track.length, (p - s) % track.length) > spacing for p in used)
    for entry, sign, _ in entries:
        s = (entry * step - OVERHEAD_LEAD) % track.length
        row = int(s / track.length * track.count) % track.count
        if track.pit_zone[row] or not clear(s, OVERHEAD_SPACING, placed) or len(placed) >= OVERHEAD_COUNT:
            continue
        overhead(boards, tower, frame, track, s, sign, brand % BRAND_ROWS)
        placed.append(s)
        brand += 1
    for s in BRIDGE_DISTANCES:
        if clear(s, 60.0, placed):
            bridge(boards, tower, frame, track, s, brand % BRAND_ROWS)
            placed.append(s)
            brand += 1
    hoardings = []
    for entry, sign, _ in entries:
        s = entry * step
        row = int(s / track.length * track.count) % track.count
        if (sign > 0 and track.pit_zone[row]) or not clear(s, HOARDING_SPACING, hoardings) or len(hoardings) >= HOARDING_COUNT:
            continue
        hoarding(boards, posts, frame, track, s, sign, brand % BRAND_ROWS)
        hoardings.append(s)
        brand += 1
    return boards, tower, posts
