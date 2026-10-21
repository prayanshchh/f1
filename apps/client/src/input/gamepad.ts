import { clamp, createShifts, idleInput } from "./state.ts";

export interface GamepadLike {
  readonly mapping: string;
  readonly connected: boolean;
  readonly axes: readonly number[];
  readonly buttons: readonly {
    readonly value: number;
    readonly pressed: boolean;
  }[];
}

function pedal(pad: GamepadLike, index: number): number {
  return clamp(pad.buttons[index]?.value ?? 0, 0);
}

function bumper(pad: GamepadLike, index: number): boolean {
  return pad.buttons[index]?.pressed === true;
}

export function createGamepadReader() {
  const shifts = createShifts();
  return {
    read(pad: GamepadLike | null) {
      if (pad === null || !pad.connected || pad.mapping !== "standard") {
        shifts.reset();
        return idleInput();
      }
      const axis = clamp(pad.axes[0] ?? 0);
      const magnitude = Math.max(0, (Math.abs(axis) - 0.1) / 0.9);
      shifts.update(bumper(pad, 5), bumper(pad, 4));
      return {
        steer: magnitude === 0 ? 0 : -Math.sign(axis) * magnitude,
        throttle: pedal(pad, 7),
        brake: pedal(pad, 6),
        ...shifts.consume(),
      };
    },
  };
}
