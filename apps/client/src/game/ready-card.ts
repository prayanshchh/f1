import type { PadLink } from "./pad.ts";

function part(root: HTMLElement, name: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(`[data-ready=${name}]`);
  if (!found) throw new Error(`missing ready card element ${name}`);
  return found;
}

export function readyCard(root: HTMLElement, pad: PadLink): Promise<void> {
  const linked = part(root, "linked");
  const unlinked = part(root, "unlinked");
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
      frame = requestAnimationFrame(watch);
    };
    window.addEventListener("keydown", onKey, true);
    part(root, "go").addEventListener("click", finish, { once: true });
    watch();
  });
}
