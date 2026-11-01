import numpy as np

from palette import palette_uv
from trackside import UNIT, Batch

BAY_SPACING = 14.0
BAY_PIER = 1.8
OPENING_HEIGHT = 4.6
INTERIOR_DEPTH = 9.0
FASCIA_HEIGHT = 5.8
CANOPY_HEIGHT = 6.0
CANOPY_REACH = 3.2
CANOPY_THICKNESS = 0.35
BANNER_LOW = 7.0
BANNER_HIGH = 11.6
BANNER_TILE = 18.4
BANNER_BRAND = 1
BRAND_ROWS = 4
ROOF_HEIGHT = 14.0
ROOF_LIP_REACH = 5.0
ROOF_LIP_RISE = 1.4
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
TEAM_COUNT = 10
TEAM_BAYS = 2
STATION_LENGTH = 7.0
STATION_DEPTH = 1.5
STATION_HEIGHT = 2.5
STATION_ROOF = 0.14
RAIL_HEIGHT = 1.05
RAIL_POST_SPACING = 3.0
RAIL_SIZE = 0.05
STEP_COUNT = 5
TYRE_RADIUS = 0.34
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

SKIN = ("skin light", "skin mid", "skin dark")


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


def cylinder(batch, centre, axis, radius, length, uv, segments=10):
    axis = np.asarray(axis, float) / np.linalg.norm(axis)
    helper = np.array([0.0, 0.0, 1.0]) if abs(axis[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    u = np.cross(axis, helper)
    u /= np.linalg.norm(u)
    v = np.cross(axis, u)
    ring = [np.cos(a) * u + np.sin(a) * v for a in np.linspace(0, 2 * np.pi, segments, endpoint=False)]
    top = centre + axis * length
    for a, b in zip(ring, ring[1:] + ring[:1]):
        batch.add([centre + a * radius, centre + b * radius, top + b * radius, top + a * radius], uv)
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


def head(batch, centre, radius, uv, stretch=1.15):
    for lat0, lat1 in zip(np.linspace(-np.pi / 2, np.pi / 2, 6)[:-1], np.linspace(-np.pi / 2, np.pi / 2, 6)[1:]):
        for lon0, lon1 in zip(np.linspace(0, 2 * np.pi, 10)[:-1], np.linspace(0, 2 * np.pi, 10)[1:]):
            point = lambda la, lo: centre + radius * np.array([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la) * stretch])
            batch.add([point(lat0, lon0), point(lat0, lon1), point(lat1, lon1), point(lat1, lon0)], uv)


def person(batch, origin, heading, shirt, trousers, skin, lean=0.0, arms_out=0.0, headset=True):
    forward = np.array([np.cos(heading), np.sin(heading), 0.0])
    side = np.array([-forward[1], forward[0], 0.0])
    up = np.array([0.0, 0.0, 1.0])
    shirt_uv, trouser_uv, skin_uv = flat(shirt), flat(trousers), flat(skin)
    black = flat("black")
    hip = origin + up * 0.92
    chest = hip + up * (0.52 * np.cos(lean)) + forward * (0.52 * np.sin(lean))
    neck = chest + up * (0.08 * np.cos(lean)) + forward * (0.08 * np.sin(lean))
    centre = neck + up * 0.14 + forward * (0.12 * np.sin(lean))
    for sign in (1, -1):
        foot = origin + side * sign * 0.13
        knee = origin + up * 0.48 + side * sign * 0.12 + forward * (0.03 + 0.05 * np.sin(lean))
        limb(batch, foot + up * 0.06, knee, 0.075, 0.085, trouser_uv)
        limb(batch, knee, hip + side * sign * 0.1, 0.085, 0.11, trouser_uv)
        limb(batch, foot, foot + forward * 0.22 + up * 0.05, 0.06, 0.05, black)
        shoulder = chest + side * sign * 0.22 - up * 0.04
        elbow = shoulder - up * (0.28 * np.cos(arms_out)) + forward * (0.28 * np.sin(arms_out)) + side * sign * 0.03
        hand = elbow - up * (0.26 * np.cos(arms_out * 1.3)) + forward * (0.26 * np.sin(arms_out * 1.3))
        limb(batch, shoulder, elbow, 0.058, 0.05, shirt_uv)
        limb(batch, elbow, hand, 0.044, 0.036, skin_uv)
    limb(batch, hip, chest, 0.145, 0.19, shirt_uv)
    limb(batch, chest, neck, 0.19, 0.06, shirt_uv)
    limb(batch, neck, centre, 0.055, 0.055, skin_uv)
    head(batch, centre, 0.105, skin_uv)
    head(batch, centre + up * 0.035 - forward * 0.02, 0.1, flat("hair"), 0.95)
    if headset:
        limb(batch, centre + side * 0.112, centre - side * 0.112, 0.022, 0.022, black, 6)
        for sign in (1, -1):
            head(batch, centre + side * sign * 0.112, 0.05, black, 1.0)


def bays(track):
    pit = track.pit
    span = (pit["garageEnd"] - pit["garageStart"]) % track.length
    count = int(span // BAY_SPACING)
    spacing = span / count
    return [(pit["garageStart"] + index * spacing, spacing) for index in range(count)]


def team_of(index, count):
    first = (count - TEAM_COUNT * TEAM_BAYS) // 2
    team = (index - first) // TEAM_BAYS
    return team if 0 <= team < TEAM_COUNT else None


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
        deep = front + INTERIOR_DEPTH
        floor.add([frame.at(s0, front, 0.02), frame.at(s1, front, 0.02), frame.at(s1, deep, 0.02), frame.at(s0, deep, 0.02)], [(0, 0), (spacing / 3, 0), (spacing / 3, 3), (0, 3)])
        back.add([frame.at(s0, deep, 0), frame.at(s1, deep, 0), frame.at(s1, deep, OPENING_HEIGHT), frame.at(s0, deep, OPENING_HEIGHT)], [(0, 0), (1, 0), (1, 1), (0, 1)])
        for edge in (s0, s1):
            back.add([frame.at(edge, deep, 0), frame.at(edge, front, 0), frame.at(edge, front, OPENING_HEIGHT), frame.at(edge, deep, OPENING_HEIGHT)], [(0, 0), (1, 0), (1, 1), (0, 1)])
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
        panels.add([frame.at(sa, front, FASCIA_HEIGHT), frame.at(sb, front, FASCIA_HEIGHT), frame.at(sb, front, ROOF_HEIGHT), frame.at(sa, front, ROOF_HEIGHT)], UNIT)
        canopy.add([frame.at(sa, front, CANOPY_HEIGHT), frame.at(sb, front, CANOPY_HEIGHT), frame.at(sb, front - CANOPY_REACH, CANOPY_HEIGHT - 0.3), frame.at(sa, front - CANOPY_REACH, CANOPY_HEIGHT - 0.3)], UNIT)
        canopy.add([frame.at(sa, front - CANOPY_REACH, CANOPY_HEIGHT - 0.3), frame.at(sb, front - CANOPY_REACH, CANOPY_HEIGHT - 0.3), frame.at(sb, front - CANOPY_REACH, CANOPY_HEIGHT - 0.3 + CANOPY_THICKNESS), frame.at(sa, front - CANOPY_REACH, CANOPY_HEIGHT - 0.3 + CANOPY_THICKNESS)], UNIT)
        canopy.add([frame.at(sa, front, ROOF_HEIGHT), frame.at(sb, front, ROOF_HEIGHT), frame.at(sb, front - ROOF_LIP_REACH, ROOF_HEIGHT + ROOF_LIP_RISE), frame.at(sa, front - ROOF_LIP_REACH, ROOF_HEIGHT + ROOF_LIP_RISE)], UNIT)
        ua, ub = a / BANNER_TILE, b / BANNER_TILE
        banner.add([frame.at(sa, front - 0.08, BANNER_LOW), frame.at(sb, front - 0.08, BANNER_LOW), frame.at(sb, front - 0.08, BANNER_HIGH), frame.at(sa, front - 0.08, BANNER_HIGH)], [(ua, v0), (ub, v0), (ub, v1), (ua, v1)])
    strut = 0.0
    while strut < span:
        s = start + strut
        foot = frame.at(s, front - 0.1, BANNER_HIGH + 0.2)
        for offset in (-2.2, 2.2):
            tip = frame.at(s + offset, front - ROOF_LIP_REACH + 0.2, ROOF_HEIGHT + ROOF_LIP_RISE - 0.1)
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


def equipment(frame, pit, parts):
    front = pit["garageFront"]
    team_parts, tyres, metal = parts["team"], parts["tyres"], parts["metal"]
    all_bays = bays(frame.track)
    colours = [f"team {i}" for i in range(TEAM_COUNT)]
    for index, (s, spacing) in enumerate(all_bays):
        team = team_of(index, len(all_bays))
        if team is None:
            continue
        colour = colours[team]
        middle = s + spacing / 2
        boom(team_parts, frame, middle - BOOM_OFFSET, front, colour)
        boom(team_parts, frame, middle + BOOM_OFFSET, front, colour)
        for stack, offset in enumerate((-6.0, -5.2)):
            base = frame.at(s + 1.3 + stack * 0.0, front + offset, 0.02)
            for layer in range(4):
                cylinder(tyres, base + np.array([0, 0, layer * TYRE_WIDTH]), (0, 0, 1), TYRE_RADIUS, TYRE_WIDTH - 0.02, flat("black"), 12)
        for bottle in range(2):
            cylinder(metal, frame.at(s + spacing - 1.2 + bottle * 0.35, front - 0.35, 0.02), (0, 0, 1), BOTTLE_RADIUS, BOTTLE_HEIGHT, flat("grey"), 10)
        cart_s = s + spacing - 3.4
        box(metal, frame, cart_s, cart_s + CART_SIZE[1], front - 1.2, front - 1.2 + CART_SIZE[0], 0.15, CART_SIZE[2], flat("grey"))
        box(team_parts, frame, cart_s, cart_s + CART_SIZE[1], front - 1.21, front - 1.19 + CART_SIZE[0], CART_SIZE[2], CART_SIZE[2] + 0.06, flat(colour))


def crew(frame, pit, batch, rng):
    front = pit["garageFront"]
    all_bays = bays(frame.track)
    lane_heading = np.arctan2(*frame.basis(all_bays[0][0])[1][::-1]) + np.pi
    for index, (s, spacing) in enumerate(all_bays):
        team = team_of(index, len(all_bays))
        if team is None:
            continue
        shirt = f"team {team}"
        count = 4 if index % 2 == 0 else 2
        for member in range(count):
            place_s = s + spacing * (0.2 + 0.6 * (member + rng.random()) / count)
            place_lat = front - rng.uniform(2.0, 5.6)
            heading = lane_heading + rng.uniform(-0.7, 0.7)
            lean = rng.choice([0.0, 0.0, 0.0, 0.55])
            person(batch, frame.at(place_s, place_lat, 0.02), heading, shirt, "dark", SKIN[int(rng.integers(0, 3))], lean=lean, arms_out=0.25 if lean else rng.uniform(0, 0.15))


def marshals(frame, pit, batch, rng):
    length = frame.track.length
    deck = pit["pitWall"] + pit["pitWallDeck"] / 2
    span = (pit["garageEnd"] - pit["garageStart"]) % length
    tangent_heading = np.arctan2(*frame.basis(pit["garageStart"])[0][::-1])
    for _ in range(MARSHAL_COUNT):
        s = pit["garageStart"] + rng.uniform(5.0, span - 5.0)
        shirt = "marshal" if rng.random() < 0.8 else "hi vis"
        person(batch, frame.at(s, deck + rng.uniform(-0.6, 0.6), 1.02), tangent_heading - np.pi / 2 + rng.uniform(-0.8, 0.8), shirt, "marshal" if shirt == "marshal" else "dark", SKIN[int(rng.integers(0, 3))], headset=False)


def pit_wall(frame, pit, parts, rng):
    length = frame.track.length
    front = pit["pitWall"]
    deck = pit["pitWallDeck"]
    back = front + deck
    start = pit["garageStart"]
    span = (pit["garageEnd"] - start) % length
    team_parts, steel, screens, station_roof = parts["team"], parts["steel"], parts["screens"], parts["canopy"]
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
        centre = s + spacing
        s0, s1 = centre - STATION_LENGTH / 2, centre + STATION_LENGTH / 2
        l0 = front + 0.55
        l1 = l0 + STATION_DEPTH
        colour = flat(f"team {team}")
        box(team_parts, frame, s0, s1, l0 + 0.5, l1 - 0.3, 1.0, 1.0 + 0.85, flat("dark"))
        box(team_parts, frame, s0, s1, l0 + 0.5, l1 - 0.3, 1.85, 1.92, colour)
        for screen in range(5):
            a = s0 + 0.3 + screen * (STATION_LENGTH - 0.6) / 5
            b = a + (STATION_LENGTH - 0.6) / 5 - 0.12
            for face_lat in (l0 + 0.48, l1 - 0.28):
                screens.add([frame.at(a, face_lat, 2.0), frame.at(b, face_lat, 2.0), frame.at(b, face_lat, 2.55), frame.at(a, face_lat, 2.55)], UNIT)
        for corner_s in (s0 + 0.15, s1 - 0.15):
            for corner_l in (l0 + 0.1, l1 - 0.1):
                limb(steel, frame.at(corner_s, corner_l, 1.0), frame.at(corner_s, corner_l, 1.0 + STATION_HEIGHT), 0.05, 0.05, UNIT, 6)
        station_roof.add([frame.at(s0 - 0.3, l0 - 0.3, 3.5), frame.at(s1 + 0.3, l0 - 0.3, 3.5), frame.at(s1 + 0.3, l1 + 0.3, 3.5 + STATION_ROOF), frame.at(s0 - 0.3, l1 + 0.3, 3.5 + STATION_ROOF)], UNIT)
        box(team_parts, frame, s0 - 0.3, s1 + 0.3, l1 + 0.28, l1 + 0.32, 3.2, 3.5 + STATION_ROOF, colour)
        for seat in (0.25, 0.5, 0.75):
            person(parts["people"], frame.at(s0 + STATION_LENGTH * seat, l1 - 0.15, 1.02), np.arctan2(*frame.basis(s0)[1][::-1]) + np.pi, f"team {team}", "dark", SKIN[int(rng.integers(0, 3))])
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


def build(track):
    frame = Frame(track)
    pit = track.pit
    names = ("panels", "fascia", "banner", "canopy", "floor", "inner", "back", "lights", "steel", "team", "tyres", "metal", "screens", "people", "white", "signs", "concrete", "tower")
    parts = {name: Batch() for name in names}
    rng = np.random.default_rng(SEED)
    garage_front(frame, pit, parts)
    equipment(frame, pit, parts)
    crew(frame, pit, parts["people"], rng)
    marshals(frame, pit, parts["people"], rng)
    pit_wall(frame, pit, parts, rng)
    start = pit["garageStart"]
    span = (pit["garageEnd"] - start) % track.length
    for position, reach in ((0.25, float(track.walls[0, 1]) + 2.0), (0.68, None)):
        v_bridge(frame, pit, parts, start + span * position, reach if reach is not None else -pit["pitWall"])
    entry_signs(frame, pit, parts)
    return parts
