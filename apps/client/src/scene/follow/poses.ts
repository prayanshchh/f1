import { PHYSICS_HZ, type Quat, type Vec3 } from "../../contracts/index.ts";

export interface PoseSample {
  tick: number;
  position: Vec3;
  orientation: Quat;
}

function interpolate(a: PoseSample, b: PoseSample, tick: number): PoseSample {
  const alpha = (tick - a.tick) / (b.tick - a.tick);
  const blend = (x: number, y: number) => x + alpha * (y - x);
  const p = a.orientation;
  const q = b.orientation;
  const sign = p.x * q.x + p.y * q.y + p.z * q.z + p.w * q.w < 0 ? -1 : 1;
  const orientation = {
    x: blend(p.x, sign * q.x),
    y: blend(p.y, sign * q.y),
    z: blend(p.z, sign * q.z),
    w: blend(p.w, sign * q.w),
  };
  const length = Math.hypot(...Object.values(orientation));
  for (const key of ["x", "y", "z", "w"] as const) orientation[key] /= length;
  return {
    tick,
    position: {
      x: blend(a.position.x, b.position.x),
      y: blend(a.position.y, b.position.y),
      z: blend(a.position.z, b.position.z),
    },
    orientation,
  };
}

export function createPoseBuffer(delayTicks: number) {
  const samples: { pose: PoseSample; receivedAt: number }[] = [];
  return {
    push(sample: PoseSample, receivedAt: number): void {
      const newest = samples.at(-1);
      if (newest !== undefined && sample.tick <= newest.pose.tick) return;
      samples.push({ pose: structuredClone(sample), receivedAt });
      if (samples.length > 16) samples.shift();
    },
    at(now: number): PoseSample | null {
      const newest = samples.at(-1);
      const oldest = samples[0];
      if (newest === undefined || oldest === undefined) return null;
      const tick = Math.min(
        newest.pose.tick,
        newest.pose.tick +
          ((now - newest.receivedAt) * PHYSICS_HZ) / 1000 -
          delayTicks,
      );
      if (tick <= oldest.pose.tick) return structuredClone(oldest.pose);
      for (let i = 1; i < samples.length; i += 1) {
        const a = samples[i - 1];
        const b = samples[i];
        if (a !== undefined && b !== undefined && tick <= b.pose.tick)
          return interpolate(a.pose, b.pose, tick);
      }
      return structuredClone(newest.pose);
    },
  };
}
