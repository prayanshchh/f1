import { frameIndex, type HudInfo, outOfRaceState } from "./engine.ts";
import type { LapResult, LapTrace } from "./laptrace.ts";
import type { HudPart } from "./settings.ts";

export function lapTime(seconds: number | null): string {
  if (seconds === null || !(seconds > 0)) return "--:--.---";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${String(minutes)}:${rest.toFixed(3).padStart(6, "0")}`;
}

function sectorTime(seconds: number | null): string {
  return seconds === null ? "—" : seconds.toFixed(3);
}

function signed(seconds: number): string {
  return `${seconds < 0 ? "−" : "+"}${Math.abs(seconds).toFixed(3)}`;
}

function gearLabel(gear: number): string {
  if (gear < 0) return "R";
  if (gear === 0) return "N";
  return String(gear);
}

function tyreColor(temp: number, optimal: number): string {
  const t = Math.max(-1, Math.min(1, (temp - optimal) / 25));
  if (t < 0) return `hsl(${String(150 + -t * 60)} 80% ${String(55 - -t * 5)}%)`;
  return `hsl(${String(150 - t * 150)} 85% 55%)`;
}

function replay(element: HTMLElement, name: string): void {
  element.classList.remove(name);
  requestAnimationFrame(() => {
    element.classList.add(name);
  });
}

const revLeds = 15;
const lightCount = 5;

export interface HudOptions {
  totalLaps: number | null;
  parts: Record<HudPart, boolean>;
  reference: string;
}

export class Hud {
  readonly laps: LapResult[] = [];
  private readonly find: (id: string) => HTMLElement;
  private readonly leds: HTMLElement[] = [];
  private readonly lights: HTMLElement[] = [];
  private readonly sectorCells: { root: HTMLElement; time: HTMLElement }[] = [];
  private readonly tyres: { root: HTMLElement; value: HTMLElement }[] = [];
  private bannerTimer = 0;
  private splitUntil = 0;
  private lastActiveSector = -1;
  private lapFuel: number | null = null;
  private fuelAtLapStart: number | null = null;
  private lastLap = -1;
  private deltaShown = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly trace: LapTrace,
    private readonly options: HudOptions,
  ) {
    this.find = (id: string) => {
      const element = root.querySelector<HTMLElement>(`[data-hud="${id}"]`);
      if (!element) throw new Error(`missing HUD element ${id}`);
      return element;
    };
    const strip = this.find("leds");
    for (let i = 0; i < revLeds; i++) {
      const led = document.createElement("i");
      led.className = i < 5 ? "g" : i < 10 ? "r" : "b";
      strip.append(led);
      this.leds.push(led);
    }
    const gantry = this.find("lights");
    for (let i = 0; i < lightCount; i++) {
      const light = document.createElement("i");
      gantry.append(light);
      this.lights.push(light);
    }
    const sectors = this.find("sectors");
    const count = trace.sectors(0).times.length;
    for (let i = 0; i < count; i++) {
      const cell = document.createElement("div");
      cell.className = "sector";
      const label = document.createElement("span");
      label.textContent = `S${String(i + 1)}`;
      const time = document.createElement("b");
      time.textContent = "—";
      cell.append(label, time);
      sectors.append(cell);
      this.sectorCells.push({ root: cell, time });
    }
    for (const id of ["fl", "fr", "rl", "rr"]) {
      const cell = this.find(`tyre-${id}`);
      const value = document.createElement("span");
      cell.append(value);
      this.tyres.push({ root: cell, value });
    }
    this.setParts(options.parts);
    this.find("reference").textContent = options.reference;
  }

  setParts(parts: Record<HudPart, boolean>): void {
    for (const [part, on] of Object.entries(parts))
      this.root.classList.toggle(`no-${part}`, !on);
  }

  update(frame: Float64Array, info: HudInfo, now: number): void {
    const value = (index: number) => frame[index] ?? 0;
    const time = value(frameIndex.time);
    const laps = value(frameIndex.laps);
    const distance = value(frameIndex.distFromStart);
    const current = value(frameIndex.curLapTime);
    const result = this.trace.sample(
      laps,
      distance,
      current,
      value(frameIndex.lastLapTime),
    );
    if (result) {
      this.laps.push(result);
      this.showLap(result, now);
    }
    this.updateDash(value, info);
    this.updateTiming(value, laps, distance, current, now);
    this.updateFuel(info, laps);
    this.updateTyres(info);
    this.updateInputs(value);
    this.updateLights(time);
    this.updateNotice(info);
    if (this.bannerTimer && now > this.bannerTimer) {
      this.find("banner").classList.remove("show");
      this.bannerTimer = 0;
    }
  }

  private updateDash(value: (index: number) => number, info: HudInfo): void {
    const rpm = value(frameIndex.rpm) * (30 / Math.PI);
    const redLine = Math.max(1, value(frameIndex.rpmRedLine) * (30 / Math.PI));
    this.find("speed").textContent = String(
      Math.round(Math.abs(value(frameIndex.speed)) * 3.6),
    );
    this.find("gear").textContent = gearLabel(value(frameIndex.gear));
    this.find("rpm").textContent = String(Math.round(rpm));
    const fraction = rpm / redLine;
    const lit = Math.round(((fraction - 0.7) / 0.28) * revLeds);
    const flash = fraction > 0.98;
    this.leds.forEach((led, i) => {
      led.classList.toggle("on", i < lit);
    });
    this.find("leds").classList.toggle("flash", flash);
    this.find("rpm-bar").style.transform =
      `scaleX(${String(Math.min(1, fraction))})`;
    const damage = info.maxDamage > 0 ? info.damage / info.maxDamage : 0;
    this.find("damage").style.setProperty(
      "--damage",
      String(Math.min(1, damage)),
    );
    this.find("damage").hidden = damage < 0.02;
  }

  private updateTiming(
    value: (index: number) => number,
    laps: number,
    distance: number,
    current: number,
    now: number,
  ): void {
    const total = this.options.totalLaps;
    this.find("lap").textContent = total
      ? `${String(Math.max(1, Math.min(laps, total)))}/${String(total)}`
      : String(Math.max(1, laps));
    this.find("current").textContent = laps > 0 ? lapTime(current) : lapTime(0);
    this.find("last").textContent = lapTime(value(frameIndex.lastLapTime));
    this.find("best").textContent = lapTime(value(frameIndex.bestLapTime));
    this.updateSectors(laps, distance, now);
    this.updateDelta(laps, distance, current, now);
  }

  private updateSectors(laps: number, distance: number, now: number): void {
    const sectors = this.trace.sectors(distance);
    this.sectorCells.forEach((cell, i) => {
      const status = sectors.status[i] ?? null;
      cell.time.textContent = sectorTime(sectors.times[i] ?? null);
      cell.root.dataset["status"] =
        status ?? (i === sectors.active && laps > 0 ? "live" : "");
    });
    if (sectors.active === this.lastActiveSector) return;
    const closed = sectors.active - 1;
    const cell = this.sectorCells[closed];
    if (cell && sectors.times[closed] !== null) {
      replay(cell.root, "pop");
      this.splitUntil = now + 2.5;
      this.find("delta-label").textContent = `Sector ${String(closed + 1)}`;
    }
    this.lastActiveSector = sectors.active;
  }

  private updateDelta(
    laps: number,
    distance: number,
    current: number,
    now: number,
  ): void {
    const delta = this.trace.delta(distance, current);
    const widget = this.find("delta");
    const fill = this.find("delta-fill");
    if (delta === null) {
      widget.dataset["state"] = "idle";
      this.find("delta-value").textContent = laps > 0 ? "—" : "";
      this.find("delta-pred").textContent =
        laps > 1 ? "Complete a clean lap" : "Set a lap time";
      fill.style.transform = "scaleX(0)";
      return;
    }
    this.deltaShown += (delta - this.deltaShown) * 0.25;
    const shown = this.deltaShown;
    const ahead = shown <= 0;
    widget.dataset["state"] = ahead ? "ahead" : "behind";
    this.find("delta-value").textContent = signed(shown);
    fill.style.transform = `scaleX(${String(Math.min(1, Math.abs(shown) / 1.5))})`;
    fill.style.transformOrigin = ahead ? "left center" : "right center";
    fill.style.left = ahead ? "50%" : "auto";
    fill.style.right = ahead ? "auto" : "50%";
    const predicted = this.trace.predicted(distance, current);
    this.find("delta-pred").textContent =
      predicted === null ? "" : `Predicted ${lapTime(predicted)}`;
    if (now > this.splitUntil) this.find("delta-label").textContent = "Delta";
  }

  private updateFuel(info: HudInfo, laps: number): void {
    if (laps !== this.lastLap) {
      if (
        this.fuelAtLapStart !== null &&
        laps === this.lastLap + 1 &&
        this.lastLap >= 1
      ) {
        const used = this.fuelAtLapStart - info.fuel;
        if (used > 0.05) this.lapFuel = used;
      }
      this.fuelAtLapStart = info.fuel;
      this.lastLap = laps;
    }
    this.find("fuel").textContent = info.fuel.toFixed(1);
    this.find("fuel-bar").style.transform =
      `scaleX(${String(Math.min(1, info.fuel / Math.max(1, info.tank)))})`;
    const lapsLeft = this.lapFuel ? info.fuel / this.lapFuel : null;
    this.find("fuel-laps").textContent =
      lapsLeft === null ? "measuring…" : `${lapsLeft.toFixed(1)} laps`;
    this.find("fuel-box").classList.toggle(
      "low",
      lapsLeft !== null && lapsLeft < 1.2,
    );
  }

  private updateTyres(info: HudInfo): void {
    const order = [1, 0, 3, 2];
    this.tyres.forEach((tyre, i) => {
      const wheel = order[i] ?? 0;
      const temp = info.tyreTemp[wheel] ?? 0;
      const optimal = info.tyreOptimal[wheel] ?? temp;
      tyre.root.style.setProperty("--tyre", tyreColor(temp, optimal));
      tyre.root.style.setProperty(
        "--wear",
        String(Math.max(0, Math.min(1, info.tyreTread[wheel] ?? 1))),
      );
      tyre.value.textContent = String(Math.round(temp - 273.15));
    });
  }

  private updateInputs(value: (index: number) => number): void {
    this.find("in-throttle").style.transform =
      `scaleY(${String(Math.max(0, Math.min(1, value(frameIndex.accel))))})`;
    this.find("in-brake").style.transform =
      `scaleY(${String(Math.max(0, Math.min(1, value(frameIndex.brake))))})`;
    this.find("in-steer").style.transform =
      `rotate(${String(-value(frameIndex.steer) * 90)}deg)`;
  }

  private updateLights(time: number): void {
    const gantry = this.find("lights");
    const lit =
      time < 0 ? Math.min(lightCount, Math.floor((time + 2) / 0.4) + 1) : 0;
    this.lights.forEach((light, i) => {
      light.classList.toggle("on", i < lit);
    });
    gantry.classList.toggle("show", time < 0.6);
    gantry.classList.toggle("out", time >= 0);
    this.find("go").classList.toggle("show", time >= 0 && time < 1.4);
  }

  private updateNotice(info: HudInfo): void {
    const notice = this.find("notice");
    let text = "";
    if (info.state & 0x0400) text = "Out of fuel";
    else if (info.state & 0x0200) text = "Car broken";
    else if (info.state & outOfRaceState) text = "Retired";
    notice.textContent = text;
    notice.classList.toggle("show", text !== "");
  }

  private showLap(result: LapResult, now: number): void {
    const banner = this.find("banner");
    this.find("banner-lap").textContent = `Lap ${String(result.lap)}`;
    this.find("banner-time").textContent = lapTime(result.time);
    const chip = this.find("banner-delta");
    chip.textContent = result.best
      ? "Personal best"
      : result.delta === null
        ? ""
        : signed(result.delta);
    banner.dataset["kind"] = result.best
      ? "pb"
      : (result.delta ?? 0) <= 0
        ? "ahead"
        : "behind";
    this.find("banner-sectors").replaceChildren(
      ...result.sectors.map((t, i) => {
        const span = document.createElement("span");
        span.textContent = `S${String(i + 1)} ${t.toFixed(3)}`;
        return span;
      }),
    );
    replay(banner, "show");
    this.bannerTimer = now + 4.5;
    this.lastActiveSector = -1;
  }
}
