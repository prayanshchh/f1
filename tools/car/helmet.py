import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from design import HEAD, HEAD_RADIUS

WRAP = (4096, 1536)
WRAP_SPAN = 0.30
WRAP_SEAM = -1.62
TOP = 1024
TOP_SPAN = 0.30
VISOR_TOP = 0.165
GLOSS = 0.12
SHADOW = (8, 8, 10)
WHITE = (245, 245, 245)
DOT_SPACING = 0.0055
DOT_REACH = 0.05


def srgb(colour):
    return tuple(int(colour[i : i + 2], 16) for i in (1, 3, 5))


def to_linear(image):
    data = np.asarray(image, np.float32) / 255.0
    return np.where(data <= 0.04045, data / 12.92, ((data + 0.055) / 1.055) ** 2.4)


def wrap_column(angle):
    return ((angle - WRAP_SEAM) % (2 * math.pi)) / (2 * math.pi) * WRAP[0]


def wrap_row(height):
    return (WRAP_SPAN / 2 - height) / WRAP_SPAN * WRAP[1]


def metres(value):
    return value / WRAP_SPAN * WRAP[1]


def glyphs(mask, tall):
    image = Image.fromarray(np.uint8(np.clip(mask, 0, 1) * 255))
    width = max(1, int(round(image.width * tall / image.height)))
    return image.resize((width, max(1, int(round(tall)))), Image.LANCZOS)


def grow(layer, pixels):
    return layer.filter(ImageFilter.MaxFilter(pixels * 2 + 1)) if pixels > 0 else layer


def paint(canvas, layer, corner, colour, alpha=None):
    canvas.paste(Image.new(canvas.mode, layer.size, colour), corner, layer)
    if alpha is not None:
        alpha.paste(Image.new("L", layer.size, 255), corner, layer)


def stamp(canvas, mask, centre, tall, colour):
    image = glyphs(mask, tall)
    paint(canvas, image, (int(round(centre[0] - image.width / 2)), int(round(centre[1] - image.height / 2))), colour)


def badge(canvas, mask, centre, tall, colour, rim, rim_px, alpha=None):
    image = glyphs(mask, tall)
    margin = rim_px * 3
    shape = Image.new("L", (image.width + margin * 2, image.height + margin * 2), 0)
    shape.paste(image, (margin, margin))
    outer = grow(shape, rim_px * 2)
    shadow = Image.new("L", shape.size, 0)
    shadow.paste(outer, (rim_px, rim_px))
    corner = (int(round(centre[0] - shape.width / 2)), int(round(centre[1] - shape.height / 2)))
    for layer, colour_of in ((shadow, SHADOW), (outer, SHADOW), (grow(shape, rim_px), rim), (shape, colour)):
        paint(canvas, layer, corner, colour_of, alpha)


def swoosh(angle):
    return -0.012 - 0.034 * math.cos(angle) + 0.012 * math.sin(2 * angle)


def halftone(draw, columns, angles, colour):
    step = int(metres(DOT_SPACING))
    for c, a in zip(columns, angles):
        if c % step:
            continue
        edge = swoosh(a)
        for k in range(1, int(DOT_REACH / DOT_SPACING)):
            lift = k * DOT_SPACING
            radius = metres(DOT_SPACING) * 0.48 * (1 - lift / DOT_REACH) ** 1.3
            if radius < 1.5:
                break
            row = wrap_row(edge + lift + 0.012)
            shift = step / 2 if k % 2 else 0
            draw.ellipse([c + shift - radius, row - radius, c + shift + radius, row + radius], fill=colour)


def shards(draw, colour, light):
    for side in (1, -1):
        for k, (start, reach, lift) in enumerate(((2.45, 0.38, 0.050), (2.65, 0.32, 0.034), (2.85, 0.26, 0.020))):
            tip = side * (start - reach)
            root = side * start
            points = [
                (wrap_column(root), wrap_row(swoosh(root) + lift + 0.016)),
                (wrap_column(tip), wrap_row(swoosh(tip) + lift * 0.4 + 0.012)),
                (wrap_column(root), wrap_row(swoosh(root) + lift - 0.004)),
            ]
            draw.polygon(points, fill=light if k == 1 else colour)


def wrap_design(team, text_mask):
    colours = team["colours"]
    base, primary, light, accent = (srgb(colours[k]) for k in ("deep", "primary", "secondary", "accent"))
    title, partner, supplier, _ = team["sponsors"]
    driver = team["drivers"][0]
    canvas = Image.new("RGB", WRAP, base)
    draw = ImageDraw.Draw(canvas)
    columns = list(range(0, WRAP[0], 4))
    angles = [(c / WRAP[0]) * 2 * math.pi + WRAP_SEAM for c in columns]
    halftone(draw, columns, angles, primary)
    boundary = [(c, wrap_row(swoosh(a))) for c, a in zip(columns, angles)]
    band = [(c, wrap_row(swoosh(a) + 0.011)) for c, a in zip(columns, angles)]
    draw.polygon(band + [(WRAP[0], WRAP[1]), (0, WRAP[1])], fill=light)
    draw.polygon(boundary + [(WRAP[0], WRAP[1]), (0, WRAP[1])], fill=primary)
    for offset, width in ((0.0, 0.0022), (0.011, 0.0022), (0.016, 0.0012), (-0.006, 0.0012)):
        line = [(c, r - metres(offset)) for c, r in boundary]
        draw.line(line, fill=accent, width=max(2, int(metres(width))))
    shards(draw, accent, light)
    strip_top = wrap_row(VISOR_TOP * HEAD_RADIUS * 1.04 + 0.026)
    strip_bottom = wrap_row(VISOR_TOP * HEAD_RADIUS * 1.04 + 0.002)
    left, right = wrap_column(-1.2), wrap_column(1.2)
    draw.rectangle([left, strip_top, right, strip_bottom], fill=(14, 14, 16))
    draw.rectangle([left, strip_top - metres(0.002), right, strip_top], fill=accent)
    stamp(canvas, text_mask(title, weight=850, italic=0.12), (wrap_column(0.0), (strip_top + strip_bottom) / 2), metres(0.015), WHITE)
    number = text_mask(str(driver["number"]), weight=900, italic=0.1)
    for side in (1, -1):
        badge(canvas, number, (wrap_column(side * 1.72), wrap_row(0.018)), metres(0.05), light, accent, 6)
        stamp(canvas, text_mask(partner, weight=800), (wrap_column(side * 2.6), wrap_row(-0.048)), metres(0.010), WHITE)
        stamp(canvas, text_mask(supplier, weight=800), (wrap_column(side * 1.3), wrap_row(-0.080)), metres(0.008), WHITE)
    badge(canvas, text_mask(driver["code"], weight=900, italic=0.08), (wrap_column(math.pi), wrap_row(0.006)), metres(0.026), light, accent, 4)
    stamp(canvas, text_mask(team["name"].upper(), weight=850), (wrap_column(0.0), wrap_row(-0.086)), metres(0.011), WHITE)
    return to_linear(canvas)


def top_design(team, text_mask):
    colours = team["colours"]
    primary, light, accent = (srgb(colours[k]) for k in ("primary", "secondary", "accent"))
    driver = team["drivers"][0]
    canvas = Image.new("RGB", (TOP, TOP), (0, 0, 0))
    alpha = Image.new("L", (TOP, TOP), 0)
    scale = TOP / TOP_SPAN
    centre = TOP / 2
    draw = ImageDraw.Draw(canvas)
    mask = ImageDraw.Draw(alpha)
    for offset, width, colour in ((0.0, 0.026, primary), (0.0, 0.008, light), (0.017, 0.003, accent), (-0.017, 0.003, accent)):
        box = [centre + (offset - width / 2) * scale, 0, centre + (offset + width / 2) * scale, TOP]
        draw.rectangle(box, fill=colour)
        mask.rectangle(box, fill=255)
    for k in range(4):
        tip = centre - (0.02 + 0.022 * k) * scale
        arm = 0.024 * scale
        chevron = [(centre - arm, tip + arm * 0.9), (centre, tip), (centre + arm, tip + arm * 0.9)]
        draw.line(chevron, fill=accent, width=int(0.003 * scale), joint="curve")
        mask.line(chevron, fill=255, width=int(0.003 * scale), joint="curve")
    digits = text_mask(str(driver["number"]), weight=900, italic=0.1)
    badge(canvas, digits, (centre, centre + 0.035 * scale), 0.075 * scale, light, accent, 5, alpha=alpha)
    return to_linear(canvas), np.asarray(alpha, np.float32) / 255.0


def paint_helmet(atlas, team, text_mask, sample):
    where = atlas.where(r"^helmet")
    wrap = wrap_design(team, text_mask)
    top, top_alpha = top_design(team, text_mask)
    x, y, z = atlas.x[where], atlas.y[where], atlas.z[where]
    angle = np.arctan2(y, x - HEAD[0])
    u = ((angle - WRAP_SEAM) % (2 * math.pi)) / (2 * math.pi)
    v = (WRAP_SPAN / 2 - (z - HEAD[2])) / WRAP_SPAN
    side = np.stack([sample(wrap[..., c], u, v) for c in range(3)], -1)
    tu = 0.5 - y / TOP_SPAN
    tv = 0.5 - (x - HEAD[0]) / TOP_SPAN
    crown = np.stack([sample(top[..., c], tu, tv) for c in range(3)], -1)
    weight = sample(top_alpha, tu, tv) * np.clip((atlas.nz[where] - 0.55) / 0.25, 0, 1)
    colour = side + (crown - side) * weight[:, None]
    return where, colour, GLOSS
