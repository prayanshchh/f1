import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import gaussian_filter

sys.path.insert(0, str(Path(__file__).resolve().parent))
from design import linear, use

CONTRAST = 0.22
DARK_TEXT = np.array([0.008, 0.008, 0.010])
LIGHT_TEXT = np.array([0.8, 0.81, 0.82])
LOD_ALBEDO = 2048
LOD_ORM = 1024
FONT = Path("apps/client/node_modules/@fontsource-variable/saira/files/saira-latin-wght-normal.woff2")
CARBON = np.array([0.018, 0.018, 0.021])
BLACK = np.array([0.008, 0.008, 0.010])
COCKPIT = np.array([0.022, 0.022, 0.025])
ROUGH_PAINT = 0.30
ROUGH_CARBON = 0.34
ROUGH_MATTE = 0.62
PAINTED = re.compile(r"^(monocoque|cockpit-pad|halo-collar|nose-tip|sidepod|inlet-lip|cockpit-rim|airbox-lip|halo-hoop|halo-pillar|mirror-housing|helmet|cockpit-winglet|engine-fin|roll-hoop-blade|rw-endplate|fw-endplate|fw-flap2|rw-flap|rw-main|t-cam)")
MATTE = re.compile(r"^(tub|floor$|floor\.|plank|diffuser)")


def font(size, weight=800):
    face = ImageFont.truetype(str(FONT), size)
    face.set_variation_by_axes([weight])
    return face


def text_mask(text, height=256, weight=800, italic=0.18, pad=8):
    face = font(height, weight)
    probe = Image.new("L", (8, 8))
    box = ImageDraw.Draw(probe).textbbox((0, 0), text, font=face)
    width = box[2] - box[0] + pad * 2 + int(height * italic)
    tall = box[3] - box[1] + pad * 2
    image = Image.new("L", (width, tall), 0)
    ImageDraw.Draw(image).text((pad - box[0], pad - box[1]), text, font=face, fill=255)
    if italic:
        image = image.transform(image.size, Image.AFFINE, (1, italic, -italic * tall, 0, 1, 0), Image.BICUBIC)
    return np.asarray(image, np.float32) / 255.0


def sample(mask, u, v):
    h, w = mask.shape
    x = u * (w - 1)
    y = v * (h - 1)
    x0 = np.clip(np.floor(x).astype(np.int32), 0, w - 2)
    y0 = np.clip(np.floor(y).astype(np.int32), 0, h - 2)
    fx = x - x0
    fy = y - y0
    top = mask[y0, x0] * (1 - fx) + mask[y0, x0 + 1] * fx
    low = mask[y0 + 1, x0] * (1 - fx) + mask[y0 + 1, x0 + 1] * fx
    return (top * (1 - fy) + low * fy) * ((u >= 0) & (u <= 1) & (v >= 0) & (v <= 1))


class Atlas:
    def __init__(self, work):
        info = json.loads((work / "atlas.json").read_text())
        self.size = info["size"]
        self.islands = info["islands"]
        position = np.load(work / "position.npy")
        normal = np.load(work / "normal.npy")
        self.x = -position[..., 1]
        self.y = position[..., 0]
        self.z = position[..., 2]
        self.nx = -normal[..., 1]
        self.ny = normal[..., 0]
        self.nz = normal[..., 2]
        self.ao = np.load(work / "ao.npy")
        self.part = np.full((self.size, self.size), -1, np.int32)
        for index, island in enumerate(self.islands):
            self.part[self.window(island)] = index
        for index, island in enumerate(self.islands):
            self.part[self.window(island, 1)] = index
        self.names = [i["name"] for i in self.islands]

    def window(self, island, grow=10):
        s = self.size
        return (
            slice(max(int(island["y"] * s) - grow, 0), min(int((island["y"] + island["h"]) * s) + grow + 1, s)),
            slice(max(int(island["x"] * s) - grow, 0), min(int((island["x"] + island["w"]) * s) + grow + 1, s)),
        )

    def where(self, pattern):
        regex = re.compile(pattern)
        chosen = np.array([bool(regex.match(n)) for n in self.names] + [False])
        return chosen[self.part]


def blend(target, colour, alpha):
    if colour is None:
        bright = target @ np.array([0.2126, 0.7152, 0.0722]) > CONTRAST
        colour = np.where(bright[..., None], DARK_TEXT, LIGHT_TEXT)
    target += (np.asarray(colour) - target) * alpha[..., None]


def side_decal(atlas, albedo, height, text, x, z, length, colour, parts, side=None, weight=800, flat=0.25):
    mask = text_mask(text, weight=weight)
    tall = length * mask.shape[0] / mask.shape[1]
    for sign in (1, -1) if side is None else (side,):
        direction = -sign
        u = 0.5 + direction * (atlas.x - x) / length
        v = 0.5 - (atlas.z - z) / tall
        alpha = sample(mask, u, v) * (atlas.ny * sign > flat) * atlas.where(parts)
        blend(albedo, colour, alpha)
        height -= alpha * 0.15


def top_decal(atlas, albedo, height, text, x, length, colour, parts, y=0.0, read_from_front=False, up=0.3, weight=800, angle=0.0):
    mask = text_mask(text, weight=weight)
    tall = length * mask.shape[0] / mask.shape[1]
    sign = -1 if read_from_front else 1
    dx = atlas.x - x
    dy = atlas.y - y
    across = dy * np.cos(angle) - dx * np.sin(angle)
    along = dy * np.sin(angle) + dx * np.cos(angle)
    u = 0.5 - sign * across / length
    v = 0.5 - sign * along / tall
    blend(albedo, colour, sample(mask, u, v) * (atlas.nz > up) * atlas.where(parts))


def rear_decal(atlas, albedo, text, y, z, length, colour, parts, weight=800, facing=0.2):
    mask = text_mask(text, weight=weight)
    tall = length * mask.shape[0] / mask.shape[1]
    u = 0.5 - (atlas.y - y) / length
    v = 0.5 - (atlas.z - z) / tall
    blend(albedo, colour, sample(mask, u, v) * (atlas.nx < -facing) * atlas.where(parts))


def upper_decal(atlas, albedo, text, y, x, length, colour, parts, weight=800, up=0.3):
    mask = text_mask(text, weight=weight)
    tall = length * mask.shape[0] / mask.shape[1]
    u = 0.5 + (atlas.y - y) / length
    v = 0.5 + (atlas.x - x) / tall
    blend(albedo, colour, sample(mask, u, v) * (atlas.nz > up) * atlas.where(parts))


def along_decal(atlas, albedo, text, y, x, length, colour, parts, sign, weight=800):
    mask = text_mask(text, weight=weight)
    tall = length * mask.shape[0] / mask.shape[1]
    u = 0.5 - sign * (atlas.x - x) / length
    v = 0.5 + sign * (atlas.y - y) / tall
    blend(albedo, colour, sample(mask, u, v) * (atlas.nz > 0.25) * atlas.where(parts))


def strip_decal(atlas, albedo, island_name, text, along, around, length, weight=800):
    island = next(i for i in atlas.islands if i["name"] == island_name)
    mask = text_mask(text, weight=weight)
    window = atlas.window(island, 0)
    s = atlas.size
    rows, cols = np.mgrid[window[0], window[1]]
    v = (rows + 0.5) / s
    u = (cols + 0.5) / s
    span_v = island["h"]
    span_u = island["w"]
    scale_v = (v - island["y"]) / span_v
    scale_u = (u - island["x"]) / span_u
    tall_uv = length * mask.shape[0] / mask.shape[1]
    a = 0.5 + (scale_v - along) / length
    b = 0.5 + (scale_u - around) / tall_uv
    albedo[window] += (LIGHT_TEXT - albedo[window]) * sample(mask, a, b)[..., None]


def scheme(team, atlas, body, wings_colour):
    x, y, z = atlas.x, atlas.y, atlas.z
    absy = np.abs(y)
    kind = team["pattern"]
    width = 0.012
    if kind == "deck":
        limit = np.interp(x, [-1.27, -1.10, -0.80, -0.40, 0.0, 0.50, 0.90, 1.10, 1.13], [0.0, 0.14, 0.30, 0.38, 0.38, 0.30, 0.19, 0.17, 0.0])
        top = atlas.nz > 0.15
        return body & top & (absy < limit), body & top & (np.abs(absy - (limit + 0.018)) < 0.006) & (x < 1.13) & (x > -1.30)
    if kind == "halfway":
        line = x + 0.9 * (z - 0.35) + 0.15
    elif kind == "spear":
        line = np.interp(x, [-2.1, -1.3, -0.4, 0.5, 1.4, 2.8], [0.03, 0.09, 0.2, 0.14, 0.075, 0.03]) - absy
        line = np.where(atlas.nz > -0.1, -line, 1.0)
    elif kind == "flank":
        line = z - (0.27 + 0.13 * np.clip(x + 0.3, -1.2, 1.8) * 0.5)
        line = np.where(absy > 0.05, line, 1.0)
    else:
        line = np.maximum(0.21 + 0.45 * np.clip(x - 0.55, -1.4, 0) * -0.1 - absy, np.abs(x + 0.1) - 0.68)
    return body & (line < 0), body & (np.abs(line) < width)


def paint(atlas, team):
    global LIGHT_TEXT, DARK_TEXT
    EMBER = np.array(linear(team["colours"]["primary"]))
    EMBER_DEEP = np.array(linear(team["colours"]["deep"]))
    PEARL = np.array(linear(team["colours"]["secondary"]))
    GOLD = np.array(linear(team["colours"]["accent"]))
    NORTHWIND, VOLTARA, KESTREL, AURELIA = team["sponsors"]
    VANTA = team["name"].upper()
    NUMBER = team["number"]
    x, y, z = atlas.x, atlas.y, atlas.z
    absy = np.abs(y)
    albedo = np.empty(x.shape + (3,), np.float32)
    albedo[...] = CARBON
    rough = np.full(x.shape, ROUGH_CARBON, np.float32)
    carbon = np.ones(x.shape, np.float32)
    height = np.ones(x.shape, np.float32) * 0.5

    painted = atlas.where(PAINTED.pattern)
    matte = atlas.where(MATTE.pattern)
    rough[matte] = ROUGH_MATTE
    albedo[atlas.where(r"^tub")] = COCKPIT

    chassis = atlas.where(r"^(monocoque|nose-tip|cockpit-winglet)")
    pods = atlas.where(r"^sidepod")
    sweep_line = 0.235 + 0.06 * np.clip((x - 0.3) / 1.8, -1, 1) + 0.10 * np.clip((0.2 - x) / 1.9, 0, 1) - 0.30 * np.clip((x - 1.25) / 0.5, 0, 1)
    upper_body = z > sweep_line
    colour = painted.copy()
    colour &= ~(chassis & ~upper_body)
    pod_cut = z > 0.285 - 0.085 * np.clip((0.3 - x) / 2.0, 0, 1) + 0.14 * np.clip((x + 0.2) / 0.5, 0, 1) * 0.3
    colour &= ~(pods & ~pod_cut)
    wings = atlas.where(r"^(rw-main|rw-flap|fw-flap2)")
    colour &= ~(wings & (atlas.nz < 0.1))
    colour &= ~atlas.where(r"^rw-flap")
    colour &= ~(atlas.where(r"^rw-main") & (x < -2.31))

    albedo[colour] = EMBER
    rough[colour] = ROUGH_PAINT
    carbon[colour] = 0.0
    wings = atlas.where(r"^(fw-main|fw-flap1|fw-flap2|fw-outer|fw-plane|fw-footplate|rw-main|rw-flap)")
    albedo[wings] = CARBON
    carbon[wings] = 1.0
    rough[wings] = 0.46
    if team["wings"] != "carbon":
        panels = atlas.where(r"^(fw-main|fw-flap2|fw-outer|rw-flap)") & (atlas.nz > 0.0)
        albedo[panels] = EMBER
        carbon[panels] = 0.0
        rough[panels] = ROUGH_PAINT

    fade = np.clip((x + 0.15) / 1.1, 0, 1)
    body = chassis | pods | atlas.where(r"^(engine-fin|roll-hoop-blade)")
    deep = body & colour
    albedo[deep] = (EMBER_DEEP[None] * (1 - fade[deep, None]) + EMBER[None] * fade[deep, None])

    cover, edge = scheme(team, atlas, body, EMBER)
    albedo[cover] = PEARL
    carbon[cover] = 0.0
    rough[cover] = ROUGH_PAINT
    albedo[edge] = PEARL if team["pattern"] == "deck" else GOLD
    carbon[edge] = 0.0
    rough[edge] = ROUGH_PAINT
    pinstripe = chassis & (np.abs(z - sweep_line) < 0.007)
    albedo[pinstripe] = GOLD
    carbon[pinstripe] = 0.0
    rough[pinstripe] = ROUGH_PAINT
    pod_line = pods & (np.abs(z - (0.285 - 0.085 * np.clip((0.3 - x) / 2.0, 0, 1) + 0.14 * np.clip((x + 0.2) / 0.5, 0, 1) * 0.3)) < 0.006)
    albedo[pod_line] = GOLD
    carbon[pod_line] = 0.0
    rough[pod_line] = ROUGH_PAINT

    halo = atlas.where(r"^halo")
    albedo[halo] = BLACK
    carbon[halo] = 0.0
    rough[halo] = 0.42
    albedo[atlas.where(r"^halo-hoop")] = BLACK
    inner_edge = atlas.where(r"^halo-hoop") & (atlas.nz < 0.25)
    carbon[inner_edge] = 1.0
    albedo[inner_edge] = CARBON
    albedo[atlas.where(r"^(halo-pillar|halo-collar)")] = EMBER
    rough[atlas.where(r"^(halo-pillar|halo-collar)")] = ROUGH_PAINT
    streak = atlas.where(r"^halo-pillar") & (np.abs(absy - (0.004 + 1.8 * np.clip(0.73 - x, 0, 0.2) ** 1.6)) < 0.0022) & (x < 0.73)
    albedo[streak] = BLACK
    hoop = next(i for i in atlas.islands if i["name"] == "halo-hoop")
    rows, cols = atlas.window(hoop, 0)
    grid_v, grid_u = np.mgrid[rows, cols]
    along_hoop = ((grid_v + 0.5) / atlas.size - hoop["y"]) / hoop["h"]
    around_hoop = ((grid_u + 0.5) / atlas.size - hoop["x"]) / hoop["w"]
    centre = np.abs(along_hoop - 0.5) < 0.085
    top_half = (around_hoop > 0.02) & (around_hoop < 0.48)
    window_albedo = albedo[rows, cols]
    window_albedo[centre & top_half] = EMBER
    window_carbon = carbon[rows, cols]
    window_carbon[centre & top_half] = 0.0
    carbon[rows, cols] = window_carbon
    albedo[rows, cols] = window_albedo

    albedo[atlas.where(r"^cockpit-pad")] = PEARL
    albedo[atlas.where(r"^(rw-endplate|fw-endplate)")] = BLACK
    rough[atlas.where(r"^(rw-endplate|fw-endplate)")] = 0.3
    upper_plate = atlas.where(r"^rw-endplate\.") & (z > 0.74)
    albedo[upper_plate] = EMBER
    plate_tip = atlas.where(r"^fw-endplate") & (z > 0.285)
    albedo[plate_tip] = EMBER

    mirror = atlas.where(r"^mirror-housing")
    albedo[mirror] = CARBON
    carbon[mirror] = 1.0
    rough[mirror] = ROUGH_CARBON
    mirror_top = mirror & (atlas.nz > 0.05)
    albedo[mirror_top] = EMBER
    carbon[mirror_top] = 0.0
    rough[mirror_top] = ROUGH_PAINT
    fin = atlas.where(r"^mirror-fin")
    rough[fin] = ROUGH_CARBON
    fin_accent = fin & (z < 0.650)
    albedo[fin_accent] = EMBER
    carbon[fin_accent] = 0.0
    rough[fin_accent] = ROUGH_PAINT

    helmet = atlas.where(r"^helmet")
    albedo[helmet] = np.array(linear(team.get("helmet", "#e7e8e9")))
    albedo[helmet & (np.abs(z - 0.768) < 0.03)] = EMBER
    albedo[helmet & (np.abs(y) < 0.018)] = EMBER
    albedo[helmet & (z > 0.813)] = GOLD
    carbon[helmet] = 0.0
    rough[helmet] = 0.2

    for joint in (1.42, 0.92):
        line = chassis & (np.abs(x - joint) < 0.0022)
        albedo[line] *= 0.25
        height[line] = 0.1
    cover_joint = (chassis | pods) & (np.abs(x + 0.62) < 0.0022) & (z > 0.25)
    albedo[cover_joint] *= 0.25
    height[cover_joint] = 0.1
    pod_joint = pods & (np.abs(z - (0.46 - 0.15 * np.clip((0.3 - x) / 2.0, 0, 1))) < 0.002)
    albedo[pod_joint] *= 0.35
    height[pod_joint] = 0.2
    fasteners = (chassis | pods) & (np.abs(np.mod(y + 0.03, 0.06) - 0.03) < 0.0035) & (np.abs(x - 0.92) < 0.012) & (np.abs(x - 0.92) > 0.0055)
    albedo[fasteners] = albedo[fasteners] * 0.45 + 0.08
    height[fasteners] = 0.35

    LIGHT_TEXT = np.array(linear(team.get("text", "#e7e8e9")))
    white = None
    side_decal(atlas, albedo, height, VANTA, -0.05, 0.445, 0.60, white, r"^sidepod")
    side_decal(atlas, albedo, height, NORTHWIND, -0.70, 0.385, 0.44, white, r"^sidepod")
    side_decal(atlas, albedo, height, VOLTARA, 1.28, 0.385, 0.40, white, r"^monocoque")
    side_decal(atlas, albedo, height, KESTREL, 2.00, 0.300, 0.24, white, r"^monocoque")
    side_decal(atlas, albedo, height, NUMBER, 0.28, 0.585, 0.17, white, r"^monocoque", weight=900)
    side_decal(atlas, albedo, height, NUMBER, -0.95, 0.53, 0.20, None, r"^monocoque", weight=900)
    side_decal(atlas, albedo, height, VANTA, -2.14, 0.845, 0.28, white, r"^rw-endplate\.", weight=900)
    side_decal(atlas, albedo, height, AURELIA, -2.08, 0.63, 0.20, white, r"^rw-endplate\.")
    side_decal(atlas, albedo, height, NORTHWIND, 2.36, 0.19, 0.30, white, r"^fw-endplate")
    side_decal(atlas, albedo, height, VANTA, 0.15, 0.10, 0.5, white, r"^inwash-1", weight=900)

    top_decal(atlas, albedo, height, NUMBER, 1.72, 0.20, white, r"^monocoque", read_from_front=True, weight=900)
    top_decal(atlas, albedo, height, VANTA, 2.62, 0.10, white, r"^monocoque", read_from_front=True, weight=900)
    top_decal(atlas, albedo, height, AURELIA, 2.42, 0.13, white, r"^monocoque", read_from_front=True)
    top_decal(atlas, albedo, height, KESTREL, 2.20, 0.17, white, r"^monocoque", read_from_front=True)
    top_decal(atlas, albedo, height, VOLTARA, 2.02, 0.19, white, r"^monocoque", read_from_front=True)
    top_decal(atlas, albedo, height, NORTHWIND, 1.42, 0.26, white, r"^monocoque", read_from_front=True)
    top_decal(atlas, albedo, height, VANTA, 1.28, 0.20, white, r"^monocoque", read_from_front=True, weight=900)
    top_decal(atlas, albedo, height, VANTA, 1.00, 0.26, None, r"^monocoque", read_from_front=True, weight=900)
    top_decal(atlas, albedo, height, VOLTARA, -0.75, 0.24, None, r"^(monocoque|sidepod)", weight=900)
    for side in (1, -1):
        top_decal(atlas, albedo, height, VOLTARA, 0.05, 0.25, white, r"^sidepod", y=side * 0.47, up=0.55)
        top_decal(atlas, albedo, height, NORTHWIND, 2.66, 0.26, white, r"^fw-main", y=side * 0.31, up=0.3, read_from_front=True, angle=side * 0.32)
        top_decal(atlas, albedo, height, VOLTARA, 2.33, 0.17, white, r"^fw-flap1", y=side * 0.31, up=0.1, read_from_front=True, angle=side * 0.32)

    upper_decal(atlas, albedo, NORTHWIND, 0.0, -2.03, 0.54, white, r"^rw-main")
    for sign in (1, -1):
        upper_decal(atlas, albedo, VANTA, sign * 0.33, -2.30, 0.17, white, r"^rw-flap", weight=900)
    for sign in (1, -1):
        top_decal(atlas, albedo, height, NORTHWIND, 1.70, 0.215, white, r"^susp-upper-a", y=sign * 0.36, angle=sign * 0.26, up=-1)
        top_decal(atlas, albedo, height, VOLTARA, 1.70, 0.20, white, r"^susp-lower-a", y=sign * 0.37, up=-1)
        along_decal(atlas, albedo, KESTREL, sign * 0.262, 0.46, 0.20, None, r"^monocoque", sign)
        along_decal(atlas, albedo, VOLTARA, sign * 0.335, 0.12, 0.30, white, r"^monocoque", sign)
        upper_decal(atlas, albedo, VANTA, sign * 0.58, 0.665, 0.13, white, r"^mirror-housing", weight=900)
        upper_decal(atlas, albedo, NORTHWIND, sign * 0.36, 0.695, 0.13, white, r"^mirror-housing")
    for x_pos, text, length in ((1.27, AURELIA, 0.16), (2.05, NORTHWIND, 0.17)):
        side_decal(atlas, albedo, height, text, x_pos, 0.47 if x_pos < 2 else 0.34, length, white, r"^monocoque")
    for sign in (1, -1):
        small_x = np.linspace(0.32, -1.10, 6)
        for k, mark in enumerate((NUMBER, NUMBER, VANTA, KESTREL, AURELIA, VOLTARA)):
            side_decal(atlas, albedo, height, mark, small_x[k], 0.30 + 0.02 * np.cos(k), 0.09, white, r"^sidepod", side=sign, weight=700)
    rear_decal(atlas, albedo, VANTA, 0.0, 0.875, 0.34, white, r"^rw-flap", weight=900)
    rear_decal(atlas, albedo, NORTHWIND, 0.0, 0.770, 0.40, white, r"^rw-main", facing=0.05)

    for text, along, length in (
        (VOLTARA, 0.24, 0.11),
        (NORTHWIND, 0.385, 0.12),
        (VANTA, 0.5, 0.075),
        (KESTREL, 0.615, 0.10),
        (AURELIA, 0.76, 0.10),
    ):
        strip_decal(atlas, albedo, "halo-hoop", text, along, 0.25, length, weight=850)

    occlusion = gaussian_filter(np.clip(atlas.ao, 0, 1), atlas.size / 1600) ** 1.15
    soot = np.clip((-x - 1.7) / 0.5, 0, 1) * np.clip(1 - np.abs(z - 0.38) / 0.25, 0, 1) * np.clip(1 - absy / 0.25, 0, 1)
    albedo *= 1 - 0.35 * soot[..., None]
    return albedo, rough, carbon, height, occlusion


def save_rgb(path, array, quality=92, gamma=True, size=None):
    data = np.clip(array, 0, 1)
    if gamma:
        data = np.where(data <= 0.0031308, data * 12.92, 1.055 * data ** (1 / 2.4) - 0.055)
    image = Image.fromarray(np.flipud(np.round(data * 255).astype(np.uint8)))
    if size:
        image = image.resize((size, size), Image.LANCZOS)
    image.save(path, quality=quality, subsampling=0)


def tyre_texture(out):
    width, height = 4096, 512
    image = Image.new("RGB", (width, height), (21, 21, 23))
    draw = ImageDraw.Draw(image)
    face = font(30, 800)
    small = font(15, 600)
    rows = height
    for sidewall, flip in ((0.20, False), (0.80, True)):
        y = int(rows * sidewall)
        for k in range(2):
            x = width * (k / 2 + 0.05)
            layer = Image.new("RGBA", (900, 90), (0, 0, 0, 0))
            layer_draw = ImageDraw.Draw(layer)
            layer_draw.text((10, 4), "KESTREL", font=face, fill=(208, 208, 208, 255))
            layer_draw.text((330, 16), "P RACE 18", font=small, fill=(208, 208, 208, 255))
            if flip:
                layer = layer.transpose(Image.FLIP_TOP_BOTTOM).transpose(Image.FLIP_LEFT_RIGHT)
            image.paste(layer, (int(x), y - 45), layer)
    array = np.asarray(image, np.float32) / 255.0
    rough = np.full(array.shape[:2], 0.82, np.float32)
    v = (np.arange(height, dtype=np.float32) + 0.5) / height
    tread = (v > 0.34) & (v < 0.66)
    array = array.copy()
    array[tread] *= 0.72
    rough[tread] = 0.62
    for centre in (0.30, 0.325, 0.675, 0.70):
        array[np.abs(v - centre) < 0.0035] *= 0.6
    Image.fromarray(np.round(array * 255).astype(np.uint8)).save(out / "shared" / "tyre.jpg", quality=90, subsampling=0)


def main():
    team = use(sys.argv[1] if len(sys.argv) > 1 else "vanta")
    work = Path(sys.argv[2] if len(sys.argv) > 2 else f"build/car/{team['id']}")
    root = Path("content/cars")
    out = root / team["id"]
    atlas = Atlas(work)
    albedo, rough, carbon, height, occlusion = paint(atlas, team)
    orm = np.stack([occlusion, rough, carbon], axis=-1)
    save_rgb(out / "albedo.jpg", albedo)
    save_rgb(out / "albedo-lod.jpg", albedo, size=LOD_ALBEDO)
    save_rgb(out / "orm.jpg", orm, gamma=False, size=4096)
    save_rgb(out / "orm-lod.jpg", orm, gamma=False, size=LOD_ORM)
    save_rgb(out / "bump.jpg", np.stack([height, height, height], axis=-1), gamma=False, size=4096, quality=88)
    tyre_texture(root)
    print(f"livery: {team['id']} {atlas.size}px")


if __name__ == "__main__":
    main()
