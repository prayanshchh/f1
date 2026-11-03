import argparse
import hashlib
import json
import pathlib
import subprocess
import tempfile
import urllib.request

import numpy as np

SAMPLE_RATE = 48000
BITRATE = "160k"
PEAK_LIMIT = 0.98
ROOT = pathlib.Path(__file__).resolve().parents[2]
MUSIC = ROOT / "content" / "music"
SOURCES = MUSIC / "MUSIC-SOURCES.json"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fetch(url, target):
    if not target.exists():
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(request, timeout=120) as response:
            target.write_bytes(response.read())
    return target


def decode(path):
    command = ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "2", "-ar", str(SAMPLE_RATE)]
    command += ["-af", "aresample=filter_size=64:phase_shift=10:cutoff=0.97", "-f", "f32le", "-"]
    output = subprocess.run(command, capture_output=True, check=True).stdout
    return np.frombuffer(output, dtype=np.float32).reshape(-1, 2).copy()


def write_wav(samples, path):
    command = ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SAMPLE_RATE), "-ac", "2"]
    command += ["-i", "-", str(path)]
    subprocess.run(command, input=samples.astype(np.float32).tobytes(), check=True)


def loudness(path):
    command = ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path)]
    command += ["-af", "loudnorm=print_format=json", "-f", "null", "-"]
    report = subprocess.run(command, capture_output=True, text=True, check=True).stderr
    start = report.rindex("{")
    return float(json.loads(report[start : report.index("}", start) + 1])["input_i"])


def bake_loop(samples, start, end):
    first = round(start * SAMPLE_RATE)
    last = round(end * SAMPLE_RATE)
    tail = samples[last:]
    looped = samples[:last].copy()
    looped[first : first + len(tail)] += tail[: last - first]
    return looped


def encode(samples, target, scratch):
    wav = scratch / f"{target.stem}.wav"
    write_wav(samples, wav)
    command = ["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-c:a", "libopus"]
    command += ["-b:a", BITRATE, "-vbr", "on", "-map_metadata", "-1", str(target)]
    subprocess.run(command, check=True)


def build(track, target_lufs, cache, scratch):
    source = fetch(track["download_url"], cache / f"{track['cue']}{pathlib.Path(track['download_url'].split('?')[0]).suffix}")
    if digest(source) != track["download_sha256"]:
        raise SystemExit(f"{track['cue']}: download does not match download_sha256")
    samples = decode(source)
    measured = scratch / f"{track['cue']}-measure.wav"
    write_wav(samples, measured)
    samples *= 10 ** ((target_lufs - loudness(measured)) / 20)
    loop = track.get("loop")
    if loop:
        samples = bake_loop(samples, loop["start"], loop["end"])
    peak = float(np.abs(samples).max())
    if peak > PEAK_LIMIT:
        samples *= PEAK_LIMIT / peak
    target = MUSIC / track["file"]
    encode(samples, target, scratch)
    print(track["cue"], f"{len(samples) / SAMPLE_RATE:.2f}s", f"{target.stat().st_size / 1e6:.2f}MB", digest(target))


def main():
    parser = argparse.ArgumentParser(description="Download, level and encode the game music")
    parser.add_argument("--cache", type=pathlib.Path, required=True)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    sources = json.loads(SOURCES.read_text())
    with tempfile.TemporaryDirectory() as scratch:
        for track in sources["tracks"]:
            build(track, sources["target_lufs"], args.cache, pathlib.Path(scratch))


if __name__ == "__main__":
    main()
