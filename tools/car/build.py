import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import aero
import body
import cockpit
import details
import running
from cockpit import WHEEL_X, WHEEL_Z
from shapes import PARTS, material, to_blender

ATLAS = 8192
PADDING = 16
AO_SAMPLES = 64
AO_DISTANCE = 0.9


def arguments():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    out = Path(argv[0] if argv else "content/cars/vanta-26")
    work = Path(argv[1] if len(argv) > 1 else "build/car")
    bake = "--no-bake" not in argv
    return out, work, bake


def materials():
    material("body", (0.6, 0.6, 0.6), 0.3)
    material("cockpit", (0.03, 0.03, 0.035), 0.5)
    material("void", (0.004, 0.004, 0.005), 0.9)
    material("headrest", (0.005, 0.005, 0.006), 0.72)
    material("tyre", (0.02, 0.02, 0.021), 0.82)
    material("rim", (0.035, 0.035, 0.04), 0.32, 1.0)
    material("rim-dark", (0.012, 0.012, 0.014), 0.45, 0.6)
    material("wheel-nut", (0.75, 0.08, 0.04), 0.35, 1.0)
    material("brake", (0.025, 0.025, 0.025), 0.75)
    material("carbon-part", (0.018, 0.018, 0.02), 0.42)
    material("exhaust", (0.20, 0.17, 0.19), 0.36, 1.0)
    material("caliper", (0.42, 0.03, 0.02), 0.34, 0.6)
    material("titanium", (0.55, 0.53, 0.5), 0.35, 1.0)
    material("led-red", (0.3, 0.0, 0.0), 0.4, 0, (1.0, 0.02, 0.01), 3)
    material("led-green", (0.0, 0.2, 0.0), 0.3, 0, (0.15, 1.0, 0.2), 6)
    material("led-wheel-red", (0.2, 0.0, 0.0), 0.3, 0, (1.0, 0.05, 0.03), 6)
    material("led-purple", (0.1, 0.0, 0.2), 0.3, 0, (0.55, 0.2, 1.0), 6)
    material("wheel-carbon", (0.006, 0.006, 0.007), 0.42)
    material("wheel-metal", (0.35, 0.35, 0.37), 0.35, 1.0)
    material("wheel-rotary", (0.03, 0.03, 0.033), 0.4, 0.8)
    material("wheel-screen", (0.0, 0.0, 0.0), 0.15)
    material("grip", (0.025, 0.025, 0.027), 0.92)
    material("glove", (1.0, 1.0, 1.0), 0.94)
    material("suit", (0.05, 0.05, 0.055), 0.85)
    material("helmet", (0.8, 0.8, 0.8), 0.18)
    material("visor", (0.015, 0.018, 0.022), 0.05, 0.8)
    material("mirror-l", (0.8, 0.8, 0.8), 0.04, 1.0)
    material("mirror-r", (0.8, 0.8, 0.8), 0.04, 1.0)
    material("wheel-face", (0.02, 0.02, 0.022), 0.5)
    material("wheel-bezel", (0.012, 0.012, 0.014), 0.45, 0.6)
    material("wheel-cap", (0.02, 0.02, 0.022), 0.5)
    material("lens", (0.01, 0.01, 0.012), 0.08, 0.5)
    material("led-green-mark", (0.1, 0.7, 0.1), 0.5, 0, (0.3, 1.0, 0.2), 1.2)
    for name, colour in (
        ("btn-white", (0.8, 0.8, 0.78)),
        ("btn-yellow", (0.85, 0.65, 0.05)),
        ("btn-green", (0.05, 0.55, 0.15)),
        ("btn-blue", (0.05, 0.2, 0.7)),
        ("btn-red", (0.7, 0.03, 0.03)),
    ):
        material(name, colour, 0.28)


def island_bounds(obj):
    layer = obj.data.uv_layers.active.data
    uv = np.empty(len(layer) * 2, np.float32)
    layer.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    low = uv.min(axis=0)
    high = uv.max(axis=0)
    return low, high, uv


def fit(sizes, scale):
    pad = PADDING / ATLAS
    x = y = shelf = pad
    placed = {}
    for index, (w, h) in sizes:
        w *= scale
        h *= scale
        if x + w + pad > 1:
            x = pad
            y += shelf + pad
            shelf = 0
        if y + h + pad > 1:
            return None
        placed[index] = (x, y)
        x += w + pad
        shelf = max(shelf, h)
    return placed


def pack_atlas():
    parts = [p for p in PARTS if p["atlas"]]
    atlas = [p["object"] for p in parts]
    islands = [island_bounds(obj) for obj in atlas]
    sizes = sorted(
        [(i, tuple((high - low) * parts[i]["density"])) for i, (low, high, _) in enumerate(islands)],
        key=lambda item: -item[1][1],
    )
    low_scale, high_scale = 0.01, 2.0
    for _ in range(30):
        scale = (low_scale + high_scale) / 2
        if fit(sizes, scale):
            low_scale = scale
        else:
            high_scale = scale
    placed = fit(sizes, low_scale)
    for i, obj in enumerate(atlas):
        low, _, uv = islands[i]
        moved = (uv - low) * parts[i]["density"] * low_scale + np.array(placed[i])
        obj.data.uv_layers.active.data.foreach_set("uv", moved.astype(np.float32).ravel())
    print(f"atlas: {len(atlas)} islands, {low_scale * ATLAS:.0f} px/m")
    rects = []
    for i, obj in enumerate(atlas):
        low, high, _ = islands[i]
        size = (high - low) * parts[i]["density"] * low_scale
        rects.append({"name": obj.name, "x": float(placed[i][0]), "y": float(placed[i][1]), "w": float(size[0]), "h": float(size[1])})
    return atlas, low_scale, rects


def devices():
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    preferences = bpy.context.preferences.addons["cycles"].preferences
    preferences.compute_device_type = "METAL"
    preferences.get_devices()
    for device in preferences.devices:
        device.use = True
    scene.cycles.device = "GPU"


def bake_pass(atlas, name, kind, samples, setup, colorspace="Non-Color"):
    image = bpy.data.images.new(name, ATLAS, ATLAS, float_buffer=True, alpha=False)
    image.colorspace_settings.name = colorspace
    scene = bpy.context.scene
    scene.cycles.samples = samples
    scene.render.bake.margin = PADDING
    scene.render.bake.use_selected_to_active = False
    created = []
    for obj in atlas:
        for slot in obj.material_slots:
            if slot.material:
                tree = slot.material.node_tree
                node = tree.nodes.new("ShaderNodeTexImage")
                node.image = image
                tree.nodes.active = node
                created.append((tree, node))
    restore = setup(atlas)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in atlas:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = atlas[0]
    if kind == "AO":
        scene.world = scene.world or bpy.data.worlds.new("world")
        scene.world.light_settings.distance = AO_DISTANCE
    bpy.ops.object.bake(type=kind, margin=PADDING, use_clear=True)
    for tree, node in created:
        tree.nodes.remove(node)
    restore()
    pixels = np.empty(ATLAS * ATLAS * 4, np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    return pixels.reshape(ATLAS, ATLAS, 4)[..., :3]


def nothing(_atlas):
    return lambda: None


def emit_geometry(socket_name):
    def setup(atlas):
        changes = []
        seen = set()
        for obj in atlas:
            for slot in obj.material_slots:
                mat = slot.material
                if mat is None or mat in seen:
                    continue
                seen.add(mat)
                tree = mat.node_tree
                output = next(n for n in tree.nodes if n.type == "OUTPUT_MATERIAL")
                previous = output.inputs["Surface"].links[0].from_socket
                geometry = tree.nodes.new("ShaderNodeNewGeometry")
                emission = tree.nodes.new("ShaderNodeEmission")
                tree.links.new(geometry.outputs[socket_name], emission.inputs["Color"])
                tree.links.new(emission.outputs[0], output.inputs["Surface"])
                changes.append((tree, output, previous, geometry, emission))

        def restore():
            for tree, output, previous, geometry, emission in changes:
                tree.links.new(previous, output.inputs["Surface"])
                tree.nodes.remove(geometry)
                tree.nodes.remove(emission)

        return restore

    return setup


def merged_copy(atlas):
    copies = []
    for obj in atlas:
        duplicate = obj.copy()
        duplicate.data = obj.data.copy()
        bpy.context.scene.collection.objects.link(duplicate)
        copies.append(duplicate)
        obj.hide_render = True
    with bpy.context.temp_override(active_object=copies[0], selected_editable_objects=copies, object=copies[0]):
        bpy.ops.object.join()
    return copies[0]


def bake(atlas, work):
    devices()
    work.mkdir(parents=True, exist_ok=True)
    merged = merged_copy(atlas)
    target = [merged]
    np.save(work / "position.npy", bake_pass(target, "position", "EMIT", 1, emit_geometry("Position")))
    np.save(work / "normal.npy", bake_pass(target, "normal", "EMIT", 1, emit_geometry("Normal")))
    np.save(work / "ao.npy", bake_pass(target, "ao", "AO", AO_SAMPLES, nothing)[..., 0])
    mesh = merged.data
    bpy.data.objects.remove(merged)
    bpy.data.meshes.remove(mesh)
    for obj in atlas:
        obj.hide_render = False


def assemble():
    groups = {}
    for part in PARTS:
        groups.setdefault(part["group"], []).append(part["object"])
    pivots = {}
    root = bpy.data.objects.new("car", None)
    bpy.context.scene.collection.objects.link(root)
    origin = {}
    for spec in (running.FRONT, running.REAR):
        for corner, side in (("l", 1), ("r", -1)):
            name = f"wheel-{spec['name']}{corner}"
            origin[name] = to_blender([spec["x"], side * spec["y"], spec["radius"]])
            pivot = bpy.data.objects.new(name, None)
            bpy.context.scene.collection.objects.link(pivot)
            pivot.parent = root
            pivot.location = tuple(origin[name])
            pivots[name] = pivot
    for group, objects in groups.items():
        keep = objects[0]
        if len(objects) > 1:
            with bpy.context.temp_override(active_object=keep, selected_editable_objects=objects, object=keep):
                bpy.ops.object.join()
        keep.name = group
        keep.data.name = group
        if group.endswith("-spin"):
            parent = pivots[group[: -len("-spin")]]
            centre = origin[parent.name]
        elif group in pivots:
            keep.name = f"{group}-upright"
            parent = pivots[group]
            centre = origin[group]
        elif group == "steering-wheel":
            parent = root
            centre = to_blender([WHEEL_X, 0.0, WHEEL_Z])
        else:
            parent = root
            centre = np.zeros(3)
        vertices = np.empty(len(keep.data.vertices) * 3, np.float64)
        keep.data.vertices.foreach_get("co", vertices)
        keep.data.vertices.foreach_set("co", (vertices.reshape(-1, 3) - centre).ravel())
        keep.data.update()
        keep.parent = parent
        keep.location = tuple(centre) if parent is root else (0.0, 0.0, 0.0)


def export(out):
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out / "car.glb"),
        export_format="GLB",
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="NONE",
        export_extras=False,
        export_apply=False,
        export_draco_mesh_compression_enable=False,
    )


def main():
    out, work, should_bake = arguments()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials()
    body.build_body()
    aero.build_aero()
    running.build_running()
    cockpit.build_cockpit()
    details.build_details()
    atlas, scale, rects = pack_atlas()
    work.mkdir(parents=True, exist_ok=True)
    (work / "atlas.json").write_text(json.dumps({"size": ATLAS, "pixelsPerMetre": scale * ATLAS, "islands": rects}))
    if should_bake:
        bake(atlas, work)
    assemble()
    if "--save" in sys.argv:
        bpy.ops.wm.save_as_mainfile(filepath=str((work / "car.blend").resolve()))
    export(out)
    faces = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
    print(f"car: {faces} triangles -> {out / 'car.glb'} {math.floor((out / 'car.glb').stat().st_size / 1e6)} MB")


if __name__ == "__main__":
    main()
