import bpy


def flat_material(name, rgb, metallic, roughness):
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def material(name, color, roughness=None, normal=None, metallic=0.0, alpha=False):
    mat = bpy.data.materials.new(name)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Metallic"].default_value = metallic
    image = nodes.new("ShaderNodeTexImage")
    image.image = bpy.data.images.load(str(color))
    links.new(image.outputs["Color"], bsdf.inputs["Base Color"])
    if alpha:
        links.new(image.outputs["Alpha"], bsdf.inputs["Alpha"])
    if roughness is not None:
        rough = nodes.new("ShaderNodeTexImage")
        rough.image = bpy.data.images.load(str(roughness))
        rough.image.colorspace_settings.name = "Non-Color"
        split = nodes.new("ShaderNodeSeparateColor")
        links.new(rough.outputs["Color"], split.inputs["Color"])
        links.new(split.outputs["Green"], bsdf.inputs["Roughness"])
    else:
        bsdf.inputs["Roughness"].default_value = 0.9
    if normal is not None:
        nor = nodes.new("ShaderNodeTexImage")
        nor.image = bpy.data.images.load(str(normal))
        nor.image.colorspace_settings.name = "Non-Color"
        map_node = nodes.new("ShaderNodeNormalMap")
        links.new(nor.outputs["Color"], map_node.inputs["Color"])
        links.new(map_node.outputs["Normal"], bsdf.inputs["Normal"])
    return mat
