import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter, map_coordinates

sys.path.insert(0, str(Path(__file__).resolve().parent))
from livery import text_mask

AROUND = 8192
ROWS = 512
WALL_FROM = 0.224
WALL_TO = 0.360
TREAD_HALF = 0.21
FLAT = 0.5
SEED = 26
BRAND = "KESTREL"
PRODUCT = "VELOCE SLICK"
MARKING = "305/670 R18  RACING USE ONLY"
MOULDED = "TUBELESS  RADIAL  ROTATION  MAX LOAD 1050 KG  MADE FOR CIRCUIT USE  DOT KR26 4426"
SHOULDER_RINGS = (0.3180, 0.3225, 0.3270, 0.3315, 0.3360)
BEAD_RINGS = ((0.2410, 0.0012), (0.2445, 0.0008))
WEAR_MARKS = (-0.06, 0.0, 0.06)
PICKUP_AROUND = 8.0
PICKUP_ACROSS = 2.5
NOISE_SPREAD = 0.15
CONDITION_AROUND = 4096
CONDITION_SEED = 27
CIRCUMFERENCE = 2 * np.pi * 0.355
FIELD_SPREAD = 0.17
INTER = {"pitch": 36, "from": 0.14, "to": 0.93, "sweep": 0.075, "bend": 1.3, "width": 0.0028}
WET = {"pitch": 26, "from": 0.05, "to": 0.97, "sweep": 0.3, "bend": 1.0, "width": 0.0042}


def wall_row(radius):
    return (radius - WALL_FROM) / (WALL_TO - WALL_FROM) * ROWS


def tread_row(axial):
    return (axial + TREAD_HALF) / (2 * TREAD_HALF) * ROWS


def column(turn):
    return turn * AROUND


def band(rows, centre, width):
    return np.clip(1 - np.abs(rows - centre) / width, 0, 1) ** 0.5


def stripe(rows, radius, half):
    return np.clip(wall_row(radius + half) - wall_row(radius) - np.abs(rows - wall_row(radius)) + 0.5, 0, 1)


def stamp(layer, mask, turn, radius, cap):
    tall = wall_row(radius + cap / 2) - wall_row(radius - cap / 2)
    height, width = mask.shape
    across = max(1, int(round(width / height * cap * AROUND / (2 * np.pi * radius))))
    image = Image.fromarray(np.uint8(np.clip(mask, 0, 1) * 255)).resize((across, max(1, int(round(tall)))), Image.LANCZOS)
    glyphs = np.flipud(np.asarray(image, np.float32) / 255.0)
    top = int(round(wall_row(radius) - glyphs.shape[0] / 2))
    left = int(round(column(turn) - glyphs.shape[1] / 2))
    columns = (np.arange(glyphs.shape[1]) + left) % AROUND
    rows = slice(top, top + glyphs.shape[0])
    layer[rows, columns] = np.maximum(layer[rows, columns], glyphs)
    return across


def bird():
    size = 256
    points = np.array([(0.0, 0.42), (0.55, 0.0), (0.42, 0.36), (1.0, 0.30), (0.58, 0.55), (0.40, 1.0), (0.30, 0.55)])
    image = Image.new("L", (size, size), 0)
    ImageDraw.Draw(image).polygon([tuple(p * (size - 1)) for p in points], fill=255)
    return np.asarray(image, np.float32) / 255.0


def lettering(colour, white, relief):
    for start in (0.0, 0.5):
        word = text_mask(BRAND, height=256, weight=900, italic=0.16)
        width = stamp(colour, word, start + 0.125, 0.2760, 0.040)
        mark = bird()
        stamp(colour, mark, start + 0.125 - (width / 2 + 150) / AROUND, 0.2760, 0.044)
        stamp(white, text_mask(PRODUCT, height=200, weight=750, italic=0.1), start + 0.375, 0.2800, 0.0165)
        stamp(white, text_mask(MARKING, height=160, weight=600, italic=0.0), start + 0.375, 0.2600, 0.0072)
    words = text_mask(MOULDED, height=140, weight=650, italic=0.0)
    for turn in (0.06, 0.31, 0.56, 0.81):
        stamp(relief, words, turn, 0.3105, 0.0050)


def arcs(rows, columns, colour):
    turn = columns / AROUND
    for centre in (0.375, 0.875):
        offset = np.abs((turn - centre + 0.5) % 1.0 - 0.5)
        span = np.clip((0.105 - offset) / 0.002, 0, 1)
        colour[:] = np.maximum(colour, stripe(rows, 0.3030, 0.0035)[:, None] * span[None, :])
    colour[:] = np.maximum(colour, stripe(rows, 0.2490, 0.0013)[:, None])


def rubber_noise(rng, shape, along, across):
    noise = rng.normal(0, 1, shape)
    return gaussian_filter(noise, (across, along), mode="wrap")


def wall(rng):
    rows = np.arange(ROWS, dtype=np.float32) + 0.5
    columns = np.arange(AROUND, dtype=np.float32) + 0.5
    colour = np.zeros((ROWS, AROUND), np.float32)
    white = np.zeros_like(colour)
    relief = np.zeros_like(colour)
    lettering(colour, white, relief)
    arcs(rows, columns, colour)
    height = np.full((ROWS, AROUND), FLAT, np.float32)
    radius = WALL_FROM + rows / ROWS * (WALL_TO - WALL_FROM)
    knurl = (np.sin(columns / AROUND * 2 * np.pi * 1100) * 0.5 + 0.5) ** 3
    bead = np.clip((0.2370 - radius) / 0.0015, 0, 1) * np.clip((radius - 0.2290) / 0.0010, 0, 1)
    height += 0.10 * bead[:, None] * knurl[None, :]
    for centre, width in BEAD_RINGS:
        height += 0.22 * band(rows, wall_row(centre), wall_row(centre + width) - wall_row(centre))[:, None]
    for centre in SHOULDER_RINGS:
        height += 0.16 * band(rows, wall_row(centre), wall_row(centre + 0.0007) - wall_row(centre))[:, None]
    height += 0.20 * gaussian_filter(np.maximum(colour, white), 0.6, mode="wrap")
    height += 0.18 * gaussian_filter(relief, 0.5, mode="wrap")
    height += 0.025 * rubber_noise(rng, (ROWS, AROUND), 1.2, 1.2)
    return colour, white, height


def tread(rng):
    rows = np.arange(ROWS, dtype=np.float32) + 0.5
    columns = np.arange(AROUND, dtype=np.float32) + 0.5
    grain = rubber_noise(rng, (ROWS, AROUND), 22.0, 0.9)
    grain /= grain.std()
    fine = rubber_noise(rng, (ROWS, AROUND), 2.0, 0.7)
    fine /= fine.std()
    height = FLAT + 0.05 * grain + 0.035 * fine
    axial = rows / ROWS * 2 * TREAD_HALF - TREAD_HALF
    for turn in (0.06, 0.31, 0.56, 0.81):
        for across in WEAR_MARKS:
            dy = (axial[:, None] - across) / 0.0026
            dx = ((columns[None, :] / AROUND - turn + 0.5) % 1.0 - 0.5) * 2 * np.pi * 0.35 / 0.0026
            height -= 0.35 * np.clip(1 - np.hypot(dx, dy), 0, 1) ** 0.6
    blobs = rubber_noise(rng, (ROWS, AROUND), PICKUP_AROUND, PICKUP_ACROSS)
    blobs /= blobs.std()
    return np.clip(0.5 + NOISE_SPREAD * grain, 0, 1), np.clip(0.5 + NOISE_SPREAD * blobs, 0, 1), height


def unit_field(rng, shape, along, across):
    field = rubber_noise(rng, shape, along, across)
    return field / field.std()


def spread(field):
    return np.clip(0.5 + FIELD_SPREAD * field, 0, 1)


def warped(field, rng, shape, reach, along, across):
    rows, columns = np.indices(shape, dtype=np.float32)
    shift = unit_field(rng, shape, along, across) * reach
    return map_coordinates(field, [rows + shift, columns], order=1, mode="wrap")


def condition(rng):
    shape = (ROWS, CONDITION_AROUND)
    ripples = warped(unit_field(rng, shape, 13.0, 1.3), rng, shape, 3.0, 40.0, 12.0)
    ridges = spread(np.sign(ripples) * np.abs(ripples) ** 0.7)
    cover = spread(0.8 * unit_field(rng, shape, 70.0, 34.0) + 0.45 * unit_field(rng, shape, 14.0, 9.0))
    lumps = spread(0.6 * unit_field(rng, shape, 6.0, 5.0) + 0.55 * unit_field(rng, shape, 2.2, 2.0) + 0.3 * unit_field(rng, shape, 16.0, 12.0))
    tear = spread(0.7 * unit_field(rng, shape, 130.0, 70.0) + 0.3 * unit_field(rng, shape, 30.0, 18.0) + 0.14 * unit_field(rng, shape, 6.0, 5.0))
    return ridges, cover, lumps, tear


def groove(pattern, across, along):
    side = np.sign(across)
    t = (np.abs(across) - pattern["from"]) / (pattern["to"] - pattern["from"])
    pitch = CIRCUMFERENCE / pattern["pitch"]
    centre = pattern["sweep"] * np.clip(t, 0, 1) ** pattern["bend"] + np.where(side < 0, pitch / 2, 0)
    phase = np.mod(along - centre, pitch)
    distance = np.minimum(phase, pitch - phase)
    ends = np.clip(np.minimum(t, 1 - t) * 40, 0, 1)
    return np.clip((pattern["width"] - distance) / 0.0007 + 0.5, 0, 1) * ends


def treads(rng):
    rows = (np.arange(ROWS, dtype=np.float32) + 0.5) / ROWS * 2 - 1
    columns = (np.arange(CONDITION_AROUND, dtype=np.float32) + 0.5) / CONDITION_AROUND * CIRCUMFERENCE
    across = np.repeat(rows[:, None], CONDITION_AROUND, axis=1)
    along = np.repeat(columns[None, :], ROWS, axis=0)
    inter = groove(INTER, across, along)
    wet = groove(WET, across, along)
    shape = (ROWS, CONDITION_AROUND)
    coarse = 1 - np.abs(unit_field(rng, shape, 16.0, 13.0))
    medium = 1 - np.abs(unit_field(rng, shape, 7.0, 6.0))
    chunks = np.clip((0.6 * coarse ** 3 + 0.4 * medium ** 3) * 1.3, 0, 1)
    specks = unit_field(rng, (ROWS, CONDITION_AROUND), 0.7, 0.7)
    clumps = unit_field(rng, (ROWS, CONDITION_AROUND), 3.0, 3.0)
    grit = spread(0.7 * specks + 0.7 * clumps)
    return inter, wet, chunks, grit


def to_bytes(channel):
    return np.uint8(np.clip(np.round(channel * 255), 0, 255))


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "content/cars/shared")
    rng = np.random.default_rng(SEED)
    blocks = [wall(rng), tread(rng)]
    average = [np.repeat(channel.mean(axis=1, keepdims=True), AROUND, axis=1) for channel in blocks[0]]
    blocks.append(average)
    image = np.concatenate([np.stack([to_bytes(c) for c in block], axis=-1) for block in blocks], axis=0)
    Image.fromarray(image, "RGB").save(out / "tyre.png", optimize=True)
    print(f"tyre: {image.shape[1]}x{image.shape[0]}")
    worn = np.random.default_rng(CONDITION_SEED)
    layers = [condition(worn), treads(worn)]
    extra = np.concatenate([np.stack([to_bytes(c) for c in block], axis=-1) for block in layers], axis=0)
    Image.fromarray(extra, "RGBA").save(out / "tyre-condition.png", optimize=True)
    print(f"tyre-condition: {extra.shape[1]}x{extra.shape[0]}")


if __name__ == "__main__":
    main()
