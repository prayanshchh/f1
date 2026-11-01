import bmesh
import bpy
import numpy as np
from mathutils import Vector

from trackside import UNIT, Batch, beam

ROW_DEPTH = 0.85
ROW_RISE = 0.45
FRONT_WALL = 1.2
MIN_ROWS = 3
MAX_ROWS = 40
ROOF_CLEARANCE = 3.5
ROOF_COVER = 0.75
ROOF_THICKNESS = 0.3
COLUMN_SPACING = 12.0
COLUMN_SIZE = 0.5
FACADE_METRES = (32.0, 14.0)
TOWER_HEIGHT = 70.0
TOWER_RADIUS = 2.5
DECK_RADIUS = 7.5
DECK_DEPTH = 4.0
MAST_HEIGHT = 8.0
VEIL_CABLES = 40
VEIL_SPREAD = np.radians(55.0)
VEIL_REACH = 48.0
VEIL_WIDTH = 0.35
VEIL_DIRECTION = np.radians(200.0)
GANTRY_CLEARANCE = 2.5
GANTRY_LOW = 6.0
GANTRY_HIGH = 7.6
GANTRY_DEPTH = 1.0
GANTRY_PILLAR = 1.0
GANTRY_BRAND = 0
BRAND_ROWS = 4
BOARD_SPAN = 4.0
PANEL_SIZE = (3.2, 1.6)
PANEL_DEPTH = 0.35
LIGHT_COLUMNS = 5
LIGHT_ROWS = 4
LAMP_SIZE = 0.26


def frame(outline, toward):
    _, short = principal_axes(outline)
    facing = short if np.dot(short, toward) >= 0 else -short
    across = np.array([-facing[1], facing[0]])
    depth = outline @ facing
    length = outline @ across
    return facing, across, depth.min(), depth.max(), length.min(), length.max()


def at(facing, across, d, l):
    return facing * d + across * l


def stand(seats, concrete, roof, columns, data):
    outline = np.array(data["outline"])
    facing, across, back, front, left, right = frame(outline, np.asarray(data["facing"], float))
    base = data["base"]
    rows = int(np.clip((front - back) / ROW_DEPTH, MIN_ROWS, MAX_ROWS))
    depth = (front - back) / rows
    ends = (left, right)

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
        concrete.add([(*f0, low), (*f1, low), (*f1, low + ROW_RISE), (*f0, low + ROW_RISE)], UNIT)
    top = base + FRONT_WALL + rows * ROW_RISE
    b0, b1 = edge(back)
    concrete.add([(*b0, base), (*b1, base), (*b1, top), (*b0, top)], UNIT)
    for l in ends:
        p_front, p_back = at(facing, across, front, l), at(facing, across, back, l)
        concrete.add([(*p_front, base), (*p_back, base), (*p_back, top), (*p_front, base + FRONT_WALL)], UNIT)
    if not data["roof"]:
        return
    height = top + ROOF_CLEARANCE
    reach = back + (front - back) * ROOF_COVER
    r0, r1 = edge(back), edge(reach)
    roof.add([(*r0[0], height), (*r0[1], height), (*r1[1], height - 0.6), (*r1[0], height - 0.6)], UNIT)
    count = max(2, int((right - left) / COLUMN_SPACING) + 1)
    for l in np.linspace(left, right, count):
        foot = at(facing, across, back, l)
        beam(columns, np.array([*foot, base]), np.array([*foot, height]), COLUMN_SIZE)


def principal_axes(outline):
    centred = outline - outline.mean(axis=0)
    _, _, vectors = np.linalg.svd(centred, full_matrices=False)
    return vectors[0], vectors[1]


def pit_building(facade, concrete, roof, data):
    outline = np.array(data["outline"])
    long_axis, short_axis = principal_axes(outline)
    u = outline @ long_axis
    v = outline @ short_axis
    base, height = data["base"], data["height"]
    corners = [
        long_axis * u.min() + short_axis * v.min(),
        long_axis * u.max() + short_axis * v.min(),
        long_axis * u.max() + short_axis * v.max(),
        long_axis * u.min() + short_axis * v.max(),
    ]
    span = u.max() - u.min()
    for a, b, textured in ((0, 1, True), (1, 2, False), (2, 3, True), (3, 0, False)):
        pa, pb = corners[a], corners[b]
        target = facade if textured else concrete
        repeat = span / FACADE_METRES[0] if textured else 1
        target.add([(*pa, base), (*pb, base), (*pb, base + height), (*pa, base + height)], [(0, 0), (repeat, 0), (repeat, 1), (0, 1)])
    roof.add([(*c, base + height) for c in corners], UNIT)


def extrude(walls, roofs, data):
    outline = np.array(data["outline"])
    base, height = data["base"], data["height"]
    for a, b in zip(outline, np.roll(outline, -1, axis=0)):
        length = np.linalg.norm(b - a)
        walls.add([(*a, base), (*b, base), (*b, base + height), (*a, base + height)], [(0, 0), (length / 4, 0), (length / 4, height / 4), (0, height / 4)])
    roofs.add([(*p, base + height) for p in outline], [(0, 0)] * len(outline))


def tower(white, glass, data):
    x, y = data["position"]
    base = data["base"]
    meshes = []
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=TOWER_RADIUS, radius2=TOWER_RADIUS * 0.8, depth=TOWER_HEIGHT)
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector((x, y, base + TOWER_HEIGHT / 2)))
    result = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.25, radius2=0.05, depth=MAST_HEIGHT)
    bmesh.ops.translate(bm, verts=result["verts"], vec=Vector((x, y, base + TOWER_HEIGHT + MAST_HEIGHT / 2)))
    meshes.append(("tower column", bm, white))
    deck = bmesh.new()
    bmesh.ops.create_cone(deck, cap_ends=True, segments=32, radius1=DECK_RADIUS, radius2=DECK_RADIUS, depth=DECK_DEPTH)
    bmesh.ops.translate(deck, verts=deck.verts, vec=Vector((x, y, base + TOWER_HEIGHT - DECK_DEPTH / 2)))
    meshes.append(("tower deck", deck, glass))
    cables = Batch()
    for angle in VEIL_DIRECTION + np.linspace(-VEIL_SPREAD, VEIL_SPREAD, VEIL_CABLES):
        direction = np.array([np.cos(angle), np.sin(angle)])
        top = np.array([x, y]) + direction * DECK_RADIUS
        foot = np.array([x, y]) + direction * VEIL_REACH * (0.85 + 0.15 * np.cos(angle - VEIL_DIRECTION))
        beam(cables, np.array([*top, base + TOWER_HEIGHT - DECK_DEPTH]), np.array([*foot, base]), VEIL_WIDTH)
    for name, bm, material in meshes:
        data_mesh = bpy.data.meshes.new(name)
        bm.to_mesh(data_mesh)
        bm.free()
        data_mesh.materials.append(material)
        obj = bpy.data.objects.new(name, data_mesh)
        bpy.context.scene.collection.objects.link(obj)
    return cables


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
