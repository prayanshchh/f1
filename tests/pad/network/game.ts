import { PadLink } from "../../../apps/client/src/game/pad.ts";

function element(name: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-pad=${name}]`);
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

const link = new PadLink(element("panel"), element("badge"));
Object.assign(window, {
  padGame: { input: () => link.current(performance.now() / 1000) },
});
