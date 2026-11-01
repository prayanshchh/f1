import { temperatureState, type TyreInfo } from "./tyres.ts";

interface PartDamage {
  wingLeft: number;
  wingRight: number;
  sidepodLeft: number;
  sidepodRight: number;
  floor: number;
  diffuser: number;
  rearWing: number;
}

export interface CarStatus {
  engineTemp: number;
  damage: PartDamage;
  brakes: number[];
}

const pages = ["quick", "temps", "wear", "pressure"] as const;
type Page = (typeof pages)[number];

const brakeCold = 200;
const brakeHot = 950;
const pressureSpan = 4;
const frontTarget = 23.5;
const rearTarget = 22;
const engineWarm = 130;
const engineHot = 140;

const damageSteps = [
  { below: 0.2, state: "ok" },
  { below: 0.45, state: "warm" },
  { below: 0.7, state: "orange" },
] as const;

const wearSteps = [
  { below: 0.15, state: "ok" },
  { below: 0.34, state: "warm" },
  { below: 0.6, state: "orange" },
] as const;

function severity(
  value: number,
  steps: readonly { below: number; state: string }[],
): string {
  return steps.find((step) => value < step.below)?.state ?? "hot";
}

export function damageState(damage: number): string {
  return severity(damage, damageSteps);
}

export function wearColour(wear: number): string {
  return severity(wear, wearSteps);
}

export function brakeState(celsius: number): string {
  if (celsius < brakeCold) return "cool";
  return celsius > brakeHot ? "hot" : "ok";
}

function engineState(celsius: number): string {
  if (celsius > engineHot) return "hot";
  return celsius > engineWarm ? "warm" : "ok";
}

function pressureState(offTarget: number): string {
  if (offTarget < 0.35) return "ok";
  return offTarget < 0.7 ? "warm" : "hot";
}

export function nextPage(page: string): Page {
  const index = pages.findIndex((p) => p === page);
  return pages[(index + 1) % pages.length] ?? "quick";
}

const wingShape =
  "M-5 118 L-50 125 L-165 170 L-168 235 L-155 252 L-80 240 L-50 225 L-35 170 L-20 145 L-5 140Z";
const sidepodShape = "M-35 458 L-100 490 L-134 555 L-35 505Z";
const engineShape =
  "M-36 630 L36 630 L52 652 L66 656 L66 700 L32 740 L26 768 L-26 768 L-32 740 L-66 700 L-66 656 L-52 652Z";
const outerFloorShape =
  "M-135 590 L-120 590 Q-125 720 -85 885 L-100 885 Q-128 790 -135 650Z";
const floorShape =
  "M-110 590 L-65 590 L-40 625 L-70 652 L-72 705 L-35 760 L-35 885 L-70 885 Q-112 720 -110 590Z";
const rearWingShape =
  "M-105 955 L105 955 L110 1010 L8 1015 L8 1028 L-8 1028 L-8 1015 L-110 1010Z";
const frame = `
  <path class="car-line" d="M-30 160 Q-30 145 0 145 Q30 145 30 160 L30 260 L48 262 L48 285 L30 290 L35 420 L60 520 L60 590 L-60 590 L-60 520 L-35 420 L-30 290 L-48 285 L-48 262 L-30 260Z" />
  <ellipse class="car-line" cx="0" cy="570" rx="32" ry="42" />
  <ellipse class="car-line" cx="0" cy="572" rx="52" ry="58" />
  <path class="car-line" d="M-78 320 L-32 305 M-78 335 L-32 335 M-78 350 L-32 375 M78 320 L32 305 M78 335 L32 335 M78 350 L32 375" />
  <path class="car-line fill" d="M-105 425 L-92 420 L-96 490 L-120 515Z M105 425 L92 420 L96 490 L120 515Z" />
  <path class="car-line" d="M-92 600 Q-98 720 -58 885 M92 600 Q98 720 58 885 M-78 620 Q-82 720 -46 800 M78 620 Q82 720 46 800" />
`;

function tyre(id: string, x: number, y: number, h: number, w: number): string {
  return `<g class="part tyre" data-part="${id}"><rect x="${String(x)}" y="${String(y)}" width="${String(w)}" height="${String(h)}" rx="20" class="tyre-outer"/><rect x="${String(x + 13)}" y="${String(y + 16)}" width="${String(w - 26)}" height="${String(h - 32)}" rx="6" class="tyre-inner"/></g>`;
}

function upright(side: number, y: number, h: number): string {
  const x = side > 0 ? 78 : -98;
  return `<rect class="upright" x="${String(x)}" y="${String(y)}" width="20" height="${String(h)}" rx="5"/>`;
}

const carArt = `${frame}
  <g class="part damage" data-part="wing-left"><path d="${wingShape}"/></g>
  <g class="part damage" data-part="wing-right"><path d="${wingShape}" transform="scale(-1 1)"/></g>
  <g class="part damage" data-part="sidepod-left"><path d="${sidepodShape}"/></g>
  <g class="part damage" data-part="sidepod-right"><path d="${sidepodShape}" transform="scale(-1 1)"/></g>
  <g class="part damage" data-part="floor"><path d="${outerFloorShape}"/><path d="${outerFloorShape}" transform="scale(-1 1)"/><path d="${floorShape}"/><path d="${floorShape}" transform="scale(-1 1)"/></g>
  <g class="part damage" data-part="diffuser"><rect x="-12" y="780" width="24" height="105" rx="3"/><rect x="-62" y="895" width="124" height="45" rx="4"/></g>
  <g class="part damage" data-part="rear-wing"><path d="${rearWingShape}"/></g>
  ${upright(-1, 310, 42)}${upright(1, 310, 42)}${upright(-1, 898, 40)}${upright(1, 898, 40)}
  ${tyre("fl", -172, 270, 122, 70)}${tyre("fr", 102, 270, 122, 70)}
  ${tyre("rl", -178, 850, 130, 74)}${tyre("rr", 104, 850, 130, 74)}
  <g class="part engine" data-part="engine"><path d="${engineShape}"/></g>`;

const corners = [
  { id: "fl", wheel: 1, left: true },
  { id: "fr", wheel: 0, left: false },
  { id: "rl", wheel: 3, left: true },
  { id: "rr", wheel: 2, left: false },
] as const;

const brakeIcon =
  '<svg class="brake-icon" viewBox="0 0 24 24"><path d="M12 2 a10 10 0 1 0 0 20 l2 -5 a5 5 0 1 1 0 -10Z"/><path d="M15 3.5 a10 10 0 0 1 0 17 l-1 -4 a5 5 0 0 0 0 -9Z"/></svg>';

function text(parent: HTMLElement, className: string): HTMLElement {
  const node = document.createElement("span");
  node.className = className;
  parent.append(node);
  return node;
}

interface CornerView {
  surface: HTMLElement;
  inner: HTMLElement;
  brake: HTMLElement;
  wear: HTMLElement;
  pressure: HTMLElement;
  arc: SVGCircleElement;
  tyre: Element;
}

function reading(column: HTMLElement, marker: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "temp-row";
  const value = text(row, "temp-value");
  const icon = document.createElement("i");
  icon.className = `temp-mark ${marker}`;
  if (marker === "brake") icon.innerHTML = brakeIcon;
  row.append(icon);
  column.append(row);
  return value;
}

function wearRing(root: HTMLElement): {
  wear: HTMLElement;
  pressure: HTMLElement;
  arc: SVGCircleElement;
} {
  const ring = document.createElement("div");
  ring.className = "wear-ring";
  ring.innerHTML =
    '<svg viewBox="0 0 100 100"><circle class="wear-base" cx="50" cy="50" r="46"/><circle class="wear-arc" cx="50" cy="50" r="46" pathLength="100"/></svg>';
  const wear = text(ring, "wear-value");
  const pressure = text(ring, "wear-psi");
  root.append(ring);
  const arc = ring.querySelector<SVGCircleElement>(".wear-arc");
  if (!arc) throw new Error("wear ring has no arc");
  return { wear, pressure, arc };
}

export class Mfd {
  private readonly views: CornerView[] = [];
  private readonly car: SVGSVGElement;
  private readonly engineTemp: HTMLElement;
  private page: Page = "quick";

  constructor(
    private readonly root: HTMLElement,
    find: (id: string) => HTMLElement,
  ) {
    this.car = find("mfd-car") as unknown as SVGSVGElement;
    this.car.innerHTML = carArt;
    this.engineTemp = find("engine-temp");
    const gauges = find("mfd-gauges");
    for (const corner of corners) {
      const slot = document.createElement("div");
      slot.className = `mfd-corner ${corner.id} ${corner.left ? "left" : "right"}`;
      const temps = document.createElement("div");
      temps.className = "corner-temps";
      temps.dataset["for"] = "temps";
      const surface = reading(temps, "surface");
      const inner = reading(temps, "inner");
      const brake = reading(temps, "brake");
      const wearBox = document.createElement("div");
      wearBox.className = "corner-wear";
      wearBox.dataset["for"] = "wear";
      slot.append(temps, wearBox);
      gauges.append(slot);
      const shape = this.car.querySelector(`[data-part="${corner.id}"]`);
      if (!shape) throw new Error(`car art has no ${corner.id}`);
      this.views.push({
        surface,
        inner,
        brake,
        tyre: shape,
        ...wearRing(wearBox),
      });
    }
    this.setPage(this.page);
  }

  next(): void {
    this.setPage(nextPage(this.page));
  }

  update(tyres: TyreInfo, status: CarStatus): void {
    if (this.page === "quick") return;
    corners.forEach((corner, i) => {
      this.updateCorner(i, corner.wheel, tyres, status);
    });
    this.updateCar(status);
  }

  private setPage(page: Page): void {
    this.page = page;
    this.root.dataset["page"] = page;
    this.root.querySelector("[data-hud=mfd-dots]")?.replaceChildren(
      ...pages.map((p) => {
        const bar = document.createElement("b");
        bar.classList.toggle("on", p === page);
        return bar;
      }),
    );
  }

  private updateCorner(
    index: number,
    wheel: number,
    tyres: TyreInfo,
    status: CarStatus,
  ): void {
    const view = this.views[index];
    const data = tyres.wheels[wheel];
    if (!view || !data) return;
    const surface = temperatureState(data.surface, tyres.low, tyres.high);
    const inner = temperatureState(data.carcass, tyres.low, tyres.high);
    const brake = status.brakes[wheel] ?? 0;
    const paint = (node: HTMLElement, value: number, state: string) => {
      node.textContent = `${String(Math.round(value))}°C`;
      if (node.parentElement) node.parentElement.dataset["state"] = state;
    };
    paint(view.surface, data.surface, surface);
    paint(view.inner, data.carcass, inner);
    paint(view.brake, brake, brakeState(brake));
    this.updateRing(view, wheel, data.wear, data.pressure, surface);
    view.tyre.setAttribute("data-edge", inner);
  }

  private updateRing(
    view: CornerView,
    wheel: number,
    wear: number,
    pressure: number,
    surface: string,
  ): void {
    const isPressure = this.page === "pressure";
    const target = wheel < 2 ? frontTarget : rearTarget;
    const offTarget = Math.min(1, Math.abs(pressure - target) / pressureSpan);
    const ring = isPressure ? pressureState(offTarget) : wearColour(wear);
    view.wear.textContent = isPressure
      ? pressure.toFixed(1)
      : `${String(Math.round(wear * 100))}%`;
    view.pressure.textContent = isPressure ? "psi" : "";
    view.arc.style.strokeDashoffset = String(
      100 - (isPressure ? offTarget : wear) * 100,
    );
    view.arc.parentElement?.parentElement?.setAttribute("data-state", ring);
    view.tyre.setAttribute(
      "data-state",
      this.page === "temps" ? surface : ring,
    );
  }

  private updateCar(status: CarStatus): void {
    const { damage } = status;
    const parts: Record<string, string> = {
      "wing-left": damageState(damage.wingLeft),
      "wing-right": damageState(damage.wingRight),
      "sidepod-left": damageState(damage.sidepodLeft),
      "sidepod-right": damageState(damage.sidepodRight),
      floor: damageState(damage.floor),
      diffuser: damageState(damage.diffuser),
      "rear-wing": damageState(damage.rearWing),
      engine: engineState(status.engineTemp),
    };
    for (const [part, state] of Object.entries(parts))
      this.car
        .querySelector(`[data-part="${part}"]`)
        ?.setAttribute("data-state", state);
    this.engineTemp.textContent = `${String(Math.round(status.engineTemp))}°C`;
  }
}
