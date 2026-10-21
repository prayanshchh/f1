import { createShifts, idleInput, requirePositive } from "./state.ts";

const bindings = {
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  throttle: ["ArrowUp", "KeyW"],
  brake: ["ArrowDown", "KeyS"],
  shiftUp: ["KeyE"],
  shiftDown: ["KeyQ"],
};
const gameKeys = new Set(Object.values(bindings).flat());

function approach(value: number, target: number, step: number): number {
  return (
    value + Math.sign(target - value) * Math.min(Math.abs(target - value), step)
  );
}

export function createKeyboard() {
  const held = new Set<string>();
  const shifts = createShifts();
  let state = idleInput();
  const pressed = (codes: string[]) => codes.some((code) => held.has(code));
  const updateShifts = () => {
    shifts.update(pressed(bindings.shiftUp), pressed(bindings.shiftDown));
  };
  return {
    keyDown(code: string, repeat = false) {
      if (!repeat && gameKeys.has(code)) {
        held.add(code);
        updateShifts();
      }
    },
    keyUp(code: string) {
      held.delete(code);
      updateShifts();
    },
    sample(dt: number) {
      requirePositive(dt, "Time step");
      const target =
        Number(pressed(bindings.left)) - Number(pressed(bindings.right));
      state = {
        steer: approach(state.steer, target, dt / (target === 0 ? 0.15 : 0.25)),
        throttle: approach(
          state.throttle,
          Number(pressed(bindings.throttle)),
          dt / 0.1,
        ),
        brake: approach(state.brake, Number(pressed(bindings.brake)), dt / 0.1),
        ...shifts.consume(),
      };
      return { ...state };
    },
    reset() {
      held.clear();
      shifts.reset();
      state = idleInput();
    },
  };
}

export function attachKeyboard(
  target: EventTarget,
  keyboard: ReturnType<typeof createKeyboard>,
) {
  const forward = (event: Event) => {
    if (
      !("code" in event) ||
      typeof event.code !== "string" ||
      !gameKeys.has(event.code)
    ) {
      return;
    }
    event.preventDefault();
    if (event.type === "keydown") {
      keyboard.keyDown(event.code, "repeat" in event && event.repeat === true);
    } else {
      keyboard.keyUp(event.code);
    }
  };
  const reset = () => {
    keyboard.reset();
  };
  target.addEventListener("keydown", forward);
  target.addEventListener("keyup", forward);
  target.addEventListener("blur", reset);
  return () => {
    target.removeEventListener("keydown", forward);
    target.removeEventListener("keyup", forward);
    target.removeEventListener("blur", reset);
    keyboard.reset();
  };
}
