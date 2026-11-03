import json
import sys
from pathlib import Path

import numpy as np
from scipy import sparse
from scipy.sparse.linalg import splu

EDGE_MARGIN = 1.15
KERB_USE = 0.8
CURVATURE_SMOOTHING = 2
ADMM_RHO = 0.05
ADMM_ITERATIONS = 4000
WEIGHT_WINDOW = 10
WEIGHT_FLOOR = 0.5
GRAVITY = 9.81
GRIP = 2.2
DOWNFORCE_PER_AERO = 0.00032
DOWNFORCE_FACTOR = 3
GRIP_FACTOR = 1.0
BRAKE_GRIP = 2.27
DRAG = 0.000675
POWER = 725.0
TRACTION_SHARE = 0.66
TOP_SPEED = 100.0
YAW_LIMIT = 1.05
SPEED_ITERATIONS = 3


def load(directory):
    return json.loads((directory / "track.json").read_text())


def frame(track):
    c = track["centerline"]
    p = np.array([[q["x"], q["z"]] for q in c])
    y = np.array([q["y"] for q in c])
    half = np.array([q["width"] for q in c]) / 2
    camber = np.array([q["camber"] for q in c])
    forward = np.roll(p, -1, 0) - np.roll(p, 1, 0)
    forward /= np.linalg.norm(forward, axis=1)[:, None]
    left = np.stack([forward[:, 1], -forward[:, 0]], 1)
    return p, y, half, camber, left


def kerb_mask(track, side, count):
    step = track["length"] / count
    distance = np.arange(count) * step
    mask = np.zeros(count, bool)
    for s in track["surfaces"]:
        if s["kind"] != "kerb" or s["side"] != side:
            continue
        if s["from"] <= s["to"]:
            mask |= (distance >= s["from"]) & (distance <= s["to"])
        else:
            mask |= (distance >= s["from"]) | (distance <= s["to"])
    return mask * track["surfaces"][0]["width"] * KERB_USE


def second_difference(count):
    i = np.arange(count)
    rows = np.concatenate([i, i, i])
    cols = np.concatenate([(i - 1) % count, i, (i + 1) % count])
    data = np.concatenate([np.ones(count), -2 * np.ones(count), np.ones(count)])
    return sparse.csr_matrix((data, (rows, cols)), shape=(count, count))


def minimum_curvature(p, left, low, high, weight):
    d2 = second_difference(len(p))
    a = sparse.vstack([d2.multiply(left[:, 0][None, :]), d2.multiply(left[:, 1][None, :])]).tocsc()
    b = -np.concatenate([d2 @ p[:, 0], d2 @ p[:, 1]])
    w = sparse.diags(np.concatenate([weight, weight]))
    system = splu((a.T @ w @ a + ADMM_RHO * sparse.identity(len(p))).tocsc())
    target = a.T @ w @ b
    z = np.clip(np.zeros(len(p)), low, high)
    u = np.zeros(len(p))
    for _ in range(ADMM_ITERATIONS):
        x = system.solve(target + ADMM_RHO * (z - u))
        z = np.clip(x + u, low, high)
        u += x - z
    return z


def spread_weight(line, step):
    k = np.abs(curvature(line, step))
    width = WEIGHT_WINDOW
    padded = np.concatenate([k[-width:], k, k[:width]])
    w = np.convolve(padded, np.ones(2 * width + 1) / (2 * width + 1), "valid") / k.mean() + WEIGHT_FLOOR
    return w / w.mean()


def curvature(line, step):
    forward = np.roll(line, -1, 0) - line
    heading = np.arctan2(forward[:, 1], forward[:, 0])
    turn = np.angle(np.exp(1j * (heading - np.roll(heading, 1))))
    width = CURVATURE_SMOOTHING
    kernel = np.ones(2 * width + 1) / (2 * width + 1)
    padded = np.concatenate([turn[-width:], turn, turn[:width]])
    return np.convolve(padded, kernel, "valid") / step


def lateral_limit(v, car):
    downforce, grip = car
    return GRIP * grip * (GRAVITY + downforce * v * v)


def remaining(v, k, limit, car):
    used = np.minimum(1.0, (k * v * v / lateral_limit(v, car)) ** 2)
    return limit * np.sqrt(1.0 - used)


def accel_limit(v, k, slope, car):
    v = max(v, 5.0)
    traction = remaining(v, k, TRACTION_SHARE * lateral_limit(v, car), car)
    return min(POWER / v, traction) - DRAG * v * v - GRAVITY * slope


def brake_limit(v, k, slope, car):
    grip = remaining(v, k, BRAKE_GRIP / GRIP * lateral_limit(v, car), car)
    return grip + DRAG * v * v + GRAVITY * slope


def corner_speed(k, car):
    k = np.maximum(np.abs(k), 1e-6)
    v = np.full_like(k, TOP_SPEED)
    for _ in range(30):
        v = np.minimum(TOP_SPEED, np.minimum(np.sqrt(lateral_limit(v, car) / k), YAW_LIMIT / k))
    return v


def profile(k, slope, step, car):
    count = len(k)
    limit = corner_speed(k, car)
    start = int(np.argmin(limit))
    order = (start + np.arange(count)) % count
    braking = limit.copy()
    for _ in range(SPEED_ITERATIONS):
        for j in order[::-1]:
            nxt = (j + 1) % count
            v = braking[nxt]
            reach = np.sqrt(v * v + 2 * step * brake_limit(v, k[nxt], -slope[j], car))
            braking[j] = min(limit[j], reach)
    speed = braking.copy()
    for _ in range(SPEED_ITERATIONS):
        for j in order:
            prev = (j - 1) % count
            v = speed[prev]
            reach = np.sqrt(max(0.0, v * v + 2 * step * accel_limit(v, k[prev], slope[prev], car)))
            speed[j] = min(braking[j], reach)
    return speed, braking


def rounded(values, digits):
    return [round(float(v), digits) for v in values]


def build(track):
    p, y, half, camber, left = frame(track)
    count = len(p)
    step = track["length"] / count
    low = -(half - EDGE_MARGIN + kerb_mask(track, "right", count))
    high = half - EDGE_MARGIN + kerb_mask(track, "left", count)
    offset = minimum_curvature(p, left, low, high, np.ones(count))
    offset = minimum_curvature(p, left, low, high, spread_weight(p + offset[:, None] * left, step))
    line = p + offset[:, None] * left
    height = y + offset * camber
    k = curvature(line, step)
    slope = (np.roll(height, -1) - height) / step
    speed, braking = profile(k, slope, step, (DOWNFORCE_PER_AERO * DOWNFORCE_FACTOR, GRIP_FACTOR))
    return {
        "length": track["length"],
        "x": rounded(line[:, 0], 3),
        "y": rounded(height, 3),
        "z": rounded(line[:, 1], 3),
        "profile": {
            "lapTime": round(float(np.sum(step / speed)), 2),
            "speed": rounded(speed, 2),
            "braking": rounded(braking, 2),
        },
    }


def main():
    directory = Path(sys.argv[1] if len(sys.argv) > 1 else "content/tracks/hill-country")
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else directory
    result = build(load(directory))
    (out / "racing-line.json").write_text(json.dumps(result, separators=(",", ":")) + "\n")
    p = result["profile"]
    print(f"lap {p['lapTime']:.2f} s, top {max(p['speed']) * 3.6:.0f} km/h")


if __name__ == "__main__":
    main()
