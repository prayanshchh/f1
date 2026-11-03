export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function button(
  className: string,
  text: string,
  onClick: () => void,
): HTMLButtonElement {
  const node = el("button", className, text);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

export function prompt(glyph: string, label: string): HTMLElement {
  const box = el("span", "prompt");
  box.append(el("i", "btn-glyph", glyph), el("span", "", label));
  return box;
}

export function loading(label = "", className = ""): HTMLElement {
  const box = el("div", `loading ${className}`.trim());
  box.setAttribute("role", "status");
  const bars = document.querySelector("[data-loader]")?.cloneNode(true);
  if (bars instanceof HTMLElement) {
    bars.removeAttribute("data-loader");
    box.append(bars);
  }
  if (label) box.append(el("span", "", label));
  return box;
}
