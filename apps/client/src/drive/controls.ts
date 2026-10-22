import {
  attachKeyboard,
  createKeyboard,
  createGamepadReader,
} from "../input/index.ts";
import type { Input } from "../contracts/index.ts";

export function createControls(target: Window) {
  const keyboard = createKeyboard();
  attachKeyboard(target, keyboard);
  const pads = createGamepadReader();
  return {
    read(dt: number): Input {
      const k = keyboard.sample(dt);
      const pad =
        Array.from(target.navigator.getGamepads()).find(
          (p) => p !== null && p.connected && p.mapping === "standard",
        ) ?? null;
      const g = pads.read(pad);
      return {
        steer: Math.max(-1, Math.min(1, k.steer + g.steer)),
        throttle: Math.max(k.throttle, g.throttle),
        brake: Math.max(k.brake, g.brake),
        shiftUp: k.shiftUp || g.shiftUp,
        shiftDown: k.shiftDown || g.shiftDown,
      };
    },
  };
}
