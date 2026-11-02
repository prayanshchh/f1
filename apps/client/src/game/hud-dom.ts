const written = new WeakMap<Element, Map<string, string | boolean>>();

function isNew(node: Element, key: string, value: string | boolean): boolean {
  let values = written.get(node);
  if (!values) {
    values = new Map();
    written.set(node, values);
  }
  if (values.get(key) === value) return false;
  values.set(key, value);
  return true;
}

export function putText(node: Element, value: string): void {
  if (isNew(node, "#text", value)) node.textContent = value;
}

export function putData(
  node: HTMLElement | SVGElement,
  key: string,
  value: string,
): void {
  if (isNew(node, key, value)) node.dataset[key] = value;
}

export function putAttr(node: Element, name: string, value: string): void {
  if (isNew(node, name, value)) node.setAttribute(name, value);
}

export function putHidden(node: HTMLElement, hidden: boolean): void {
  if (isNew(node, "#hidden", hidden)) node.hidden = hidden;
}

export function putStyle(
  node: HTMLElement | SVGElement,
  property: string,
  value: string,
): void {
  if (isNew(node, property, value)) node.style.setProperty(property, value);
}
