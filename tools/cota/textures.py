import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

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


if __name__ == "__main__":
    main()
