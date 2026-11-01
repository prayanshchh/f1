import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

FONT = Path("apps/client/node_modules/@fontsource-variable/saira/files/saira-latin-wght-normal.woff2")
FACE = (2048, 1386)
FACE_WIDTH = 0.17
FACE_HEIGHT = 0.115
GLOVE = (640, 820)
EMBER = (168, 40, 26)
EMBER_DEEP = (120, 24, 12)
INK = (14, 15, 18)
BUTTONS = [
    (0.086, 0.058, "N", (226, 226, 200), (40, 170, 70)),
    (0.100, 0.026, "OV", (46, 150, 190), (60, 200, 90)),
    (0.090, -0.006, "", (232, 216, 180), (232, 216, 180)),
    (0.092, -0.040, "+10", (240, 150, 70), (240, 150, 70)),
    (0.074, -0.074, "RCH", (170, 120, 210), (235, 235, 235)),
    (-0.086, 0.058, "PIT", (230, 196, 60), (50, 120, 210)),
    (-0.100, 0.026, "R", (200, 40, 40), (200, 40, 40)),
    (-0.090, -0.006, "OK", (235, 230, 215), (235, 230, 215)),
    (-0.092, -0.040, "+1", (70, 190, 90), (240, 140, 60)),
    (-0.074, -0.074, "BO", (210, 90, 170), (210, 90, 170)),
]
ROTARIES = [(0.050, -0.066, 0.0165, "SOC"), (-0.050, -0.066, 0.0165, "TORQUE")]
DIAL = (0.0, -0.075, 0.0235)
DIAL_COLOURS = [
    ((60, 130, 220), "SLIP"),
    ((230, 225, 215), "SHIFT"),
    ((226, 190, 60), "FAIL A"),
    ((240, 150, 60), "TYRE"),
    ((240, 110, 60), "FAIL B"),
    ((70, 190, 110), "FUEL"),
    ((90, 200, 180), "TORQ"),
    ((200, 60, 60), "LAP"),
]


def font(size, weight=700):
    face = ImageFont.truetype(str(FONT), size)
    face.set_variation_by_axes([weight])
    return face


def to_px(y, z):
    return ((FACE_WIDTH - y) / (2 * FACE_WIDTH) * FACE[0], (FACE_HEIGHT - z) / (2 * FACE_HEIGHT) * FACE[1])


def circle(draw, y, z, radius, **options):
    x, v = to_px(y, z)
    r = radius / (2 * FACE_WIDTH) * FACE[0]
    draw.ellipse((x - r, v - r, x + r, v + r), **options)


def centred(draw, x, y, text, face, fill):
    box = draw.textbbox((0, 0), text, font=face)
    draw.text((x - (box[0] + box[2]) / 2, y - (box[1] + box[3]) / 2), text, font=face, fill=fill)


def wheel_face(out):
    image = Image.new("RGB", FACE, (6, 6, 7))
    draw = ImageDraw.Draw(image)
    small = font(24, 700)
    label = font(30, 800)
    for y, z, text, cap, ring in BUTTONS:
        circle(draw, y, z, 0.0086, fill=tuple(int(c * 0.72) for c in cap))
        if text:
            x, v = to_px(y, z)
            centred(draw, x, v, text, label if len(text) < 3 else small, INK if sum(cap) > 300 else (240, 240, 240))
        x, v = to_px(y, z)
        r = 0.0122 / (2 * FACE_WIDTH) * FACE[0]
        draw.arc((x - r, v - r, x + r, v + r), 0, 360, fill=ring, width=7)
    number = font(26, 700)
    for y, z, radius, text in ROTARIES:
        x, v = to_px(y, z)
        r = (radius + 0.0055) / (2 * FACE_WIDTH) * FACE[0]
        for k in range(12):
            angle = np.radians(120 + k * (300 / 11))
            centred(draw, x + r * np.cos(angle), v + r * np.sin(angle), str(k + 1), number, (222, 222, 222))
        centred(draw, x, v + r + 30, text, small, (222, 222, 222))
    y, z, radius = DIAL
    x, v = to_px(y, z)
    outer = (radius + 0.0065) / (2 * FACE_WIDTH) * FACE[0]
    inner = radius * 0.72 / (2 * FACE_WIDTH) * FACE[0]
    count = len(DIAL_COLOURS)
    for k, (colour, _) in enumerate(DIAL_COLOURS):
        start = 180 + k * 180 / count - 90
        draw.pieslice((x - outer, v - outer, x + outer, v + outer), start, start + 180 / count - 1, fill=colour)
    draw.ellipse((x - inner, v - inner, x + inner, v + inner), fill=(6, 6, 7))
    tiny = font(20, 800)
    for k, (colour, text) in enumerate(DIAL_COLOURS):
        angle = np.radians(180 + (k + 0.5) * 180 / count - 90)
        centred(draw, x + (outer + inner) / 2 * np.cos(angle), v + (outer + inner) / 2 * np.sin(angle), text, tiny, INK)
    for y, z, _text, _cap, _ring in BUTTONS:
        x, v = to_px(y, z)
        r = 0.0162 / (2 * FACE_WIDTH) * FACE[0]
        draw.arc((x - r, v - r, x + r, v + r), 55, 125, fill=(62, 62, 66), width=5)
    screw = (72, 72, 76)
    for y, z in ((0.124, 0.040), (0.124, 0.012), (0.128, -0.040), (0.112, -0.078), (-0.124, 0.040), (-0.124, 0.012), (-0.128, -0.040), (-0.112, -0.078), (0.060, 0.088), (-0.060, 0.088), (0.030, -0.100), (-0.030, -0.100), (0.0725, -0.022), (-0.0725, -0.022)):
        circle(draw, y, z, 0.0030, fill=screw)
        circle(draw, y, z, 0.0013, fill=(20, 20, 22))
    dot = (208, 208, 212)
    for y, z in ((0.112, 0.056), (0.112, 0.048), (0.112, 0.040), (-0.112, 0.056), (-0.112, 0.048), (-0.112, 0.040), (0.0735, 0.040), (0.0735, 0.032), (-0.0735, 0.040), (-0.0735, 0.032)):
        circle(draw, y, z, 0.0018, fill=dot)
    centred(draw, *to_px(0.0, 0.094), "VANTA", font(40, 900), (230, 230, 232))
    image.save(out / "wheel-face.jpg", quality=92, subsampling=0)


def glove(out):
    width, height = GLOVE
    image = Image.new("RGB", GLOVE, (128, 30, 20))
    draw = ImageDraw.Draw(image)
    accent = (228, 190, 70)
    for edge, toward in ((0, 1), (width, -1)):
        def px(u, v, edge=edge, toward=toward):
            return (edge + toward * u, v)
        draw.polygon([px(0, 0), px(116, 0), px(136, 190), px(116, 400), px(170, height), px(0, height)], fill=INK)
        draw.line([px(116, 0), px(136, 190), px(116, 400), px(170, height)], fill=(90, 92, 98), width=5)
        draw.line([px(12, 120), px(68, 210), px(100, 150)], fill=accent, width=7)
        draw.line([px(68, 210), px(54, 330), px(110, 420)], fill=accent, width=7)
        draw.line([px(54, 330), px(14, 430)], fill=accent, width=7)
        draw.line([px(110, 420), px(46, 520), px(120, 600)], fill=accent, width=7)
        draw.line([px(46, 520), px(10, 610)], fill=accent, width=7)
    draw.rectangle((0, height - 118, width, height), fill=INK)
    draw.rectangle((0, height - 124, width, height - 114), fill=(214, 214, 214))
    draw.rectangle((width // 2 - 110, height - 104, width // 2 + 110, height - 40), fill=(38, 38, 42))
    stitch = (92, 22, 14)
    for x in range(230, width - 230, 62):
        draw.line((x, 10, x + 10, height - 130), fill=stitch, width=2)
    for x in (180, width - 180):
        for y in range(0, height - 130, 22):
            draw.line((x, y, x + 2, y + 12), fill=(236, 226, 214), width=2)
    layer = Image.new("RGBA", (250, 70), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((6, 2), "VANTA", font=font(52, 900), fill=(240, 240, 240, 255))
    layer = layer.rotate(50, expand=True, resample=Image.BICUBIC)
    image.paste(layer, (width // 2 - 110, 210), layer)
    image.save(out / "glove.jpg", quality=92, subsampling=0)


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "content/cars/vanta-26")
    wheel_face(out)
    glove(out)
    array = np.asarray(Image.open(out / "wheel-face.jpg"))
    print(f"art: {array.shape} -> {out}")


if __name__ == "__main__":
    main()
