import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector, noise

sys.path.insert(0, str(Path(__file__).resolve().parent))
from materials import flat_material, material

ATLAS_WIDTH = 2.0
ATLAS_HEIGHT = 2.2
HELMET_TILE = (0.86, 1.0)
HELMET_CENTRE = (0.0, 0.0, 1.705)
HEAD_CUT = 1.655
GLOVE_REACH = 0.69
BOOT_HEIGHT = 0.14
SUIT_SMOOTHING = 6
SUIT_INFLATE = 0.014
BOOT_INFLATE = 0.018
FOLD_STRENGTH = 0.007
SLEEVE_END = 0.44
NECK_LINE = 1.5
STATIC_CLOTH_RATIO = 0.14
STATIC_SKIN_RATIO = 0.22
STATIC_HAIR_RATIO = 0.35
STATIC_FACE_RATIO = 0.3
FPS = 24

UAL_CLIPS = {
    "Idle_Loop": "ready",
    "Jog_Fwd_Loop": "run",
    "Fixing_Kneeling": "gunner",
    "Idle_Talking_Loop": "talking",
    "Interact": "interact",
}
STATIC_POSES = (("ready", 12), ("talking", 20), ("interact", 16), ("arms_folded", 0), ("hands_hips", 0))
SPINE_SHARE = {"pelvis": 0.25, "spine_01": 0.45, "spine_02": 0.75, "spine_03": 1.0}
FINGERS = ("index", "middle", "ring", "pinky")
GRIP_CURL = (35, 50, 35)


def import_gltf(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return [o for o in bpy.data.objects if o not in before]


def character(source, name):
    objects = import_gltf(source / f"Superhero_{name}_FullBody.gltf")
    parts = {"arm": None, "body": None, "eyes": None, "brows": None}
    for obj in objects:
        if obj.type == "ARMATURE":
            parts["arm"] = obj
        elif obj.name.startswith("Icosphere"):
            bpy.data.objects.remove(obj)
        elif obj.name.startswith("Eyes"):
            parts["eyes"] = obj
        elif obj.name.startswith("Eyebrows"):
            parts["brows"] = obj
        elif obj.type == "MESH":
            parts["body"] = obj
    return parts


def bone_head(arm, name):
    return arm.data.bones[name].head_local.copy()


def body_position(obj, vertex):
    return obj.matrix_world @ vertex.co


def group_weights(obj):
    names = {g.index: g.name for g in obj.vertex_groups}
    return lambda vertex: {names[g.group]: g.weight for g in vertex.groups}


def wrinkle(co, arm):
    near = 0.0
    for name in ("lowerarm_l", "lowerarm_r", "calf_l", "calf_r", "pelvis", "upperarm_l", "upperarm_r", "spine_01"):
        near = max(near, max(0.0, 1.0 - (co - bone_head(arm, name)).length / 0.2))
    stretched = Vector((co.x * 7.0, co.y * 7.0, co.z * 24.0))
    return FOLD_STRENGTH * (0.3 + near) * noise.noise(stretched) * 2.0


def tailor(obj, arm):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    cloth = [v for v in bm.verts if abs(v.co.x) < GLOVE_REACH and v.co.z > BOOT_HEIGHT]
    for _ in range(SUIT_SMOOTHING):
        bmesh.ops.smooth_vert(bm, verts=cloth, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.normal_update()
    for vert in bm.verts:
        if abs(vert.co.x) >= GLOVE_REACH:
            vert.co += vert.normal * 0.002
        elif vert.co.z <= BOOT_HEIGHT:
            vert.co += vert.normal * BOOT_INFLATE
        else:
            vert.co += vert.normal * (SUIT_INFLATE + wrinkle(vert.co, arm))
    bm.to_mesh(obj.data)
    bm.free()


def project_uvs(data):
    while data.uv_layers:
        data.uv_layers.remove(data.uv_layers[0])
    layer = data.uv_layers.new(name="UVMap")
    for polygon in data.polygons:
        front = polygon.normal.y <= 0
        for loop_index in polygon.loop_indices:
            co = data.vertices[data.loops[loop_index].vertex_index].co
            across = co.x if front else -co.x
            u = (across / ATLAS_WIDTH + 0.5) * 0.5
            v = co.z / ATLAS_HEIGHT
            layer.data[loop_index].uv = (u + (0.0 if front else 0.5), v)


def keep_vertices(obj, keep):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep(v.co)], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()


def copy_object(obj, name):
    copy = obj.copy()
    copy.data = obj.data.copy()
    copy.name = name
    bpy.context.scene.collection.objects.link(copy)
    return copy


def decimate(obj, ratio):
    modifier = obj.modifiers.new("reduce", "DECIMATE")
    modifier.ratio = ratio
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    rig = [m for m in obj.modifiers if m.type == "ARMATURE"]
    for m in rig:
        m.show_viewport = False
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    reduced = bpy.data.meshes.new_from_object(obj.evaluated_get(graph), preserve_all_data_layers=True, depsgraph=graph)
    for m in rig:
        m.show_viewport = True
    obj.modifiers.remove(modifier)
    obj.data = reduced


def primitive(bm, kind, matrix, **options):
    if kind == "sphere":
        result = bmesh.ops.create_uvsphere(bm, u_segments=options.get("u", 14), v_segments=options.get("v", 10), radius=1.0)
    else:
        result = bmesh.ops.create_cone(bm, cap_ends=True, segments=options.get("u", 8), radius1=options["r0"], radius2=options["r1"], depth=options["depth"])
    bmesh.ops.transform(bm, matrix=matrix, verts=result["verts"])


def along(start, end):
    direction = end - start
    rotation = direction.to_track_quat("Z", "Y").to_matrix().to_4x4()
    return Matrix.Translation((start + end) / 2) @ rotation, direction.length


def make_helmet():
    centre = Vector(HELMET_CENTRE)
    shell = bmesh.new()
    primitive(shell, "sphere", Matrix.Translation(centre) @ Matrix.Diagonal((0.108, 0.126, 0.116, 1.0)), u=24, v=16)
    primitive(shell, "sphere", Matrix.Translation(centre + Vector((0, -0.03, -0.085))) @ Matrix.Diagonal((0.082, 0.095, 0.05, 1.0)), u=16, v=10)
    primitive(shell, "sphere", Matrix.Translation(centre + Vector((0, 0.045, -0.08))) @ Matrix.Diagonal((0.086, 0.07, 0.055, 1.0)), u=14, v=8)
    for sign in (1, -1):
        primitive(shell, "sphere", Matrix.Translation(centre + Vector((sign * 0.102, -0.005, -0.012))) @ Matrix.Diagonal((0.016, 0.036, 0.046, 1.0)), u=12, v=8)
    primitive(shell, "cone", Matrix.Translation(centre + Vector((0, 0.0, 0.113))) @ Matrix.Rotation(math.radians(90), 4, "X") @ Matrix.Diagonal((1.0, 0.35, 1.0, 1.0)), r0=0.02, r1=0.018, depth=0.14, u=8)
    shell_data = bpy.data.meshes.new("crew helmet")
    shell.to_mesh(shell_data)
    shell.free()
    for polygon in shell_data.polygons:
        polygon.use_smooth = True
    layer = shell_data.uv_layers.new(name="UVMap")
    v0, v1 = HELMET_TILE
    for polygon in shell_data.polygons:
        for loop_index in polygon.loop_indices:
            co = shell_data.vertices[shell_data.loops[loop_index].vertex_index].co - centre
            height = max(0.0, min(1.0, (co.z + 0.14) / 0.27))
            layer.data[loop_index].uv = (0.5, v0 + (v1 - v0) * height)
    visor = bmesh.new()
    primitive(visor, "sphere", Matrix.Translation(centre + Vector((0, -0.014, -0.002))) @ Matrix.Diagonal((0.103, 0.123, 0.078, 1.0)), u=24, v=10)
    bmesh.ops.delete(visor, geom=[v for v in visor.verts if v.co.y > centre.y - 0.02], context="VERTS")
    visor_data = bpy.data.meshes.new("crew visor")
    visor.to_mesh(visor_data)
    visor.free()
    for polygon in visor_data.polygons:
        polygon.use_smooth = True
    result = []
    for name, data in (("crew helmet", shell_data), ("crew visor", visor_data)):
        obj = bpy.data.objects.new(name, data)
        bpy.context.scene.collection.objects.link(obj)
        result.append((obj, "Head"))
    return result


def two_bone(root, target, upper, lower, hint):
    reach = target - root
    distance = min(reach.length, (upper + lower) * 0.999)
    direction = reach.normalized()
    along_axis = (upper * upper - lower * lower + distance * distance) / (2 * distance)
    height = math.sqrt(max(0.0, upper * upper - along_axis * along_axis))
    bend = (hint - direction * hint.dot(direction)).normalized()
    middle = root + direction * along_axis + bend * height
    return middle, root + direction * distance


def turn(axis, degrees):
    return Quaternion(axis, math.radians(degrees))


def rest_joints(arm):
    joints = {
        "hips": bone_head(arm, "pelvis"),
        "spine": bone_head(arm, "spine_01"),
        "chest": bone_head(arm, "spine_03"),
        "neck": bone_head(arm, "neck_01"),
    }
    for side, letter in (("L", "l"), ("R", "r")):
        joints[f"clavicle.{side}"] = bone_head(arm, f"clavicle_{letter}")
        joints[f"shoulder.{side}"] = bone_head(arm, f"upperarm_{letter}")
        joints[f"elbow.{side}"] = bone_head(arm, f"lowerarm_{letter}")
        joints[f"wrist.{side}"] = bone_head(arm, f"hand_{letter}")
        joints[f"tip.{side}"] = bone_head(arm, f"middle_01_{letter}")
        joints[f"hip.{side}"] = bone_head(arm, f"thigh_{letter}")
        joints[f"knee.{side}"] = bone_head(arm, f"calf_{letter}")
        joints[f"ankle.{side}"] = bone_head(arm, f"foot_{letter}")
    return joints


def world(forward, left, up):
    return Vector((left, -forward, up))


def solve_pose(arm, spec):
    joints = rest_joints(arm)
    deltas = {}
    lean = spec.get("lean", 0.0)
    forward_axis = Vector((1, 0, 0))
    up_axis = Vector((0, 0, 1))
    twist = spec.get("twist", 0.0)
    leaning = lambda amount: turn(up_axis, twist * amount) @ turn(forward_axis, lean * amount)
    hips = world(*spec["hips"])
    for name, share in SPINE_SHARE.items():
        deltas[name] = leaning(share)
    look = spec.get("look", 0.4)
    deltas["neck_01"] = leaning(1.0 - look)
    deltas["Head"] = leaning(1.0 - 2 * look)
    chest = hips + deltas["pelvis"] @ (joints["spine"] - joints["hips"])
    chest = chest + deltas["spine_01"] @ (joints["chest"] - joints["spine"])
    for side, letter, sign in (("L", "l", 1), ("R", "r", -1)):
        deltas[f"clavicle_{letter}"] = deltas["spine_03"]
        shoulder = chest + deltas["spine_03"] @ (joints[f"shoulder.{side}"] - joints["chest"])
        rest_upper = joints[f"elbow.{side}"] - joints[f"shoulder.{side}"]
        rest_lower = joints[f"wrist.{side}"] - joints[f"elbow.{side}"]
        rest_hand = joints[f"tip.{side}"] - joints[f"wrist.{side}"]
        hint = spec.get(f"elbow.{side}")
        pole = world(*hint) if hint else world(-0.5, sign * 0.6, -0.5)
        elbow, wrist = two_bone(shoulder, world(*spec[f"hand.{side}"]), rest_upper.length, rest_lower.length, pole)
        deltas[f"upperarm_{letter}"] = rest_upper.rotation_difference(elbow - shoulder)
        deltas[f"lowerarm_{letter}"] = rest_lower.rotation_difference(wrist - elbow)
        grip = spec.get(f"grip.{side}")
        hand = rest_hand.rotation_difference(world(*grip) if grip else wrist - elbow)
        deltas[f"hand_{letter}"] = hand
        curl_axis = Vector((0, sign, 0))
        for finger_name in FINGERS:
            current = hand
            for index, angle in enumerate(GRIP_CURL):
                current = current @ Quaternion(curl_axis, math.radians(angle))
                deltas[f"{finger_name}_0{index + 1}_{letter}"] = current
        hip = hips + deltas["pelvis"] @ (joints[f"hip.{side}"] - joints["hips"])
        ankle_height = joints[f"ankle.{side}"].z
        target = world(*spec[f"foot.{side}"]) + Vector((0, 0, ankle_height))
        rest_thigh = joints[f"knee.{side}"] - joints[f"hip.{side}"]
        rest_shin = joints[f"ankle.{side}"] - joints[f"knee.{side}"]
        knee_hint = spec.get(f"knee.{side}")
        knee_pole = world(*knee_hint) if knee_hint else world(1.0, sign * 0.15, 0.0)
        knee, ankle = two_bone(hip, target, rest_thigh.length, rest_shin.length, knee_pole)
        deltas[f"thigh_{letter}"] = rest_thigh.rotation_difference(knee - hip)
        deltas[f"calf_{letter}"] = rest_shin.rotation_difference(ankle - knee)
        deltas[f"foot_{letter}"] = turn(forward_axis, spec.get(f"toe.{side}", 0.0))
    return hips, deltas


def apply_pose(arm, spec, frame):
    hips, deltas = solve_pose(arm, spec)
    rest_hips = bone_head(arm, "pelvis")
    effective = {}
    for bone in arm.data.bones:
        parent = bone.parent
        parent_delta = effective.get(parent.name, Quaternion()) if parent else Quaternion()
        delta = deltas.get(bone.name, parent_delta)
        effective[bone.name] = delta
        pose_bone = arm.pose.bones[bone.name]
        rest = bone.matrix_local.to_quaternion()
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.rotation_quaternion = rest.inverted() @ parent_delta.inverted() @ delta @ rest
        pose_bone.keyframe_insert("rotation_quaternion", frame=frame)
        if bone.name == "pelvis":
            pose_bone.location = rest.inverted() @ (hips - rest_hips)
            pose_bone.keyframe_insert("location", frame=frame)


def stand(**extra):
    spec = {
        "hips": (0, 0, 0.95),
        "lean": 3,
        "hand.L": (0.06, 0.32, 0.98),
        "hand.R": (0.06, -0.32, 0.98),
        "foot.L": (0, 0.13, 0),
        "foot.R": (0, -0.13, 0),
    }
    spec.update(extra)
    return spec


def holding(forward, height, **extra):
    grip_l, grip_r = (0.5, -0.8, 0), (0.5, 0.8, 0)
    return stand(**{"hand.L": (forward, 0.3, height), "hand.R": (forward, -0.3, height), "grip.L": grip_l, "grip.R": grip_r}, **extra)


CLIPS = {
    "tyre_off": [
        (0, holding(0.5, 0.46, hips=(0.06, 0, 0.66), lean=44, **{"foot.L": (0.2, 0.2, 0), "foot.R": (-0.22, -0.2, 0)})),
        (12, holding(0.45, 0.62, hips=(0.02, 0, 0.74), lean=28, **{"foot.L": (0.2, 0.2, 0), "foot.R": (-0.22, -0.2, 0)})),
        (24, holding(0.36, 0.92, hips=(-0.06, 0, 0.9), lean=-6, **{"foot.L": (0.1, 0.16, 0), "foot.R": (-0.2, -0.16, 0)})),
    ],
    "tyre_on": [
        (0, holding(0.36, 0.92, hips=(-0.04, 0, 0.92), lean=-4, **{"foot.L": (0.1, 0.16, 0), "foot.R": (-0.14, -0.16, 0)})),
        (12, holding(0.46, 0.62, hips=(0.03, 0, 0.76), lean=28, **{"foot.L": (0.24, 0.2, 0), "foot.R": (-0.22, -0.2, 0)})),
        (24, holding(0.54, 0.44, hips=(0.1, 0, 0.64), lean=46, **{"foot.L": (0.3, 0.2, 0), "foot.R": (-0.2, -0.2, 0)})),
    ],
    "jack_front": [
        (0, stand(hips=(-0.14, 0, 0.86), lean=14, **{"hand.L": (0.34, 0.12, 0.96), "hand.R": (0.34, -0.12, 0.96), "foot.L": (0.2, 0.2, 0), "foot.R": (-0.34, -0.2, 0)})),
        (24, stand(hips=(-0.26, 0, 0.8), lean=-8, **{"hand.L": (0.24, 0.12, 0.66), "hand.R": (0.24, -0.12, 0.66), "foot.L": (0.2, 0.2, 0), "foot.R": (-0.46, -0.2, 0)})),
    ],
    "jack_rear": [
        (0, stand(hips=(-0.1, 0, 0.58), lean=44, **{"hand.L": (0.42, 0.12, 0.62), "hand.R": (0.42, -0.12, 0.62), "foot.L": (0.3, 0.22, 0), "foot.R": (-0.38, -0.18, 0)})),
        (24, stand(hips=(-0.16, 0, 0.52), lean=30, **{"hand.L": (0.34, 0.12, 0.44), "hand.R": (0.34, -0.12, 0.44), "foot.L": (0.3, 0.22, 0), "foot.R": (-0.44, -0.18, 0)})),
    ],
    "stabilise": [
        (0, stand(hips=(-0.1, 0, 0.82), lean=46, **{"hand.L": (0.56, 0.22, 0.62), "hand.R": (0.56, -0.22, 0.62), "foot.L": (0.16, 0.22, 0), "foot.R": (-0.38, -0.2, 0)})),
        (24, stand(hips=(-0.08, 0, 0.81), lean=48, **{"hand.L": (0.58, 0.22, 0.61), "hand.R": (0.58, -0.22, 0.61), "foot.L": (0.16, 0.22, 0), "foot.R": (-0.38, -0.2, 0)})),
    ],
    "signal": [
        (0, stand(hips=(0, 0.02, 0.94), **{"hand.R": (0.2, -0.26, 1.3), "elbow.R": (0.1, -1, -0.4)})),
        (24, stand(hips=(0, 0.02, 0.935), **{"hand.R": (0.22, -0.26, 1.33), "elbow.R": (0.1, -1, -0.4)})),
    ],
    "arms_folded": [
        (0, stand(lean=1, **{"hand.L": (0.18, -0.06, 1.26), "hand.R": (0.18, 0.06, 1.22), "elbow.L": (-0.2, 1, -0.4), "elbow.R": (-0.2, -1, -0.4)})),
    ],
    "hands_hips": [
        (0, stand(lean=-2, **{"hand.L": (0.03, 0.22, 1.06), "hand.R": (0.03, -0.22, 1.06), "elbow.L": (-0.4, 1, 0), "elbow.R": (-0.4, -1, 0), "foot.L": (0, 0.17, 0), "foot.R": (0, -0.17, 0)})),
    ],
}


def import_motion(source):
    objects = import_gltf(source / "UAL1_Standard.glb")
    kept = {}
    for action in list(bpy.data.actions):
        if action.name in UAL_CLIPS:
            action.name = UAL_CLIPS[action.name]
            action.use_fake_user = True
            kept[action.name] = action
        else:
            bpy.data.actions.remove(action)
    for obj in objects:
        bpy.data.objects.remove(obj)
    return kept


def make_clips(arm):
    arm.animation_data_create()
    for name, keys in CLIPS.items():
        action = bpy.data.actions.new(name)
        action.use_fake_user = True
        arm.animation_data.action = action
        for frame, spec in keys:
            apply_pose(arm, spec, frame)
    arm.animation_data.action = None


def use_action(arm, name):
    action = bpy.data.actions[name]
    arm.animation_data.action = action
    arm.animation_data.action_slot = action.slots[0]


def race_crew(parts, textures):
    arm, body = parts["arm"], parts["body"]
    tailor(body, arm)
    keep_vertices(body, lambda co: co.z < HEAD_CUT or abs(co.x) > 0.2)
    project_uvs(body.data)
    body.data.materials.clear()
    suit = material("crew suit", textures / "crew_suit_base_color.png", normal=textures / "crew_suit_normal.png")
    suit.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.72
    body.data.materials.append(suit)
    for name in ("eyes", "brows"):
        bpy.data.objects.remove(parts[name])
    shell = material("crew shell", textures / "crew_suit_base_color.png")
    shell.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.25
    visor = flat_material("crew visor", (0.012, 0.016, 0.022), 0.4, 0.06)
    for obj, bone in make_helmet():
        obj.data.materials.append(shell if obj.name == "crew helmet" else visor)
        group = obj.vertex_groups.new(name=bone)
        group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
        obj.parent = arm
        modifier = obj.modifiers.new("rig", "ARMATURE")
        modifier.object = arm


def hair_for(source, name, arm):
    objects = import_gltf(source / f"{name}.gltf")
    hair = None
    for obj in objects:
        if obj.type == "MESH" and obj.name.startswith("Hair"):
            hair = obj
    for obj in objects:
        if obj is not hair:
            bpy.data.objects.remove(obj)
    hair.parent = arm
    for modifier in hair.modifiers:
        if modifier.type == "ARMATURE":
            modifier.object = arm
    return hair


def static_figures(source, gender, hair_name):
    parts = character(source, gender)
    arm, body = parts["arm"], parts["body"]
    cloth = copy_object(body, "static cloth")
    tailor(cloth, arm)
    keep_vertices(cloth, lambda co: abs(co.x) < SLEEVE_END and co.z < NECK_LINE)
    project_uvs(cloth.data)
    skin = copy_object(body, "static skin")
    keep_vertices(skin, lambda co: co.z > NECK_LINE - 0.03 or abs(co.x) > SLEEVE_END - 0.03)
    hair = hair_for(source, hair_name, arm)
    decimate(cloth, STATIC_CLOTH_RATIO)
    decimate(skin, STATIC_SKIN_RATIO)
    decimate(hair, STATIC_HAIR_RATIO)
    decimate(parts["eyes"], STATIC_FACE_RATIO)
    decimate(parts["brows"], STATIC_FACE_RATIO)
    bpy.data.objects.remove(body)
    pieces = [(cloth, "cloth"), (skin, "skin"), (parts["eyes"], "eyes"), (parts["brows"], "hair"), (hair, "hair")]
    arrays = {}
    arm.animation_data_create()
    for pose, frame in STATIC_POSES:
        use_action(arm, pose)
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        graph = bpy.context.evaluated_depsgraph_get()
        groups = {}
        for obj, tag in pieces:
            mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(graph))
            mesh.calc_loop_triangles()
            layer = mesh.uv_layers.active.data
            matrix = obj.matrix_world
            bucket = groups.setdefault(tag, ([], []))
            for triangle in mesh.loop_triangles:
                bucket[0].append([tuple(matrix @ mesh.vertices[v].co) for v in triangle.vertices])
                bucket[1].append([tuple(layer[l].uv) for l in triangle.loops])
            bpy.data.meshes.remove(mesh)
        for tag, (triangles, uvs) in groups.items():
            arrays[f"{gender}_{pose}_{tag}_tri"] = np.array(triangles, np.float32)
            arrays[f"{gender}_{pose}_{tag}_uv"] = np.array(uvs, np.float32)
    arm.animation_data.action = None
    for obj, _ in pieces:
        bpy.data.objects.remove(obj)
    bpy.data.objects.remove(arm)
    return arrays


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    output = Path(argv[0] if argv else "content/tracks/hill-country/crew.glb")
    textures = Path(argv[1] if len(argv) > 1 else "build/hill-country/textures")
    source = Path("content/tracks/hill-country/source/crew").resolve()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    import_motion(source)
    statics = {}
    parts = character(source, "Male")
    make_clips(parts["arm"])
    parts["arm"].animation_data.action = None
    for gender, hair_name in (("Male", "Hair_Buzzed"), ("Female", "Hair_Buns")):
        statics.update(static_figures(source, gender, hair_name))
    np.savez(textures.parent / "crew_static.npz", **statics)
    race_crew(parts, textures)
    for action in bpy.data.actions:
        use_action(parts["arm"], action.name) if action.slots else None
    parts["arm"].animation_data.action = None
    if len(argv) > 2:
        return preview(parts["arm"], argv[2])
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        export_yup=True,
        export_skins=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_frame_step=2,
        export_image_format="AUTO",
        export_materials="EXPORT",
        use_selection=True,
    )
    total = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
    print(f"crew: {total} faces, {len(bpy.data.actions)} clips -> {output}")
    return None


def preview(arm, path):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 24
    scene.render.resolution_x, scene.render.resolution_y = 1400, 800
    world_data = bpy.data.worlds.new("sky")
    world_data.use_nodes = True
    world_data.node_tree.nodes["Background"].inputs[0].default_value = (0.7, 0.75, 0.8, 1.0)
    world_data.node_tree.nodes["Background"].inputs[1].default_value = 0.8
    scene.world = world_data
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.0
    sun_obj = bpy.data.objects.new("sun", sun)
    sun_obj.rotation_euler = (0.9, 0.2, 0.6)
    scene.collection.objects.link(sun_obj)
    plane = bpy.data.meshes.new("floor")
    plane.from_pydata([(-20, -20, 0), (20, -20, 0), (20, 20, 0), (-20, 20, 0)], [], [(0, 1, 2, 3)])
    scene.collection.objects.link(bpy.data.objects.new("floor", plane))
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.parent is arm]
    roles = ["ready", "run", "gunner", "tyre_off", "jack_front", "stabilise"]
    for index, role in enumerate(roles):
        clone_arm = arm.copy()
        clone_arm.animation_data_create()
        clone_arm.animation_data.action = bpy.data.actions[role]
        clone_arm.animation_data.action_slot = bpy.data.actions[role].slots[0]
        clone_arm.location = (index * 1.35 - 3.4, 0, 0)
        scene.collection.objects.link(clone_arm)
        for mesh in meshes:
            copy = mesh.copy()
            copy.parent = clone_arm
            for modifier in copy.modifiers:
                if modifier.type == "ARMATURE":
                    modifier.object = clone_arm
            scene.collection.objects.link(copy)
    for mesh in meshes:
        mesh.hide_render = True
    arm.hide_render = True
    camera = bpy.data.cameras.new("cam")
    camera.lens = 50
    cam = bpy.data.objects.new("cam", camera)
    cam.location = (0.0, -9.5, 1.3)
    cam.rotation_euler = (math.radians(85), 0, 0)
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.frame_set(10)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return None


if __name__ == "__main__":
    main()
