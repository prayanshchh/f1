import * as THREE from "three/webgpu";
import type { CarTiming } from "./engine.ts";
import { compounds } from "./tyres.ts";
import type { Entrant } from "./weekend.ts";

const aroundRows = 5;
const labelRange = 140;
const labelCount = 3;
const labelNear = 6;
const labelHeight = 1.4;
const labelEdge = 0.95;
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
  tyre: HTMLElement;
  gap: HTMLElement;
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
    const tyre = document.createElement("i");
    tyre.className = "row-tyre";
    const gap = document.createElement("b");
    gap.className = "row-gap";
    root.append(pos, name, tyre, gap);
    root.hidden = true;
    this.list.append(root);
    return { root, pos, name, tyre, gap, shown: "" };
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

  update(timing: CarTiming[]): void {
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
      const key = `${String(data.position)}|${entrant.code}|${gap}|${compound.letter}`;
      if (key === row.shown) return;
      row.shown = key;
      row.pos.textContent = String(data.position);
      row.name.textContent = surname(entrant);
      row.name.style.setProperty("--team", entrant.colour);
      row.root.dataset["me"] = isPlayer ? "1" : "";
      row.root.classList.toggle("out", data.eliminated);
      row.tyre.textContent = compound.letter;
      row.tyre.style.setProperty("--tyre", compound.colour);
      row.gap.textContent = gap;
    });
  }
}

const eyeSpace = new THREE.Vector3();

function carPoint(cars: Float64Array, at: number): THREE.Vector3 {
  return eyeSpace.set(
    cars[at + 12] ?? 0,
    cars[at + 13] ?? 0,
    cars[at + 14] ?? 0,
  );
}

function fillLabel(label: HTMLElement, entrant: Entrant, position: number) {
  const text = `${String(position)}|${surname(entrant)}`;
  if (label.dataset["key"] === text) return;
  label.dataset["key"] = text;
  const pos = document.createElement("span");
  pos.textContent = String(position);
  const bar = document.createElement("i");
  bar.style.background = entrant.colour;
  const name = document.createElement("b");
  name.textContent = surname(entrant);
  label.replaceChildren(pos, bar, name);
}

export class CarLabels {
  private readonly labels: HTMLElement[] = [];

  constructor(
    root: HTMLElement,
    private readonly entrants: Entrant[],
  ) {
    for (let i = 0; i < labelCount; i++) {
      const label = document.createElement("div");
      label.className = "car-label";
      label.hidden = true;
      root.append(label);
      this.labels.push(label);
    }
  }

  private nearest(
    cars: Float64Array,
    stride: number,
    camera: THREE.Camera,
  ): number[] {
    const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const near: { index: number; distance: number }[] = [];
    for (let i = 1; i < this.entrants.length; i++) {
      const distance = carPoint(cars, i * stride).distanceTo(eye);
      if (distance < labelRange && distance > labelNear)
        near.push({ index: i, distance });
    }
    return near
      .sort((a, b) => a.distance - b.distance)
      .map(({ index }) => index);
  }

  update(
    cars: Float64Array,
    stride: number,
    timing: CarTiming[],
    camera: THREE.Camera,
    width: number,
    height: number,
  ): void {
    let used = 0;
    for (const index of this.nearest(cars, stride, camera)) {
      if (used >= labelCount) break;
      const point = carPoint(cars, index * stride);
      point.z += labelHeight;
      point.project(camera);
      const entrant = this.entrants[index];
      const label = this.labels[used];
      const row = timing[index];
      if (point.z > 1 || Math.abs(point.x) > labelEdge) continue;
      if (!label || !entrant || !row) continue;
      fillLabel(label, entrant, row.position);
      const x = (point.x * 0.5 + 0.5) * width;
      const y = (1 - (point.y * 0.5 + 0.5)) * height;
      label.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -100%)`;
      label.hidden = false;
      used++;
    }
    this.labels.forEach((label, i) => {
      if (i >= used) label.hidden = true;
    });
  }
}
