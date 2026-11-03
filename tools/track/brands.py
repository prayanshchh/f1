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


def northwind(draw, fonts):
    text_at(draw, "NORTHWIND", font(fonts, "montserrat", 200, 800), "#ffffff", (2130, 250), 14)
    draw.ellipse([1040, 150, 1240, 350], outline="#58b4f2", width=30)


def voltara(draw, fonts):
    text_at(draw, "VOLTARA", font(fonts, "anton", 300), "#ffd400", (2130, 245), 18)
    draw.polygon([(1290, 110), (1230, 270), (1290, 270), (1250, 400), (1370, 220), (1310, 220), (1360, 110)], fill="#ffd400")


def aurenne(draw, fonts):
    text_at(draw, "AURENNE", font(fonts, "cinzel", 230, 700), "#ffffff", (2048, 245), 20)
    draw.rectangle([1450, 390, 2650, 400], fill="#9be3d6")


def kestrel(draw, fonts):
    text_at(draw, "KESTREL", font(fonts, "barlow", 340), "#ffffff", (2130, 240), 8)
    draw.polygon([(1250, 150), (1490, 240), (1340, 240), (1290, 370), (1250, 240), (1130, 210)], fill="#ffffff")


def marlowe(draw, fonts):
    text_at(draw, "MARLOWE", font(fonts, "oswald", 290, 700), "#efe6cf", (2080, 238), 22)
    draw.polygon([(1000, 380), (1140, 130), (1210, 250), (1260, 190), (1380, 380)], fill="#efe6cf")
    text_at(draw, "OUTFITTERS", font(fonts, "oswald", 70, 500), "#c9b98f", (3150, 310), 8)


def torqua(draw, fonts):
    text_at(draw, "TORQUA", font(fonts, "barlow", 360), "#ffffff", (2130, 236), 12)
    for x in (1040, 1150, 1260):
        draw.polygon([(x, 130), (x + 70, 130), (x + 150, 256), (x + 70, 382), (x, 382), (x + 80, 256)], fill="#9be03a")


def cordave(draw, fonts):
    text_at(draw, "CORDAVE RAIL", font(fonts, "anton", 260), "#ffffff", (2048, 230), 14)
    draw.rectangle([1150, 400, 2950, 414], fill="#e23b3b")
    draw.rectangle([1150, 432, 2950, 446], fill="#e23b3b")


def verdale(draw, fonts):
    text_at(draw, "VERDALE", font(fonts, "oswald", 300, 600), "#f4f1e4", (2150, 240), 26)
    draw.ellipse([1020, 130, 1260, 370], fill="#f4f1e4")
    draw.polygon([(1140, 160), (1220, 250), (1140, 340), (1060, 250)], fill="#3d6b2a")


def albaren(draw, fonts):
    text_at(draw, "ALBAREN AIR", font(fonts, "montserrat", 220, 800), "#ffffff", (2200, 245), 6)
    draw.ellipse([820, 116, 1100, 396], fill="#ffb347")
    draw.rectangle([760, 290, 1160, 306], fill="#2a8fd6")
    draw.rectangle([760, 330, 1160, 346], fill="#2a8fd6")


def nimbara(draw, fonts):
    text_at(draw, "NIMBARA CLOUD", font(fonts, "montserrat", 190, 700), "#14213d", (2300, 240), 4)
    for row, width in enumerate((260, 200, 140)):
        top = 150 + row * 80
        draw.rounded_rectangle([860, top, 860 + width, top + 52], radius=26, fill="#2f6fe0")


def maison(draw, fonts):
    width = text_at(draw, "MAISON LUCE", font(fonts, "cinzel", 220, 600), "#f2f2f2", (2048, 245), 22)
    for sign in (-1, 1):
        edge = 2048 + sign * (width / 2 + 90)
        draw.rectangle([min(edge, edge + sign * 420), 252, max(edge, edge + sign * 420), 258], fill="#f2f2f2")


def halden(draw, fonts):
    text_at(draw, "HALDEN", font(fonts, "oswald", 300, 700), "#ffffff", (1880, 238), 16)
    text_at(draw, "LOGISTICS", font(fonts, "oswald", 88, 400), "#ffe2cc", (2830, 300), 6)


BRANDS = [
    ("NORTHWIND", "#0b1d45", "#58b4f2", northwind),
    ("VOLTARA", "#111214", "#ffd400", voltara),
    ("AURENNE", "#0d6b6e", "#9be3d6", aurenne),
    ("KESTREL", "#a80f1a", "#ffffff", kestrel),
    ("MARLOWE", "#22402f", "#c9b98f", marlowe),
    ("TORQUA", "#18191b", "#9be03a", torqua),
    ("CORDAVE", "#34373d", "#e23b3b", cordave),
    ("VERDALE", "#3d6b2a", "#f4f1e4", verdale),
    ("ALBAREN", "#2a8fd6", "#ffb347", albaren),
    ("NIMBARA", "#eef1f5", "#2f6fe0", nimbara),
    ("MAISON", "#111113", "#f2f2f2", maison),
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
