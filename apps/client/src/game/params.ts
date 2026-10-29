export interface ParamFs {
  readFile(path: string, options: { encoding: "utf8" }): string;
  writeFile(path: string, data: string): void;
  analyzePath(path: string): { exists: boolean };
  mkdirTree(path: string): void;
}

export interface NumParam {
  value: number;
  min: number;
  max: number;
  unit: string;
}

export class ParamDoc {
  private constructor(private readonly doc: Document) {}

  static parse(text: string): ParamDoc {
    return new ParamDoc(
      new DOMParser().parseFromString(text, "application/xml"),
    );
  }

  static empty(name: string): ParamDoc {
    return ParamDoc.parse(
      `<?xml version="1.0" encoding="UTF-8"?>\n<params name="${name}" type="template" mode="mw"></params>`,
    );
  }

  static read(fs: ParamFs, path: string): ParamDoc | null {
    return fs.analyzePath(path).exists
      ? ParamDoc.parse(fs.readFile(path, { encoding: "utf8" }))
      : null;
  }

  num(path: string, name: string): NumParam | null {
    const node = this.attribute(path, name, "attnum");
    if (!node) return null;
    const value = Number(node.getAttribute("val"));
    const bound = (key: string) =>
      node.hasAttribute(key) ? Number(node.getAttribute(key)) : value;
    return {
      value,
      min: bound("min"),
      max: bound("max"),
      unit: node.getAttribute("unit") ?? "",
    };
  }

  setNum(path: string, name: string, value: number, unit = ""): void {
    const node = this.ensure(path, name, "attnum");
    node.setAttribute("val", String(value));
    if (unit) node.setAttribute("unit", unit);
    else node.removeAttribute("unit");
    node.removeAttribute("min");
    node.removeAttribute("max");
  }

  setStr(path: string, name: string, value: string): void {
    this.ensure(path, name, "attstr").setAttribute("val", value);
  }

  write(fs: ParamFs, path: string): void {
    fs.mkdirTree(path.slice(0, path.lastIndexOf("/")));
    fs.writeFile(path, new XMLSerializer().serializeToString(this.doc));
  }

  private section(path: string, create: boolean): Element | null {
    let node: Element | null = this.doc.documentElement;
    for (const part of path.split("/").filter(Boolean)) {
      if (!node) return null;
      const parent: Element = node;
      node =
        Array.from(parent.children).find(
          (child) =>
            child.tagName === "section" &&
            normalize(child.getAttribute("name")) === part,
        ) ?? null;
      if (!node && create) {
        node = this.doc.createElement("section");
        node.setAttribute("name", part);
        parent.appendChild(node);
      }
    }
    return node;
  }

  private attribute(path: string, name: string, tag: string): Element | null {
    const section = this.section(path, false);
    if (!section) return null;
    return (
      Array.from(section.children).find(
        (child) =>
          child.tagName === tag &&
          normalize(child.getAttribute("name")) === name,
      ) ?? null
    );
  }

  private ensure(path: string, name: string, tag: string): Element {
    const existing = this.attribute(path, name, tag);
    if (existing) return existing;
    const section = this.section(path, true);
    if (!section) throw new Error(`cannot create section ${path}`);
    const node = this.doc.createElement(tag);
    node.setAttribute("name", name);
    section.appendChild(node);
    return node;
  }
}

function normalize(text: string | null): string {
  return (text ?? "").replaceAll(/\s+/g, " ").trim();
}
