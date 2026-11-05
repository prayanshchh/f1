import { carStride } from "./engine.ts";
import { closedPolyline, type Polyline, pointAlong } from "./polyline.ts";
import { putAttr, putData } from "./hud-dom.ts";
import type { Entrant } from "./weekend.ts";

export interface TrackMap {
  points: [number, number][];
  length: number;
}

type Screen = [number, number][];

const size = 300;
const pad = 24;
const lookAhead = 6;
const straightWindow = 45;
const straightTurn = 0.06;
const straightLength = 320;
const stripOffset = 10;

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, String(value));
  return node;
}

function pathOf(points: Screen, close = false): string {
  const d = `M${points.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("L")}`;
  return close ? `${d}Z` : d;
}

function project(map: TrackMap): Screen {
  const xs = map.points.map((p) => p[0]);
  const ys = map.points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  const scale = (size - pad * 2) / Math.max(spanX, spanY, 1);
  const offX = (size - spanX * scale) / 2;
  const offY = (size - spanY * scale) / 2;
  return map.points.map((p) => [
    offX + (p[0] - minX) * scale,
    size - (offY + (p[1] - minY) * scale),
  ]);
}

function heading(screen: Screen, i: number): number {
  const n = screen.length;
  const a = screen[(i - 1 + n) % n] ?? [0, 0];
  const b = screen[(i + 1) % n] ?? [0, 0];
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

function turnAround(screen: Screen, i: number, reach: number): number {
  const n = screen.length;
  const before = heading(screen, (i - reach + n) % n);
  const after = heading(screen, (i + reach) % n);
  return Math.abs(
    Math.atan2(Math.sin(after - before), Math.cos(after - before)),
  );
}

function straightRuns(screen: Screen, length: number): [number, number][] {
  const n = screen.length;
  if (n < 8) return [];
  const step = length / n;
  const reach = Math.max(1, Math.round(straightWindow / step));
  const flat = screen.map(
    (_, i) => turnAround(screen, i, reach) < straightTurn,
  );
  const runs: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && flat[i] === true;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      if ((i - start) * step >= straightLength) runs.push([start, i - 1]);
      start = -1;
    }
  }
  return runs;
}

function centreOf(screen: Screen): [number, number] {
  const n = Math.max(1, screen.length);
  return [
    screen.reduce((sum, p) => sum + p[0], 0) / n,
    screen.reduce((sum, p) => sum + p[1], 0) / n,
  ];
}

function offsetRun(
  screen: Screen,
  run: [number, number],
  centre: [number, number],
): Screen {
  const part = screen.slice(run[0], run[1] + 1);
  const mid = part[Math.floor(part.length / 2)] ?? [0, 0];
  const angle = heading(screen, Math.floor((run[0] + run[1]) / 2));
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  const outward =
    nx * (mid[0] - centre[0]) + ny * (mid[1] - centre[1]) >= 0 ? 1 : -1;
  return part.map(([x, y]) => [
    x + nx * stripOffset * outward,
    y + ny * stripOffset * outward,
  ]);
}

export class MiniMap {
  readonly length: number;
  private readonly screen: Screen;
  private readonly centre: [number, number];
  private readonly line: Polyline | null;
  private readonly dots: SVGCircleElement[] = [];
  private readonly flagPaths: SVGPathElement[] = [];
  private readonly car: SVGElement;

  constructor(
    find: (id: string) => HTMLElement,
    map: TrackMap | null,
    marks: { boundaries: number[]; detection: number; flagSectors: number },
    field: Entrant[] | null,
  ) {
    const root = find("map");
    this.car = find("map-car") as unknown as SVGElement;
    this.length = map?.length ?? 1;
    if (!map || map.points.length < 3) {
      root.classList.add("empty");
      this.screen = [];
      this.centre = [0, 0];
      this.line = null;
      return;
    }
    this.screen = project(map);
    this.centre = centreOf(this.screen);
    this.line = closedPolyline(
      this.screen.map((p) => [
        Number(p[0].toFixed(1)),
        Number(p[1].toFixed(1)),
      ]),
    );
    root.setAttribute("viewBox", `0 0 ${String(size)} ${String(size)}`);
    const d = pathOf(this.screen, true);
    find("map-sectors").append(
      svg("path", { d, class: "map-edge" }),
      svg("path", { d, class: "map-line" }),
    );
    this.buildStrips(find("map-strips"));
    this.buildFlags(find("map-flags"), marks.flagSectors);
    this.buildMarks(find("map-marks"), marks.boundaries, marks.detection);
    this.buildRivals(find("map-field"), field);
  }

  private at(distance: number): [number, number] {
    if (!this.line) return [0, 0];
    const t = ((((distance / this.length) % 1) + 1) % 1) * this.line.total;
    return pointAlong(this.line, t);
  }

  private buildStrips(group: HTMLElement): void {
    for (const run of straightRuns(this.screen, this.length))
      group.append(
        svg("path", {
          d: pathOf(offsetRun(this.screen, run, this.centre)),
          class: "map-strip",
        }),
      );
  }

  private buildFlags(group: HTMLElement, sectors: number): void {
    const step = this.length / (this.screen.length - 1 || 1);
    for (let k = 0; k < sectors; k++) {
      const from = Math.floor((k * this.length) / sectors / step);
      const to = Math.min(
        this.screen.length - 1,
        Math.ceil(((k + 1) * this.length) / sectors / step),
      );
      const path = svg("path", {
        d: pathOf(this.screen.slice(from, to + 1)),
        class: "map-flag",
      });
      group.append(path);
      this.flagPaths.push(path);
    }
  }

  private buildMarks(
    marks: HTMLElement,
    boundaries: number[],
    detection: number,
  ): void {
    const cuts = [0, ...boundaries];
    cuts.forEach((cut, i) => {
      const [x, y] = this.at(cut);
      const angle = this.angleAt(cut);
      if (i > 0)
        marks.append(
          svg("path", {
            d: "M0 -8V8",
            class: "map-split",
            transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(angle * 57.2958).toFixed(1)})`,
          }),
        );
      const [lx, ly] = this.beside(cut + 140, 17);
      const label = svg("text", { x: lx, y: ly, class: "map-num" });
      label.textContent = String(i + 1);
      marks.append(label);
    });
    const [fx, fy] = this.beside(0, 15);
    marks.append(
      svg("rect", {
        x: fx - 6,
        y: fy - 4,
        width: 12,
        height: 8,
        class: "map-start",
      }),
    );
    const [dx, dy] = this.at(detection);
    marks.append(
      svg("circle", { cx: dx, cy: dy, r: 7.5, class: "map-detect" }),
      svg("circle", { cx: dx, cy: dy, r: 2.6, class: "map-detect-dot" }),
    );
  }

  private angleAt(distance: number): number {
    const [ax, ay] = this.at(distance - lookAhead);
    const [bx, by] = this.at(distance + lookAhead);
    return Math.atan2(by - ay, bx - ax);
  }

  private beside(distance: number, gap: number): [number, number] {
    const [x, y] = this.at(distance);
    const angle = this.angleAt(distance);
    const [cx, cy] = this.centre;
    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);
    const side = nx * (x - cx) + ny * (y - cy) >= 0 ? 1 : -1;
    return [x + nx * gap * side, y + ny * gap * side];
  }

  private buildRivals(group: HTMLElement, field: Entrant[] | null): void {
    field?.forEach((entrant, i) => {
      if (i === 0) return;
      const dot = svg("circle", { r: 5, class: "map-rival" });
      dot.style.fill = entrant.colour;
      group.append(dot);
      this.dots.push(dot);
    });
  }

  player(distance: number): void {
    if (!this.line) return;
    const [x, y] = this.at(distance);
    const angle = this.angleAt(distance) * 57.2958;
    putAttr(
      this.car,
      "transform",
      `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${angle.toFixed(0)})`,
    );
  }

  field(cars: Float64Array): void {
    if (!this.line) return;
    this.dots.forEach((dot, i) => {
      const at = (i + 1) * carStride;
      const visible = (cars[at + 46] ?? 0) !== 0;
      putData(dot, "off", visible ? "" : "1");
      if (!visible) return;
      const [x, y] = this.at(cars[at + 48] ?? 0);
      putAttr(dot, "cx", x.toFixed(1));
      putAttr(dot, "cy", y.toFixed(1));
    });
  }

  flags(flags: number[]): void {
    this.flagPaths.forEach((path, k) => {
      putData(path, "flag", String(flags[k] ?? 0));
    });
  }
}
