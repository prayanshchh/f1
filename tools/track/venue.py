import numpy as np

from palette import BRAND_ROWS
from standshape import FRONT_WALL, ROW_RISE, layout
from trackside import UNIT, beam

ROOF_CLEARANCE = 4.5
ROOF_COVER = 0.8
BAY_WIDTH = 14.0
FIN_THICKNESS = 0.22
FIN_RISE = 2.4
COLUMN_SIZE = 0.45
RAIL_HEIGHT = 1.0
RAIL_SIZE = 0.05
FRAME_SPACING = 8.0
FRAME_SIZE = 0.2
TOWER_HEIGHT = 76.5
TOWER_FLOORS = 20
TOWER_PLATE = 8.5
TOWER_CORE = 4.6
TOWER_COLUMN = 0.5
TOWER_DECK = 11.5
VEIL_RIBS = 36
VEIL_SPREAD = np.radians(62.0)
VEIL_REACH = 46.0
VEIL_ROOF = 13.0
VEIL_TOP = 68.0
VEIL_WIDTH = 0.55
VEIL_STEPS = 18
GANTRY_CLEARANCE = 2.5
GANTRY_LOW = 6.0
GANTRY_HIGH = 7.6
GANTRY_DEPTH = 1.0
GANTRY_PILLAR = 1.0
GANTRY_BRAND = 8
BOARD_SPAN = 12.8
PANEL_SIZE = (3.2, 1.6)
PANEL_DEPTH = 0.35
LIGHT_COLUMNS = 5
LIGHT_ROWS = 4
LAMP_SIZE = 0.26


def at(facing, across, d, l):
    return facing * d + across * l


def stand(seats, concrete, roof, columns, data):
    shape = layout(data)
    facing, across = shape["facing"], shape["across"]
    back, front, left, right = shape["back"], shape["front"], shape["left"], shape["right"]
    rows, depth, base = shape["rows"], shape["depth"], shape["base"]

    def edge(d):
        return at(facing, across, d, left), at(facing, across, d, right)

    a, b = edge(front)
    concrete.add([(*a, base), (*b, base), (*b, base + FRONT_WALL), (*a, base + FRONT_WALL)], UNIT)
    for row in range(rows):
        near, far = front - row * depth, front - (row + 1) * depth
        low = base + FRONT_WALL + row * ROW_RISE
        n0, n1 = edge(near)
        f0, f1 = edge(far)
        seats.add([(*n0, low), (*n1, low), (*f1, low), (*f0, low)], UNIT)
        seats.add([(*f0, low), (*f1, low), (*f1, low + ROW_RISE), (*f0, low + ROW_RISE)], UNIT)
    top = base + FRONT_WALL + rows * ROW_RISE
    b0, b1 = edge(back)
    concrete.add([(*b0, top - 1.0), (*b1, top - 1.0), (*b1, top + RAIL_HEIGHT), (*b0, top + RAIL_HEIGHT)], UNIT)
    for l in (left, right):
        p_front, p_back = at(facing, across, front, l), at(facing, across, back, l)
        concrete.add([(*p_front, base), (*p_back, base), (*p_back, top), (*p_front, base + FRONT_WALL)], UNIT)
    for l in np.arange(left, right + 1, FRAME_SPACING):
        foot = at(facing, across, back, l)
        beam(columns, np.array([*foot, base]), np.array([*foot, top]), FRAME_SIZE)
        mid = at(facing, across, (back + front) / 2, l)
        beam(columns, np.array([*mid, base]), np.array([*foot, top]), FRAME_SIZE * 0.6)
    beam(columns, np.array([*b0, top + RAIL_HEIGHT]), np.array([*b1, top + RAIL_HEIGHT]), RAIL_SIZE * 2)
    a0, a1 = edge(front)
    beam(columns, np.array([*a0, base + FRONT_WALL + RAIL_HEIGHT]), np.array([*a1, base + FRONT_WALL + RAIL_HEIGHT]), RAIL_SIZE)
    if not data["roof"]:
        return
    height = top + ROOF_CLEARANCE
    reach = back + (front - back) * ROOF_COVER
    bays = max(1, int((right - left) / BAY_WIDTH))
    span = (right - left) / bays
    for bay in range(bays):
        l0, l1 = left + bay * span, left + (bay + 1) * span
        rear0, rear1 = at(facing, across, back, l0), at(facing, across, back, l1)
        lip0, lip1 = at(facing, across, reach, l0 - 0.6), at(facing, across, reach, l1 + 0.6)
        roof.add([(*rear0, height), (*rear1, height), (*lip1, height + FIN_RISE)], [(0, 0), (1, 0), (1, 1)])
        roof.add([(*rear0, height), (*lip1, height + FIN_RISE), (*lip0, height + FIN_RISE)], [(0, 0), (1, 1), (0, 1)])
        roof.add([(*lip0, height + FIN_RISE - FIN_THICKNESS), (*lip1, height + FIN_RISE - FIN_THICKNESS), (*lip1, height + FIN_RISE), (*lip0, height + FIN_RISE)], UNIT)
        foot = at(facing, across, back, l0)
        beam(columns, np.array([*foot, base]), np.array([*foot, height]), COLUMN_SIZE)
        beam(columns, np.array([*foot, height]), np.array([*at(facing, across, reach, l0), height + FIN_RISE]), COLUMN_SIZE * 0.5)


def extrude_box(batch, centre, half_x, half_y, z0, z1):
    x, y = centre
    corners = [(x - half_x, y - half_y), (x + half_x, y - half_y), (x + half_x, y + half_y), (x - half_x, y + half_y)]
    for a, b in zip(corners, corners[1:] + corners[:1]):
        batch.add([(*a, z0), (*b, z0), (*b, z1), (*a, z1)], UNIT)
    batch.add([(*c, z1) for c in corners], UNIT)
    batch.add([(*c, z0) for c in corners[::-1]], UNIT)


def extrude(walls, roofs, data):
    outline = np.array(data["outline"])
    base, height = data["base"], data["height"]
    for a, b in zip(outline, np.roll(outline, -1, axis=0)):
        length = np.linalg.norm(b - a)
        walls.add([(*a, base), (*b, base), (*b, base + height), (*a, base + height)], [(0, 0), (length / 4, 0), (length / 4, height / 4), (0, height / 4)])
    roofs.add([(*p, base + height) for p in outline], [(0, 0)] * len(outline))


def tower(plates, core, veil, data):
    x, y = data["position"]
    base = data["base"]
    direction = np.asarray(data["veil"], float)
    extrude_box(core, (x, y), TOWER_CORE / 2, TOWER_CORE / 2, base, base + TOWER_HEIGHT)
    for floor in range(TOWER_FLOORS):
        z = base + 6.0 + floor * (TOWER_HEIGHT - 8.0) / TOWER_FLOORS
        half = TOWER_PLATE / 2 * (1.0 - 0.15 * (floor % 2))
        extrude_box(plates, (x, y), half, half, z, z + 0.42)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = x + sx * TOWER_PLATE * 0.44, y + sy * TOWER_PLATE * 0.44
            extrude_box(plates, (cx, cy), TOWER_COLUMN / 2, TOWER_COLUMN / 2, base, base + TOWER_HEIGHT - 2.0)
    extrude_box(plates, (x, y), TOWER_DECK / 2, TOWER_DECK / 2, base + TOWER_HEIGHT - 3.0, base + TOWER_HEIGHT - 2.4)
    extrude_box(core, (x, y), TOWER_DECK / 2 - 0.5, TOWER_DECK / 2 - 0.5, base + TOWER_HEIGHT - 2.4, base + TOWER_HEIGHT)
    extrude_box(plates, (x, y), TOWER_DECK / 2 + 0.3, TOWER_DECK / 2 + 0.3, base + TOWER_HEIGHT, base + TOWER_HEIGHT + 0.4)
    heading = np.arctan2(direction[1], direction[0])
    ends = []
    for index in range(VEIL_RIBS):
        t = index / (VEIL_RIBS - 1)
        angle = heading + (t - 0.5) * 2 * VEIL_SPREAD
        out = np.array([np.cos(angle), np.sin(angle)])
        side = np.array([-out[1], out[0]])
        start = np.array([x, y]) + direction * TOWER_PLATE * 0.6 + side * (t - 0.5) * TOWER_PLATE * 0.8
        reach = VEIL_REACH * (0.82 + 0.18 * np.cos(angle - heading))
        points = []
        for step in range(VEIL_STEPS + 1):
            u = step / VEIL_STEPS
            xy = start + out * reach * (u**1.7)
            z = base + VEIL_TOP * (1 - u) ** 1.4 + VEIL_ROOF * u + (1 - u) * 3.0 * np.sin(t * np.pi)
            points.append((xy, z))
        for (p0, z0), (p1, z1) in zip(points, points[1:]):
            veil.add(
                [(*(p0 - side * VEIL_WIDTH / 2), z0), (*(p0 + side * VEIL_WIDTH / 2), z0), (*(p1 + side * VEIL_WIDTH / 2), z1), (*(p1 - side * VEIL_WIDTH / 2), z1)],
                UNIT,
            )
        ends.append(points[-1])
    for (p0, z0), (p1, z1) in zip(ends, ends[1:]):
        beam(veil, np.array([*p0, z0]), np.array([*p1, z1]), 0.5)


def gantry(track, boards, steel, panel, lamps):
    row = 0
    centre = track.position[row, :2]
    normal = track.normal[row]
    tangent = track.tangent[row]
    half = track.half[row] + GANTRY_CLEARANCE
    ground = track.position[row, 2]
    for sign in (1, -1):
        foot = centre + normal * sign * half
        beam(steel, np.array([*foot, ground]), np.array([*foot, ground + GANTRY_HIGH]), GANTRY_PILLAR)
    left, right = centre + normal * half, centre - normal * half
    beam(steel, np.array([*left, ground + (GANTRY_LOW + GANTRY_HIGH) / 2]), np.array([*right, ground + (GANTRY_LOW + GANTRY_HIGH) / 2]), GANTRY_DEPTH * 0.9)
    v0, v1 = 1 - (GANTRY_BRAND + 1) / BRAND_ROWS, 1 - GANTRY_BRAND / BRAND_ROWS
    repeat = 2 * half / BOARD_SPAN
    for face, reading in ((-1, (left, right)), (1, (right, left))):
        shift = tangent * face * GANTRY_DEPTH / 2
        a, b = reading[0] + shift, reading[1] + shift
        boards.add(
            [(*a, ground + GANTRY_LOW), (*b, ground + GANTRY_LOW), (*b, ground + GANTRY_HIGH), (*a, ground + GANTRY_HIGH)],
            [(0, v0), (repeat, v0), (repeat, v1), (0, v1)],
        )
    width, height = PANEL_SIZE
    top = ground + GANTRY_LOW
    bottom = top - height
    front = centre - tangent * (GANTRY_DEPTH / 2 + PANEL_DEPTH)
    for d in (0.0, PANEL_DEPTH):
        base = front + tangent * d
        a, b = base + normal * width / 2, base - normal * width / 2
        panel.add([(*a, bottom), (*b, bottom), (*b, top), (*a, top)], UNIT)
    face = front - tangent * 0.02
    for column in range(LIGHT_COLUMNS):
        across = (column - (LIGHT_COLUMNS - 1) / 2) * width / LIGHT_COLUMNS
        for lamp in range(LIGHT_ROWS):
            middle = bottom + (lamp + 0.5) * height / LIGHT_ROWS
            centre_lamp = face - normal * across
            l0, l1 = centre_lamp + normal * LAMP_SIZE / 2, centre_lamp - normal * LAMP_SIZE / 2
            uv = (column + 0.5, lamp + 0.5)
            lamps.add(
                [(*l0, middle - LAMP_SIZE / 2), (*l1, middle - LAMP_SIZE / 2), (*l1, middle + LAMP_SIZE / 2), (*l0, middle + LAMP_SIZE / 2)],
                [uv] * 4,
            )
