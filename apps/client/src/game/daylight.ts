export interface SessionLight {
  elevation: number;
  afternoon: boolean;
  night: number;
  lamps: number;
}

const nightBelow = -2;
const lampsBelow = 14;
const lampsFull = 2;

function ramp(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

export function sessionLight(hours: number): SessionLight {
  const degrees = 90 - 15 * Math.abs(hours - 12);
  const night = degrees < nightBelow ? 1 : 0;
  return {
    elevation: (degrees * Math.PI) / 180,
    afternoon: hours > 12,
    night,
    lamps: Math.max(night, ramp(lampsBelow, lampsFull, degrees)),
  };
}
