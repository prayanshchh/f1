import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np
import road
import trackside
root, build = road.arguments()
track = road.Track(root, build)
n = track.count
P = track.position[:, :2]
H = track.half
idx = np.arange(n)

def on_other_asphalt(points, own, margin=0.0, window=60):
    hits = np.zeros(len(points), bool)
    for start in range(0, n, 400):
        rows = idx[start:start + 400]
        d = np.linalg.norm(points[:, None, :] - P[None, rows, :], axis=2) - H[None, rows]
        far = np.abs(((rows[None, :] - own[:, None]) + n // 2) % n - n // 2) > window
        hits |= ((d < -margin) & far).any(axis=1)
    return hits

report = {}
terrain = np.load(build / "terrain.npz")
tx, ty, th = terrain["x"], terrain["y"], terrain["heights"]
def terrain_at(xy):
    fx = np.interp(xy[:, 0], tx, np.arange(len(tx)))
    fy = np.interp(xy[:, 1], ty, np.arange(len(ty)))
    x0 = np.clip(np.floor(fx).astype(int), 0, len(tx) - 2); y0 = np.clip(np.floor(fy).astype(int), 0, len(ty) - 2)
    ax, ay = fx - x0, fy - y0
    return (th[y0, x0] * (1 - ax) * (1 - ay) + th[y0, x0 + 1] * ax * (1 - ay) + th[y0 + 1, x0] * (1 - ax) * ay + th[y0 + 1, x0 + 1] * ax * ay)

for side, sign in ((0, 1), (1, -1)):
    name = "left" if side == 0 else "right"
    rail = track.rails[:, side]
    W = track.walls[:, side]
    front = P + track.normal * (sign * (W - 1.0))[:, None]
    verge = track.surface_height(idx, sign * (W - 1.0))
    report[f"{name}: terrain above grass in front of wall"] = int(((terrain_at(front) > verge + 0.02) & rail).sum())
    wall = P + track.normal * (sign * W)[:, None]
    seg = np.roll(wall, -1, 0) - wall
    forward = np.einsum("ij,ij->i", seg, track.tangent) / np.maximum(np.linalg.norm(seg, axis=1), 1e-9)
    report[f"{name}: wall turning back (<60 deg off track direction)"] = int(((forward < 0.5) & rail).sum())
    report[f"{name}: wall on other asphalt"] = int((on_other_asphalt(wall, idx) & rail).sum())
    mid_runoff = P + track.normal * (sign * (H + track.data["runoff"] / 2))[:, None]
    report[f"{name}: green band on other asphalt"] = int(on_other_asphalt(mid_runoff, idx).sum())
    for frac in (0.3, 0.6, 1.0):
        reach = H + (track.verge_offsets[:, side, -1] - H) * frac
        pts = P + track.normal * (sign * reach)[:, None]
        report[f"{name}: grass at {int(frac*100)}% reach on other asphalt"] = int(on_other_asphalt(pts, idx, margin=0.3).sum())
def visible_ground(rows, lateral, side):
    reach = track.verge_offsets[rows, side, -1]
    sign = 1 if side == 0 else -1
    xy = P[rows] + track.normal[rows] * (sign * lateral)[:, None]
    verge = track.surface_height(rows, sign * np.minimum(lateral, reach))
    return np.where(lateral <= reach, verge, terrain_at(xy))


steps = np.arange(0.0, 60.0, 1.0)
for side in (0, 1):
    name = "left" if side == 0 else "right"
    rows = idx[::5]
    profile = np.stack([visible_ground(rows, H[rows] + d, side) for d in steps], 1)
    jumps = np.abs(np.diff(profile, axis=1))
    report[f"{name}: ground steps over 0.25 m within 60 m of the edge"] = int((jumps > 0.25).sum())
    report[f"{name}: ground steeper than 60% within 60 m of the edge"] = int((jumps > 0.6).sum())
panels, _, _ = trackside.distance_boards(track, road.gaussian)
v, f, _ = panels.arrays()
centres = v.reshape(-1, 4, 3).mean(axis=1)[:, :2] if len(v) else np.zeros((0, 2))
own = np.array([np.argmin(np.linalg.norm(P - c, axis=1)) for c in centres], int)
report["distance boards"] = len(centres)
report["distance boards on asphalt"] = int(on_other_asphalt(centres, own, margin=-1.0, window=-1).sum()) if len(centres) else 0
problems = {k: v for k, v in report.items() if v and k != "distance boards"}
for k, val in report.items():
    print(f"{k}: {val}")
if problems:
    raise SystemExit(f"{len(problems)} trackside problems found")
