import { type CarTiming, sessionPhase, type SessionInfo } from "./engine.ts";
import { lapText, surname } from "./tower.ts";
import { compounds } from "./tyres.ts";
import { clockText, type Entrant, segmentNames } from "./weekend.ts";

const statusLabels = [
  "On Track",
  "Out Lap",
  "Flying Lap",
  "In Lap",
  "Pit Lane",
  "Garage",
  "Finished",
  "Retired",
  "Knocked Out",
];
const knockouts = [6, 6, 0];
const garageCompounds = [0, 1, 2];
const compactRows = 12;

function find(selector: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`missing element ${selector}`);
  return node;
}

function cell(text: string, className = ""): HTMLTableCellElement {
  const td = document.createElement("td");
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function ranked(timing: CarTiming[]): CarTiming[] {
  return [...timing].sort((a, b) => a.position - b.position);
}

function dangerFrom(timing: CarTiming[], segment: number): number {
  const alive = timing.filter((row) => !row.eliminated).length;
  return alive - (knockouts[segment] ?? 0);
}

function tyreCell(compound: number): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "tyre-cell";
  const tyre = compounds[compound] ?? compounds[1];
  const badge = document.createElement("i");
  badge.textContent = tyre.letter;
  badge.style.setProperty("--tyre", tyre.colour);
  td.append(badge);
  return td;
}

function garageNote(mine: CarTiming | undefined): string {
  if (mine?.eliminated)
    return "You are out of this session. Skip to the end to see who takes pole.";
  if (mine && mine.segmentBest > 0)
    return `Your best is ${lapText(mine.segmentBest)}, P${String(mine.position)}. Fresh tyres are fitted when you leave.`;
  return "No lap time yet. The cut comes at the flag, so leave enough time for an out lap and a flying lap.";
}

function qualifyingGap(row: CarTiming, leaderBest: number): string {
  return row.segmentBest > 0 && row.position > 1
    ? `+${(row.segmentBest - leaderBest).toFixed(3)}`
    : "";
}

function garageTime(row: CarTiming): string {
  if (row.eliminated) return "Out";
  return row.segmentBest > 0 ? lapText(row.segmentBest) : "No time";
}

function garageRow(
  row: CarTiming,
  entrant: Entrant | undefined,
  danger: number,
  leaderBest: number,
): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.classList.toggle("me", row.index === 0);
  tr.classList.toggle("out", row.eliminated);
  tr.classList.toggle("danger", !row.eliminated && row.position > danger);
  const nameCell = cell(entrant ? surname(entrant) : "", "name");
  nameCell.style.setProperty("--team", entrant?.colour ?? "#888");
  tr.append(
    cell(String(row.position), "pos"),
    nameCell,
    cell(statusLabels[row.status] ?? "", "state"),
    cell(garageTime(row), "time"),
    cell(qualifyingGap(row, leaderBest), "gap"),
  );
  return tr;
}

export interface GarageActions {
  go: (compound: number) => void;
  fast: () => boolean;
  skip: () => void;
}

export class GarageScreen {
  private readonly root = find("[data-garage=root]");
  private compound = 0;
  private fastOn = false;

  constructor(
    private readonly entrants: Entrant[],
    private readonly actions: GarageActions,
  ) {
    find("[data-garage=go]").addEventListener("click", () => {
      this.actions.go(this.compound);
    });
    find("[data-garage=fast]").addEventListener("click", () => {
      this.toggleFast();
    });
    find("[data-garage=skip]").addEventListener("click", () => {
      this.actions.skip();
    });
    window.addEventListener(
      "keydown",
      (event) => {
        if (this.root.hidden || event.key === "Escape") return;
        event.stopPropagation();
        this.onKey(event);
      },
      true,
    );
    this.buildTyres();
  }

  private onKey(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (event.key === "Enter") this.actions.go(this.compound);
    else if (event.key.toLowerCase() === "f") this.toggleFast();
    else if (event.key.toLowerCase() === "s") this.actions.skip();
    else if (event.key === "ArrowLeft") this.nudge(-1);
    else if (event.key === "ArrowRight") this.nudge(1);
    else return;
    event.preventDefault();
  }

  private nudge(delta: number): void {
    const next = garageCompounds.indexOf(this.compound) + delta;
    this.compound = garageCompounds[next] ?? this.compound;
    this.buildTyres();
  }

  private toggleFast(): void {
    this.fastOn = this.actions.fast();
    find("[data-garage=fast-label]").textContent = this.fastOn
      ? "Normal Speed"
      : "Fast Forward";
  }

  private buildTyres(): void {
    find("[data-garage=tyres]").replaceChildren(
      ...garageCompounds.map((index) => {
        const tyre = compounds[index] ?? compounds[0];
        const button = document.createElement("button");
        button.type = "button";
        button.classList.toggle("active", index === this.compound);
        const badge = document.createElement("i");
        badge.textContent = tyre.letter;
        badge.style.setProperty("--tyre", tyre.colour);
        button.append(badge, tyre.label);
        button.addEventListener("click", () => {
          this.compound = index;
          this.buildTyres();
        });
        return button;
      }),
    );
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
    this.fastOn = false;
    find("[data-garage=fast-label]").textContent = "Fast Forward";
  }

  hide(): void {
    this.root.hidden = true;
  }

  update(timing: CarTiming[], info: SessionInfo): void {
    const out = knockouts[info.segment] ?? 0;
    find("[data-garage=title]").textContent = segmentNames[info.segment] ?? "Q";
    find("[data-garage=subtitle]").textContent = out
      ? `Bottom ${String(out)} knocked out`
      : "Top ten shootout for pole";
    const running = info.phase === sessionPhase.running;
    find("[data-garage=clock]").textContent = running
      ? clockText(info.clock)
      : "Flag";
    const mine = timing[0];
    find("[data-garage=note]").textContent = garageNote(mine);
    find("[data-garage=go]").toggleAttribute(
      "disabled",
      mine?.eliminated === true || !running,
    );
    const danger = out ? dangerFrom(timing, info.segment) : Infinity;
    const leader = ranked(timing)[0]?.segmentBest ?? 0;
    find("[data-garage=rows]").replaceChildren(
      ...ranked(timing).map((row) =>
        garageRow(row, this.entrants[row.index], danger, leader),
      ),
    );
  }
}

export interface ClassificationAction {
  label: string;
  run: () => void;
}

function raceGap(row: CarTiming, winner: CarTiming | undefined): string {
  if (row.retired) return "DNF";
  if (!row.finished)
    return row.lapsDown > 0 ? `+${String(row.lapsDown)} Lap` : "Running";
  if (!winner || row.index === winner.index) return lapText(row.finishTime);
  if (row.lapsDown > 0) return `+${String(row.lapsDown)} Lap`;
  return `+${(row.finishTime - winner.finishTime).toFixed(3)}`;
}

function driverCells(entrant: Entrant | undefined): HTMLTableCellElement[] {
  if (!entrant) return [cell(""), cell("", "team-cell")];
  const team = cell(entrant.team, "team-cell");
  team.style.setProperty("--team", entrant.colour);
  return [cell(entrant.name), team];
}

function classificationRow(
  row: CarTiming,
  entrant: Entrant | undefined,
  leader: CarTiming | undefined,
  mode: "race" | "qualifying",
): HTMLTableRowElement {
  const race = mode === "race";
  const tr = document.createElement("tr");
  tr.classList.toggle("me", row.index === 0);
  tr.append(
    cell(String(row.position), "pos"),
    ...driverCells(entrant),
    tyreCell(row.compound),
    cell(lapText(race ? row.best : row.segmentBest || row.best), "time"),
    cell(
      race
        ? raceGap(row, leader)
        : qualifyingGap(row, leader?.segmentBest ?? 0),
      "gap",
    ),
  );
  return tr;
}

function classificationRows(
  entrants: Entrant[],
  timing: CarTiming[],
  mode: "race" | "qualifying",
  segment: number,
): HTMLTableRowElement[] {
  const order = ranked(timing);
  const danger =
    mode === "qualifying" && knockouts[segment]
      ? dangerFrom(timing, segment)
      : Infinity;
  return order.map((row, index) => {
    const tr = classificationRow(row, entrants[row.index], order[0], mode);
    tr.style.setProperty("--i", String(index));
    tr.classList.toggle("danger", !row.eliminated && row.position > danger);
    return tr;
  });
}

export function updateClassificationRows(
  entrants: Entrant[],
  timing: CarTiming[],
): void {
  const body = find("[data-results=laps]");
  body.classList.add("settled");
  body.replaceChildren(...classificationRows(entrants, timing, "race", 0));
}

export function showClassification(
  title: string,
  subtitle: string,
  entrants: Entrant[],
  timing: CarTiming[],
  mode: "race" | "qualifying",
  segment: number,
  actions: ClassificationAction[],
): void {
  find("[data-results=tag]").textContent = subtitle;
  find("[data-results=title]").textContent = title;
  const headers = ["Pos", "Driver", "Team", "Tyre", "Best", "Gap"];
  find("[data-results=head]").replaceChildren(
    ...headers.map((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      return th;
    }),
  );
  const body = find("[data-results=laps]");
  body.classList.remove("settled");
  body.replaceChildren(...classificationRows(entrants, timing, mode, segment));
  body.parentElement?.classList.toggle("compact", timing.length > compactRows);
  find("[data-results=summary]").textContent = "";
  showActions(actions);
}

export function showActions(actions: ClassificationAction[]): void {
  const root = find("[data-results=root]");
  find("[data-results=actions]").replaceChildren(
    ...actions.map((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", action.run);
      return button;
    }),
  );
  root.hidden = false;
  requestAnimationFrame(() => {
    root.classList.add("open");
  });
}

export function hideClassification(): void {
  const root = find("[data-results=root]");
  root.classList.remove("open");
  root.hidden = true;
}

export function showGrid(
  title: string,
  entrants: Entrant[],
  gridCodes: string[],
  times: Map<string, number>,
): Promise<void> {
  find("[data-grid=title]").textContent = title;
  find("[data-grid=rows]").replaceChildren(
    ...gridCodes.map((code, index) => {
      const entrant = entrants.find((e) => e.code === code);
      const slot = document.createElement("div");
      slot.className = "grid-slot";
      slot.style.setProperty("--i", String(index));
      slot.classList.toggle("me", entrant?.player === true);
      const pos = document.createElement("span");
      pos.textContent = String(index + 1);
      const bar = document.createElement("i");
      bar.style.background = entrant?.colour ?? "#888";
      const name = document.createElement("b");
      name.textContent = entrant ? surname(entrant) : code;
      const time = document.createElement("small");
      time.textContent = lapText(times.get(code) ?? 0);
      slot.append(pos, bar, name, time);
      return slot;
    }),
  );
  const root = find("[data-grid=root]");
  root.hidden = false;
  return new Promise((done) => {
    const go = () => {
      root.hidden = true;
      window.removeEventListener("keydown", onKey, true);
      done();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      event.stopPropagation();
      event.preventDefault();
      go();
    };
    window.addEventListener("keydown", onKey, true);
    find("[data-grid=go]").addEventListener("click", go, { once: true });
  });
}
