import numpy as np

from palette import BRAND_ROWS, TEAMS, palette_uv
from trackside import UNIT, Batch

BAY_SPACING = 14.0
BAY_PIER = 1.8
OPENING_HEIGHT = 4.6
INTERIOR_DEPTH = 9.0
FASCIA_HEIGHT = 5.8
CANOPY_HEIGHT = 6.0
CANOPY_REACH = 3.2
CANOPY_THICKNESS = 0.35
BANNER_TILE = 9.6
BANNER_STRIP = 1.2
BANNER_BRAND = 5
BALCONIES = (7.2, 10.7)
BALCONY_REACH = 1.2
BALCONY_RECESS = 1.6
BALCONY_THICKNESS = 0.4
BUILDING_DEPTH = 24.0
ROOF_HEIGHT = 14.0
ROOF_LIP_REACH = 9.0
ROOF_LIP_RISE = 2.6
ROOF_EDGE = 0.45
STRUT_SPACING = 28.0
STRUT_SIZE = 0.22
LIGHT_STRIP = 0.5
FASCIA_COLUMNS = 4
FASCIA_ROWS = 7
BOOM_REACH = 7.0
BOOM_HEIGHT = 4.8
BOOM_SIZE = 0.17
BOOM_STEPS = 8
BOOM_OFFSET = 3.2
TEAM_COUNT = len(TEAMS)
TEAM_BAYS = 2
STATION_LENGTH = 7.0
RAIL_HEIGHT = 1.05
RAIL_POST_SPACING = 3.0
RAIL_SIZE = 0.05
STEP_COUNT = 5
TYRE_WIDTH = 0.36
BOTTLE_RADIUS = 0.13
BOTTLE_HEIGHT = 1.7
CART_SIZE = (0.6, 1.1, 1.0)
BRIDGE_HEIGHT = 10.0
BRIDGE_DEPTH = 1.0
BRIDGE_BANNER = 3.0
V_SPREAD = 5.0
V_SIZE = 0.55
MARSHAL_COUNT = 34
TOWER_WIDTH = 1.6
TOWER_LEVEL = 1.8
TOWER_POST = 0.11
TOWER_BRACE = 0.05
SEED = 25
GARAGE_GRID = (4, 3)
BLANKET_RADIUS = 0.37
BAND_HEIGHT = 0.07
COMPOUNDS = ("soft", "medium", "hard")
MONITORS = 7
CHAIRS = 6
STAND_ROOF = 3.55
STAND_DECK = 1.0
MAST_HEIGHT = 2.4


class Frame:
    def __init__(self, track):
        self.track = track

    def local(self, s):
        track = self.track
        f = (s % track.length) / track.length * track.count
        i = int(f) % track.count
        j = (i + 1) % track.count
        t = f - int(f)
        position = track.position[i] * (1 - t) + track.position[j] * t
        camber = track.camber[i] * (1 - t) + track.camber[j] * t
        tangent = track.tangent[i] * (1 - t) + track.tangent[j] * t
        normal = track.normal[i] * (1 - t) + track.normal[j] * t
        return position, camber, tangent, normal

    def at(self, s, lateral, height=0.0):
        position, camber, _, normal = self.local(s)
        xy = position[:2] + normal * lateral
        return np.array([xy[0], xy[1], position[2] + camber * lateral + height])

    def basis(self, s):
        _, _, tangent, normal = self.local(s)
        return tangent, normal


def box(batch, frame, s0, s1, l0, l1, h0, h1, uv=UNIT):
    p = lambda s, l, h: frame.at(s, l, h)
    for corners in (
        (p(s0, l0, h0), p(s1, l0, h0), p(s1, l0, h1), p(s0, l0, h1)),
        (p(s0, l1, h0), p(s1, l1, h0), p(s1, l1, h1), p(s0, l1, h1)),
        (p(s0, l0, h0), p(s0, l1, h0), p(s0, l1, h1), p(s0, l0, h1)),
        (p(s1, l0, h0), p(s1, l1, h0), p(s1, l1, h1), p(s1, l0, h1)),
        (p(s0, l0, h1), p(s1, l0, h1), p(s1, l1, h1), p(s0, l1, h1)),
    ):
        batch.add(corners, uv)


def flat(colour):
    return [palette_uv(colour)] * 4


def cylinder(batch, centre, axis, radius, length, uv, segments=10, caps=True):
    axis = np.asarray(axis, float) / np.linalg.norm(axis)
    helper = np.array([0.0, 0.0, 1.0]) if abs(axis[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    u = np.cross(axis, helper)
    u /= np.linalg.norm(u)
    v = np.cross(axis, u)
    ring = [np.cos(a) * u + np.sin(a) * v for a in np.linspace(0, 2 * np.pi, segments, endpoint=False)]
    top = centre + axis * length
    for a, b in zip(ring, ring[1:] + ring[:1]):
        batch.add([centre + a * radius, centre + b * radius, top + b * radius, top + a * radius], uv)
    if caps:
        batch.add([top + a * radius for a in ring], [uv[0]] * segments)
        batch.add([centre + a * radius for a in ring], [uv[0]] * segments)


def limb(batch, start, end, r0, r1, uv, segments=8):
    start, end = np.asarray(start, float), np.asarray(end, float)
    axis = end - start
    length = np.linalg.norm(axis)
    axis /= length
    helper = np.array([1.0, 0.0, 0.0]) if abs(axis[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    u = np.cross(axis, helper)
    u /= np.linalg.norm(u)
    v = np.cross(axis, u)
    ring = [np.cos(a) * u + np.sin(a) * v for a in np.linspace(0, 2 * np.pi, segments, endpoint=False)]
    for a, b in zip(ring, ring[1:] + ring[:1]):
        batch.add([start + a * r0, start + b * r0, end + b * r1, end + a * r1], uv)
    batch.add([end + a * r1 for a in ring], [uv[0]] * segments)
    batch.add([start + a * r0 for a in ring], [uv[0]] * segments)


class Figures:
    def __init__(self, path):
        self.data = np.load(path)

    def add(self, parts, origin, heading, tile, tone, pose):
        gender = "Female" if tone % 3 == 2 else "Male"
        forward = np.array([np.cos(heading), np.sin(heading)])
        left = np.array([-forward[1], forward[0]])
        columns, rows = 4, 3
        tile_u, tile_v = tile % columns, rows - 1 - tile // columns
        for tag in ("cloth", "skin", "hair", "eyes"):
            key = f"{gender}_{pose}_{tag}"
            batch = parts[f"people {tag}"] if tag != "skin" else parts[f"people skin {gender} {tone % 2}"]
            for corners, coords in zip(self.data[f"{key}_tri"], self.data[f"{key}_uv"]):
                world = [
                    (origin[0] + c[0] * left[0] - c[1] * forward[0], origin[1] + c[0] * left[1] - c[1] * forward[1], origin[2] + c[2])
                    for c in corners
                ]
                if tag == "cloth":
                    mapped = [((tile_u + c[0]) / columns, (tile_v + c[1]) / rows) for c in coords]
                else:
                    mapped = [tuple(c) for c in coords]
                batch.add(world, mapped)


POSES = ("ready", "talking", "interact", "arms_folded", "hands_hips")
MARSHAL_TILE = len(TEAMS)


def bay_count(pit, length):
    return int(((pit["garageEnd"] - pit["garageStart"]) % length) // BAY_SPACING)


def bays(track):
    pit = track.pit
    span = (pit["garageEnd"] - pit["garageStart"]) % track.length
    count = bay_count(pit, track.length)
    spacing = span / count
    return [(pit["garageStart"] + index * spacing, spacing) for index in range(count)]


def team_of(index, count):
    first = (count - TEAM_COUNT * TEAM_BAYS) // 2
    team = (index - first) // TEAM_BAYS
    return team if 0 <= team < TEAM_COUNT else None


def garage_cell(team):
    columns, rows = GARAGE_GRID
    index = team if team is not None else columns * rows - 1
    u0, u1 = index % columns / columns, (index % columns + 1) / columns
    v0, v1 = 1 - (index // columns + 1) / rows, 1 - index // columns / rows
    return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]


def tyre_stack(batch, base, count, compound):
    cylinder(batch, base, (0, 0, 1), BLANKET_RADIUS, count * TYRE_WIDTH - 0.015, flat("blanket"), 14)
    for layer in range(count):
        band = base + np.array([0, 0, layer * TYRE_WIDTH + (TYRE_WIDTH - BAND_HEIGHT) / 2])
        cylinder(batch, band, (0, 0, 1), BLANKET_RADIUS + 0.006, BAND_HEIGHT, flat(compound), 14, caps=False)


def garage_interior(frame, pit, parts, team, s0, s1):
    front = pit["garageFront"]
    deep = front + INTERIOR_DEPTH
    team_parts, tyres, steel, screens = parts["team"], parts["tyres"], parts["steel"], parts["screens"]
    brand, base = flat(f"team {team}"), flat(f"team deep {team}")
    box(team_parts, frame, s0 + 1.2, s1 - 1.2, front + 0.6, deep - 1.6, 0.0, 0.035, flat(f"team floor {team}"))
    box(team_parts, frame, s0 + 1.25, s1 - 1.25, front + 0.6, front + 0.75, 0.0, 0.04, brand)
    for lateral in (front + 2.6, front + 6.2):
        box(team_parts, frame, s0, s1, lateral, lateral + 0.3, OPENING_HEIGHT - 0.55, OPENING_HEIGHT - 0.3, base)
        box(team_parts, frame, s0, s1, lateral - 0.01, lateral + 0.31, OPENING_HEIGHT - 0.6, OPENING_HEIGHT - 0.55, brand)
    for edge, inward in ((s0 + 0.55, 1), (s1 - 0.55, -1)):
        for k, lateral in enumerate((front + 4.4, front + 5.3, front + 6.2, front + 7.1)):
            tyre_stack(tyres, frame.at(edge, lateral, 0.02), 4, COMPOUNDS[(k + (inward > 0)) % len(COMPOUNDS)])
        a, b = edge - 0.45, edge + 0.45
        for lateral in (front + 3.9, front + 7.6):
            for level in (0.0, 1.5):
                limb(steel, frame.at(a, lateral, level), frame.at(b, lateral, level), 0.025, 0.025, UNIT, 4)
            limb(steel, frame.at(a, lateral, 0.0), frame.at(a, lateral, 1.5), 0.025, 0.025, UNIT, 4)
            limb(steel, frame.at(b, lateral, 0.0), frame.at(b, lateral, 1.5), 0.025, 0.025, UNIT, 4)
    bench = deep - 1.15
    for k, start in enumerate(np.linspace(s0 + 1.6, s1 - 2.6, 4)):
        box(team_parts, frame, start, start + 0.95, bench, bench + 0.6, 0.12, 0.98, flat("dark"))
        box(team_parts, frame, start - 0.01, start + 0.96, bench - 0.01, bench + 0.61, 0.98, 1.02, brand if k % 2 else base)
    desk = deep - 2.8
    middle = (s0 + s1) / 2
    box(team_parts, frame, middle - 1.4, middle + 1.4, desk, desk + 0.7, 0.0, 0.92, flat("dark"))
    for k in range(3):
        a = middle - 1.3 + k * 0.88
        box(team_parts, frame, a, a + 0.8, desk + 0.3, desk + 0.36, 0.95, 1.45, flat("monitor"))
        screens.add([frame.at(a + 0.03, desk + 0.29, 0.98), frame.at(a + 0.77, desk + 0.29, 0.98), frame.at(a + 0.77, desk + 0.29, 1.42), frame.at(a + 0.03, desk + 0.29, 1.42)], UNIT)


def garage_front(frame, pit, parts):
    front = pit["garageFront"]
    panels, fascia, banner, canopy, floor, inner, back, lights, steel = (
        parts[name] for name in ("panels", "fascia", "banner", "canopy", "floor", "inner", "back", "lights", "steel")
    )
    all_bays = bays(frame.track)
    for index, (s, spacing) in enumerate(all_bays):
        s0, s1 = s + BAY_PIER / 2, s + spacing - BAY_PIER / 2
        for a, b in ((s, s0), (s1, s + spacing)):
            panels.add([frame.at(a, front, -0.5), frame.at(b, front, -0.5), frame.at(b, front, OPENING_HEIGHT), frame.at(a, front, OPENING_HEIGHT)], UNIT)
        team = team_of(index, len(all_bays))
        cell = garage_cell(team)
        if team is not None:
            for edge in (s0, s1):
                box(parts["team"], frame, edge - 0.12, edge + 0.12, front - 0.06, front - 0.01, 0.0, OPENING_HEIGHT, flat(f"team {team}"))
            garage_interior(frame, pit, parts, team, s0, s1)
        deep = front + INTERIOR_DEPTH
        floor.add([frame.at(s0, front, 0.02), frame.at(s1, front, 0.02), frame.at(s1, deep, 0.02), frame.at(s0, deep, 0.02)], [(0, 0), (spacing / 3, 0), (spacing / 3, 3), (0, 3)])
        back.add([frame.at(s0, deep, 0), frame.at(s1, deep, 0), frame.at(s1, deep, OPENING_HEIGHT), frame.at(s0, deep, OPENING_HEIGHT)], cell)
        for edge in (s0, s1):
            back.add([frame.at(edge, deep, 0), frame.at(edge, front, 0), frame.at(edge, front, OPENING_HEIGHT), frame.at(edge, deep, OPENING_HEIGHT)], cell)
        inner.add([frame.at(s0, front, OPENING_HEIGHT), frame.at(s1, front, OPENING_HEIGHT), frame.at(s1, deep, OPENING_HEIGHT), frame.at(s0, deep, OPENING_HEIGHT)], UNIT)
        for strip in (0.3, 0.65):
            light_lat = front + INTERIOR_DEPTH * strip
            lights.add(
                [
                    frame.at(s0 + 1, light_lat, OPENING_HEIGHT - 0.02),
                    frame.at(s1 - 1, light_lat, OPENING_HEIGHT - 0.02),
                    frame.at(s1 - 1, light_lat + LIGHT_STRIP, OPENING_HEIGHT - 0.02),
                    frame.at(s0 + 1, light_lat + LIGHT_STRIP, OPENING_HEIGHT - 0.02),
                ],
                UNIT,
            )
        column, row = index % FASCIA_COLUMNS, index // FASCIA_COLUMNS % FASCIA_ROWS
        u0, u1 = column / FASCIA_COLUMNS, (column + 1) / FASCIA_COLUMNS
        v0, v1 = 1 - (row + 1) / FASCIA_ROWS, 1 - row / FASCIA_ROWS
        fascia.add(
            [frame.at(s, front - 0.05, OPENING_HEIGHT), frame.at(s + spacing, front - 0.05, OPENING_HEIGHT), frame.at(s + spacing, front - 0.05, FASCIA_HEIGHT), frame.at(s, front - 0.05, FASCIA_HEIGHT)],
            [(u0, v0), (u1, v0), (u1, v1), (u0, v1)],
        )
    start, end = all_bays[0][0], all_bays[-1][0] + all_bays[-1][1]
    span = (end - start) % frame.track.length
    samples = np.arange(0.0, span, 7.0).tolist() + [span]
    pairs = list(zip(samples, samples[1:]))
    v0, v1 = 1 - (BANNER_BRAND + 1) / BRAND_ROWS, 1 - BANNER_BRAND / BRAND_ROWS
    for a, b in pairs:
        sa, sb = start + a, start + b
        glass = front + BALCONY_RECESS
        panels.add([frame.at(sa, glass, FASCIA_HEIGHT), frame.at(sb, glass, FASCIA_HEIGHT), frame.at(sb, glass, ROOF_HEIGHT), frame.at(sa, glass, ROOF_HEIGHT)], UNIT)
        canopy.add([frame.at(sa, front, FASCIA_HEIGHT), frame.at(sb, front, FASCIA_HEIGHT), frame.at(sb, glass, FASCIA_HEIGHT), frame.at(sa, glass, FASCIA_HEIGHT)], UNIT)
        canopy.add([frame.at(sa, front, CANOPY_HEIGHT), frame.at(sb, front, CANOPY_HEIGHT), frame.at(sb, front - CANOPY_REACH, CANOPY_HEIGHT - 0.3), frame.at(sa, front - CANOPY_REACH, CANOPY_HEIGHT - 0.3)], UNIT)
        canopy.add([frame.at(sa, front - CANOPY_REACH, CANOPY_HEIGHT - 0.3), frame.at(sb, front - CANOPY_REACH, CANOPY_HEIGHT - 0.3), frame.at(sb, front - CANOPY_REACH, CANOPY_HEIGHT - 0.3 + CANOPY_THICKNESS), frame.at(sa, front - CANOPY_REACH, CANOPY_HEIGHT - 0.3 + CANOPY_THICKNESS)], UNIT)
        for level in BALCONIES:
            lip = front - BALCONY_REACH
            canopy.add([frame.at(sa, lip, level), frame.at(sb, lip, level), frame.at(sb, glass, level), frame.at(sa, glass, level)], UNIT)
            canopy.add([frame.at(sa, lip, level - BALCONY_THICKNESS), frame.at(sb, lip, level - BALCONY_THICKNESS), frame.at(sb, lip, level), frame.at(sa, lip, level)], UNIT)
            limb(steel, frame.at(sa, lip + 0.1, level + RAIL_HEIGHT), frame.at(sb, lip + 0.1, level + RAIL_HEIGHT), RAIL_SIZE, RAIL_SIZE, UNIT, 4)
        roof_lip = front - ROOF_LIP_REACH
        canopy.add([frame.at(sa, glass, ROOF_HEIGHT), frame.at(sb, glass, ROOF_HEIGHT), frame.at(sb, roof_lip, ROOF_HEIGHT + ROOF_LIP_RISE), frame.at(sa, roof_lip, ROOF_HEIGHT + ROOF_LIP_RISE)], UNIT)
        canopy.add([frame.at(sa, roof_lip, ROOF_HEIGHT + ROOF_LIP_RISE - ROOF_EDGE), frame.at(sb, roof_lip, ROOF_HEIGHT + ROOF_LIP_RISE - ROOF_EDGE), frame.at(sb, roof_lip, ROOF_HEIGHT + ROOF_LIP_RISE), frame.at(sa, roof_lip, ROOF_HEIGHT + ROOF_LIP_RISE)], UNIT)
        canopy.add([frame.at(sa, glass, ROOF_HEIGHT), frame.at(sb, glass, ROOF_HEIGHT), frame.at(sb, front + BUILDING_DEPTH, ROOF_HEIGHT), frame.at(sa, front + BUILDING_DEPTH, ROOF_HEIGHT)], UNIT)
        panels.add([frame.at(sa, front + BUILDING_DEPTH, -0.5), frame.at(sb, front + BUILDING_DEPTH, -0.5), frame.at(sb, front + BUILDING_DEPTH, ROOF_HEIGHT), frame.at(sa, front + BUILDING_DEPTH, ROOF_HEIGHT)], UNIT)
        ua, ub = a / BANNER_TILE, b / BANNER_TILE
        level = BALCONIES[0]
        banner.add([frame.at(sa, front - BALCONY_REACH - 0.04, level - BANNER_STRIP), frame.at(sb, front - BALCONY_REACH - 0.04, level - BANNER_STRIP), frame.at(sb, front - BALCONY_REACH - 0.04, level), frame.at(sa, front - BALCONY_REACH - 0.04, level)], [(ua, v0), (ub, v0), (ub, v1), (ua, v1)])
    for s, inward in ((start, 1), (start + span, -1)):
        for lateral in (front + BUILDING_DEPTH,):
            canopy.add([frame.at(s, front, -0.5), frame.at(s, lateral, -0.5), frame.at(s, lateral, ROOF_HEIGHT), frame.at(s, front, ROOF_HEIGHT)], UNIT)
    strut = 0.0
    while strut < span:
        s = start + strut
        foot = frame.at(s, front + BALCONY_RECESS - 0.2, BALCONIES[-1] + 0.2)
        for offset in (-2.2, 2.2):
            tip = frame.at(s + offset, front - ROOF_LIP_REACH + 0.3, ROOF_HEIGHT + ROOF_LIP_RISE - 0.2)
            limb(steel, foot, tip, STRUT_SIZE / 2, STRUT_SIZE / 2, UNIT, 6)
        strut += STRUT_SPACING


def boom(batch, frame, s, front, colour):
    uv = flat(colour)
    points = [frame.at(s, front - 0.1, 0.02), frame.at(s, front - 0.1, BOOM_HEIGHT - 1.0)]
    for t in np.linspace(0.0, np.pi / 2, BOOM_STEPS)[1:]:
        points.append(frame.at(s, front - 0.1 - 1.0 * (1 - np.cos(t)), BOOM_HEIGHT - 1.0 + 1.0 * np.sin(t)))
    points.append(frame.at(s, front - BOOM_REACH, BOOM_HEIGHT - 0.1))
    for a, b in zip(points, points[1:]):
        limb(batch, a, b, BOOM_SIZE, BOOM_SIZE, uv, 8)
    tip = frame.at(s, front - BOOM_REACH, BOOM_HEIGHT - 0.1)
    limb(batch, tip, tip - np.array([0, 0, 0.45]), 0.03, 0.03, flat("black"), 6)


def jack(batch, frame, s, lateral, length, colour):
    limb(batch, frame.at(s, lateral, 0.12), frame.at(s + length, lateral, 0.95), 0.03, 0.03, flat("jack"), 8)
    box(batch, frame, s - 0.25, s + 0.25, lateral - 0.22, lateral + 0.22, 0.06, 0.2, flat(colour))
    for side in (-0.2, 0.2):
        cylinder(batch, frame.at(s - 0.2, lateral + side, 0.06), frame.at(s - 0.2, lateral + side + 0.04, 0.06) - frame.at(s - 0.2, lateral + side, 0.06), 0.06, 0.04, flat("rubber"), 10)
    limb(batch, frame.at(s + length - 0.25, lateral, 0.95), frame.at(s + length + 0.15, lateral, 0.98), 0.035, 0.035, flat("dark"), 8)


def gun_cart(batch, frame, s, lateral, colour):
    box(batch, frame, s, s + 0.5, lateral, lateral + 0.4, 0.1, 0.75, flat("dark"))
    box(batch, frame, s - 0.01, s + 0.51, lateral - 0.01, lateral + 0.41, 0.75, 0.8, flat(colour))
    cylinder(batch, frame.at(s + 0.25, lateral + 0.2, 0.8), (0, 0, 1), 0.04, 0.2, flat("jack"), 8)
    cylinder(batch, frame.at(s + 0.25, lateral + 0.2, 0.42), frame.at(s + 0.25, lateral - 0.02, 0.42) - frame.at(s + 0.25, lateral + 0.2, 0.42), 0.17, 0.06, flat("rubber"), 12)


def traffic_light(batch, frame, s, front):
    tip = front - BOOM_REACH
    box(batch, frame, s - 0.2, s + 0.2, tip - 0.08, tip + 0.08, BOOM_HEIGHT - 1.2, BOOM_HEIGHT - 0.55, flat("monitor"))
    for k, colour in enumerate(("soft", "go")):
        centre = frame.at(s, tip - 0.09, BOOM_HEIGHT - 0.72 - k * 0.3)
        cylinder(batch, centre, frame.at(s, tip - 0.11, 0) - frame.at(s, tip - 0.09, 0), 0.09, 0.02, flat(colour), 12)


def equipment(frame, pit, parts):
    front = pit["garageFront"]
    team_parts, tyres, metal = parts["team"], parts["tyres"], parts["metal"]
    all_bays = bays(frame.track)
    for index, (s, spacing) in enumerate(all_bays):
        team = team_of(index, len(all_bays))
        if team is None:
            continue
        colour = f"team {team}"
        middle = s + spacing / 2
        boom(team_parts, frame, middle - BOOM_OFFSET, front, colour)
        boom(team_parts, frame, middle + BOOM_OFFSET, front, colour)
        traffic_light(team_parts, frame, middle + BOOM_OFFSET, front)
        for k, (along, lateral) in enumerate(((1.0, -6.1), (1.0, -5.25), (1.85, -6.1), (1.85, -5.25))):
            tyre_stack(tyres, frame.at(s + along, front + lateral, 0.02), 4, COMPOUNDS[(index + k // 2) % len(COMPOUNDS)])
        for bottle in range(2):
            cylinder(metal, frame.at(s + spacing - 1.2 + bottle * 0.35, front - 0.35, 0.02), (0, 0, 1), BOTTLE_RADIUS, BOTTLE_HEIGHT, flat("grey"), 10)
        cart_s = s + spacing - 3.4
        box(metal, frame, cart_s, cart_s + CART_SIZE[1], front - 1.2, front - 1.2 + CART_SIZE[0], 0.15, CART_SIZE[2], flat("grey"))
        box(team_parts, frame, cart_s, cart_s + CART_SIZE[1], front - 1.21, front - 1.19 + CART_SIZE[0], CART_SIZE[2], CART_SIZE[2] + 0.06, flat(colour))
        jack(team_parts, frame, s + 3.0, front - 0.9, 1.9, f"team deep {team}")
        jack(team_parts, frame, s + spacing - 6.2, front - 0.9, 1.3, f"team deep {team}")
        for k in range(4):
            gun_cart(team_parts, frame, s + 5.0 + k * 0.75, front - 0.55, colour)


def crew(frame, pit, parts, rng, figures):
    front = pit["garageFront"]
    all_bays = bays(frame.track)
    lane_heading = np.arctan2(*frame.basis(all_bays[0][0])[1][::-1]) + np.pi
    for index, (s, spacing) in enumerate(all_bays):
        team = team_of(index, len(all_bays))
        if team is None or index == pit["playerBay"]:
            continue
        shirt = f"team {team}"
        count = 4 if index % 2 == 0 else 2
        for member in range(count):
            place_s = s + spacing * (0.2 + 0.6 * (member + rng.random()) / count)
            place_lat = front - rng.uniform(2.0, 5.6)
            heading = lane_heading + rng.uniform(-0.7, 0.7)
            figures.add(parts, frame.at(place_s, place_lat, 0.02), heading, team, int(rng.integers(0, 6)), str(rng.choice(POSES)))


def marshals(frame, pit, parts, rng, figures):
    length = frame.track.length
    deck = pit["pitWall"] + pit["pitWallDeck"] / 2
    span = (pit["garageEnd"] - pit["garageStart"]) % length
    tangent_heading = np.arctan2(*frame.basis(pit["garageStart"])[0][::-1])
    for _ in range(MARSHAL_COUNT):
        s = pit["garageStart"] + rng.uniform(5.0, span - 5.0)
        figures.add(parts, frame.at(s, deck + rng.uniform(-0.6, 0.6), 1.02), tangent_heading - np.pi / 2 + rng.uniform(-0.8, 0.8), MARSHAL_TILE, int(rng.integers(0, 6)), str(rng.choice(POSES)))


def pit_stand(frame, parts, rng, figures, team, centre, front, deck):
    team_parts, steel, screens = parts["team"], parts["steel"], parts["screens"]
    brand, base = flat(f"team {team}"), flat(f"team deep {team}")
    s0, s1 = centre - STATION_LENGTH / 2, centre + STATION_LENGTH / 2
    l0, l1 = front + 0.45, front + deck - 0.15
    floor = STAND_DECK + 0.15
    box(team_parts, frame, s0, s1, l0, l1, STAND_DECK, floor, flat("dark"))
    box(team_parts, frame, s0, s1, l0 + 0.05, l0 + 0.75, floor, 2.0, base)
    box(team_parts, frame, s0 - 0.01, s1 + 0.01, l0 + 0.04, l0 + 0.76, 2.0, 2.05, flat("dark"))
    box(team_parts, frame, s0 - 0.01, s1 + 0.01, l0 + 0.03, l0 + 0.05, 1.45, 1.6, brand)
    width = STATION_LENGTH / MONITORS
    for row, (bottom, top) in enumerate(((2.1, 2.55), (2.6, 3.05))):
        for k in range(MONITORS):
            a, b = s0 + k * width + 0.04, s0 + (k + 1) * width - 0.04
            lean = 0.05 * row
            box(team_parts, frame, a, b, l0 + 0.3 - lean, l0 + 0.36 - lean, bottom, top, flat("monitor"))
            screens.add([frame.at(a + 0.03, l0 + 0.365 - lean, bottom + 0.03), frame.at(b - 0.03, l0 + 0.365 - lean, bottom + 0.03), frame.at(b - 0.03, l0 + 0.365 - lean, top - 0.03), frame.at(a + 0.03, l0 + 0.365 - lean, top - 0.03)], UNIT)
    for k in range(CHAIRS):
        seat_s = s0 + (k + 0.5) * STATION_LENGTH / CHAIRS
        seat_l = l0 + 1.15
        limb(steel, frame.at(seat_s, seat_l, floor), frame.at(seat_s, seat_l, 1.72), 0.03, 0.03, UNIT, 6)
        box(team_parts, frame, seat_s - 0.24, seat_s + 0.24, seat_l - 0.22, seat_l + 0.22, 1.72, 1.8, flat("chair"))
        box(team_parts, frame, seat_s - 0.23, seat_s + 0.23, seat_l + 0.2, seat_l + 0.26, 1.8, 2.35, flat("chair"))
        box(team_parts, frame, seat_s - 0.235, seat_s + 0.235, seat_l + 0.195, seat_l + 0.265, 2.22, 2.35, brand)
    roof_l0, roof_l1 = l0 - 0.6, l1 + 0.5
    box(team_parts, frame, s0 - 0.5, s1 + 0.5, roof_l0, roof_l1, STAND_ROOF, STAND_ROOF + 0.16, base)
    for lateral in (roof_l0 - 0.03, roof_l1 - 0.01):
        box(team_parts, frame, s0 - 0.52, s1 + 0.52, lateral, lateral + 0.04, STAND_ROOF - 0.28, STAND_ROOF + 0.18, brand)
    parts["lights"].add([frame.at(s0, l0 + 0.2, STAND_ROOF - 0.01), frame.at(s1, l0 + 0.2, STAND_ROOF - 0.01), frame.at(s1, l0 + 0.45, STAND_ROOF - 0.01), frame.at(s0, l0 + 0.45, STAND_ROOF - 0.01)], UNIT)
    for post_s in (s0 + 0.1, centre, s1 - 0.1):
        for post_l in (l0 + 0.1, l1 - 0.1):
            limb(steel, frame.at(post_s, post_l, floor), frame.at(post_s, post_l, STAND_ROOF), 0.045, 0.045, UNIT, 6)
    for edge in (s0 - 0.02, s1 - 0.02):
        box(team_parts, frame, edge, edge + 0.04, l0 + 0.05, l0 + 0.95, 2.05, STAND_ROOF, base)
    mast = frame.at(s1 + 0.2, l1, STAND_ROOF + 0.16)
    top = mast + np.array([0, 0, MAST_HEIGHT])
    limb(steel, mast, top, 0.035, 0.025, UNIT, 6)
    for lift, reach in ((0.6, 0.45), (1.5, 0.3)):
        a, b = frame.at(s1 + 0.2 - reach, l1, STAND_ROOF + 0.16 + lift), frame.at(s1 + 0.2 + reach, l1, STAND_ROOF + 0.16 + lift)
        limb(steel, a, b, 0.015, 0.015, UNIT, 4)
    dish = frame.at(s0 + 0.6, l0 + 0.6, STAND_ROOF + 0.45)
    cylinder(steel, dish, frame.at(s0 + 0.6, l0 + 0.1, STAND_ROOF + 0.7) - frame.at(s0 + 0.6, l0 + 0.6, STAND_ROOF + 0.45), 0.32, 0.05, UNIT, 16)
    limb(steel, frame.at(s0 + 0.6, l0 + 0.6, STAND_ROOF + 0.16), dish, 0.03, 0.03, UNIT, 6)
    heading = np.arctan2(*frame.basis(s0)[1][::-1])
    for seat in (1, 3, 4):
        seat_s = s0 + (seat + 0.5) * STATION_LENGTH / CHAIRS
        figures.add(parts, frame.at(seat_s, l0 + 1.6, floor), heading + np.pi, team, int(rng.integers(0, 6)), str(rng.choice(POSES)))


def pit_wall(frame, pit, parts, rng, figures):
    length = frame.track.length
    front = pit["pitWall"]
    deck = pit["pitWallDeck"]
    back = front + deck
    start = pit["garageStart"]
    span = (pit["garageEnd"] - start) % length
    steel = parts["steel"]
    margin = 24.0
    post = margin
    while post < span - margin:
        s = start + post
        limb(steel, frame.at(s, back - 0.08, 1.0), frame.at(s, back - 0.08, 1.0 + RAIL_HEIGHT), RAIL_SIZE, RAIL_SIZE, UNIT, 6)
        limb(steel, frame.at(s, back - 0.08, 1.0 + RAIL_HEIGHT), frame.at(s + RAIL_POST_SPACING, back - 0.08, 1.0 + RAIL_HEIGHT), RAIL_SIZE, RAIL_SIZE, UNIT, 6)
        limb(steel, frame.at(s, back - 0.08, 1.0 + RAIL_HEIGHT / 2), frame.at(s + RAIL_POST_SPACING, back - 0.08, 1.0 + RAIL_HEIGHT / 2), RAIL_SIZE * 0.7, RAIL_SIZE * 0.7, UNIT, 6)
        post += RAIL_POST_SPACING
    all_bays = bays(frame.track)
    for team in range(TEAM_COUNT):
        first = (len(all_bays) - TEAM_COUNT * TEAM_BAYS) // 2 + team * TEAM_BAYS
        s, spacing = all_bays[first]
        pit_stand(frame, parts, rng, figures, team, s + spacing, front, deck)
    for stairs in (0.2, 0.5, 0.8):
        s = start + span * stairs
        step_depth = 0.2
        for step in range(STEP_COUNT):
            lift = 1.0 * (STEP_COUNT - step) / STEP_COUNT
            box(parts["concrete"], frame, s, s + 1.6, back + step * step_depth, back + (step + 1) * step_depth, 0.0, lift)


def lattice(batch, frame, s, lateral, top):
    half = TOWER_WIDTH / 2
    corners = [(s - half, lateral - half), (s + half, lateral - half), (s + half, lateral + half), (s - half, lateral + half)]
    for a, l in corners:
        limb(batch, frame.at(a, l, -1.0), frame.at(a, l, top), TOWER_POST, TOWER_POST, UNIT, 6)
    level = 0.0
    while level < top:
        for (a0, l0), (a1, l1) in zip(corners, corners[1:] + corners[:1]):
            limb(batch, frame.at(a0, l0, level), frame.at(a1, l1, level), TOWER_BRACE, TOWER_BRACE, UNIT, 5)
            limb(batch, frame.at(a0, l0, level), frame.at(a1, l1, level + TOWER_LEVEL), TOWER_BRACE, TOWER_BRACE, UNIT, 5)
        level += TOWER_LEVEL


def v_bridge(frame, pit, parts, s, right_reach):
    deck_lat = pit["pitWall"] + pit["pitWallDeck"] / 2
    front = pit["garageFront"]
    steel, white, banner = parts["steel"], parts["white"], parts["banner"]
    for sign in (1, -1):
        limb(white, frame.at(s, deck_lat, 1.0), frame.at(s + sign * V_SPREAD, deck_lat, BRIDGE_HEIGHT), V_SIZE * 0.55, V_SIZE, flat("white"), 10)
    limb(white, frame.at(s - V_SPREAD, deck_lat, BRIDGE_HEIGHT), frame.at(s + V_SPREAD, deck_lat, BRIDGE_HEIGHT), V_SIZE, V_SIZE, flat("white"), 10)
    far = -right_reach
    box(steel, frame, s - BRIDGE_DEPTH / 2, s + BRIDGE_DEPTH / 2, far, front, BRIDGE_HEIGHT - 0.25, BRIDGE_HEIGHT + 0.25, UNIT)
    if right_reach > 0:
        lattice(parts["tower"], frame, s, far, BRIDGE_HEIGHT + 1.0)
    for brand, l0, l1 in ((2, deck_lat + 1.0, front - 2.0), (3, far + 2.0, deck_lat - 1.0)):
        run = l1 - l0
        if run < BRIDGE_BANNER:
            continue
        tiles = run / (BRIDGE_BANNER * 4)
        v0, v1 = 1 - (brand + 1) / BRAND_ROWS, 1 - brand / BRAND_ROWS
        for shift, reading in ((-BRIDGE_DEPTH / 2, (l1, l0)), (BRIDGE_DEPTH / 2, (l0, l1))):
            a, b = reading
            banner.add(
                [frame.at(s + shift, a, BRIDGE_HEIGHT - 0.25 - BRIDGE_BANNER), frame.at(s + shift, b, BRIDGE_HEIGHT - 0.25 - BRIDGE_BANNER), frame.at(s + shift, b, BRIDGE_HEIGHT - 0.25), frame.at(s + shift, a, BRIDGE_HEIGHT - 0.25)],
                [(0, v0), (tiles, v0), (tiles, v1), (0, v1)],
            )


def entry_signs(frame, pit, parts):
    signs = parts["signs"]
    start = pit["wallStart"]
    wall = pit["pitWall"]
    for lateral in (wall + 1.0, pit["pitLaneSign"]):
        s = start + 1.0
        box(parts["white"], frame, s, s + 0.2, lateral, lateral + 1.0, 0.0, 1.5, flat("white"))
        signs.add([frame.at(s - 0.02, lateral + 1.0, 0.25), frame.at(s - 0.02, lateral, 0.25), frame.at(s - 0.02, lateral, 1.25), frame.at(s - 0.02, lateral + 1.0, 1.25)], [(0, 0.5), (1, 0.5), (1, 1), (0, 1)])
    arrow_s = start - 1.0
    limb(parts["steel"], frame.at(arrow_s, wall + 0.2, 0.0), frame.at(arrow_s, wall + 0.2, 3.2), 0.06, 0.06, UNIT, 6)
    signs.add([frame.at(arrow_s, wall + 0.85, 2.0), frame.at(arrow_s, wall - 0.45, 2.0), frame.at(arrow_s, wall - 0.45, 3.3), frame.at(arrow_s, wall + 0.85, 3.3)], [(0, 0), (1, 0), (1, 0.5), (0, 0.5)])


def build(track, figure_path):
    frame = Frame(track)
    figures = Figures(figure_path)
    pit = track.pit
    names = ("panels", "fascia", "banner", "canopy", "floor", "inner", "back", "lights", "steel", "team", "tyres", "metal", "screens", "people cloth", "people hair", "people eyes", "people skin Male 0", "people skin Male 1", "people skin Female 0", "people skin Female 1", "white", "signs", "concrete", "tower")
    parts = {name: Batch() for name in names}
    rng = np.random.default_rng(SEED)
    garage_front(frame, pit, parts)
    equipment(frame, pit, parts)
    crew(frame, pit, parts, rng, figures)
    marshals(frame, pit, parts, rng, figures)
    pit_wall(frame, pit, parts, rng, figures)
    start = pit["garageStart"]
    span = (pit["garageEnd"] - start) % track.length
    for position, reach in ((0.25, float(track.walls[0, 1]) + 2.0), (0.68, None)):
        v_bridge(frame, pit, parts, start + span * position, reach if reach is not None else -pit["pitWall"])
    entry_signs(frame, pit, parts)
    return parts
