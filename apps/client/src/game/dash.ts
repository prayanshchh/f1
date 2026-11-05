import { boostMode, type EnergyInfo } from "./energy.ts";
import { putAttr, putData, putStyle, putText } from "./hud-dom.ts";

interface Point {
  x: number;
  y: number;
}

const batt: Point = { x: 96, y: 82 };
const dial: Point = { x: 374, y: 82 };
const harvestAt: Point = { x: 101, y: 144 };
const sweepFrom = 220;
const sweep = 270;
const ledCount = 15;
const revLedCount = 10;
const revStart = 0.835;
const revFull = 0.935;
const revFlash = 0.975;
const rpmHot = 0.9;
const flowWatts = 2000;
const emptyShare = 0.005;
const pedalBar = { length: 82, top: 157.5, bottom: 164.5, slant: 3.5 };
const brakeEdge = 200;
const throttleEdge = 270;
const rollMs = 220;
const clutchMs = 150;
const dotAngles = [0, 28, 56, 84, 112, 140, 220, 248, 276, 304, 332];

export type ErsState =
  "deploy" | "harvest" | "boost" | "overtake" | "overtake-boost";

const ersLabels: Record<ErsState, string> = {
  deploy: "Deploying",
  harvest: "Harvesting",
  boost: "Boost Active",
  overtake: "Overtake Mode",
  "overtake-boost": "Overtake Boost",
};

export function ersState(energy: EnergyInfo, previous: ErsState): ErsState {
  const charged = energy.battery > energy.capacity * emptyShare;
  const boosting = energy.mode === boostMode && charged;
  if (energy.overtakeActive) return boosting ? "overtake-boost" : "overtake";
  if (boosting) return "boost";
  if (energy.motorPower > flowWatts) return "deploy";
  if (energy.motorPower < -flowWatts) return "harvest";
  return previous === "deploy" ? "deploy" : "harvest";
}

export function revLeds(fraction: number): number {
  const lit = Math.round(
    ((fraction - revStart) / (revFull - revStart)) * revLedCount,
  );
  return Math.max(0, Math.min(revLedCount, lit));
}

function gearLabel(gear: number): string {
  if (gear < 0) return "R";
  if (gear === 0) return "N";
  return String(gear);
}

function fixed(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function around(centre: Point, radius: number, degrees: number): Point {
  const t = (degrees * Math.PI) / 180;
  return {
    x: centre.x + radius * Math.sin(t),
    y: centre.y - radius * Math.cos(t),
  };
}

function polar(centre: Point, radius: number, degrees: number): string {
  const { x, y } = around(centre, radius, degrees);
  return `${fixed(x)} ${fixed(y)}`;
}

function dots(): string {
  return dotAngles
    .map((a) => {
      const { x, y } = around(batt, 75, a);
      return `<circle r="1.35" cx="${fixed(x)}" cy="${fixed(y)}" />`;
    })
    .join("");
}

function arc(
  centre: Point,
  radius: number,
  from: number,
  span: number,
): string {
  const large = span > 180 ? 1 : 0;
  return `M${polar(centre, radius, from)}A${String(radius)} ${String(radius)} 0 ${String(large)} 1 ${polar(centre, radius, from + span)}`;
}

function spokes(centre: Point): string {
  return Array.from({ length: 8 }, (_, i) => {
    const a = i * 45 + 22.5;
    return `M${polar(centre, 2.6, a)}L${polar(centre, 6.2, a)}`;
  }).join("");
}

const gauge = arc(batt, 61, sweepFrom, sweep);

function ring(name: string, centre: Point, radius: number): string {
  return `<circle class="${name}" cx="${String(centre.x)}" cy="${String(centre.y)}" r="${String(radius)}" />`;
}

const frameSvg = `
<defs>
  <linearGradient id="dash-plate" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0b0c12" stop-opacity="0.86" />
    <stop offset="1" stop-color="#0b0c12" stop-opacity="0.66" />
  </linearGradient>
  <radialGradient id="dial-glass" gradientUnits="userSpaceOnUse" cx="${String(dial.x)}" cy="${String(dial.y)}" r="68.5">
    <stop offset="0" stop-color="#040408" stop-opacity="0.92" />
    <stop offset="0.8" stop-color="#07070c" stop-opacity="0.9" />
    <stop offset="1" stop-color="#16171f" stop-opacity="0.84" />
  </radialGradient>
</defs>
<path class="dash-plate" d="M96 26H186L194 18H276L284 26H374V150L360 176H110L96 150Z" />
<path class="dash-line" d="M158 26H186L194 18H276L284 26H312" />
<path class="dash-line soft" d="M166 57H304" />
<path class="dash-line" d="M104 156L112 167H203L211 153H259L267 167H358L366 156" />
${ring("dial-disc", dial, 68.5)}
${ring("dial-rim", dial, 69.5)}
<g class="part-fuel">
${ring("batt-back", batt, 62)}
<path class="batt-ticks" d="${arc(batt, 62.5, sweepFrom, sweep)}" pathLength="270" />
${ring("batt-rim", batt, 70)}
${ring("batt-disc-back", batt, 55)}
${ring("batt-disc-rim", batt, 55.4)}
<g class="batt-dots">${dots()}</g>
</g>
<path class="dash-icon" d="M181 67L185.5 63.5V70.5ZM193 67L188.5 63.5V70.5Z" />
<path class="fuel-can part-fuel" data-hud="fuel-can" d="M181.5 80H188L192 84V92H181.5ZM182.5 77.5H186.5V79H182.5ZM189 78.5L192.5 75.5L193.5 76.5L190.5 79.5Z" />
<g class="damage-icon" data-hud="damage-icon">
  <path d="M180.5 110.5L189.2 101.8M192.2 98.8A3.2 3.2 0 1 1 189.8 96.4" />
  <path d="M180.5 98.5L184 102M186 104L193.5 111.5" />
</g>
<path class="shift-arrow" d="M270.5 86L276 80.5L281.5 86Z" />
<path class="shift-arrow" d="M270.5 103L276 108.5L281.5 103Z" />
`;

const liveSvg = `
<path class="dial-rpm" data-hud="rpm-ring" d="${arc(dial, 59, sweepFrom, sweep)}" pathLength="270" />
<path class="batt-level part-fuel" data-hud="batt-ring" d="${gauge}" pathLength="270" />
<g class="harvest part-fuel">
  ${ring("harvest-plate", harvestAt, 13.5)}
  ${ring("harvest-track", harvestAt, 11.6)}
  <path class="harvest-fill" data-hud="harvest-ring" d="${arc(harvestAt, 11.6, 180, 359.9)}" pathLength="100" />
  ${ring("rotor", harvestAt, 7.4)}
  ${ring("rotor-hub", harvestAt, 1.9)}
  <path class="rotor-spokes" d="${spokes(harvestAt)}" />
</g>
<g class="part-inputs">
  <polygon class="pedal-bar brake" data-hud="in-brake" points="" />
  <polygon class="pedal-bar throttle" data-hud="in-throttle" points="" />
</g>
`;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function streak(context: CanvasRenderingContext2D, random: () => number): void {
  const x = random() * 110;
  const y = random() * 220;
  const length = 14 + random() * 90;
  const width = 0.5 + random() * 1.6;
  const tint = random() < 0.72 ? "20, 24, 8" : "255, 255, 236";
  const alpha = (0.12 + random() * 0.4).toFixed(2);
  for (const shift of [0, -220]) {
    const gradient = context.createLinearGradient(
      0,
      y + shift,
      0,
      y + shift + length,
    );
    gradient.addColorStop(0, `rgba(${tint}, 0)`);
    gradient.addColorStop(0.5, `rgba(${tint}, ${alpha})`);
    gradient.addColorStop(1, `rgba(${tint}, 0)`);
    context.fillStyle = gradient;
    context.fillRect(x, y + shift, width, length);
  }
}

function streakTexture(seed: number, count: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = 110;
  canvas.height = 220;
  const context = canvas.getContext("2d");
  if (!context) return "none";
  const random = seeded(seed);
  for (let i = 0; i < count; i++) streak(context, random);
  return `url(${canvas.toDataURL()})`;
}

function waveTexture(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 110;
  canvas.height = 110;
  const context = canvas.getContext("2d");
  if (!context) return "none";
  context.lineCap = "round";
  for (const [y, alpha, width] of [
    [30, 0.55, 5],
    [84, 0.32, 7],
  ] as const) {
    for (const shift of [0, 110, -110]) {
      context.strokeStyle = `rgba(255, 255, 255, ${String(alpha)})`;
      context.lineWidth = width;
      context.shadowColor = "rgba(255, 255, 255, 0.9)";
      context.shadowBlur = 6;
      context.beginPath();
      context.moveTo(-6, y + shift + 16);
      context.quadraticCurveTo(28, y + shift - 2, 55, y + shift - 6);
      context.quadraticCurveTo(82, y + shift - 2, 116, y + shift + 16);
      context.stroke();
    }
  }
  return `url(${canvas.toDataURL()})`;
}

function svgIn(root: HTMLElement, selector: string, markup: string): void {
  const node = root.querySelector(selector);
  if (node) node.innerHTML = markup;
}

function pedalPoints(edge: number, amount: number, direction: number): string {
  const { length, top, bottom, slant } = pedalBar;
  const reach = Math.round(Math.max(0, Math.min(1, amount)) * length * 2) / 2;
  if (reach < slant * 2) return "";
  const far = edge + direction * reach;
  const near = edge;
  return [
    `${fixed(far)},${String(top)}`,
    `${fixed(near)},${String(top)}`,
    `${fixed(near - direction * slant)},${String(bottom)}`,
    `${fixed(far + direction * slant)},${String(bottom)}`,
  ].join(" ");
}

export interface DashSample {
  speedKph: number;
  gear: number;
  rpm: number;
  redLine: number;
  throttle: number;
  brake: number;
}

export class Dash {
  private readonly leds: HTMLElement[] = [];
  private readonly gearNow: HTMLElement;
  private readonly gearWas: HTMLElement;
  private readonly disc: HTMLElement;
  private gear: number | null = null;
  private ers: ErsState = "harvest";
  private lit = -1;
  private upshiftAt = -Infinity;

  constructor(
    root: HTMLElement,
    private readonly find: (id: string) => HTMLElement,
  ) {
    svgIn(root, ".dash-frame", frameSvg);
    svgIn(root, ".dash-live", liveSvg);
    const strip = find("leds");
    for (let i = 0; i < ledCount; i++) {
      const led = document.createElement("i");
      led.className = i < 5 ? "aux" : i < 10 ? "pink" : "violet";
      if (i === 1 || i === 2) led.classList.add("green");
      strip.append(led);
      this.leds.push(led);
    }
    const gear = find("gear");
    this.gearNow = document.createElement("b");
    this.gearWas = document.createElement("b");
    this.gearWas.className = "was";
    gear.replaceChildren(this.gearWas, this.gearNow);
    this.disc = find("batt-disc");
    const textures: Record<string, () => string> = {
      "streak-a": () => streakTexture(17, 70),
      "streak-b": () => streakTexture(48, 46),
      wave: waveTexture,
    };
    this.disc.querySelectorAll<HTMLElement>("[data-layer]").forEach((layer) => {
      layer.style.backgroundImage =
        textures[layer.dataset["layer"] ?? ""]?.() ?? "none";
    });
  }

  update(sample: DashSample): void {
    putText(this.find("speed"), String(Math.round(Math.abs(sample.speedKph))));
    putText(this.find("rpm"), String(Math.round(sample.rpm)));
    this.shift(sample.gear);
    const clutch = performance.now() - this.upshiftAt < clutchMs;
    const fraction = clutch ? 0 : sample.rpm / Math.max(1, sample.redLine);
    this.revs(fraction);
    const rpmRing = this.find("rpm-ring");
    putData(rpmRing, "hot", fraction >= rpmHot ? "1" : "");
    putStyle(
      rpmRing,
      "stroke-dasharray",
      `${(Math.min(1, fraction) * sweep).toFixed(1)} 270`,
    );
    putAttr(
      this.find("in-brake"),
      "points",
      pedalPoints(brakeEdge, sample.brake, -1),
    );
    putAttr(
      this.find("in-throttle"),
      "points",
      pedalPoints(throttleEdge, sample.throttle, 1),
    );
  }

  energy(energy: EnergyInfo): void {
    const share = Math.max(
      0,
      Math.min(1, energy.battery / Math.max(1, energy.capacity)),
    );
    const harvest = Math.min(
      1,
      energy.harvested / Math.max(1, energy.harvestLimit),
    );
    this.ers = ersState(energy, this.ers);
    const dash = this.find("dash");
    putData(dash, "ers", this.ers);
    putData(dash, "smode", energy.straightMode >= 0.5 ? "1" : "");
    putText(this.find("batt"), `${String(Math.round(share * 100))}%`);
    putText(this.find("status"), ersLabels[this.ers]);
    putStyle(
      this.find("batt-ring"),
      "stroke-dasharray",
      `${(share * sweep).toFixed(1)} 270`,
    );
    putStyle(
      this.find("harvest-ring"),
      "stroke-dasharray",
      `${(harvest * 100).toFixed(1)} 100`,
    );
  }

  damaged(on: boolean): void {
    putData(this.find("damage-icon"), "on", on ? "1" : "");
  }

  private revs(fraction: number): void {
    const lit = revLeds(fraction);
    putData(this.find("leds"), "flash", fraction >= revFlash ? "1" : "");
    if (lit === this.lit) return;
    this.lit = lit;
    this.leds.forEach((led, i) => {
      if (i >= 5) led.classList.toggle("on", i - 5 < lit);
    });
  }

  private shift(gear: number): void {
    const previous = this.gear;
    if (previous === gear) return;
    this.gear = gear;
    putText(this.gearNow, gearLabel(gear));
    if (previous === null) return;
    putText(this.gearWas, gearLabel(previous));
    const up = gear > previous ? 1 : -1;
    if (up > 0) this.upshiftAt = performance.now();
    const easing = "cubic-bezier(0.2, 0.7, 0.2, 1)";
    this.gearNow.animate(
      [
        {
          transform: `translateY(${String(42 * up)}%)`,
          opacity: 0.2,
          color: "#8c8f99",
        },
        { transform: "translateY(0)", opacity: 1, color: "#ffffff" },
      ],
      { duration: rollMs, easing },
    );
    this.gearWas.animate(
      [
        { transform: "translateY(0)", opacity: 0.75 },
        { transform: `translateY(${String(-14 * up)}%)`, opacity: 0 },
      ],
      { duration: rollMs, easing },
    );
  }
}
