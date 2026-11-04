import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

import brands
from palette import PALETTE, PALETTE_CELLS, TEAMS, shade
from pitlane import TEAM_BAYS, bay_count

GRASS_HUE = 0.25
GRASS_SATURATION = 1.5
GRASS_VALUE = 0.7
STREAKS = (2048, 512)
STREAK_LAYERS = ((1.4, 60.0, 1.0), (3.5, 140.0, 0.8), (0.8, 18.0, 0.5))
KERB_SIZE = (512, 1024)
FONT = Path("apps/client/node_modules/@fontsource-variable/saira/files/saira-latin-wght-normal.woff2")
CHAINLINK = 256
CHAINLINK_WIRE = 14
CHAINLINK_COLOUR = (165, 168, 172)
DISTANCES = ("300", "200", "100")
PALETTE_SIZE = 256
FASCIA_GRID = (4, 7)
FASCIA_TILE = (512, 96)
GARAGE_BACK = (1024, 512)
GARAGE_GRID = (4, 3)
PIT_DECAL = (1024, 1024)
PIT_TEXT = ("80", "PIT")
DISTANCE_BOARD = 512
FACADE = (2048, 896)
FACADE_METRES = (32.0, 14.0)
TECPRO = (1024, 256)
FENCE_METAL = (108, 112, 118)


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


def streaks():
    rng = np.random.default_rng(23)
    height, width = STREAKS
    out = np.zeros((height, width), np.float32)
    for across, along, gain in STREAK_LAYERS:
        spectrum = np.fft.fft2(rng.normal(0, 1, (height, width)))
        fy = np.fft.fftfreq(height)[:, None]
        fx = np.fft.fftfreq(width)[None, :]
        spectrum *= np.exp(-2 * np.pi**2 * ((fy * along) ** 2 + (fx * across) ** 2))
        layer = np.real(np.fft.ifft2(spectrum))
        out += layer / layer.std() * gain
    out = np.clip(0.5 + out * 0.18, 0, 1)
    return Image.fromarray(np.round(out * 255).astype(np.uint8), "L")


def font(size, weight):
    face = ImageFont.truetype(str(FONT), size)
    face.set_variation_by_axes([weight])
    return face


def tecpro():
    rng = np.random.default_rng(13)
    width, height = TECPRO
    base = np.full((height, width, 3), 0.62, np.float32) * np.array([1.0, 0.99, 0.96], np.float32)
    streak = np.asarray(Image.fromarray(np.uint8(rng.random((8, width // 8)) * 255)).resize((width, height), Image.BICUBIC), np.float32) / 255.0
    base *= (0.94 + 0.09 * streak)[..., None]
    ramp = np.linspace(0, 1, height)[:, None, None] ** 2
    base = base * (1 - 0.5 * ramp) + np.array([0.24, 0.21, 0.18], np.float32) * 0.5 * ramp
    base[:, :6] *= 0.45
    base[:, -6:] *= 0.45
    base[:10] *= 0.8
    return np.clip(base + rng.normal(0, 0.012, (height, width, 1)), 0, 1)


def chainlink():
    size = CHAINLINK
    image = Image.new("RGBA", (size, size), (*CHAINLINK_COLOUR, 0))
    draw = ImageDraw.Draw(image)
    for shift in (-size, 0, size):
        draw.line([(shift, 0), (shift + size, size)], fill=(*CHAINLINK_COLOUR, 255), width=CHAINLINK_WIRE)
        draw.line([(shift + size, 0), (shift, size)], fill=(*CHAINLINK_COLOUR, 255), width=CHAINLINK_WIRE)
    return image


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


def fascia(bays):
    columns, rows = FASCIA_GRID
    width, height = FASCIA_TILE
    atlas = Image.new("RGB", (width * columns, height * rows), "#10141c")
    draw = ImageDraw.Draw(atlas)
    first = (bays - TEAM_BAYS * len(TEAMS)) // 2
    number = font(66, 800)
    label = font(36, 760)
    small = font(23, 560)
    for index in range(columns * rows):
        x, y = index % columns * width, index // columns * height
        draw.rectangle([x, y, x + width - 1, y + height - 1], fill="#10141c")
        draw.rectangle([x, y + height - 6, x + width - 1, y + height - 1], fill="#1f2633")
        team = (index - first) // TEAM_BAYS
        if not 0 <= team < len(TEAMS) or index >= bays:
            continue
        data = TEAMS[team]
        driver = data["drivers"][(index - first) % TEAM_BAYS]
        draw.rectangle([x, y, x + 150, y + height - 1], fill=data["colours"]["primary"])
        draw.polygon([(x + 150, y), (x + 196, y), (x + 150, y + height - 1)], fill=data["colours"]["primary"])
        draw.rectangle([x, y + height - 8, x + width - 1, y + height - 1], fill=data["brand"])
        box = draw.textbbox((0, 0), str(driver["number"]), font=number)
        draw.text((x + 75 - (box[2] + box[0]) / 2, y + 44 - (box[3] + box[1]) / 2), str(driver["number"]), font=number, fill="#ffffff")
        draw.text((x + 214, y + 12), data["name"].upper(), font=label, fill="#ffffff")
        draw.text((x + 214, y + 56), f"{driver['first'][0]}. {driver['last'].upper()}", font=small, fill="#c3cad6")
    return atlas


def garage_panel(team):
    width, height = GARAGE_BACK
    deep = team["colours"]["primary"] if team else "#1b2230"
    brand = team["brand"] if team else "#3a4252"
    image = Image.new("RGB", GARAGE_BACK, "#d3d6db")
    draw = ImageDraw.Draw(image)
    for x in range(0, width, 128):
        draw.line([x, 0, x, height], fill="#b4b8bf", width=3)
    draw.rectangle([0, 0, width, 96], fill=deep)
    draw.rectangle([0, 96, width, 104], fill=brand)
    if team:
        title = font(46, 780)
        text = team["fullName"].upper()
        box = draw.textbbox((0, 0), text, font=title)
        draw.text(((width - box[2] - box[0]) / 2, 48 - (box[3] + box[1]) / 2), text, font=title, fill="#ffffff")
    draw.rectangle([0, 236, width, 246], fill=brand)
    draw.rectangle([0, height - 40, width, height], fill="#2e333c")
    for index, x in enumerate(range(28, width - 180, 200)):
        draw.rectangle([x, 270, x + 180, height - 40], fill="#1d2027")
        for y in range(284, height - 56, 38):
            draw.rectangle([x + 8, y, x + 172, y + 30], fill=deep if index % 2 else "#3a3f48")
            draw.rectangle([x + 60, y + 12, x + 120, y + 17], fill="#b3b8bf")
        draw.rectangle([x + 8, 122, x + 172, 222], fill="#0b0f15")
        draw.rectangle([x + 16, 130, x + 164, 214], fill=("#0f2638", "#10301f", "#2c1d0c", "#1d1536")[index % 4])
        for line in range(5):
            y = 140 + line * 14
            draw.line([x + 24, y, x + 150 - (line * 23) % 70, y], fill=("#d6e6f2", brand)[line % 2], width=4)
    return image


def garage_back():
    columns, rows = GARAGE_GRID
    width, height = GARAGE_BACK
    atlas = Image.new("RGB", (width * columns, height * rows))
    for index in range(columns * rows):
        team = TEAMS[index] if index < len(TEAMS) else None
        atlas.paste(garage_panel(team), (index % columns * width, index // columns * height))
    return atlas


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


CREW_ATLAS = (2048, 1408)
CREW_WIDTH = 2.0
CREW_HEIGHT = 2.2
CREW_KIT = {"suit": "#1b4fa8", "dark": "#0d2a66", "trim": "#f28a12", "white": "#eef0f2", "black": "#0c0d10", "back": "STEALTH", "chest": "NORTHWIND", "legs": "VOLTARA"}
CREW_DARKEN = 0.55
CREW_LIGHT_SUIT = 0.55


def crew_kit(team):
    primary = team["colours"]["primary"]
    light = np.dot([int(primary[i : i + 2], 16) / 255 for i in (1, 3, 5)], [0.2126, 0.7152, 0.0722]) > CREW_LIGHT_SUIT
    return {
        "suit": primary,
        "dark": shade(primary, CREW_DARKEN),
        "trim": team["brand"],
        "white": "#15171b" if light else "#eef0f2",
        "black": "#0c0d10",
        "back": team["name"].upper(),
        "chest": team["sponsors"][0],
        "legs": team["sponsors"][1],
    }


def crew_suit(kit=CREW_KIT):
    width, height = CREW_ATLAS
    half = width // 2
    image = Image.new("RGB", CREW_ATLAS, kit["suit"])
    draw = ImageDraw.Draw(image)

    def to(side, x, z):
        return (side * half + half / 2 + x / CREW_WIDTH * half, height - z / CREW_HEIGHT * height)

    def band(side, x0, x1, z0, z1, colour):
        (ax, ay), (bx, by) = to(side, x0, z1), to(side, x1, z0)
        draw.rectangle([min(ax, bx), ay, max(ax, bx), by], fill=colour)

    def label(side, x, z, text, size, colour):
        face = font(size, 800)
        cx, cy = to(side, x, z)
        box = draw.textbbox((0, 0), text, font=face)
        draw.text((cx - (box[2] + box[0]) / 2, cy - (box[3] + box[1]) / 2), text, font=face, fill=colour)

    for side in (0, 1):
        band(side, -1.0, 1.0, 0.0, 0.14, kit["black"])
        band(side, -1.0, 1.0, 0.14, 0.165, kit["dark"])
        for sign in (1, -1):
            band(side, sign * 0.69, sign * 1.0, 1.2, 1.7, kit["black"])
            band(side, sign * 0.65, sign * 0.69, 1.2, 1.7, kit["dark"])
            band(side, sign * 0.46, sign * 0.5, 1.2, 1.7, kit["white"])
            band(side, sign * 0.27, sign * 0.33, 1.2, 1.7, kit["dark"])
            band(side, sign * 0.03, sign * 0.21, 0.46, 0.6, kit["dark"])
            band(side, sign * 0.03, sign * 0.21, 0.595, 0.605, kit["white"])
        band(side, -0.22, 0.22, 0.98, 1.03, kit["black"])
        band(side, -0.028, 0.028, 0.98, 1.03, kit["white"])
        band(side, -0.11, 0.11, 1.5, 1.62, kit["dark"])
        for sign in (1, -1):
            band(side, sign * 0.15, sign * 0.165, 1.03, 1.42, kit["dark"])
    label(0, 0, 1.35, kit["chest"], 26, kit["white"])
    for z in (1.22, 1.15):
        draw.polygon([to(0, -0.1, z + 0.04), to(0, 0, z - 0.02), to(0, 0.1, z + 0.04), to(0, 0.1, z + 0.012), to(0, 0, z - 0.048), to(0, -0.1, z + 0.012)], fill=kit["trim"])
    for z in (1.38, 1.3, 1.22):
        draw.polygon([to(1, -0.12, z + 0.05), to(1, 0, z - 0.02), to(1, 0.12, z + 0.05), to(1, 0.12, z + 0.015), to(1, 0, z - 0.055), to(1, -0.12, z + 0.015)], fill=kit["trim"])
    label(1, 0, 1.11, kit["back"], 34, kit["white"])
    for sign in (1, -1):
        label(0, sign * 0.12, 0.76, kit["legs"], 13, kit["white"])
    top = round(height * 0.14)
    draw.rectangle([0, 0, width, top], fill=kit["white"])
    draw.rectangle([0, top * 0.42, width, top], fill=kit["suit"])
    draw.rectangle([0, top * 0.42, width, top * 0.47], fill=kit["dark"])
    draw.rectangle([0, top * 0.82, width, top * 0.9], fill=kit["trim"])
    return image


STATIC_TILE = (512, 352)
STATIC_GRID = (4, 3)


def crew_polo(team_colour, trim=None, overalls=False):
    width, height = CREW_ATLAS
    half = width // 2
    shirt = team_colour
    trousers = team_colour if overalls else "#17191f"
    image = Image.new("RGB", CREW_ATLAS, trousers)
    draw = ImageDraw.Draw(image)

    def box(side, x0, x1, z0, z1, colour):
        y0, y1 = height - z1 / CREW_HEIGHT * height, height - z0 / CREW_HEIGHT * height
        ax = side * half + half / 2 + x0 / CREW_WIDTH * half
        bx = side * half + half / 2 + x1 / CREW_WIDTH * half
        draw.rectangle([min(ax, bx), y0, max(ax, bx), y1], fill=colour)

    for side in (0, 1):
        box(side, -1.0, 1.0, 0.0, 0.14, "#0c0d10")
        box(side, -1.0, 1.0, 1.02, 1.7, shirt)
        if not overalls:
            box(side, -0.08, 0.08, 1.42, 1.56, "#17191f")
            box(side, -0.24, 0.24, 0.98, 1.03, "#0c0d10")
            for sign in (1, -1):
                box(side, sign * 0.3, sign * 0.46, 1.2, 1.7, trim)
                box(side, sign * 0.13, sign * 0.17, 1.03, 1.4, trim)
        else:
            for sign in (1, -1):
                box(side, sign * 0.03, sign * 0.21, 0.72, 0.76, "#d9dcde")
                box(side, sign * 0.03, sign * 0.17, 1.22, 1.26, "#d9dcde")
    return image


def crew_static_atlas():
    tile_w, tile_h = STATIC_TILE
    columns, rows = STATIC_GRID
    atlas = Image.new("RGB", (tile_w * columns, tile_h * rows))
    tiles = [crew_polo(team["colours"]["primary"], team["brand"]) for team in TEAMS] + [crew_polo("#e8701a", overalls=True)]
    for index, tile in enumerate(tiles):
        atlas.paste(tile.resize(STATIC_TILE), (index % columns * tile_w, index // columns * tile_h))
    return atlas


MARKS = (1024, 192)
MARK_ROWS = (0.32, 0.5, 0.82)


def track_marks():
    width, height = MARKS
    row_height = height // len(MARK_ROWS)
    rng = np.random.default_rng(41)
    alpha = np.zeros((height, width), np.float32)
    across = np.linspace(-1, 1, row_height)
    edge = np.clip((1 - np.abs(across)) / 0.35, 0, 1)
    for row, strength in enumerate(MARK_ROWS):
        streaks = np.repeat(rng.random((row_height // 4 + 1, width // 16 + 1)), 4, axis=0)[:row_height]
        streaks = np.repeat(streaks, 16, axis=1)[:, :width]
        grain = rng.random((row_height, width))
        along = 0.75 + 0.25 * np.sin(np.linspace(0, 12 * np.pi, width) + row)
        alpha[row * row_height : (row + 1) * row_height] = strength * edge[:, None] * (0.55 + 0.3 * streaks + 0.15 * grain) * along
    rgba = np.zeros((height, width, 4), np.float32)
    rgba[..., :3] = 0.015
    rgba[..., 3] = np.clip(alpha, 0, 1)
    return Image.fromarray(np.round(rgba * 255).astype(np.uint8), "RGBA")


def crew_normal():
    width, height = CREW_ATLAS[0] // 2, CREW_ATLAS[1] // 2
    rng = np.random.default_rng(31)
    fine = rng.normal(0, 1, (height, width))
    blur = lambda values, sx, sy: np.real(np.fft.ifft2(np.fft.fft2(values) * np.exp(-2 * np.pi**2 * ((np.fft.fftfreq(height)[:, None] * sy) ** 2 + (np.fft.fftfreq(width)[None, :] * sx) ** 2))))
    folds = blur(rng.normal(0, 1, (height, width)), 2.4, 7)
    folds = folds / folds.std()
    weave = blur(fine, 0.8, 0.8)
    weave = weave / weave.std()
    relief = folds * 1.4 + weave * 0.18
    dx = np.roll(relief, -1, 1) - np.roll(relief, 1, 1)
    dy = np.roll(relief, -1, 0) - np.roll(relief, 1, 0)
    normal = np.stack([-dx * 0.14, dy * 0.14, np.ones_like(relief)], -1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    return Image.fromarray(np.round((normal * 0.5 + 0.5) * 255).astype(np.uint8), "RGB")


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


def build_fonts(out):
    return out.parent / "fonts"


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "content/tracks/hill-country")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "build/hill-country/textures")
    out.mkdir(parents=True, exist_ok=True)
    source = root / "textures" / "source"
    save(grass(source), out / "grass_base_color.jpg")
    save(kerb(source), out / "kerb_base_color.png")
    streaks().save(root / "textures" / "baked" / "asphalt_streaks.png")
    save(brands.boards(build_fonts(out)), out / "boards_base_color.png")
    save(tecpro(), out / "tecpro_base_color.png")
    chainlink().save(out / "chainlink_base_color.png")
    save(distance_boards(), out / "distance_base_color.png")
    save(facade(), out / "facade_base_color.png")
    pit_decals().save(out / "pit_decals_base_color.png")
    palette().save(out / "palette_base_color.png")
    track = json.loads((root / "track.json").read_text())
    fascia(bay_count(track["pitLane"], track["length"])).save(out / "fascia_base_color.png")
    garage_back().save(out / "garage_back_base_color.png")
    pit_signs().save(out / "pit_signs_base_color.png")
    crew_suit().save(out / "crew_suit_base_color.png")
    for team in TEAMS:
        crew_suit(crew_kit(team)).save(root.parent.parent / "cars" / team["id"] / "crew.jpg", quality=88)
    crew_normal().save(out / "crew_suit_normal.png")
    track_marks().save(out / "track_marks_base_color.png")
    crew_static_atlas().save(out / "crew_static_base_color.png")


if __name__ == "__main__":
    main()
