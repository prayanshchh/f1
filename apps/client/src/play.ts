import { Runtime } from "./runtime/runtime.ts";
import { idleInput } from "./runtime/shared.ts";

const runtime = new Runtime();
Object.assign(window, { f1: runtime });
const held = new Set<string>();
const controls = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Shift",
  "Control",
]);

function updateKeyboard(event: KeyboardEvent): void {
  if (!controls.has(event.key)) {
    return;
  }
  event.preventDefault();
  if (event.type === "keydown") {
    held.add(event.key);
  } else {
    held.delete(event.key);
  }
  const input = {
    steer: Number(held.has("ArrowLeft")) - Number(held.has("ArrowRight")),
    throttle: Number(held.has("ArrowUp")),
    brake: Number(held.has("ArrowDown")),
    shiftUp: event.type === "keydown" && event.key === "Shift" && !event.repeat,
    shiftDown:
      event.type === "keydown" && event.key === "Control" && !event.repeat,
  };
  writeKeyboard(input);
}

function writeKeyboard(input: ReturnType<typeof idleInput>): void {
  try {
    runtime.setInput(input);
  } catch (error) {
    if (!(error instanceof Error) || error instanceof RangeError) {
      throw error;
    }
  }
}

window.addEventListener("keydown", updateKeyboard);
window.addEventListener("keyup", updateKeyboard);
window.addEventListener("blur", () => {
  held.clear();
  writeKeyboard(idleInput());
});
