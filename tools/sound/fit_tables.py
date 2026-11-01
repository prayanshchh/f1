import argparse
import json
import pathlib
import subprocess
import tempfile

import numpy as np
from scipy import ndimage, signal

SAMPLE_RATE = 48000
HOP_SECONDS = 0.02
HOP = int(HOP_SECONDS * SAMPLE_RATE)
WINDOW = 4096
FFT_SIZE = 8192
ORDERS = 96
RPM_AXIS = np.arange(5000, 13501, 500)
BAND_EDGES = np.geomspace(40, 16000, 37)
FREQUENCIES = np.fft.rfftfreq(FFT_SIZE, 1 / SAMPLE_RATE)
BIN_HZ = SAMPLE_RATE / FFT_SIZE
ALL_ENGINE_CLIP = "P-zmZ6ADvGE"
RACE_CLIP = "guiOElY7zbU"
CHASE_SECTIONS = [("chase_a", ALL_ENGINE_CLIP, 5.0, 11.3), ("chase_b", ALL_ENGINE_CLIP, 39.6, 11.5)]
RACE_SECTION = ("race", RACE_CLIP, 5.0, 400.0)
FIT_SECTIONS = [*CHASE_SECTIONS, ("race_fit", RACE_CLIP, 5.0, 120.0)]
CHUNK_SECONDS = 60
PAD_SAMPLES = 2048


def load_audio(path, start, length):
    command = ["ffmpeg", "-v", "error", "-ss", str(start), "-i", str(path), "-t", str(length)]
    command += ["-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"]
    output = subprocess.run(command, capture_output=True, check=True).stdout
    return np.frombuffer(output, dtype=np.float32)


def fetch_clip(clip, folder):
    matches = list(folder.glob(f"{clip}.webm"))
    if matches:
        return matches[0]
    url = f"https://www.youtube.com/watch?v={clip}"
    target = str(folder / f"{clip}.%(ext)s")
    subprocess.run(["yt-dlp", "-q", "-f", "bestaudio", "-o", target, url], check=True)
    return next(folder.glob(f"{clip}.*"))


def spectrum(samples):
    window = signal.get_window("hann", WINDOW)
    frames = np.lib.stride_tricks.sliding_window_view(samples, WINDOW)[::HOP]
    return np.abs(np.fft.rfft(frames * window, FFT_SIZE, axis=1))


def viterbi(salience, candidates):
    count, states = salience.shape
    logs = np.log(candidates)
    jump = np.abs(logs[:, None] - logs[None, :])
    transition = -jump * 120 - np.maximum(jump - 0.25, 0) * 300
    score = salience[0].copy()
    back = np.zeros((count, states), dtype=int)
    for frame in range(1, count):
        step = score[None, :] + transition
        back[frame] = step.argmax(1)
        score = step.max(1) + salience[frame]
    path = np.zeros(count, dtype=int)
    path[-1] = score.argmax()
    for frame in range(count - 2, -1, -1):
        path[frame] = back[frame + 1, path[frame + 1]]
    return candidates[path], salience[np.arange(count), path] - np.median(salience, axis=1)


def refine(magnitudes, cycle):
    refined = cycle.copy()
    for frame, centre in enumerate(cycle):
        estimates = []
        weights = []
        for multiple in range(2, 17):
            index = int(round(centre * multiple / BIN_HZ))
            reach = max(1, int(0.02 * centre * multiple / BIN_HZ))
            low = max(index - reach, 1)
            peak = magnitudes[frame, low : index + reach + 1].argmax() + low
            a, b, c = np.log(magnitudes[frame, peak - 1 : peak + 2] + 1e-9)
            offset = np.clip(0.5 * (a - c) / (a - 2 * b + c + 1e-9), -1, 1)
            estimates.append((peak + offset) * BIN_HZ / multiple)
            weights.append(magnitudes[frame, peak])
        if sum(weights) > 0:
            refined[frame] = np.average(estimates, weights=weights)
    return refined


def track_rpm(samples):
    magnitudes = spectrum(samples)
    whitened = np.log(magnitudes + 1e-5)
    whitened -= ndimage.uniform_filter1d(whitened, 41, axis=1)
    candidates = np.geomspace(36.0, 125.0, 300)
    multiples = np.arange(1, 25)
    top = magnitudes.shape[1] - 1
    on_line = np.clip(np.round(np.outer(candidates, multiples) / BIN_HZ).astype(int), 0, top)
    between = np.clip(np.round(np.outer(candidates, multiples - 0.5) / BIN_HZ).astype(int), 0, top)
    salience = whitened[:, on_line].sum(axis=2) - whitened[:, between].sum(axis=2)
    cycle, confidence = viterbi(salience, candidates)
    return refine(magnitudes, cycle) * 120, confidence, magnitudes * 2 / (0.5 * WINDOW)


def measure_frames(rpm, magnitudes):
    count = min(len(rpm), len(magnitudes))
    orders = np.zeros((count, ORDERS))
    noise = np.zeros((count, len(BAND_EDGES) - 1))
    for frame in range(count):
        lines = rpm[frame] / 120 * np.arange(1, ORDERS + 1)
        indices = np.round(lines / BIN_HZ).astype(int)
        reaches = np.maximum(1, (0.006 * lines / BIN_HZ).astype(int))
        for order in range(ORDERS):
            if lines[order] < 20000:
                low = max(indices[order] - reaches[order], 0)
                orders[frame, order] = magnitudes[frame, low : indices[order] + reaches[order] + 1].max()
        mask = np.ones(magnitudes.shape[1], dtype=bool)
        for index in indices[indices < magnitudes.shape[1] - 4]:
            mask[max(index - 2, 0) : index + 3] = False
        for band in range(len(BAND_EDGES) - 1):
            inside = (FREQUENCIES >= BAND_EDGES[band]) & (FREQUENCIES < BAND_EDGES[band + 1])
            chosen = inside & mask if (inside & mask).any() else inside
            noise[frame, band] = np.sqrt(np.median(magnitudes[frame, chosen] ** 2) + 1e-16)
    return orders, noise


def analyse(samples):
    parts = []
    for begin in range(0, len(samples), CHUNK_SECONDS * SAMPLE_RATE):
        chunk = samples[begin : begin + CHUNK_SECONDS * SAMPLE_RATE]
        if len(chunk) < 2 * SAMPLE_RATE:
            continue
        rpm, confidence, magnitudes = track_rpm(chunk)
        orders, noise = measure_frames(rpm, magnitudes)
        count = len(orders)
        parts.append((rpm[:count], confidence[:count], orders, noise))
    rpm, confidence, orders, noise = (np.concatenate(items) for items in zip(*parts))
    smooth = np.gradient(ndimage.gaussian_filter1d(rpm, 6), HOP_SECONDS)
    fast = np.abs(np.gradient(ndimage.gaussian_filter1d(rpm, 1.5), HOP_SECONDS))
    good = (confidence > np.percentile(confidence, 15)) & (fast < 6000)
    return {"rpm": rpm, "orders": orders, "noise": noise, "on": good & (smooth > 150), "off": good & (smooth < -1000)}


def table(rpm, values, mask):
    result = np.full((len(RPM_AXIS), values.shape[1]), np.nan)
    for row, centre in enumerate(RPM_AXIS):
        chosen = mask & (np.abs(rpm - centre) < 250)
        if chosen.sum() >= 12:
            result[row] = 20 * np.log10(np.median(values[chosen], axis=0) + 1e-7)
    return result


def tables_of(measured):
    rpm = measured["rpm"]
    return {
        "on": table(rpm, measured["orders"], measured["on"]),
        "off": table(rpm, measured["orders"], measured["off"]),
        "noiseOn": table(rpm, measured["noise"], measured["on"]),
        "noiseOff": table(rpm, measured["noise"], measured["off"]),
    }


def filled(values):
    result = values.copy()
    for column in range(result.shape[1]):
        known = ~np.isnan(result[:, column])
        result[:, column] = np.interp(RPM_AXIS, RPM_AXIS[known], result[known, column]) if known.any() else -90
    return result


def merged_with_chase(race, chase):
    overlap = (RPM_AXIS >= 11000) & (RPM_AXIS <= 12000)
    offset = np.nan_to_num(np.nanmedian(chase[overlap] - race[overlap], axis=0))
    base = filled(race) + offset
    top = filled(chase)
    missing = np.isnan(chase[:, 0])
    top[missing] = base[missing]
    blend = np.clip((RPM_AXIS - 10500) / 500, 0, 1)[:, None]
    return base * (1 - blend) + top * blend, offset


def initial_tables(chase_tables, race_tables):
    chase = {key: np.nanmean([item[key] for item in chase_tables], axis=0) for key in chase_tables[0]}
    on, order_offset = merged_with_chase(race_tables["on"], chase["on"])
    noise_on, noise_offset = merged_with_chase(race_tables["noiseOn"], chase["noiseOn"])
    soften = lambda values: ndimage.gaussian_filter1d(values, 0.8, axis=0)
    return {
        "on": soften(on),
        "off": soften(filled(race_tables["off"]) + ndimage.median_filter(order_offset, 3)),
        "noiseOn": soften(noise_on),
        "noiseOff": soften(filled(race_tables["noiseOff"]) + noise_offset),
    }


def sustained(mask, frames=20):
    labels, count = ndimage.label(mask)
    result = np.zeros(len(mask), dtype=bool)
    for label in range(1, count + 1):
        region = labels == label
        if region.sum() >= frames:
            result |= region
    return result


def throttle_track(measured):
    lifted = sustained(measured["off"])
    load = np.zeros(len(measured["rpm"]))
    current = 1.0
    for frame in range(len(load)):
        current = 1.0 if measured["on"][frame] else 0.0 if lifted[frame] else current
        load[frame] = current
    return load


def render(tables_path, measured, folder, repo):
    replay = folder / "replay.json"
    output = folder / "render.f32"
    channels = {
        "rpm": np.round(measured["rpm"], 1).tolist(),
        "load": throttle_track(measured).tolist(),
        "speed": [60.0] * len(measured["rpm"]),
    }
    replay.write_text(json.dumps({"hop": HOP_SECONDS, "channels": channels}))
    command = ["pnpm", "exec", "node", "--no-warnings", "tools/sound/replay.mjs", str(tables_path), str(replay), str(output)]
    subprocess.run(command, cwd=repo, check=True)
    samples = np.fromfile(output, dtype=np.float32).reshape(-1, 2).mean(axis=1)
    return np.concatenate([np.zeros(PAD_SAMPLES, dtype=np.float32), samples])


def to_json(tables):
    payload = {"rpm": RPM_AXIS.tolist(), "bands": np.round(BAND_EDGES, 2).tolist()}
    payload.update({key: np.round(values, 1).tolist() for key, values in tables.items()})
    return json.dumps(payload, separators=(",", ":"))


def refine_tables(tables, references, measured_clips, folder, repo, rounds):
    tables_path = folder / "tables.json"
    for _ in range(rounds):
        tables_path.write_text(to_json(tables))
        errors = {key: [] for key in tables}
        for name, measured in measured_clips.items():
            synthetic = render(tables_path, measured, folder, repo)[: len(references[name])]
            ours = analyse(synthetic)
            ours["on"], ours["off"] = measured["on"][: len(ours["rpm"])], measured["off"][: len(ours["rpm"])]
            ours["rpm"] = measured["rpm"][: len(ours["rpm"])]
            fitted = tables_of(ours)
            target = tables_of(measured)
            for key in tables:
                errors[key].append(target[key] - fitted[key])
        for key in tables:
            step = np.nan_to_num(np.nanmean(errors[key], axis=0))
            tables[key] = tables[key] + np.clip(step, -12, 12) * 0.7
    return tables


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--clips", type=pathlib.Path, required=True)
    parser.add_argument("--out", type=pathlib.Path, required=True)
    parser.add_argument("--rounds", type=int, default=4)
    args = parser.parse_args()
    repo = pathlib.Path(__file__).resolve().parents[2]
    args.clips.mkdir(parents=True, exist_ok=True)
    source = lambda section: load_audio(fetch_clip(section[1], args.clips), section[2], section[3])
    chase = [tables_of(analyse(source(section))) for section in CHASE_SECTIONS]
    race = tables_of(analyse(source(RACE_SECTION)))
    tables = initial_tables(chase, race)
    references = {section[0]: source(section) for section in FIT_SECTIONS}
    measured = {name: analyse(samples) for name, samples in references.items()}
    with tempfile.TemporaryDirectory() as folder:
        tables = refine_tables(tables, references, measured, pathlib.Path(folder), repo, args.rounds)
    args.out.write_text(to_json(tables))


if __name__ == "__main__":
    main()
