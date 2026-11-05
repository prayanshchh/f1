import type { CarTiming } from "./engine.ts";
import { teamLogo } from "./team-logos.ts";
import { compounds } from "./tyres.ts";
import type { Entrant } from "./weekend.ts";

const aroundRows = 5;
const statusGarage = 5;
const statusOut = 1;
const statusIn = 3;

export function lapText(seconds: number): string {
  if (!(seconds > 0)) return "--:--.---";
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${(seconds - minutes * 60).toFixed(3).padStart(6, "0")}`;
}

export function surname(entrant: Entrant): string {
  const parts = entrant.name.trim().split(/\s+/);
  return (parts.at(-1) ?? entrant.code).toUpperCase();
}

function signedGap(value: number): string {
  return `${value < 0 ? "-" : "+"}${Math.abs(value).toFixed(3)}`;
}

function raceGapText(
  row: CarTiming,
  player: CarTiming | undefined,
  isPlayer: boolean,
): string {
  if (isPlayer) return "--:--.---";
  if (row.progress <= 0) return "";
  if (row.inPit) return "IN PIT";
  if (!player) return "";
  const laps = player.lapsDown - row.lapsDown;
  if (laps !== 0) return `${laps > 0 ? "-" : "+"}${String(Math.abs(laps))} LAP`;
  return signedGap(row.gapLeader - player.gapLeader);
}

function qualifyingGapText(row: CarTiming, leaderBest: number): string {
  if (row.eliminated) return "OUT";
  if (row.status === statusGarage && row.segmentBest <= 0) return "PIT";
  if (row.segmentBest <= 0)
    return row.status === statusOut
      ? "OUT LAP"
      : row.status === statusIn
        ? "IN LAP"
        : "NO TIME";
  if (row.position === 1) return lapText(row.segmentBest);
  return signedGap(row.segmentBest - leaderBest);
}

interface TowerRow {
  root: HTMLElement;
  pos: HTMLElement;
  name: HTMLElement;
  logo: HTMLElement;
  label: HTMLElement;
  tyre: HTMLElement;
  gap: HTMLElement;
  pen: HTMLElement;
  shown: string;
}

export class Tower {
  private readonly rows: TowerRow[];
  private full = false;

  constructor(
    private readonly list: HTMLElement,
    private readonly entrants: Entrant[],
    private readonly qualifying: boolean,
  ) {
    this.list.replaceChildren();
    this.rows = entrants.map(() => this.makeRow());
  }

  private makeRow(): TowerRow {
    const root = document.createElement("li");
    const pos = document.createElement("span");
    pos.className = "row-pos";
    const name = document.createElement("span");
    name.className = "row-name";
    const logo = document.createElement("i");
    logo.className = "row-logo";
    const label = document.createElement("span");
    name.append(logo, label);
    const tyre = document.createElement("i");
    tyre.className = "row-tyre";
    const gap = document.createElement("b");
    gap.className = "row-gap";
    const pen = document.createElement("em");
    pen.className = "row-pen";
    pen.hidden = true;
    root.append(pos, name, tyre, gap, pen);
    root.hidden = true;
    this.list.append(root);
    return { root, pos, name, logo, label, tyre, gap, pen, shown: "" };
  }

  toggleFull(): boolean {
    this.full = !this.full;
    return this.full;
  }

  private window(ranked: CarTiming[]): CarTiming[] {
    if (this.full) return ranked;
    const mine = ranked.findIndex((row) => row.index === 0);
    const half = Math.floor(aroundRows / 2);
    const from = Math.max(0, Math.min(ranked.length - aroundRows, mine - half));
    return ranked.slice(from, from + aroundRows);
  }

  update(timing: CarTiming[], penalties: string[]): void {
    const ranked = [...timing].sort((a, b) => a.position - b.position);
    const player = timing[0];
    const leaderBest = ranked[0]?.segmentBest ?? 0;
    const visible = this.window(ranked);
    this.rows.forEach((row, i) => {
      const data = visible[i];
      if (!data) {
        row.root.hidden = true;
        return;
      }
      row.root.hidden = false;
      const entrant = this.entrants[data.index];
      if (!entrant) return;
      const isPlayer = data.index === 0;
      const gap = this.qualifying
        ? qualifyingGapText(data, leaderBest)
        : raceGapText(data, player, isPlayer);
      const compound = compounds[data.compound] ?? compounds[1];
      const pen = penalties[data.index] ?? "";
      const key = `${String(data.position)}|${entrant.code}|${gap}|${compound.letter}|${pen}`;
      if (key === row.shown) return;
      row.shown = key;
      row.pos.textContent = String(data.position);
      row.label.textContent = surname(entrant);
      row.logo.replaceChildren(teamLogo(entrant.car, entrant.colour));
      row.name.style.setProperty("--team", entrant.colour);
      row.root.dataset["me"] = isPlayer ? "1" : "";
      row.root.classList.toggle("out", data.eliminated);
      row.tyre.textContent = compound.letter;
      row.tyre.style.setProperty("--tyre", compound.colour);
      row.gap.textContent = gap;
      row.pen.textContent = pen;
      row.pen.hidden = pen === "";
    });
  }
}
