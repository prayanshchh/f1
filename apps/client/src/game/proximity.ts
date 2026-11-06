import { carField, carStride } from "./frame-layout.ts";
import { putStyle } from "./hud-dom.ts";

const behindReach = 14;
const aheadReach = 2.5;
const sideReach = 6;
const steepest = 50;
const solidFrom = 0.15;

interface Alongside {
  strength: number;
  angle: number;
}

export interface Proximity {
  left: Alongside | null;
  right: Alongside | null;
}

function closeness(along: number, side: number): number {
  if (along > aheadReach) return 0;
  const behind = Math.max(0, -along) / behindReach;
  return Math.max(0, 1 - Math.hypot(behind, side / sideReach));
}

function closer(current: Alongside | null, next: Alongside): Alongside {
  return current && current.strength >= next.strength ? current : next;
}

function at(cars: Float64Array, index: number): number {
  return cars[index] ?? 0;
}

function place(found: Proximity, cars: Float64Array, row: number): void {
  if (at(cars, row + carField.visible) === 0) return;
  const dx = at(cars, row + 12) - at(cars, 12);
  const dy = at(cars, row + 13) - at(cars, 13);
  const along = dx * at(cars, 0) + dy * at(cars, 1);
  const side = dx * at(cars, 4) + dy * at(cars, 5);
  const strength = closeness(along, side);
  if (strength <= 0) return;
  const tilt = (Math.atan2(-along, Math.abs(side)) * 180) / Math.PI;
  const near = {
    strength,
    angle: Math.min(steepest, Math.max(-steepest, tilt)),
  };
  if (side > 0) found.left = closer(found.left, near);
  else found.right = closer(found.right, near);
}

export function proximity(cars: Float64Array): Proximity {
  const found: Proximity = { left: null, right: null };
  const count = Math.floor(cars.length / carStride);
  for (let i = 1; i < count; i++) place(found, cars, i * carStride);
  return found;
}

function show(arrow: HTMLElement, near: Alongside | null): void {
  const opacity = near ? Math.min(1, near.strength / solidFrom) : 0;
  putStyle(arrow, "opacity", opacity.toFixed(2));
  if (near) putStyle(arrow, "--tilt", `${near.angle.toFixed(0)}deg`);
}

export class ProximityArrows {
  constructor(
    private readonly left: HTMLElement,
    private readonly right: HTMLElement,
  ) {}

  update(cars: Float64Array): void {
    const found = proximity(cars);
    show(this.left, found.left);
    show(this.right, found.right);
  }
}
