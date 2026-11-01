import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from palette import PALETTE, PALETTE_CELLS

GRASS_HUE = 0.25
GRASS_SATURATION = 1.5
GRASS_VALUE = 0.7
RUNOFF_GREEN = np.array([0.16, 0.46, 0.25])
KERB_SIZE = (512, 1024)
FONT = Path("apps/client/node_modules/@fontsource-variable/saira/files/saira-latin-wght-normal.woff2")
BOARD = (2048, 512)
BRANDS = [
    ("NORTHWIND", "#0b1d45", "#ffffff", "#3fa9f5"),
    ("VOLTARA", "#111111", "#ffd400", "#ffd400"),
    ("AURELIA", "#0d6b6e", "#ffffff", "#9be3d6"),
    ("KESTREL", "#b0101c", "#ffffff", "#ffffff"),
]
CHAINLINK = 256
CHAINLINK_WIRE = 22
CHAINLINK_COLOUR = (150, 154, 160)
DECAL = (2048, 512)
DECAL_WEAR = 0.22
DISTANCES = ("300", "200", "100")
PALETTE_SIZE = 256
TEAMS = ["ATLAS", "CINDER", "HALCYON", "MERIDIAN", "NOVARA", "ORIEL", "QUILL", "RAVENNA", "SOLACE", "TEMPESTA"]
DRIVERS = ["A. VANCE", "L. MORO", "T. HALE", "J. SATO", "R. BEKK", "M. ORTIZ", "D. KANE", "S. ILIC", "C. WEBB", "N. ARNO", "E. LUND", "P. ROSSI", "K. DARA", "H. FINN", "B. OKAFOR", "G. MARSH", "I. NOVAK", "F. TERZI", "O. BRANDT", "V. KIRAN"]
FASCIA_GRID = (4, 7)
FASCIA_TILE = (512, 96)
GARAGE_BACK = (1024, 512)
PIT_DECAL = (1024, 1024)
PIT_TEXT = ("80", "PIT")
DISTANCE_BOARD = 512
FACADE = (2048, 896)
FACADE_METRES = (32.0, 14.0)
TECPRO = (1024, 256)
TECPRO_COLOURS = ["#c8202a", "#1f4fa8"]


def load(path, mode="RGB"):
    return np.asarray(Image.open(path).convert(mode), np.float32) / 255.0


def save(array, path):
    Image.fromarray(np.clip(np.round(array * 255.0), 0, 255).astype(np.uint8)).save(path, quality=92)


def grass(source):
    hsv = load(source / "withered_grass_base_color.jpg", "RGB")
    image = Image.fromarray((hsv * 255).astype(np.uint8)).convert("HSV")
    h, s, v = [np.asarray(c, np.float32) / 255.0 for c in image.split()]
    h = np.mod(h - h.mean() + GRASS_HUE, 1.0)
    s = np.clip(s * GRASS_SATURATION, 0, 1)
    v = np.clip(v * GRASS_VALUE, 0, 1)
    merged = Image.merge("HSV", [Image.fromarray(np.round(c * 255).astype(np.uint8)) for c in (h, s, v)])
    return np.asarray(merged.convert("RGB"), np.float32) / 255.0


def kerb(source):
    width, height = KERB_SIZE
    red = load(source / "circuit_paint_red.jpg")
    white = load(source / "circuit_paint_white.jpg")
    out = np.empty((height, width, 3), np.float32)
    half = height // 2
    out[:half] = red[:half, :width]
    out[half:] = white[:half, :width]
    rubber = np.asarray(Image.open(source / "rubber_streaks.png").convert("RGBA").resize((width, height)), np.float32) / 255.0
    alpha = rubber[..., 3:4] * np.linspace(1.0, 0.25, width)[None, :, None]
    return out * (1 - alpha * 0.9) + rubber[..., :3] * alpha * 0.9


def runoff(source):
    white = load(source / "circuit_paint_white.jpg")
    luminance = white.mean(axis=2, keepdims=True)
    return luminance / luminance.mean() * RUNOFF_GREEN


def font(size, weight):
    face = ImageFont.truetype(str(FONT), size)
    face.set_variation_by_axes([weight])
    return face


def boards():
    width, height = BOARD
    atlas = Image.new("RGB", (width, height * len(BRANDS)))
    for index, (name, background, text, accent) in enumerate(BRANDS):
        panel = Image.new("RGB", BOARD, background)
        draw = ImageDraw.Draw(panel)
        mark = int(height * 0.5)
        size = int(height * 0.62)
        while True:
            face = font(size, 800)
            box = draw.textbbox((0, 0), name, font=face)
            tw, th = box[2] - box[0], box[3] - box[1]
            if tw + mark + 60 <= width * 0.86:
                break
            size -= 8
        x = (width - tw - mark - 60) // 2
        draw.ellipse([x, (height - mark) // 2, x + mark, (height + mark) // 2], outline=accent, width=int(mark * 0.16))
        draw.text((x + mark + 60 - box[0], (height - th) // 2 - box[1]), name, font=face, fill=text)
        draw.rectangle([0, height - 18, width, height], fill=accent)
        atlas.paste(panel, (0, index * height))
    return np.asarray(atlas, np.float32) / 255.0


def tecpro():
    width, height = TECPRO
    block = width // len(TECPRO_COLOURS)
    image = Image.new("RGB", TECPRO)
    draw = ImageDraw.Draw(image)
    for index, colour in enumerate(TECPRO_COLOURS):
        draw.rounded_rectangle([index * block + 6, 4, (index + 1) * block - 6, height - 4], radius=28, fill=colour)
    out = np.asarray(image, np.float32) / 255.0
    shade = 0.8 + 0.2 * np.sin(np.linspace(0.2, np.pi - 0.2, height))[:, None, None]
    return out * shade


def chainlink():
    size = CHAINLINK
    image = Image.new("RGBA", (size, size), (*CHAINLINK_COLOUR, 0))
    draw = ImageDraw.Draw(image)
    for shift in (-size, 0, size):
        draw.line([(shift, 0), (shift + size, size)], fill=(*CHAINLINK_COLOUR, 255), width=CHAINLINK_WIRE)
        draw.line([(shift + size, 0), (shift, size)], fill=(*CHAINLINK_COLOUR, 255), width=CHAINLINK_WIRE)
    return image


def decals():
    width, height = DECAL
    atlas = Image.new("L", (width, height * len(BRANDS)), 0)
    for index, (name, *_) in enumerate(BRANDS):
        panel = Image.new("L", DECAL, 0)
        draw = ImageDraw.Draw(panel)
        size = int(height * 0.8)
        while True:
            face = font(size, 900)
            box = draw.textbbox((0, 0), name, font=face)
            if box[2] - box[0] <= width * 0.92:
                break
            size -= 8
        draw.text(((width - box[2] - box[0]) // 2, (height - box[3] - box[1]) // 2), name, font=face, fill=255)
        atlas.paste(panel, (0, index * height))
    alpha = np.asarray(atlas, np.float32) / 255.0
    noise = np.random.default_rng(7).random(alpha.shape)
    worn = alpha * np.where(noise < DECAL_WEAR, 0.0, 0.9)
    rgba = np.ones(alpha.shape + (4,), np.float32) * 0.94
    rgba[..., 3] = worn
    return Image.fromarray(np.round(rgba * 255).astype(np.uint8), "RGBA")


def pit_decals():
    atlas = Image.new("L", PIT_DECAL, 0)
    draw = ImageDraw.Draw(atlas)
    width, height = PIT_DECAL
    for index, text in enumerate(PIT_TEXT):
        top = index * height // len(PIT_TEXT)
        size = height // len(PIT_TEXT) - 40
        face = font(size, 900)
        while draw.textbbox((0, 0), text, font=face)[2] > width * 0.9:
            size -= 8
            face = font(size, 900)
        box = draw.textbbox((0, 0), text, font=face)
        draw.text(((width - box[2] - box[0]) // 2, top + (height // len(PIT_TEXT) - box[3] - box[1]) // 2), text, font=face, fill=255)
    alpha = np.asarray(atlas, np.float32) / 255.0
    rgba = np.ones(alpha.shape + (4,), np.float32) * 0.94
    rgba[..., 3] = alpha * 0.92
    return Image.fromarray(np.round(rgba * 255).astype(np.uint8), "RGBA")


def palette():
    cell = PALETTE_SIZE // PALETTE_CELLS
    image = Image.new("RGB", (PALETTE_SIZE, PALETTE_SIZE), "#808080")
    draw = ImageDraw.Draw(image)
    for index, colour in enumerate(PALETTE.values()):
        x, y = index % PALETTE_CELLS * cell, index // PALETTE_CELLS * cell
        draw.rectangle([x, y, x + cell - 1, y + cell - 1], fill=colour)
    return image


def fascia():
    columns, rows = FASCIA_GRID
    width, height = FASCIA_TILE
    atlas = Image.new("RGB", (width * columns, height * rows), "#141a26")
    draw = ImageDraw.Draw(atlas)
    count = columns * rows
    first = (count - 2 * len(TEAMS)) // 2
    number = font(62, 800)
    label = font(34, 700)
    small = font(24, 500)
    colours = list(PALETTE.values())
    for index in range(count):
        x, y = index % columns * width, index // columns * height
        draw.rectangle([x, y, x + width - 1, y + height - 1], fill="#141a26", outline="#2b3346")
        draw.text((x + width - 90, y + 14), str(index + 1), font=number, fill="#d7dbe4")
        team = (index - first) // 2
        if 0 <= team < len(TEAMS):
            draw.rectangle([x + 12, y + 12, x + 26, y + height - 12], fill=colours[team])
            draw.text((x + 40, y + 12), TEAMS[team], font=label, fill="#ffffff")
            draw.text((x + 40, y + 54), DRIVERS[index - first], font=small, fill="#b9c0cf")
    return atlas


def garage_back():
    width, height = GARAGE_BACK
    image = Image.new("RGB", GARAGE_BACK, "#c9ccd2")
    draw = ImageDraw.Draw(image)
    for x in range(0, width, 128):
        draw.line([x, 0, x, height], fill="#aeb2b9", width=3)
    draw.rectangle([0, 0, width, 70], fill="#1b2230")
    draw.rectangle([0, height - 44, width, height], fill="#3a3f49")
    for index, x in enumerate(range(40, width - 200, 220)):
        draw.rectangle([x, 260, x + 190, height - 44], fill="#23272f")
        for y in range(278, height - 60, 46):
            draw.rectangle([x + 10, y, x + 180, y + 34], fill="#40464f")
            draw.rectangle([x + 70, y + 14, x + 120, y + 20], fill="#a9adb4")
        draw.rectangle([x + 10, 120, x + 180, 230], fill="#0d1520")
        draw.rectangle([x + 20, 130, x + 170, 220], fill=("#1a4d74", "#20603f", "#6a3f19", "#3f2a6e")[index % 4])
        for line in range(4):
            y = 145 + line * 18
            draw.line([x + 28, y, x + 150 - line * 18, y], fill="#d6e6f2", width=4)
    return image


def pit_signs():
    size = 512
    atlas = Image.new("RGB", (size, size * 2), "#ffffff")
    draw = ImageDraw.Draw(atlas)
    draw.ellipse([60, 60, size - 60, size - 60], fill="#ffffff", outline="#d01020", width=46)
    face = font(190, 800)
    box = draw.textbbox((0, 0), "80", font=face)
    draw.text(((size - box[2] - box[0]) // 2, (size - box[3] - box[1]) // 2), "80", font=face, fill="#101010")
    draw.rectangle([0, size, size, size * 2], fill="#101412")
    for top in (size + 70, size + 240):
        draw.polygon([(size // 2, top), (size - 70, top + 170), (size - 170, top + 170), (size // 2, top + 70), (170, top + 170), (70, top + 170)], fill="#38d27a")
    return atlas


def distance_boards():
    size = DISTANCE_BOARD
    atlas = Image.new("RGB", (size, size * len(DISTANCES)))
    for index, label in enumerate(DISTANCES):
        panel = Image.new("RGB", (size, size), "#0b1d45")
        draw = ImageDraw.Draw(panel)
        draw.rectangle([0, 0, size - 1, size - 1], outline="#ffffff", width=28)
        face = font(int(size * 0.42), 800)
        box = draw.textbbox((0, 0), label, font=face)
        draw.text(((size - box[2] - box[0]) // 2, (size - box[3] - box[1]) // 2), label, font=face, fill="#ffffff")
        atlas.paste(panel, (0, index * size))
    return np.asarray(atlas, np.float32) / 255.0


def facade():
    width, height = FACADE
    px = width / FACADE_METRES[0]
    image = Image.new("RGB", FACADE, "#e6e6e2")
    draw = ImageDraw.Draw(image)
    y = lambda metres: height - int(metres * px)
    for bay in range(4):
        left = int((bay * 8 + 1) * px)
        draw.rectangle([left, y(4.2), left + int(6 * px), y(0)], fill="#1c1f24")
        draw.rectangle([left, y(4.2), left + int(6 * px), y(4.2) + 10], fill="#3a3f47")
    draw.rectangle([0, y(12), width, y(6)], fill="#2a3a4a")
    for pane in range(17):
        x = int(pane * 2 * px)
        draw.rectangle([x, y(12), x + 6, y(6)], fill="#9aa3ad")
    draw.rectangle([0, y(9.05), width, y(8.95)], fill="#9aa3ad")
    out = np.asarray(image, np.float32) / 255.0
    sheen = np.linspace(1.08, 0.92, height)[:, None, None]
    return np.clip(out * sheen, 0, 1)


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "content/tracks/cota")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "build/cota/textures")
    out.mkdir(parents=True, exist_ok=True)
    source = root / "textures" / "source"
    save(grass(source), out / "grass_base_color.jpg")
    save(kerb(source), out / "kerb_base_color.png")
    save(runoff(source), out / "runoff_base_color.jpg")
    save(boards(), out / "boards_base_color.png")
    save(tecpro(), out / "tecpro_base_color.png")
    chainlink().save(out / "chainlink_base_color.png")
    save(distance_boards(), out / "distance_base_color.png")
    save(facade(), out / "facade_base_color.png")
    decals().save(out / "decals_base_color.png")
    pit_decals().save(out / "pit_decals_base_color.png")
    palette().save(out / "palette_base_color.png")
    fascia().save(out / "fascia_base_color.png")
    garage_back().save(out / "garage_back_base_color.png")
    pit_signs().save(out / "pit_signs_base_color.png")


if __name__ == "__main__":
    main()
