import argparse
import json
import pathlib
import subprocess
import tempfile

import numpy as np
from scipy import ndimage, optimize, signal

from fit_tables import SAMPLE_RATE, fetch_clip, load_audio

REFERENCE_CLIP = "NBmQRO8_d8I"
CLIP_SECONDS = 7.0
HIGH_PASS = 350
ONSET_DROP = 20
TONAL = 25
LIGHT_GAP = 0.6
PITCH_RANGE = (300, 800)
BODY = (0.01, 0.1)
BACKGROUND = (0.4, 0.95)
HARMONICS = 24
NOISE_FLOOR = -70
TRACK_WINDOW = 0.006
TRACK_HOP = 0.002
TRACK_END = 0.14
PRINT_WINDOW = 0.012
PRINT_TIMES = np.round(np.arange(0.0, 0.124, 0.004), 3)
PRINT_HARMONICS = 8
IDLE_RPM = 4160
IDLE_SECONDS = 2.0
NOISE_FRAME = 1024
NOISE_BEFORE = -0.35
NOISE_TIMES = np.round(np.arange(0.0, 0.37, 0.01), 3)
NOISE_PLATEAU = (0.1, 0.28)
NOISE_BAND = (1000, 12000)
NOISE_EDGES = [400, 1000, 2000, 4000, 8000, 16000]
NOISE_TAPS = 255
NOISE_SEED = 7
NOISE_SMOOTH = 1 / 6
NOISE_NEIGHBOURS = 3
MIN_RELEASE = 0.002


def high_pass(samples):
    sos = signal.butter(6, HIGH_PASS, "highpass", fs=SAMPLE_RATE, output="sos")
    return signal.sosfiltfilt(sos, samples)


def onsets(samples):
    envelope = np.abs(signal.hilbert(samples))
    smooth = np.convolve(envelope, np.ones(48) / 48, mode="same")
    level = 20 * np.log10(smooth + 1e-9)
    threshold = level.max() - ONSET_DROP
    found = []
    index = 0
    while index < len(level):
        if level[index] > threshold:
            found.append(index)
            index += int(LIGHT_GAP * SAMPLE_RATE)
        else:
            index += 1
    return found


def tonal(samples, start):
    a, b = (int(t * SAMPLE_RATE) for t in BODY)
    segment = samples[start + a : start + b]
    size = 1 << 15
    spectrum = np.abs(np.fft.rfft(segment * np.hanning(len(segment)), size))
    freqs = np.fft.rfftfreq(size, 1 / SAMPLE_RATE)
    band = spectrum[(freqs > PITCH_RANGE[0]) & (freqs < PITCH_RANGE[1])]
    return 20 * np.log10(band.max() / np.median(band)) > TONAL


def body(samples, starts):
    a, b = (int(t * SAMPLE_RATE) for t in BODY)
    return [samples[s + a : s + b] for s in starts]


def pitch(segments):
    size = 1 << 18
    freqs = np.fft.rfftfreq(size, 1 / SAMPLE_RATE)
    total = sum(np.abs(np.fft.rfft(s * np.hanning(len(s)), size)) for s in segments)
    band = (freqs > PITCH_RANGE[0]) & (freqs < PITCH_RANGE[1])
    peak = np.flatnonzero(band)[total[band].argmax()]
    left, mid, right = np.log(total[peak - 1 : peak + 2])
    offset = 0.5 * (left - right) / (left - 2 * mid + right)
    return float(freqs[peak] + offset * (freqs[1] - freqs[0]))


def tone_level(segment, frequency):
    times = np.arange(len(segment)) / SAMPLE_RATE
    window = np.hanning(len(segment))
    return abs(np.sum(segment * window * np.exp(-2j * np.pi * frequency * times)))


def harmonic_levels(segments, f0):
    count = min(HARMONICS, int((SAMPLE_RATE / 2 - 1000) / f0))
    levels = np.array(
        [np.mean([tone_level(s, f0 * h) for s in segments]) for h in range(1, count + 1)]
    )
    decibels = 20 * np.log10(levels / levels[0])
    return [round(float(d), 2) if d > NOISE_FLOOR else None for d in decibels]


def track(samples, starts, f0, window_seconds, times):
    size = int(window_seconds * SAMPLE_RATE)
    rows = []
    for t in times:
        offset = int(t * SAMPLE_RATE)
        rows.append(
            np.mean(
                [
                    [tone_level(samples[s + offset : s + offset + size], f0 * h) for h in range(1, PRINT_HARMONICS + 1)]
                    for s in starts
                ],
                axis=0,
            )
        )
    rows = np.array(rows)
    return 20 * np.log10(rows / rows[:, 0].max() + 1e-12)


def envelope_model(times, attack, decay, sustain, hold, release):
    rise = np.clip(times / attack, 0, 1)
    fall = sustain + (1 - sustain) * np.exp(-np.clip(times - attack, 0, None) / decay)
    gate = np.clip(1 - (times - hold) / release, 0, 1)
    return rise * np.where(times < attack, 1, fall) * gate


def fit_envelope(samples, starts, f0):
    times = np.arange(0, TRACK_END, TRACK_HOP)
    measured = track(samples, starts, f0, TRACK_WINDOW, times)[:, 0]
    size = int(TRACK_WINDOW * SAMPLE_RATE)
    kernel = np.hanning(size) / np.hanning(size).sum()
    fine = np.arange(-TRACK_WINDOW, TRACK_END + TRACK_WINDOW, 1 / SAMPLE_RATE)

    def error(params):
        attack, decay, sustain, hold, release = params
        if min(attack, decay, release) <= 0 or not 0 < sustain <= 1 or hold <= attack:
            return 1e6
        shape = envelope_model(np.clip(fine, 0, None), *params)
        shape[fine < 0] = 0
        smooth = np.convolve(shape, kernel, mode="same")
        model = np.interp(times + TRACK_WINDOW / 2, fine, smooth)
        model_db = np.maximum(20 * np.log10(model / model.max() + 1e-6), -30)
        return float(np.sqrt(np.mean((model_db - np.maximum(measured, -30)) ** 2)))

    fit = optimize.minimize(error, [0.003, 0.015, 0.45, 0.105, 0.008], method="Nelder-Mead", options={"xatol": 1e-5, "fatol": 1e-4, "maxiter": 4000})
    attack, decay, sustain, hold, release = fit.x
    print(f"envelope fit rms error {fit.fun:.2f} dB")
    return {
        "attack": round(float(attack), 4),
        "decay": round(float(decay), 4),
        "sustain": round(float(sustain), 3),
        "hold": round(float(hold), 4),
        "release": round(float(release), 4),
    }


def mulberry(seed, count):
    state = seed & 0xFFFFFFFF
    out = np.empty(count)
    for i in range(count):
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        t = state
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        out[i] = ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return (out * 2 - 1) * np.sqrt(3)


NOISE_FREQS = np.fft.rfftfreq(NOISE_FRAME, 1 / SAMPLE_RATE)


def frame_power(samples, start):
    segment = samples[start : start + NOISE_FRAME] * np.hanning(NOISE_FRAME)
    return np.abs(np.fft.rfft(segment)) ** 2


def tonal_bins(f0):
    mask = np.zeros(len(NOISE_FREQS), bool)
    for h in range(1, int(NOISE_FREQS[-1] / f0) + 1):
        mask |= np.abs(NOISE_FREQS - f0 * h) < 3 * SAMPLE_RATE / NOISE_FRAME
    return mask


def noise_power(samples, starts, f0, time, background):
    mask = tonal_bins(f0)
    offset = int(time * SAMPLE_RATE)
    power = np.mean([frame_power(samples, s + offset) for s in starts], axis=0)
    excess = np.maximum(power - background, 0)
    return np.interp(NOISE_FREQS, NOISE_FREQS[~mask], excess[~mask])


def background_power(samples, starts):
    offset = int(NOISE_BEFORE * SAMPLE_RATE)
    hop = NOISE_FRAME // 2
    return np.mean([frame_power(samples, s + offset + k * hop) for s in starts for k in range(4)], axis=0)


def smooth_octaves(power):
    out = np.empty_like(power)
    for i, f in enumerate(NOISE_FREQS):
        lo, hi = f * 2 ** (-NOISE_SMOOTH / 2), f * 2 ** (NOISE_SMOOTH / 2)
        band = (NOISE_FREQS >= lo) & (NOISE_FREQS <= hi)
        out[i] = power[band].mean() if band.any() else power[i]
    return out


def band_levels(power, f0, reference):
    mask = tonal_bins(f0)
    levels = []
    for lo, hi in zip(NOISE_EDGES, NOISE_EDGES[1:]):
        band = (NOISE_FREQS >= lo) & (NOISE_FREQS < hi) & ~mask
        levels.append(round(float(10 * np.log10(power[band].mean() / reference**2 + 1e-20)), 2))
    return levels


def band_total(power):
    band = (NOISE_FREQS >= NOISE_BAND[0]) & (NOISE_FREQS < NOISE_BAND[1])
    return power[band].sum()


def noise_envelope(times, attack, boost, decay, hold, release):
    rise = np.clip(times / attack, 0, 1)
    fall = 1 + (boost - 1) * np.exp(-np.clip(times - attack, 0, None) / decay)
    gate = np.clip(1 - (times - hold) / release, 0, 1)
    return rise * fall * gate


def fit_noise_envelope(levels, attack):
    window = np.hanning(NOISE_FRAME) ** 2
    window /= window.sum()
    fine = np.arange(0, NOISE_TIMES[-1] + NOISE_FRAME / SAMPLE_RATE, 1 / SAMPLE_RATE)

    def model(params):
        power = noise_envelope(fine, attack, *params) ** 2
        return np.array(
            [np.sum(power[int(t * SAMPLE_RATE) : int(t * SAMPLE_RATE) + NOISE_FRAME] * window) for t in NOISE_TIMES]
        )

    plateau = (NOISE_TIMES >= NOISE_PLATEAU[0]) & (NOISE_TIMES <= NOISE_PLATEAU[1])
    levels = ndimage.uniform_filter1d(levels, NOISE_NEIGHBOURS, mode="nearest")
    measured = 10 * np.log10(levels / levels[plateau].mean() + 1e-6)

    def error(params):
        boost, decay, hold, release = params
        if boost < 1 or decay <= 0 or release < MIN_RELEASE or hold <= attack:
            return 1e6
        ours = ndimage.uniform_filter1d(model(params), NOISE_NEIGHBOURS, mode="nearest")
        ours_db = 10 * np.log10(ours / ours[plateau].mean() + 1e-6)
        return float(np.sqrt(np.mean((np.maximum(ours_db, -20) - np.maximum(measured, -20)) ** 2)))

    fit = optimize.minimize(error, [2.0, 0.015, 0.3, 0.01], method="Nelder-Mead", options={"xatol": 1e-5, "fatol": 1e-4, "maxiter": 4000})
    boost, decay, hold, release = fit.x
    print(f"noise envelope fit rms error {fit.fun:.2f} dB")
    return {"boost": round(float(boost), 3), "decay": round(float(decay), 4), "hold": round(float(hold), 4), "release": round(float(release), 4)}, measured


def shaped_noise(kernel, count, seed):
    return signal.lfilter(kernel, [1.0], mulberry(seed, count))


def fit_noise(filtered, starts, f0, tone_reference, tone_render, attack):
    background = background_power(filtered, starts)
    over_time = [noise_power(filtered, starts, f0, t, background) for t in NOISE_TIMES]
    plateau = [p for t, p in zip(NOISE_TIMES, over_time) if NOISE_PLATEAU[0] <= t <= NOISE_PLATEAU[1]]
    shape = smooth_octaves(np.mean(plateau, axis=0))
    gains = np.sqrt(shape / shape.max())
    gains[0] = 0
    gains[-1] = 0
    kernel = signal.firwin2(NOISE_TAPS, NOISE_FREQS / NOISE_FREQS[-1], gains)
    test = shaped_noise(kernel, SAMPLE_RATE * 2, NOISE_SEED + 1)
    hop = NOISE_FRAME // 2
    rendered = np.mean([frame_power(test, k) for k in range(NOISE_TAPS, len(test) - NOISE_FRAME, hop)], axis=0)
    band = (NOISE_FREQS >= NOISE_BAND[0]) & (NOISE_FREQS < NOISE_BAND[1])
    scale = np.sqrt(band_total(shape) / tone_reference**2 * tone_render**2 / rendered[band].sum())
    envelope, measured = fit_noise_envelope(np.array([band_total(p) for p in over_time]), attack)
    print("noise levels per band (dB vs tone):", band_levels(shape, f0, tone_reference))
    noise = {"seed": NOISE_SEED, "kernel": [round(float(k), 7) for k in kernel * scale]}
    noise.update(envelope)
    fingerprint = {
        "edges": NOISE_EDGES,
        "frame": NOISE_FRAME,
        "neighbours": NOISE_NEIGHBOURS,
        "plateau": band_levels(np.mean(plateau, axis=0), f0, tone_reference),
        "times": NOISE_TIMES.tolist(),
        "envelope": [round(float(v), 2) for v in measured],
    }
    return noise, fingerprint


def a_weighting():
    poles = [12194.217] * 2 + [20.598997] * 2 + [107.65265, 737.86223]
    zeros, gain = [0, 0, 0, 0], (2 * np.pi * 12194.217) ** 2
    digital = signal.bilinear_zpk(zeros, [-2 * np.pi * p for p in poles], gain, SAMPLE_RATE)
    sos = signal.zpk2sos(*digital)
    _, response = signal.sosfreqz(sos, worN=[1000], fs=SAMPLE_RATE)
    return sos, 1 / abs(response[0])


def weighted_level(samples):
    sos, norm = a_weighting()
    weighted = signal.sosfilt(sos, samples) * norm
    return 10 * np.log10(np.mean(weighted**2))


def above_background(raw, starts):
    def window(span):
        a, b = (int(t * SAMPLE_RATE) for t in span)
        return np.mean([10 ** (weighted_level(raw[s + a : s + b]) / 10) for s in starts])

    beep = window(BODY)
    background = window(BACKGROUND)
    return 10 * np.log10(beep - background) - 10 * np.log10(background)


def idle_level(root):
    frames = int(IDLE_SECONDS / 0.02)
    replay = {"hop": 0.02, "channels": {"rpm": [IDLE_RPM] * frames, "speed": [0] * frames}}
    with tempfile.TemporaryDirectory() as folder:
        replay_path = pathlib.Path(folder) / "idle.json"
        output_path = pathlib.Path(folder) / "idle.f32"
        replay_path.write_text(json.dumps(replay))
        tables = root / "apps/client/src/game/sound/tables.json"
        subprocess.run(
            ["pnpm", "exec", "node", "tools/sound/replay.mjs", str(tables), str(replay_path), str(output_path)],
            cwd=root,
            check=True,
        )
        stereo = np.fromfile(output_path, dtype=np.float32).reshape(-1, 2)
    return weighted_level(stereo[SAMPLE_RATE // 2 :, 0].astype(np.float64))


def render_tone(beep, times):
    wave = np.zeros_like(times)
    for h, level in enumerate(beep["harmonics"], start=1):
        if level is not None:
            wave += 10 ** (level / 20) * np.sin(2 * np.pi * beep["pitch"] * h * times)
    wave /= np.abs(wave).max()
    return wave * envelope_model(times, beep["attack"], beep["decay"], beep["sustain"], beep["hold"], beep["release"])


def render(beep):
    noise = beep.get("noise")
    end = beep["hold"] + beep["release"]
    if noise:
        end = max(end, noise["hold"] + noise["release"])
    times = np.arange(int(end * SAMPLE_RATE) + 1) / SAMPLE_RATE
    wave = render_tone(beep, times)
    if noise:
        hiss = shaped_noise(np.array(noise["kernel"]), len(times), noise["seed"])
        wave = wave + hiss * noise_envelope(times, beep["attack"], noise["boost"], noise["decay"], noise["hold"], noise["release"])
    return wave * beep.get("gain", 1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--clips", type=pathlib.Path, required=True)
    parser.add_argument("--root", type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    args.clips.mkdir(parents=True, exist_ok=True)
    raw = load_audio(fetch_clip(REFERENCE_CLIP, args.clips), 0, CLIP_SECONDS).astype(np.float64)
    filtered = high_pass(raw)
    starts = [s for s in onsets(filtered) if tonal(filtered, s)]
    gaps = np.diff(starts) / SAMPLE_RATE
    print(f"onsets {[round(s / SAMPLE_RATE, 4) for s in starts]} gaps {np.round(gaps, 4).tolist()}")
    f0 = pitch(body(filtered, starts))
    print(f"pitch {f0:.2f} Hz")
    beep = {"pitch": round(f0, 2), "harmonics": harmonic_levels(body(filtered, starts), f0)}
    beep.update(fit_envelope(filtered, starts, f0))
    a, b = (int(t * SAMPLE_RATE) for t in BODY)
    tone_reference = np.mean([tone_level(s, f0) for s in body(filtered, starts)])
    tone_render = tone_level(render(beep)[a:b], f0)
    beep["noise"], noise_print = fit_noise(filtered, starts, f0, tone_reference, tone_render, beep["attack"])
    lift = above_background(raw, starts)
    idle = idle_level(args.root)
    beep["gain"] = round(float(10 ** ((idle + lift - weighted_level(render(beep)[a:b])) / 20)), 4)
    print(f"beep {lift:+.1f} dB(A) over the reference background; game idle {idle:.1f} dB(A); gain {beep['gain']}")
    fingerprint = {
        "clip": REFERENCE_CLIP,
        "pitch": beep["pitch"],
        "interval": round(float(np.mean(gaps)), 4),
        "aboveIdle": round(float(lift), 2),
        "harmonics": beep["harmonics"][:PRINT_HARMONICS],
        "window": PRINT_WINDOW,
        "times": PRINT_TIMES.tolist(),
        "envelope": [round(float(v), 2) for v in track(filtered, starts, f0, PRINT_WINDOW, PRINT_TIMES)[:, 0]],
        "noise": noise_print,
    }
    sound = args.root / "apps/client/src/game/sound/start-beep.json"
    sound.write_text(json.dumps(beep, indent=2) + "\n")
    print_path = args.root / "tests/sound/start-beep-fingerprint.json"
    print_path.write_text(json.dumps(fingerprint, indent=2) + "\n")
    print(f"wrote {sound.relative_to(args.root)} and {print_path.relative_to(args.root)}")


if __name__ == "__main__":
    main()
