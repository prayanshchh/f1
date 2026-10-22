import type { TrackData, Vec3 } from "../../contracts/index.ts";

interface Ribbon {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

function point(track: TrackData, index: number): Vec3 {
  const value =
    track.centerline[
      (index + track.centerline.length) % track.centerline.length
    ];
  if (value === undefined)
    throw new Error("The road needs at least three points");
  return value;
}

function validate(track: TrackData): void {
  if (track.centerline.length < 3)
    throw new Error("The road needs at least three points");
  if (!Number.isFinite(track.width) || track.width <= 0)
    throw new Error("The road width must be finite and positive");
  track.centerline.forEach((p, i) => {
    if (!Object.values(p).every(Number.isFinite))
      throw new Error("Road coordinates must be finite");
    const next = point(track, i + 1);
    if (Math.hypot(next.x - p.x, next.z - p.z) <= 1e-9)
      throw new Error("Road segments must have horizontal length");
  });
}

export function ribbon(track: TrackData): Ribbon {
  validate(track);
  const n = track.centerline.length;
  const positions = new Float32Array(6 * n);
  const colors = new Float32Array(6 * n);
  const indices = new Uint32Array(6 * n);
  track.centerline.forEach((p, i) => {
    const before = point(track, i - 1);
    const after = point(track, i + 1);
    const dx = after.x - before.x;
    const dz = after.z - before.z;
    const length = Math.hypot(dx, dz);
    if (length <= 1e-9)
      throw new Error("The road tangent must have horizontal length");
    const x = ((dz / length) * track.width) / 2;
    const z = ((-dx / length) * track.width) / 2;
    positions.set([p.x + x, p.y, p.z + z, p.x - x, p.y, p.z - z], 6 * i);
    colors.fill(0.3 + 0.12 * Math.sin(2.39996 * i), 6 * i, 6 * i + 6);
    const left = 2 * i;
    const next = 2 * ((i + 1) % n);
    indices.set([left, left + 1, next, left + 1, next + 1, next], 6 * i);
  });
  return { positions, colors, indices };
}
