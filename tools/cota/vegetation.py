import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

TRUNK_HEIGHT = 3.0
TRUNK_RADIUS = (0.38, 0.24)
LIMBS = 2
CANOPY_BLOBS = 7
CANOPY_SPREAD = 4.6
CANOPY_BASE = 4.2
CANOPY_RISE = 2.4
BLOB_RADIUS = (2.3, 3.4)
BLOB_FLATTEN = 0.62
BLOB_JITTER = 0.35
SINK = 0.2


def cone(bm, start, end, radius_start, radius_end):
    direction = Vector(end) - Vector(start)
    result = bmesh.ops.create_cone(
        bm, cap_ends=False, segments=7, radius1=radius_start, radius2=radius_end, depth=direction.length
    )
    rotation = direction.to_track_quat("Z", "Y").to_matrix().to_4x4()
    centre = (Vector(start) + Vector(end)) / 2
    bmesh.ops.transform(bm, matrix=Matrix.Translation(centre) @ rotation, verts=result["verts"])


def trunk_mesh(name, rng):
    bm = bmesh.new()
    top = (0.0, 0.0, TRUNK_HEIGHT)
    cone(bm, (0.0, 0.0, -SINK), top, *TRUNK_RADIUS)
    for limb in range(LIMBS):
        angle = rng.uniform(0, 2 * np.pi) + limb * np.pi
        reach = rng.uniform(1.8, 2.8)
        end = (np.cos(angle) * reach, np.sin(angle) * reach, CANOPY_BASE + rng.uniform(0.2, 1.0))
        cone(bm, top, end, TRUNK_RADIUS[1], 0.09)
    data = bpy.data.meshes.new(name)
    bm.to_mesh(data)
    bm.free()
    return data


def canopy_mesh(name, rng):
    bm = bmesh.new()
    for _ in range(CANOPY_BLOBS):
        angle = rng.uniform(0, 2 * np.pi)
        distance = CANOPY_SPREAD * np.sqrt(rng.uniform(0, 1))
        centre = Vector((np.cos(angle) * distance, np.sin(angle) * distance, CANOPY_BASE + rng.uniform(0.6, CANOPY_RISE)))
        radius = rng.uniform(*BLOB_RADIUS)
        blob = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=radius)
        for vert in blob["verts"]:
            offset = Vector(rng.normal(0, BLOB_JITTER, 3))
            vert.co = Vector((vert.co.x, vert.co.y, vert.co.z * BLOB_FLATTEN)) + offset + centre
    data = bpy.data.meshes.new(name)
    bm.to_mesh(data)
    bm.free()
    for polygon in data.polygons:
        polygon.use_smooth = True
    return data


def forest(trees, variants, bark, leaves, seed):
    rng = np.random.default_rng(seed)
    shapes = []
    for variant in range(variants):
        trunk = trunk_mesh(f"oak trunk {variant}", rng)
        canopy = canopy_mesh(f"oak canopy {variant}", rng)
        trunk.materials.append(bark)
        canopy.materials.append(leaves)
        shapes.append((trunk, canopy))
    collection = bpy.context.scene.collection
    root = bpy.data.objects.new("forest", None)
    collection.objects.link(root)
    for index, (x, y, z, scale, rotation, variant) in enumerate(trees):
        for part, data in zip(("trunk", "canopy"), shapes[int(variant)]):
            obj = bpy.data.objects.new(f"oak {part} {index}", data)
            obj.location = (x, y, z)
            obj.rotation_euler = (0.0, 0.0, rotation)
            obj.scale = (scale, scale, scale)
            obj.parent = root
            collection.objects.link(obj)
    return len(trees)
