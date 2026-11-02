import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy
import numpy as np
from mathutils import Vector

from baking import bleed, read_frame, use_cycles, write_png

CELL = (128, 256)
GRID = (8, 4)
FRAME_HEIGHT = 2.0
SAMPLES = 24
POSES = ("ready", "talking", "interact", "arms_folded", "hands_hips")
GENDERS = ("Male", "Female")
SKINS = {"Male": ("T_Superhero_Male_Ligh.png", "T_Superhero_Male_Dark.png"), "Female": ("T_Superhero_Female_Light_BaseColor.png", "T_Superhero_Female_Dark_BaseColor.png")}
HAIRS = ((0.03, 0.02, 0.014), (0.16, 0.09, 0.04), (0.5, 0.36, 0.16), (0.012, 0.012, 0.014))
SHIRT_LINE = 0.98
TROUSERS = ((0.03, 0.04, 0.07), (0.06, 0.05, 0.04), (0.2, 0.18, 0.15), (0.015, 0.015, 0.02))
SEED = 9


def image_node(nodes, path):
    node = nodes.new("ShaderNodeTexImage")
    node.image = bpy.data.images.load(str(path), check_existing=True)
    return node


def emission(name, build):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emit = nodes.new("ShaderNodeEmission")
    links.new(build(nodes, links), emit.inputs["Color"])
    links.new(emit.outputs[0], output.inputs["Surface"])
    return material


def occluded(nodes, links, colour_socket):
    occlusion = nodes.new("ShaderNodeAmbientOcclusion")
    occlusion.samples = 6
    occlusion.inputs["Distance"].default_value = 0.25
    multiply = nodes.new("ShaderNodeVectorMath")
    multiply.operation = "MULTIPLY"
    links.new(colour_socket, multiply.inputs[0])
    ramp = nodes.new("ShaderNodeMath")
    ramp.operation = "MULTIPLY_ADD"
    ramp.inputs[1].default_value = 0.55
    ramp.inputs[2].default_value = 0.45
    links.new(occlusion.outputs["AO"], ramp.inputs[0])
    links.new(ramp.outputs[0], multiply.inputs[1])
    return multiply.outputs[0]


def cloth_colour(trousers):
    def build(nodes, links):
        geometry = nodes.new("ShaderNodeNewGeometry")
        split = nodes.new("ShaderNodeSeparateXYZ")
        links.new(geometry.outputs["Position"], split.inputs[0])
        step = nodes.new("ShaderNodeMath")
        step.operation = "GREATER_THAN"
        step.inputs[1].default_value = SHIRT_LINE
        links.new(split.outputs["Z"], step.inputs[0])
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        links.new(step.outputs[0], mix.inputs["Factor"])
        mix.inputs["A"].default_value = (*trousers, 1.0)
        mix.inputs["B"].default_value = (0.86, 0.86, 0.86, 1.0)
        return occluded(nodes, links, mix.outputs["Result"])

    return build


def cloth_mask(nodes, links):
    geometry = nodes.new("ShaderNodeNewGeometry")
    split = nodes.new("ShaderNodeSeparateXYZ")
    links.new(geometry.outputs["Position"], split.inputs[0])
    step = nodes.new("ShaderNodeMath")
    step.operation = "GREATER_THAN"
    step.inputs[1].default_value = SHIRT_LINE
    links.new(split.outputs["Z"], step.inputs[0])
    return step.outputs[0]


def textured(path):
    def build(nodes, links):
        return occluded(nodes, links, image_node(nodes, path).outputs["Color"])

    return build


def flat(rgb):
    def build(nodes, links):
        colour = nodes.new("ShaderNodeRGB")
        colour.outputs[0].default_value = (*rgb, 1.0)
        return occluded(nodes, links, colour.outputs[0])

    return build


def black(nodes, links):
    colour = nodes.new("ShaderNodeRGB")
    colour.outputs[0].default_value = (0.0, 0.0, 0.0, 1.0)
    return colour.outputs[0]


def figure_mesh(data, key):
    triangles = data[f"{key}_tri"]
    uvs = data[f"{key}_uv"]
    vertices = triangles.reshape(-1, 3)
    faces = [(i * 3, i * 3 + 1, i * 3 + 2) for i in range(len(triangles))]
    mesh = bpy.data.meshes.new(key)
    mesh.from_pydata(vertices.tolist(), [], faces)
    layer = mesh.uv_layers.new(name="UVMap")
    loops = np.empty(len(mesh.loops), np.int32)
    mesh.loops.foreach_get("vertex_index", loops)
    layer.data.foreach_set("uv", uvs.reshape(-1, 2)[loops].astype(np.float32).ravel())
    return mesh


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :]
    root, build = Path(argv[0]), Path(argv[1])
    crew = root / "source" / "crew"
    out = root / "textures" / "baked"
    data = np.load(build / "crew_static.npz")
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj)
    scene = use_cycles(SAMPLES, *CELL)
    camera = bpy.data.cameras.new("people")
    camera.type = "ORTHO"
    camera.ortho_scale = FRAME_HEIGHT
    node = bpy.data.objects.new("people", camera)
    scene.collection.objects.link(node)
    scene.camera = node
    columns, rows = GRID
    atlas = np.zeros((CELL[1] * rows, CELL[0] * columns, 4), np.float32)
    mask = np.zeros_like(atlas)
    rng = np.random.default_rng(SEED)
    masks = {part: emission(f"mask {part}", cloth_mask if part == "cloth" else black) for part in ("cloth", "skin", "eyes", "hair")}
    scratch = build / "forest"
    scratch.mkdir(parents=True, exist_ok=True)
    for index in range(columns * rows):
        gender = GENDERS[index % 2]
        pose = POSES[(index // 2) % len(POSES)]
        skin = SKINS[gender][rng.integers(2)]
        colours = {
            "cloth": emission(f"cloth {index}", cloth_colour(TROUSERS[rng.integers(len(TROUSERS))])),
            "skin": emission(f"skin {index}", textured(crew / skin)),
            "eyes": emission(f"eyes {index}", textured(crew / "T_Eye_Brown.png")),
            "hair": emission(f"hair {index}", flat(HAIRS[rng.integers(len(HAIRS))])),
        }
        turn = rng.uniform(-0.5, 0.5) + (np.pi if index % 11 == 7 else 0.0)
        objects = {}
        for part in colours:
            mesh = figure_mesh(data, f"{gender}_{pose}_{part}")
            mesh.materials.append(colours[part])
            obj = bpy.data.objects.new(part, mesh)
            scene.collection.objects.link(obj)
            objects[part] = obj
        centre = Vector((0, 0, FRAME_HEIGHT / 2))
        eye = centre + Vector((np.sin(turn) * 5, -np.cos(turn) * 5, 0.5))
        node.location = eye
        node.rotation_euler = (centre - eye).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(scratch / "person_a.png")
        bpy.ops.render.render(write_still=True)
        frame = bleed(read_frame(scratch / "person_a.png"), 8)
        for part, obj in objects.items():
            obj.data.materials[0] = masks[part]
        scene.view_settings.view_transform = "Raw"
        scene.render.filepath = str(scratch / "person_m.png")
        bpy.ops.render.render(write_still=True)
        scene.view_settings.view_transform = "Standard"
        shape = bleed(read_frame(scratch / "person_m.png"), 8)
        row, column = index // columns, index % columns
        y, x = row * CELL[1], column * CELL[0]
        atlas[y : y + CELL[1], x : x + CELL[0]] = frame
        mask[y : y + CELL[1], x : x + CELL[0]] = shape
        for obj in objects.values():
            data_mesh = obj.data
            bpy.data.objects.remove(obj)
            bpy.data.meshes.remove(data_mesh)
    write_png(atlas, out / "people_albedo.png")
    write_png(mask, out / "people_mask.png")


if __name__ == "__main__":
    main()
