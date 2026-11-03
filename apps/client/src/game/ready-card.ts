import type { PadLink } from "./pad.ts";

const pedalStart = 0.6;

function part(root: HTMLElement, name: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(`[data-ready=${name}]`);
  if (!found) throw new Error(`missing ready card element ${name}`);
  return found;
}

export function readyCard(root: HTMLElement, pad: PadLink): Promise<void> {
  const linked = part(root, "linked");
  const unlinked = part(root, "unlinked");
  const pedal = part(root, "pedal");
  root.hidden = false;
  return new Promise((done) => {
    let frame = 0;
    const finish = () => {
      window.removeEventListener("keydown", onKey, true);
      cancelAnimationFrame(frame);
      root.hidden = true;
      done();
    };
    const onKey = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      event.preventDefault();
      if (event.repeat) return;
      if (event.key === "Enter") finish();
    };
    const watch = () => {
      const connected = pad.connected;
      root.classList.toggle("behind", pad.panelOpen);
      linked.hidden = !connected;
      unlinked.hidden = connected;
      pedal.hidden = !connected;
      const throttle = pad.current(performance.now() / 1000)?.throttle ?? 0;
      if (connected && throttle > pedalStart) {
        finish();
        return;
      }
      frame = requestAnimationFrame(watch);
    };
    window.addEventListener("keydown", onKey, true);
    part(root, "go").addEventListener("click", finish, { once: true });
    watch();
  });
}
