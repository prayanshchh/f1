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
  if (glyph) box.append(el("i", "btn-glyph", glyph));
  box.append(el("span", "", label));
  return box;
}

export function revBars(className = "loader"): HTMLElement {
  const bars = el("div", className);
  bars.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 5; i++) bars.append(el("i"));
  return bars;
}

export function loading(label = "", className = ""): HTMLElement {
  const box = el("div", `loading ${className}`.trim());
  box.setAttribute("role", "status");
  box.append(revBars());
  if (label) box.append(el("span", "", label));
  return box;
}
