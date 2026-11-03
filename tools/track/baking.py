import bpy
import numpy as np


def use_cycles(samples, width, height):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    preferences = bpy.context.preferences.addons["cycles"].preferences
    preferences.compute_device_type = "METAL"
    preferences.get_devices()
    for device in preferences.devices:
        device.use = True
    scene.cycles.device = "GPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 0
    scene.render.film_transparent = True
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.world = None
    return scene


def read_frame(path):
    image = bpy.data.images.load(str(path), check_existing=False)
    image.colorspace_settings.name = "Non-Color"
    width, height = image.size
    pixels = np.empty(width * height * 4, np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    return pixels.reshape(height, width, 4)[::-1]


def bleed(frame, rounds=16):
    alpha = frame[..., 3] > 0.02
    colour = frame[..., :3] * alpha[..., None]
    weight = alpha.astype(np.float32)
    for _ in range(rounds):
        total = np.zeros_like(colour)
        count = np.zeros_like(weight)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            total += np.roll(colour * weight[..., None], (dy, dx), (0, 1))
            count += np.roll(weight, (dy, dx), (0, 1))
        grow = (weight == 0) & (count > 0)
        colour[grow] = total[grow] / count[grow][..., None]
        weight[grow] = 1.0
    out = frame.copy()
    missing = ~alpha
    out[..., :3][missing] = colour[missing]
    return out


def write_png(array, path):
    height, width = array.shape[:2]
    image = bpy.data.images.new(path.stem, width, height, alpha=True)
    image.colorspace_settings.name = "Non-Color"
    image.pixels.foreach_set(array[::-1].ravel().astype(np.float32))
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)
