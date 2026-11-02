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
