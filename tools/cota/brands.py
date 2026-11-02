from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

TILE = (4096, 512)
SEAM_SPACING = 1024
DIRT_HEIGHT = 0.22
SEED = 37
FONTS = {
    "anton": "ofl/anton/Anton-Regular.ttf",
    "oswald": "ofl/oswald/Oswald%5Bwght%5D.ttf",
    "playfair": "ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf",
    "montserrat": "ofl/montserrat/Montserrat%5Bwght%5D.ttf",
    "cinzel": "ofl/cinzel/Cinzel%5Bwght%5D.ttf",
    "barlow": "ofl/barlowcondensed/BarlowCondensed-BoldItalic.ttf",
}


def font(directory, name, size, weight=None):
    path = Path(directory) / f"{name}.ttf"
    face = ImageFont.truetype(str(path), size)
    if weight is not None:
        face.set_variation_by_axes([weight])
    return face


def text_at(draw, text, face, fill, centre, tracking=0):
    if tracking == 0:
        box = draw.textbbox((0, 0), text, font=face)
        draw.text((centre[0] - (box[0] + box[2]) / 2, centre[1] - (box[1] + box[3]) / 2), text, font=face, fill=fill)
        return box[2] - box[0]
    widths = [draw.textbbox((0, 0), c, font=face)[2] for c in text]
    total = sum(widths) + tracking * (len(text) - 1)
    box = draw.textbbox((0, 0), text, font=face)
    x = centre[0] - total / 2
    for c, w in zip(text, widths):
        draw.text((x, centre[1] - (box[1] + box[3]) / 2), c, font=face, fill=fill)
        x += w + tracking
    return total


def rose(draw, centre, radius, fill, points=8):
    cx, cy = centre
    for i in range(points * 2):
        angle = i * np.pi / points
        reach = radius if i % 2 == 0 else radius * 0.42
        next_angle = angle + np.pi / points
        next_reach = radius * 0.42 if i % 2 == 0 else radius
        draw.polygon([(cx, cy), (cx + np.cos(angle) * reach, cy + np.sin(angle) * reach), (cx + np.cos(next_angle) * next_reach, cy + np.sin(next_angle) * next_reach)], fill=fill)
    draw.ellipse([cx - radius * 0.26, cy - radius * 0.26, cx + radius * 0.26, cy + radius * 0.26], outline=fill, width=6)


def northwind(draw, fonts):
    text_at(draw, "NORTHWIND", font(fonts, "montserrat", 200, 800), "#ffffff", (2130, 250), 14)
    draw.ellipse([1040, 150, 1240, 350], outline="#58b4f2", width=30)


def voltara(draw, fonts):
    text_at(draw, "VOLTARA", font(fonts, "anton", 300), "#ffd400", (2130, 245), 18)
    draw.polygon([(1290, 110), (1230, 270), (1290, 270), (1250, 400), (1370, 220), (1310, 220), (1360, 110)], fill="#ffd400")


def aurelia(draw, fonts):
    text_at(draw, "AURELIA", font(fonts, "cinzel", 230, 700), "#ffffff", (2048, 245), 20)
    draw.rectangle([1450, 390, 2650, 400], fill="#9be3d6")


def kestrel(draw, fonts):
    text_at(draw, "KESTREL", font(fonts, "barlow", 340), "#ffffff", (2130, 240), 8)
    draw.polygon([(1250, 150), (1490, 240), (1340, 240), (1290, 370), (1250, 240), (1130, 210)], fill="#ffffff")


def marlowe(draw, fonts):
    width = text_at(draw, "MARLOWE", font(fonts, "playfair", 215, 700), "#ffffff", (2130, 195), 6)
    text_at(draw, "C R U I S E S", font(fonts, "cinzel", 66, 600), "#d6d3ef", (2130, 395), 34)
    rose(draw, (2130 - width / 2 - 170, 256), 130, "#ffffff")


def torqua(draw, fonts):
    text_at(draw, "TORQUA", font(fonts, "barlow", 390), "#d3111b", (2048, 232), 12)
    draw.rectangle([1250, 420, 2850, 445], fill="#101010")


def cardinal(draw, fonts):
    text_at(draw, "CARDINAL EXPRESS", font(fonts, "anton", 270), "#ffffff", (2048, 250), 14)


def verdant(draw, fonts):
    draw.rectangle([2048, 0, 4096, 512], fill="#0a5ea6")
    text_at(draw, "verdant", font(fonts, "montserrat", 250, 700), "#ffffff", (1024, 235))
    text_at(draw, "verdant", font(fonts, "montserrat", 250, 700), "#ffffff", (3072, 235))


def albatros(draw, fonts):
    text_at(draw, "ALBATROS AIR", font(fonts, "playfair", 240, 600), "#f4f0ea", (2100, 240), 12)
    draw.arc([700, 110, 980, 430], 200, 340, fill="#f4f0ea", width=26)
    draw.arc([540, 110, 820, 430], 200, 340, fill="#f4f0ea", width=26)


def cobalt(draw, fonts):
    text_at(draw, "cobalt.io", font(fonts, "montserrat", 260, 600), "#ffffff", (2150, 235))
    points = [(1240 + 130 * np.cos(a), 256 + 130 * np.sin(a)) for a in np.linspace(0, 2 * np.pi, 7)[:-1] + np.pi / 6]
    draw.polygon(points, outline="#62a8ff", width=24)
    text_at(draw, "C", font(fonts, "montserrat", 150, 700), "#62a8ff", (1240, 245))


def maison(draw, fonts):
    text_at(draw, "MAISON LUCE", font(fonts, "cinzel", 220, 600), "#e5c988", (2200, 245), 22)
    text_at(draw, "ML", font(fonts, "playfair", 290, 500), "#e5c988", (760, 235), -30)


def halden(draw, fonts):
    text_at(draw, "HALDEN", font(fonts, "oswald", 300, 700), "#ffffff", (1880, 238), 16)
    text_at(draw, "LOGISTICS", font(fonts, "oswald", 88, 400), "#ffe2cc", (2830, 300), 6)


BRANDS = [
    ("NORTHWIND", "#0b1d45", "#58b4f2", northwind),
    ("VOLTARA", "#111214", "#ffd400", voltara),
    ("AURELIA", "#0d6b6e", "#9be3d6", aurelia),
    ("KESTREL", "#a80f1a", "#ffffff", kestrel),
    ("MARLOWE", "#1c1650", "#3f3a8c", marlowe),
    ("TORQUA", "#f6c915", "#101010", torqua),
    ("CARDINAL", "#0d68ad", "#7fc3f2", cardinal),
    ("VERDANT", "#0a8a5c", "#c9efe0", verdant),
    ("ALBATROS", "#5a0b30", "#c7a07a", albatros),
    ("COBALT", "#0a1a38", "#2a64c8", cobalt),
    ("MAISON", "#1f2578", "#e5c988", maison),
    ("HALDEN", "#de5410", "#ffe2cc", halden),
]


def weather(panel, rng):
    width, height = TILE
    image = np.asarray(panel, np.float32) / 255.0
    blotch = np.asarray(Image.fromarray(np.uint8(rng.random((height // 16 + 1, width // 16 + 1)) * 255)).resize((width, height), Image.BICUBIC), np.float32) / 255.0
    grain = rng.normal(0, 0.012, (height, width))
    image = image * (0.975 + 0.05 * blotch)[..., None] + grain[..., None]
    ramp = np.clip((np.arange(height) / height - (1 - DIRT_HEIGHT)) / DIRT_HEIGHT, 0, 1)[:, None, None]
    image = image * (1 - 0.3 * ramp) + np.array([0.22, 0.2, 0.17], np.float32) * 0.3 * ramp
    for x in range(0, width, SEAM_SPACING):
        image[:, max(0, x - 2) : x + 2] *= 0.72
    return np.clip(image, 0, 1)


def boards(fonts):
    rng = np.random.default_rng(SEED)
    width, height = TILE
    atlas = np.empty((height * len(BRANDS), width, 3), np.float32)
    for index, (_, background, accent, art) in enumerate(BRANDS):
        panel = Image.new("RGB", TILE, background)
        draw = ImageDraw.Draw(panel)
        art(draw, fonts)
        draw.rectangle([0, 0, width, 16], fill=accent)
        draw.rectangle([0, height - 16, width, height], fill=accent)
        panel = panel.filter(ImageFilter.GaussianBlur(0.7))
        atlas[index * height : (index + 1) * height] = weather(panel, rng)
    return atlas
