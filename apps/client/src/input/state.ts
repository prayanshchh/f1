import type { Input } from "../contracts/index.ts";

export function idleInput(): Input {
  return {
    steer: 0,
    throttle: 0,
    brake: 0,
    shiftUp: false,
    shiftDown: false,
  };
}

export function clamp(value: number, minimum = -1, maximum = 1): number {
  return Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : 0;
}

export function requirePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and positive`);
  }
}

export function createShifts() {
  let heldUp = false;
  let heldDown = false;
  let pendingUp = false;
  let pendingDown = false;
  return {
    update(up: boolean, down: boolean) {
      pendingUp ||= up && !heldUp;
      pendingDown ||= down && !heldDown;
      heldUp = up;
      heldDown = down;
    },
    consume() {
      const shifts = { shiftUp: pendingUp, shiftDown: pendingDown };
      pendingUp = false;
      pendingDown = false;
      return shifts;
    },
    reset() {
      heldUp = false;
      heldDown = false;
      pendingUp = false;
      pendingDown = false;
    },
  };
}
