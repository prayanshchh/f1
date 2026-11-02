import math

import bmesh
import bpy
import numpy as np

SMOOTH_ANGLE = math.radians(38)
PARTS = []


def to_blender(points):
    points = np.asarray(points, np.float64)
    return np.stack([points[..., 1], -points[..., 0], points[..., 2]], axis=-1)


def interpolate(knots, values, samples):
    knots = np.asarray(knots, np.float64)
    values = np.asarray(values, np.float64)
    samples = np.asarray(samples, np.float64)
    order = np.argsort(knots)
    knots = knots[order]
    values = values[order]
    gaps = np.diff(knots)
    shape = (-1,) + (1,) * (values.ndim - 1)
    slopes = np.diff(values, axis=0) / gaps.reshape(shape)
    tangents = np.zeros_like(values)
    tangents[0] = slopes[0]
    tangents[-1] = slopes[-1]
    for i in range(1, len(knots) - 1):
        before = gaps[i - 1]
        after = gaps[i]
        tangents[i] = (after * slopes[i - 1] + before * slopes[i]) / (before + after)
    indices = np.clip(np.searchsorted(knots, samples, side="right") - 1, 0, len(knots) - 2)
    width = gaps[indices].reshape((-1,) + (1,) * (values.ndim - 1))
    t = ((samples - knots[indices]) / gaps[indices]).reshape((-1,) + (1,) * (values.ndim - 1))
    t2 = t * t
    t3 = t2 * t
    return (
        (2 * t3 - 3 * t2 + 1) * values[indices]
        + (t3 - 2 * t2 + t) * width * tangents[indices]
        + (-2 * t3 + 3 * t2) * values[indices + 1]
        + (t3 - t2) * width * tangents[indices + 1]
    )


def closed_curve(points, count):
    points = np.asarray(points, np.float64)
    size = len(points)
    wrapped = np.concatenate([points[-2:], points, points[:3]], axis=0)
    knots = np.arange(-2, size + 3, dtype=np.float64)
    samples = np.linspace(0, size, count, endpoint=False)
    return interpolate(knots, wrapped, samples)


def open_curve(points, count):
    points = np.asarray(points, np.float64)
    distances = np.linalg.norm(np.diff(points, axis=0), axis=-1)
    knots = np.concatenate([[0.0], np.cumsum(np.maximum(distances, 1e-6))])
    return interpolate(knots, points, np.linspace(0, knots[-1], count))


def superellipse(width, height, power, count, centre=(0.0, 0.0)):
    angles = np.linspace(0, 2 * math.pi, count, endpoint=False)
    c = np.cos(angles)
    s = np.sin(angles)
    return np.stack(
        [
            centre[0] + width * np.sign(c) * np.abs(c) ** (2 / power),
            centre[1] + height * np.sign(s) * np.abs(s) ** (2 / power),
        ],
        axis=-1,
    )


def material(name, color=(0.5, 0.5, 0.5), roughness=0.5, metallic=0.0, emissive=None, strength=0.0):
    found = bpy.data.materials.get(name)
    if found:
        return found
    created = bpy.data.materials.new(name)
    created.use_nodes = True
    node = created.node_tree.nodes["Principled BSDF"]
    node.inputs["Base Color"].default_value = (*color, 1)
    node.inputs["Roughness"].default_value = roughness
    node.inputs["Metallic"].default_value = metallic
    if emissive:
        node.inputs["Emission Color"].default_value = (*emissive, 1)
        node.inputs["Emission Strength"].default_value = strength
    return created


def register(obj, group, atlas, density=1.0):
    PARTS.append({"object": obj, "group": group, "atlas": atlas, "density": density})
    return obj


def create(name, vertices, faces, uvs, material_name, group, atlas, sharp_angle=SMOOTH_ANGLE, density=1.0):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(to_blender(vertices).tolist(), [], faces)
    mesh.update()
    layer = mesh.uv_layers.new(name="UVMap")
    flat = [uv for face_uvs in uvs for uv in face_uvs]
    layer.data.foreach_set("uv", np.asarray(flat, np.float32).ravel())
    mesh.materials.append(bpy.data.materials[material_name])
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.shade_smooth()
    mesh.set_sharp_from_angle(angle=sharp_angle)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return register(obj, group, atlas, density)


def lengths(rings):
    around = np.linalg.norm(np.diff(rings, axis=1), axis=-1).mean(axis=0)
    along = np.linalg.norm(np.diff(rings, axis=0), axis=-1).mean(axis=1)
    return around, along


def loft(name, rings, material_name="body", group="chassis", atlas=True, closed=True, caps=(True, True), sharp_angle=SMOOTH_ANGLE, density=1.0):
    rings = np.asarray(rings, np.float64)
    count, points = rings.shape[:2]
    vertices = rings.reshape(-1, 3)
    wrapped = np.concatenate([rings, rings[:, :1]], axis=1) if closed else rings
    around, along = lengths(wrapped)
    u = np.concatenate([[0.0], np.cumsum(around)])
    v = np.concatenate([[0.0], np.cumsum(along)])
    faces = []
    uvs = []
    span = points if closed else points - 1
    for i in range(count - 1):
        for j in range(span):
            k = (j + 1) % points
            faces.append([i * points + j, i * points + k, (i + 1) * points + k, (i + 1) * points + j])
            uvs.append([(u[j], v[i]), (u[j + 1], v[i]), (u[j + 1], v[i + 1]), (u[j], v[i + 1])])
    offset = u[-1] + 0.02
    for ring_index, wanted in ((0, caps[0]), (count - 1, caps[1])):
        if not wanted:
            continue
        ring = rings[ring_index]
        centre = ring.mean(axis=0)
        normal = np.cross(ring[points // 3] - centre, ring[2 * points // 3] - centre)
        normal /= max(np.linalg.norm(normal), 1e-9)
        axis = ring[0] - centre
        axis /= max(np.linalg.norm(axis), 1e-9)
        other = np.cross(normal, axis)
        flat = np.stack([(ring - centre) @ axis, (ring - centre) @ other], axis=-1)
        flat -= flat.min(axis=0)
        faces.append([ring_index * points + j for j in range(points)])
        uvs.append([(offset + p[0], p[1]) for p in flat])
        offset += flat[:, 0].max() + 0.02
    return create(name, vertices, faces, uvs, material_name, group, atlas, sharp_angle, density)


def mirror(rings):
    rings = np.array(rings, np.float64)
    rings[..., 1] *= -1
    return rings


def both(name, rings, **options):
    loft(f"{name}.l", rings, **options)
    loft(f"{name}.r", mirror(rings), **options)


def frames(path, up):
    path = np.asarray(path, np.float64)
    tangents = np.gradient(path, axis=0)
    tangents /= np.maximum(np.linalg.norm(tangents, axis=-1, keepdims=True), 1e-9)
    ups = np.broadcast_to(np.asarray(up, np.float64), tangents.shape)
    sides = np.cross(ups, tangents)
    sides /= np.maximum(np.linalg.norm(sides, axis=-1, keepdims=True), 1e-9)
    normals = np.cross(tangents, sides)
    return sides, normals


def sweep(path, width, height, power=2.0, points=20, up=(0, 0, 1)):
    path = np.asarray(path, np.float64)
    sides, normals = frames(path, up)
    width = np.broadcast_to(np.asarray(width, np.float64), (len(path),))
    height = np.broadcast_to(np.asarray(height, np.float64), (len(path),))
    profile = superellipse(1.0, 1.0, power, points)
    rings = []
    for i, centre in enumerate(path):
        rings.append(centre + width[i] * profile[:, 0, None] * sides[i] + height[i] * profile[:, 1, None] * normals[i])
    return np.asarray(rings)


def tube(name, control, width, height=None, power=2.0, samples=24, points=16, up=(0, 0, 1), **options):
    path = open_curve(control, samples) if len(control) > 2 else np.linspace(control[0], control[-1], samples)
    return loft(name, sweep(path, width, width if height is None else height, power, points, up), **options)


def tubes(name, control, width, height=None, **options):
    control = np.asarray(control, np.float64)
    tube(f"{name}.l", control, width, height, **options)
    flipped = control * np.array([1, -1, 1])
    tube(f"{name}.r", flipped, width, height, **options)


def airfoil(thickness, camber, points=28):
    half = points // 2
    x = 0.5 * (1 - np.cos(np.linspace(0, math.pi, half + 1)))
    t = 5 * thickness * (0.2969 * np.sqrt(x) - 0.126 * x - 0.3516 * x**2 + 0.2843 * x**3 - 0.1036 * x**4)
    c = camber * 4 * x * (1 - x)
    upper = np.stack([x, c + t], axis=-1)
    lower = np.stack([x, c - t], axis=-1)
    return np.concatenate([upper[::-1], lower[1:-1]], axis=0)


def wing_rings(stations, thickness=0.09, camber=0.07, points=28):
    profile = airfoil(thickness, camber, points)
    rings = []
    for station in stations:
        y, x, z, chord, pitch = station
        angle = math.radians(pitch)
        back = -profile[:, 0] * chord
        up = profile[:, 1] * chord
        px = x + back * math.cos(angle) + up * math.sin(angle)
        pz = z + back * math.sin(angle) * -1 + up * math.cos(angle)
        rings.append(np.stack([px, np.full(len(profile), y), pz], axis=-1))
    return np.asarray(rings)


def spanwise(stations, samples):
    stations = np.asarray(stations, np.float64)
    return interpolate(stations[:, 0], stations, np.linspace(stations[0, 0], stations[-1, 0], samples))


def wing(name, stations, samples=48, thickness=0.09, camber=0.07, points=28, sides=True, **options):
    rings = wing_rings(spanwise(stations, samples), thickness, camber, points)
    if sides:
        both(name, rings, **options)
    else:
        loft(name, rings, **options)


def plate(name, outline, y, thickness, side=None, samples=96, lean=None, **options):
    outline = np.asarray(outline, np.float64)
    path = closed_curve(outline, samples)
    half = thickness / 2
    bevel = half * 0.5
    offsets = [(-half, 0.992), (-half + bevel, 1.0), (half - bevel, 1.0), (half, 0.992)]
    centre = path.mean(axis=0)
    rings = []
    for offset, scale in offsets:
        flat = centre + (path - centre) * scale
        ys = np.full(len(path), y + offset)
        if lean is not None:
            ys = ys + lean(flat[:, 0], flat[:, 1])
        rings.append(np.stack([flat[:, 0], ys, flat[:, 1]], axis=-1))
    rings = np.asarray(rings)
    if side is None:
        both(name, rings, sharp_angle=math.radians(50), **options)
    else:
        loft(name, rings if side > 0 else mirror(rings), sharp_angle=math.radians(50), **options)


def lathe(name, profile, centre, axis_width=1.0, segments=96, sign=1.0, **options):
    profile = np.asarray(profile, np.float64)
    angles = np.linspace(0, 2 * math.pi, segments, endpoint=False)
    rings = []
    for offset, radius in profile:
        rings.append(
            np.stack(
                [
                    centre[0] + radius * np.cos(angles),
                    np.full(segments, centre[1] + sign * offset * axis_width),
                    centre[2] + radius * np.sin(angles),
                ],
                axis=-1,
            )
        )
    return loft(name, np.asarray(rings), **options)


def box(name, low, high, **options):
    low = np.asarray(low, np.float64)
    high = np.asarray(high, np.float64)
    ring = lambda x: np.array([[x, low[1], low[2]], [x, high[1], low[2]], [x, high[1], high[2]], [x, low[1], high[2]]])
    return loft(name, np.stack([ring(low[0]), ring(high[0])]), sharp_angle=math.radians(30), **options)
