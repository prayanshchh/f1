import type { SynthState } from "./synth.ts";

interface WheelAudio {
  skid: number;
  spin: number;
  radius: number;
  surface: number;
  load: number;
}

export interface CarAudio {
  rpm: number;
  redline: number;
  throttle: number;
  brake: number;
  gear: number;
  speed: number;
  damage: number;
  wheels: WheelAudio[];
}

export const surfaces = { road: 0, kerb: 1, grass: 2, gravel: 3 } as const;

const audioRedline = 12900;
const minimumLoad = 200;
const minimumSpeed = 3;
const lockRatio = 0.45;
const lockSpeed = 6;
const scrubStart = 0.08;
const damageForFullImpact = 400;
const brakeFullSpeed = 70;

function grounded(wheel: WheelAudio, speed: number): boolean {
  return wheel.load > minimumLoad && speed > minimumSpeed;
}

function contact(car: CarAudio, surface: number): number {
  return Math.min(1, Math.sqrt(2 * share(car, surface)));
}

function share(car: CarAudio, surface: number): number {
  const hits = car.wheels.filter(
    (wheel) => wheel.surface === surface && grounded(wheel, car.speed),
  ).length;
  return hits / Math.max(1, car.wheels.length);
}

function wheelLock(wheel: WheelAudio, car: CarAudio): number {
  if (car.brake < 0.05 || car.speed < lockSpeed || wheel.load < minimumLoad)
    return 0;
  const ratio = Math.abs(wheel.spin * wheel.radius) / car.speed;
  return ratio >= lockRatio ? 0 : 1 - ratio / lockRatio;
}

function worstLock(car: CarAudio): number {
  return car.wheels.reduce(
    (worst, wheel) => Math.max(worst, wheelLock(wheel, car)),
    0,
  );
}

function worstScrub(car: CarAudio): number {
  const worst = car.wheels.reduce(
    (most, wheel) =>
      wheel.surface === surfaces.road && grounded(wheel, car.speed)
        ? Math.max(most, wheel.skid)
        : most,
    0,
  );
  return worst <= scrubStart ? 0 : (worst - scrubStart) / (1 - scrubStart);
}

export function soundState(
  car: CarAudio,
  previous: CarAudio | null,
  master: number,
): SynthState {
  const hit = previous ? car.damage - previous.damage : 0;
  return {
    rpm: (car.rpm * audioRedline) / Math.max(1, car.redline),
    load: Math.sqrt(Math.max(0, Math.min(1, car.throttle))),
    speed: car.speed,
    gear: car.gear,
    kerb: contact(car, surfaces.kerb),
    rough: Math.max(
      contact(car, surfaces.grass),
      contact(car, surfaces.gravel),
    ),
    scrub: worstScrub(car),
    lock: worstLock(car),
    brake: car.brake * Math.min(1, car.speed / brakeFullSpeed),
    impact: hit > 0 ? Math.min(1, hit / damageForFullImpact) : 0,
    master,
  };
}
