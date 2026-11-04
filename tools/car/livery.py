import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from design import linear, use
from helmet import paint_helmet

CONTRAST = 0.22
FASTENER = 0.0055
STYLES = {}
DARK_TEXT = np.array([0.008, 0.008, 0.010])
LIGHT_TEXT = np.array([0.8, 0.81, 0.82])
LOD_ALBEDO = 2048
LOD_ORM = 1024
FONT = Path("apps/client/node_modules/@fontsource-variable/saira/files/saira-latin-wght-normal.woff2")
CARBON = np.array([0.018, 0.018, 0.021])
BLACK = np.array([0.008, 0.008, 0.010])
LABEL = np.array([0.86, 0.86, 0.84])
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


def mark_mask(kind, size):
    image = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(image)
    m = size
    if kind == 0:
        draw.ellipse((m * 0.06, m * 0.06, m * 0.94, m * 0.94), fill=255)
        draw.ellipse((m * 0.22, m * 0.22, m * 0.78, m * 0.78), fill=0)
        draw.ellipse((m * 0.38, m * 0.38, m * 0.62, m * 0.62), fill=255)
    elif kind == 1:
        for shift in (0.0, 0.34):
            draw.polygon([(m * (0.05 + shift), m * 0.08), (m * (0.30 + shift), m * 0.08), (m * (0.62 + shift), m * 0.5), (m * (0.30 + shift), m * 0.92), (m * (0.05 + shift), m * 0.92), (m * (0.37 + shift), m * 0.5)], fill=255)
    elif kind == 2:
        hexagon = [(m * (0.5 + 0.46 * np.cos(a)), m * (0.5 + 0.46 * np.sin(a))) for a in np.radians(np.arange(30, 390, 60))]
        draw.polygon(hexagon, fill=255)
        inner = [(m * (0.5 + 0.30 * np.cos(a)), m * (0.5 + 0.30 * np.sin(a))) for a in np.radians(np.arange(30, 390, 60))]
        draw.polygon(inner, fill=0)
        draw.rectangle((m * 0.18, m * 0.44, m * 0.82, m * 0.56), fill=255)
    else:
        for k in range(3):
            left = m * (0.04 + 0.30 * k)
            draw.polygon([(left + m * 0.16, m * 0.06), (left + m * 0.36, m * 0.06), (left + m * 0.20, m * 0.94), (left, m * 0.94)], fill=255)
    return image


def text_mask(text, height=256, weight=800, italic=0.18, pad=8):
    style = STYLES.get(text, {})
    weight = style.get("weight", weight)
    italic = style.get("italic", italic)
    if "mark" in style or style.get("boxed"):
        return styled_mask(text, height, weight, italic, pad, style)
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


def styled_mask(text, height, weight, italic, pad, style):
    plain = dict(STYLES.pop(text))
    try:
        words = text_mask(text, height, weight, 0.0, pad)
    finally:
        STYLES[text] = plain
    tall, wide = words.shape
    gap = int(tall * 0.18)
    mark = style.get("mark")
    side = int(tall * 0.92) if mark is not None else 0
    width = wide + (side + gap if mark is not None else 0)
    image = np.zeros((tall, width), np.float32)
    if mark is not None:
        top = (tall - side) // 2
        image[top : top + side, :side] = np.asarray(mark_mask(mark, side), np.float32) / 255.0
    image[:, width - wide :] = np.maximum(image[:, width - wide :], words)
    if style.get("boxed"):
        border = int(tall * 0.22)
        box = Image.new("L", (width + border * 2, tall + border * 2), 0)
        ImageDraw.Draw(box).rounded_rectangle((0, 0, box.width - 1, box.height - 1), radius=border, fill=255)
        plate = np.asarray(box, np.float32) / 255.0
        plate[border : border + tall, border : border + width] *= 1 - image
        image = plate
    if italic:
        shear = Image.fromarray(np.round(image * 255).astype(np.uint8))
        extra = int(shear.height * italic)
        wider = Image.new("L", (shear.width + extra, shear.height), 0)
        wider.paste(shear, (0, 0))
        wider = wider.transform(wider.size, Image.AFFINE, (1, italic, -italic * wider.height, 0, 1, 0), Image.BICUBIC)
        image = np.asarray(wider, np.float32) / 255.0
    return image


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
        self.regions = {}

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

    def region(self, pattern):
        if pattern not in self.regions:
            self.regions[pattern] = Region(self, self.where(pattern))
        return self.regions[pattern]


class Region:
    def __init__(self, atlas, mask):
        self.rows, self.cols = np.nonzero(mask)
        for name in ("x", "y", "z", "nx", "ny", "nz"):
            setattr(self, name, getattr(atlas, name)[self.rows, self.cols])


def surface_points(atlas, mask, spacing):
    rows, cols = np.nonzero(mask)
    if len(rows) == 0:
        return np.zeros((0, 3))
    points = np.stack([atlas.x[rows, cols], atlas.y[rows, cols], atlas.z[rows, cols]], axis=-1)
    _, first = np.unique(np.floor(points / spacing).astype(np.int64), axis=0, return_index=True)
    return points[np.sort(first)]


def fasteners(atlas, albedo, height, rough, points, region, radius=FASTENER):
    if len(points) == 0:
        return
    rows, cols = np.nonzero(region)
    query = np.stack([atlas.x[rows, cols], atlas.y[rows, cols], atlas.z[rows, cols]], axis=-1)
    distance, index = cKDTree(points).query(query, distance_upper_bound=radius)
    hit = np.isfinite(distance)
    rows, cols, distance, index = rows[hit], cols[hit], distance[hit], index[hit]
    offset = query[hit] - points[index]
    normal = np.stack([atlas.nx[rows, cols], atlas.ny[rows, cols], atlas.nz[rows, cols]], axis=-1)
    across = np.cross(normal, np.array([0.0, 0.0, 1.0]))
    flat = np.linalg.norm(across, axis=-1) < 0.3
    across[flat] = np.cross(normal[flat], np.array([1.0, 0.0, 0.0]))
    across /= np.maximum(np.linalg.norm(across, axis=-1, keepdims=True), 1e-9)
    r = distance / radius
    slot = (np.abs(np.sum(offset * across, axis=-1)) < radius * 0.14) & (r < 0.62)
    base = albedo[rows, cols]
    head = base * 0.5 + np.array([0.11, 0.11, 0.115])
    shade = np.where(r[:, None] > 0.72, base * 0.22, head)
    shade[slot] = base[slot] * 0.15
    albedo[rows, cols] = shade
    height[rows, cols] = np.where(r > 0.72, 0.18, np.where(slot, 0.3, 0.62))
    rough[rows, cols] = np.where(r > 0.72, rough[rows, cols], 0.36)


def louvres(atlas, albedo, height, rough, mask, rows_x, ys, length=0.15, half=0.0055):
    absy = np.abs(atlas.y)
    for start in rows_x:
        along = (atlas.x <= start) & (atlas.x >= start - length)
        taper = np.clip((start - atlas.x) / 0.02, 0, 1) * np.clip((atlas.x - start + length) / 0.02, 0, 1)
        for y in ys:
            gap = np.abs(absy - y)
            slot = mask & along & (gap < half * taper)
            lip = mask & along & (gap >= half * taper) & (gap < half * taper + 0.0028) & (absy > y)
            albedo[slot] = np.array([0.006, 0.006, 0.007])
            height[slot] = 0.08
            rough[slot] = 0.8
            albedo[lip] = albedo[lip] * 1.25 + 0.02
            height[lip] = 0.72


def icon(atlas, drawing, x, z, size, parts, facing=0.35):
    image = Image.new("L", (256, 256), 0)
    drawing(ImageDraw.Draw(image))
    mask = np.asarray(image, np.float32) / 255.0
    r = atlas.region(parts)
    for sign in (1, -1):
        u = 0.5 - sign * (r.x - x) / size
        v = 0.5 - (r.z - z) / size
        yield r, sample(mask, u, v) * (r.ny * sign > facing)


def safety_marks(atlas, albedo, x, z, parts):
    yellow = np.array(linear("#f2c200"))
    red = np.array(linear("#d81e1e"))

    def triangle(draw):
        draw.polygon([(128, 18), (240, 226), (16, 226)], fill=255)

    def inner(draw):
        draw.polygon([(128, 52), (210, 208), (46, 208)], fill=255)

    def bolt(draw):
        draw.polygon([(140, 70), (96, 150), (126, 150), (110, 206), (162, 120), (130, 120), (150, 70)], fill=255)

    def arrow(draw):
        draw.polygon([(20, 96), (150, 96), (150, 40), (240, 128), (150, 216), (150, 160), (20, 160)], fill=255)

    def label(draw):
        draw.rounded_rectangle([(8, 14), (248, 242)], radius=26, fill=255)

    lift = {arrow: 0.005, label: -0.004}
    for drawing, colour, at, size in ((triangle, BLACK, x, 0.050), (inner, yellow, x, 0.050), (bolt, BLACK, x, 0.050), (label, LABEL, x - 0.075, 0.078), (arrow, red, x - 0.075, 0.055)):
        for r, alpha in icon(atlas, drawing, at, z + lift.get(drawing, 0.0), size, parts):
            blend(albedo, r, colour, np.clip(alpha * (1.4 if drawing is triangle else 1.0), 0, 1))
    rescue = text_mask("RESCUE", weight=800)
    tall = 0.06 * rescue.shape[0] / rescue.shape[1]
    r = atlas.region(parts)
    for sign in (1, -1):
        u = 0.5 - sign * (r.x - (x - 0.075)) / 0.06
        v = 0.5 - (r.z - (z - 0.030)) / tall
        blend(albedo, r, red, sample(rescue, u, v) * (r.ny * sign > 0.35))


def blend(target, region, colour, alpha):
    keep = alpha > 1e-4
    if not keep.any():
        return None
    rows, cols, alpha = region.rows[keep], region.cols[keep], alpha[keep].astype(np.float32)
    pixels = target[rows, cols]
    if colour is None:
        bright = pixels @ np.array([0.2126, 0.7152, 0.0722], np.float32) > CONTRAST
        colour = np.where(bright[:, None], DARK_TEXT, LIGHT_TEXT)
    target[rows, cols] = pixels + (np.asarray(colour, np.float32) - pixels) * alpha[:, None]
    return rows, cols, alpha


def side_decal(atlas, albedo, height, text, x, z, length, colour, parts, side=None, weight=800, flat=0.25):
    mask = text_mask(text, weight=weight)
    tall = length * mask.shape[0] / mask.shape[1]
    r = atlas.region(parts)
    for sign in (1, -1) if side is None else (side,):
        direction = -sign
        u = 0.5 + direction * (r.x - x) / length
        v = 0.5 - (r.z - z) / tall
        done = blend(albedo, r, colour, sample(mask, u, v) * (r.ny * sign > flat))
        if done:
            height[done[0], done[1]] -= done[2] * 0.15


def top_decal(atlas, albedo, height, text, x, length, colour, parts, y=0.0, read_from_front=False, up=0.3, weight=800, angle=0.0):
    mask = text_mask(text, weight=weight)
    tall = length * mask.shape[0] / mask.shape[1]
    sign = -1 if read_from_front else 1
    r = atlas.region(parts)
    dx = r.x - x
    dy = r.y - y
    across = dy * np.cos(angle) - dx * np.sin(angle)
    along = dy * np.sin(angle) + dx * np.cos(angle)
    u = 0.5 - sign * across / length
    v = 0.5 - sign * along / tall
    blend(albedo, r, colour, sample(mask, u, v) * (r.nz > up))


def rear_decal(atlas, albedo, text, y, z, length, colour, parts, weight=800, facing=0.2):
    mask = text_mask(text, weight=weight)
    tall = length * mask.shape[0] / mask.shape[1]
    r = atlas.region(parts)
    u = 0.5 - (r.y - y) / length
    v = 0.5 - (r.z - z) / tall
    blend(albedo, r, colour, sample(mask, u, v) * (r.nx < -facing))


def upper_decal(atlas, albedo, text, y, x, length, colour, parts, weight=800, up=0.3):
    mask = text_mask(text, weight=weight)
    tall = length * mask.shape[0] / mask.shape[1]
    r = atlas.region(parts)
    u = 0.5 + (r.y - y) / length
    v = 0.5 + (r.x - x) / tall
    blend(albedo, r, colour, sample(mask, u, v) * (r.nz > up))


def along_decal(atlas, albedo, text, y, x, length, colour, parts, sign, weight=800):
    mask = text_mask(text, weight=weight)
    tall = length * mask.shape[0] / mask.shape[1]
    r = atlas.region(parts)
    u = 0.5 - sign * (r.x - x) / length
    v = 0.5 + sign * (r.y - y) / tall
    blend(albedo, r, colour, sample(mask, u, v) * (r.nz > 0.25))


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


def param_sweep(team):
    return team.get("design", {}).get("wingSweep", 0.30)


def paint(atlas, team):
    global LIGHT_TEXT, DARK_TEXT
    EMBER = np.array(linear(team["colours"]["primary"]))
    EMBER_DEEP = np.array(linear(team["colours"]["deep"]))
    PEARL = np.array(linear(team["colours"]["secondary"]))
    GOLD = np.array(linear(team["colours"]["accent"]))
    TITLE, PARTNER, SUPPLIER, ASSOCIATE = team["sponsors"]
    turn = sum(map(ord, team["id"])) % 4
    STYLES.clear()
    STYLES[TITLE] = {"mark": turn, "weight": 860, "italic": 0.18}
    STYLES[PARTNER] = {"mark": (turn + 1) % 4, "weight": 640, "italic": 0.0}
    STYLES[SUPPLIER] = {"weight": 900, "italic": 0.06}
    STYLES[ASSOCIATE] = {"weight": 600, "italic": 0.0, "boxed": True}
    TEAM = team["name"].upper()
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
    mirror_top = mirror & ((atlas.nz > 0.05) | ((np.abs(atlas.ny) > 0.8) & (absy > 0.6)))
    albedo[mirror_top] = EMBER
    carbon[mirror_top] = 0.0
    rough[mirror_top] = ROUGH_PAINT
    fin = atlas.where(r"^mirror-fin")
    rough[fin] = ROUGH_CARBON
    fin_accent = fin & (z < 0.650)
    albedo[fin_accent] = EMBER
    carbon[fin_accent] = 0.0
    rough[fin_accent] = ROUGH_PAINT

    helmet, colour, gloss = paint_helmet(atlas, team, text_mask, sample)
    albedo[helmet] = colour
    carbon[helmet] = 0.0
    rough[helmet] = gloss

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
    cover = chassis & (atlas.nz > 0.3) & (x < -0.62) & (x > -1.45) & (z > 0.30)
    spine = cover & (np.abs(absy - 0.095) < 0.0018)
    albedo[spine] *= 0.3
    height[spine] = 0.12
    shell = chassis | pods
    seams = [
        (chassis & (np.abs(x - 1.405) < 0.0015), chassis & (np.abs(x - 1.405) < FASTENER * 1.2), 0.055),
        (chassis & (np.abs(x - 0.905) < 0.0015) & (z > 0.22), chassis & (np.abs(x - 0.905) < FASTENER * 1.2), 0.06),
        (shell & (np.abs(x + 0.605) < 0.0015) & (z > 0.25), shell & (np.abs(x + 0.605) < FASTENER * 1.2), 0.055),
        (cover & (np.abs(absy - 0.11) < 0.0015), cover & (np.abs(absy - 0.11) < FASTENER * 1.2), 0.07),
    ]
    pod_line = 0.46 - 0.15 * np.clip((0.3 - x) / 2.0, 0, 1)
    seams.append((pods & (np.abs(z - pod_line + 0.012) < 0.0015) & (x < 0.25) & (x > -1.2), pods & (np.abs(z - pod_line + 0.012) < FASTENER * 1.2), 0.065))
    for line, region, spacing in seams:
        fasteners(atlas, albedo, height, rough, surface_points(atlas, line, spacing), region)
    louvres(atlas, albedo, height, rough, pods & (atlas.nz > 0.55) & (z > 0.33), (-0.47, -0.66), np.linspace(0.30, 0.45, 7))
    louvres(atlas, albedo, height, rough, chassis & (atlas.nz > 0.35) & (absy > 0.13) & (z > 0.40), (-0.98,), np.linspace(0.150, 0.215, 4), length=0.18, half=0.0045)
    slot = atlas.where(r"^nose-tip") & (atlas.nx > 0.25) & (absy < 0.024) & (np.abs(z - 0.139) < 0.0075)
    albedo[slot] = np.array([0.004, 0.004, 0.005])
    height[slot] = 0.05
    rough[slot] = 0.9
    edge = atlas.where(r"^fw-main") & (atlas.nz > -0.2) & (np.abs(x - (2.914 - param_sweep(team) * absy / 0.85)) < 0.010)
    albedo[edge] = GOLD
    carbon[edge] = 0.0
    rough[edge] = ROUGH_PAINT
    plate_edge = atlas.where(r"^rw-endplate") & (x < -2.40) & (z > 0.80)
    albedo[plate_edge] = GOLD
    carbon[plate_edge] = 0.0

    LIGHT_TEXT = np.array(linear(team.get("text", "#e7e8e9")))
    white = None
    side_decal(atlas, albedo, height, TEAM, -0.05, 0.445, 0.60, white, r"^sidepod")
    side_decal(atlas, albedo, height, TITLE, -0.70, 0.385, 0.44, white, r"^sidepod")
    side_decal(atlas, albedo, height, PARTNER, 1.28, 0.385, 0.40, white, r"^monocoque")
    side_decal(atlas, albedo, height, SUPPLIER, 2.00, 0.300, 0.24, white, r"^monocoque")
    side_decal(atlas, albedo, height, NUMBER, 0.28, 0.585, 0.17, white, r"^monocoque", weight=900)
    side_decal(atlas, albedo, height, NUMBER, -0.95, 0.53, 0.20, None, r"^monocoque", weight=900)
    side_decal(atlas, albedo, height, TEAM, -2.14, 0.845, 0.28, white, r"^rw-endplate\.", weight=900)
    side_decal(atlas, albedo, height, ASSOCIATE, -2.17, 0.715, 0.20, white, r"^rw-endplate\.")
    side_decal(atlas, albedo, height, team["chassis"], -1.10, 0.555, 0.11, white, r"^engine-fin", weight=900)
    side_decal(atlas, albedo, height, team["powerUnit"].upper(), -1.38, 0.47, 0.13, white, r"^engine-fin", weight=800)
    safety_marks(atlas, albedo, 0.70, 0.515, r"^monocoque")
    side_decal(atlas, albedo, height, TITLE, 2.36, 0.19, 0.30, white, r"^fw-endplate")
    side_decal(atlas, albedo, height, TEAM, 0.15, 0.10, 0.5, white, r"^inwash-1", weight=900)

    top_decal(atlas, albedo, height, NUMBER, 1.72, 0.20, white, r"^monocoque", read_from_front=True, weight=900)
    top_decal(atlas, albedo, height, TEAM, 2.62, 0.10, white, r"^monocoque", read_from_front=True, weight=900)
    top_decal(atlas, albedo, height, ASSOCIATE, 2.42, 0.13, white, r"^monocoque", read_from_front=True)
    top_decal(atlas, albedo, height, SUPPLIER, 2.20, 0.17, white, r"^monocoque", read_from_front=True)
    top_decal(atlas, albedo, height, PARTNER, 2.02, 0.19, white, r"^monocoque", read_from_front=True)
    top_decal(atlas, albedo, height, TITLE, 1.42, 0.26, white, r"^monocoque", read_from_front=True)
    top_decal(atlas, albedo, height, TEAM, 1.28, 0.20, white, r"^monocoque", read_from_front=True, weight=900)
    top_decal(atlas, albedo, height, TEAM, 1.00, 0.26, None, r"^monocoque", read_from_front=True, weight=900)
    top_decal(atlas, albedo, height, PARTNER, -0.75, 0.24, None, r"^(monocoque|sidepod)", weight=900)
    for side in (1, -1):
        top_decal(atlas, albedo, height, PARTNER, 0.05, 0.25, white, r"^sidepod", y=side * 0.47, up=0.55)
        top_decal(atlas, albedo, height, TITLE, 2.66, 0.26, white, r"^fw-main", y=side * 0.31, up=0.3, read_from_front=True, angle=side * 0.32)
        top_decal(atlas, albedo, height, PARTNER, 2.33, 0.17, white, r"^fw-flap1", y=side * 0.31, up=0.1, read_from_front=True, angle=side * 0.32)

    upper_decal(atlas, albedo, TITLE, 0.0, -2.03, 0.54, white, r"^rw-main")
    for sign in (1, -1):
        upper_decal(atlas, albedo, TEAM, sign * 0.33, -2.235, 0.17, white, r"^rw-flap\.", weight=900)
    for sign in (1, -1):
        top_decal(atlas, albedo, height, TITLE, 1.70, 0.215, white, r"^susp-upper-a", y=sign * 0.36, angle=sign * 0.26, up=-1)
        top_decal(atlas, albedo, height, PARTNER, 1.70, 0.20, white, r"^susp-lower-a", y=sign * 0.37, up=-1)
        along_decal(atlas, albedo, SUPPLIER, sign * 0.262, 0.46, 0.20, None, r"^monocoque", sign)
        along_decal(atlas, albedo, PARTNER, sign * 0.335, 0.12, 0.30, white, r"^monocoque", sign)
        upper_decal(atlas, albedo, TEAM, sign * 0.58, 0.665, 0.13, white, r"^mirror-housing", weight=900)
        upper_decal(atlas, albedo, TITLE, sign * 0.36, 0.695, 0.13, white, r"^mirror-housing")
    for x_pos, text, length in ((1.27, ASSOCIATE, 0.16), (2.05, TITLE, 0.17)):
        side_decal(atlas, albedo, height, text, x_pos, 0.47 if x_pos < 2 else 0.34, length, white, r"^monocoque")
    for sign in (1, -1):
        small_x = np.linspace(0.32, -1.10, 6)
        for k, mark in enumerate((NUMBER, NUMBER, TEAM, SUPPLIER, ASSOCIATE, PARTNER)):
            side_decal(atlas, albedo, height, mark, small_x[k], 0.30 + 0.02 * np.cos(k), 0.09, white, r"^sidepod", side=sign, weight=700)
    rear_decal(atlas, albedo, TEAM, 0.0, 0.875, 0.34, white, r"^rw-flap", weight=900)
    rear_decal(atlas, albedo, TITLE, 0.0, 0.770, 0.40, white, r"^rw-main", facing=0.05)

    for text, along, length in (
        (PARTNER, 0.24, 0.11),
        (TITLE, 0.385, 0.12),
        (TEAM, 0.5, 0.075),
        (SUPPLIER, 0.615, 0.10),
        (ASSOCIATE, 0.76, 0.10),
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


def main():
    team = use(sys.argv[1] if len(sys.argv) > 1 else "velza")
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
    print(f"livery: {team['id']} {atlas.size}px")


if __name__ == "__main__":
    main()
