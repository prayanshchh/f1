import json
import sys
from pathlib import Path

import numpy as np

ENV_SIZE = (1024, 512)
HORIZON_MARGIN = 6.0
SUN_RADIUS = 12.0
SUN_LIMIT = 40.0
SUN_DISC = 2.0
HORIZON_BAND = (2.0, 6.0)
GROUND_ALBEDO = np.array([0.30, 0.30, 0.22])
GROUND_BLEND = 4.0
ENV_GAIN_BELOW = 1.0


def read_header(data):
    end = data.index(b"\n\n") + 2
    line_end = data.index(b"\n", end)
    resolution = data[end:line_end].decode().split()
    return line_end + 1, int(resolution[3]), int(resolution[1])


def scanline(data, offset, width):
    if data[offset] != 2 or data[offset + 1] != 2:
        raise RuntimeError("only new-style RLE HDR files are supported")
    position = offset + 4
    row = np.empty((width, 4), np.uint8)
    for channel in range(4):
        x = 0
        while x < width:
            count = data[position]
            position += 1
            if count > 128:
                run = count - 128
                row[x : x + run, channel] = data[position]
                position += 1
            else:
                run = count
                row[x : x + run, channel] = np.frombuffer(data, np.uint8, run, position)
                position += run
            x += run
    return row, position


def decode(rgbe):
    exponent = rgbe[..., 3].astype(np.int32)
    scale = np.where(exponent > 0, np.ldexp(1.0, exponent - 136), 0.0)
    return rgbe[..., :3].astype(np.float32) * scale[..., None]


def encode(rgb):
    peak = rgb.max(axis=-1)
    mantissa, exponent = np.frexp(np.maximum(peak, 1e-32))
    scale = np.where(peak > 1e-32, mantissa * 256.0 / np.maximum(peak, 1e-32), 0.0)
    out = np.zeros(rgb.shape[:-1] + (4,), np.uint8)
    out[..., :3] = np.clip(rgb * scale[..., None], 0, 255).astype(np.uint8)
    out[..., 3] = np.where(peak > 1e-32, exponent + 128, 0).astype(np.uint8)
    return out


def box(image, width, height):
    rows, columns = image.shape[:2]
    ys = (np.arange(rows) * height // rows).astype(np.int64)
    xs = (np.arange(columns) * width // columns).astype(np.int64)
    weights = np.bincount(ys, minlength=height)[:, None] * np.bincount(xs, minlength=width)[None, :]
    out = np.zeros((height, width, 3), np.float64)
    for channel in range(3):
        partial = np.zeros((height, columns))
        np.add.at(partial, ys, image[:, :, channel])
        for y in range(height):
            out[y, :, channel] = np.bincount(xs, weights=partial[y], minlength=width)
    return (out / weights[..., None]).astype(np.float32)


def main():
    source = Path(sys.argv[1])
    out = Path(sys.argv[2])
    name = sys.argv[3]
    out.mkdir(parents=True, exist_ok=True)
    data = source.read_bytes()
    start, width, height = read_header(data)
    keep = int(np.ceil(height * (90.0 + HORIZON_MARGIN) / 180.0))
    offsets = [start]
    rows = np.empty((height, width, 4), np.uint8)
    for y in range(height):
        rows[y], next_offset = scanline(data, offsets[-1], width)
        offsets.append(next_offset)
    image = decode(rows)
    del rows
    luminance = image @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    y, x = np.unravel_index(np.argmax(luminance), luminance.shape)
    bright = luminance > luminance[y, x] * 0.5
    ys, xs = np.nonzero(bright)
    sun_u = float(np.mean(xs) + 0.5) / width
    sun_v = float(np.mean(ys) + 0.5) / height
    elevation = (0.5 - sun_v) * np.pi
    azimuth = (sun_u - 0.5) * 2 * np.pi
    latitudes = (0.5 - (np.arange(height) + 0.5) / height) * np.pi
    longitudes = ((np.arange(width) + 0.5) / width - 0.5) * 2 * np.pi
    sun_direction = np.array([np.cos(elevation) * np.cos(azimuth), np.cos(elevation) * np.sin(azimuth), np.sin(elevation)])
    clipped = image.copy()
    cos_lat = np.cos(latitudes)[:, None]
    cos_angle = np.sin(latitudes)[:, None] * sun_direction[2] + cos_lat * (np.cos(longitudes)[None, :] * sun_direction[0] + np.sin(longitudes)[None, :] * sun_direction[1])
    near_sun = cos_angle > np.cos(np.radians(SUN_RADIUS))
    peak = clipped.max(axis=2)
    too_bright = near_sun & (peak > SUN_LIMIT)
    clipped[too_bright] *= (SUN_LIMIT / peak[too_bright])[..., None]
    env = box(clipped, *ENV_SIZE)
    env_lat = (0.5 - (np.arange(ENV_SIZE[1]) + 0.5) / ENV_SIZE[1]) * np.pi
    weight = np.sin(np.maximum(env_lat, 0))[:, None, None] * np.cos(env_lat)[:, None, None]
    d_lat = np.pi / ENV_SIZE[1]
    d_lon = 2 * np.pi / ENV_SIZE[0]
    sky_irradiance = (env * weight * (env_lat[:, None, None] > 0)).sum(axis=(0, 1)) * d_lat * d_lon
    sky_radiance = sky_irradiance / np.pi
    below = np.clip(-np.degrees(env_lat) / GROUND_BLEND, 0, 1)[:, None, None]
    ground = GROUND_ALBEDO * (sky_irradiance / np.pi) * ENV_GAIN_BELOW
    env = env * (1 - below) + ground[None, None, :] * below
    crop = data[offsets[0] : offsets[keep]]
    header = f"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y {keep} +X {width}\n".encode()
    (out / f"{name}.hdr").write_bytes(header + crop)
    env_header = f"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y {ENV_SIZE[1]} +X {ENV_SIZE[0]}\n".encode()
    (out / f"{name}-env.hdr").write_bytes(env_header + encode(env).tobytes())
    disc = cos_angle > np.cos(np.radians(SUN_DISC))
    sun_colour = np.percentile(image[disc], 90, axis=0)
    sun_colour = sun_colour / sun_colour.max()
    band = (np.degrees(latitudes) > HORIZON_BAND[0]) & (np.degrees(latitudes) < HORIZON_BAND[1])
    horizon_radiance = image[band].mean(axis=(0, 1))
    (out / f"{name}.json").write_text(
        json.dumps(
            {
                "elevation": float(elevation),
                "azimuth": float(azimuth),
                "keepTop": keep / height,
                "skyRadiance": [float(v) for v in sky_radiance],
                "horizon": [float(v) for v in horizon_radiance],
                "sunColor": [float(v) for v in sun_colour],
            },
            indent=2,
        )
        + "\n"
    )
    print("sun elevation", np.degrees(elevation), "azimuth", np.degrees(azimuth), "sky radiance", sky_radiance, "kept rows", keep, "of", height)


if __name__ == "__main__":
    main()
