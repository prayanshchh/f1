import {
  api,
  type Driver,
  type LapRow,
  type PersonalBest,
  type SessionDetail,
  type SessionSummary,
} from "./api.ts";
import { button, el, prompt } from "./dom.ts";
import { lapTime } from "./hud.ts";
import { teamLogo } from "./team-logos.ts";
import { teamOf } from "./teams.ts";
import { compounds } from "./tyres.ts";

const trackNames: Record<string, string> = {
  "hill-country": "Hill Country Circuit",
};

function fromMs(ms: number | null | undefined): string {
  return ms ? lapTime(ms / 1000) : "--:--.---";
}

function sectorText(ms: number | null | undefined): string {
  return ms ? (ms / 1000).toFixed(3) : "--.---";
}

function gapText(ms: number): string {
  return `+${(ms / 1000).toFixed(3)}`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function hours(ms: number): string {
  const minutes = Math.round(ms / 60000);
  return minutes < 60
    ? `${String(minutes)} min`
    : `${String(Math.floor(minutes / 60))} h ${String(minutes % 60)} min`;
}

function cell(text: string, className = ""): HTMLTableCellElement {
  return el("td", className, text);
}

function headerRow(labels: string[]): HTMLTableRowElement {
  const row = el("tr");
  row.append(...labels.map((label) => el("th", "", label)));
  return row;
}

function stat(label: string, value: string): HTMLElement {
  const box = el("div", "records-stat");
  box.append(el("b", "", value), el("span", "", label));
  return box;
}

function bestCard(best: PersonalBest): HTMLElement {
  const team = teamOf(best.team);
  const card = el("article", "records-best");
  card.style.setProperty("--brand", team.brand);
  const ideal = best.bestSectorsMs.reduce((sum, ms) => sum + ms, 0);
  const head = el("header");
  head.append(
    teamLogo(team.id, team.brand),
    el("h3", "", trackNames[best.track] ?? best.track),
    el("small", "", `Set ${when(best.setAt)}`),
  );
  const time = el("div", "records-best-time");
  time.append(
    el("span", "", "Personal Best"),
    el("b", "", fromMs(best.timeMs)),
  );
  const idealBox = el("div", "records-best-time");
  idealBox.append(
    el("span", "", "Ideal Lap"),
    el("b", "purple", fromMs(ideal)),
  );
  const sectors = el("div", "records-sectors");
  best.sectorsMs.forEach((ms, index) => {
    const fastest = best.bestSectorsMs[index];
    const box = el("div");
    box.append(
      el("span", "", `S${String(index + 1)}`),
      el("b", ms === fastest ? "purple" : "", sectorText(ms)),
      el("small", "", `Best ${sectorText(fastest)}`),
    );
    sectors.append(box);
  });
  card.append(head, time, idealBox, sectors);
  return card;
}

function fastestSectors(laps: LapRow[]): (number | null)[] {
  const count = laps[0]?.sectorsMs.length ?? 3;
  return Array.from({ length: count }, (_, index) => {
    const known = laps
      .filter((lap) => lap.valid)
      .map((lap) => lap.sectorsMs[index])
      .filter((ms): ms is number => typeof ms === "number");
    return known.length ? Math.min(...known) : null;
  });
}

function compoundLetter(id: string | null): HTMLElement {
  const compound = compounds.find((c) => c.id === id);
  const mark = el("i", "records-compound", compound?.letter ?? "");
  mark.style.setProperty("--tyre", compound?.colour ?? "#777");
  return mark;
}

function lapTable(session: SessionDetail): HTMLTableElement {
  const laps = session.lapTimes;
  const best = Math.min(
    ...laps.filter((lap) => lap.valid).map((lap) => lap.timeMs),
  );
  const sectors = fastestSectors(laps);
  const table = el("table", "records-table");
  const head = el("thead");
  head.append(
    headerRow([
      "Lap",
      ...sectors.map((_, index) => `S${String(index + 1)}`),
      "Time",
      "Gap",
      "Tyre",
    ]),
  );
  const body = el("tbody");
  body.append(
    ...laps.map((lap) => {
      const row = el("tr");
      row.classList.toggle("best", lap.timeMs === best);
      row.classList.toggle("deleted", !lap.valid);
      const tyre = el("td");
      tyre.append(compoundLetter(lap.compound));
      row.append(
        cell(String(lap.lap), "pos"),
        ...sectors.map((fastest, index) => {
          const ms = lap.sectorsMs[index];
          return cell(sectorText(ms), ms === fastest ? "purple" : "");
        }),
        cell(fromMs(lap.timeMs), lap.timeMs === best ? "purple time" : "time"),
        cell(lap.timeMs === best ? "" : gapText(lap.timeMs - best), "gap"),
        tyre,
      );
      return row;
    }),
  );
  table.append(head, body);
  return table;
}

export class ProfileScreen {
  private readonly root: HTMLElement;
  private readonly body = el("div", "records-body");
  private close: () => void = () => undefined;
  private backTo: (() => void) | null = null;
  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    this.back();
  };

  constructor(private readonly driver: Driver) {
    const found = document.querySelector<HTMLElement>("[data-records=root]");
    if (!found)
      throw new Error("drive page markup is missing the records page");
    this.root = found;
  }

  async run(): Promise<void> {
    const stage = el("div", "stage");
    const head = el("header", "front-heading");
    head.append(
      el("span", "front-tag", "Lap records"),
      el(
        "h1",
        "",
        `${this.driver.firstName ?? ""} ${this.driver.lastName ?? this.driver.username}`,
      ),
    );
    const foot = el("footer", "front-foot");
    const back = prompt("Esc", "Back");
    back.addEventListener("click", () => {
      this.back();
    });
    foot.append(back);
    stage.append(head, this.body, foot);
    this.root.replaceChildren(stage);
    this.root.hidden = false;
    window.addEventListener("keydown", this.onKey);
    await this.overview();
    return new Promise((resolve) => {
      this.close = () => {
        this.root.hidden = true;
        window.removeEventListener("keydown", this.onKey);
        resolve();
      };
    });
  }

  private back(): void {
    if (this.backTo) {
      const target = this.backTo;
      this.backTo = null;
      target();
      return;
    }
    this.close();
  }

  private async load<T>(work: Promise<T>): Promise<T | null> {
    this.body.replaceChildren(el("p", "records-note", "Loading…"));
    try {
      return await work;
    } catch (error) {
      this.body.replaceChildren(
        el(
          "p",
          "records-note",
          error instanceof Error
            ? error.message
            : "Could not load your records.",
        ),
      );
      return null;
    }
  }

  private async overview(): Promise<void> {
    const data = await this.load(
      Promise.all([api.profile(), api.sessions(null)]),
    );
    if (!data) return;
    const [summary, page] = data;
    const stats = el("section", "records-stats");
    stats.append(
      stat("Sessions", String(summary.totals.sessions)),
      stat("Races", String(summary.totals.races)),
      stat("Laps", String(summary.totals.laps)),
      stat("Time on track", hours(summary.totals.timeMs)),
    );
    const bests = el("section", "records-bests");
    bests.append(...summary.bests.map(bestCard));
    const list = el("section", "records-sessions");
    list.dataset["records"] = "sessions";
    this.appendSessions(list, page.sessions, page.next);
    if (page.sessions.length === 0)
      list.append(
        el(
          "p",
          "records-note",
          "No laps yet. Finish a lap and it will be saved here.",
        ),
      );
    this.body.replaceChildren(stats, bests, list);
  }

  private appendSessions(
    list: HTMLElement,
    sessions: SessionSummary[],
    next: string | null,
  ): void {
    list.querySelector(".records-more")?.remove();
    list.append(
      ...sessions.map((session) =>
        button("records-session", "", () => {
          void this.detail(session.id);
        }),
      ),
    );
    const rows = Array.from(
      list.querySelectorAll<HTMLElement>(".records-session"),
    );
    rows.slice(-sessions.length).forEach((row, index) => {
      const session = sessions[index];
      if (session) this.fillSession(row, session);
    });
    if (next)
      list.append(
        button("records-more", "Load more", () => {
          void api.sessions(next).then((page) => {
            this.appendSessions(list, page.sessions, page.next);
          });
        }),
      );
  }

  private fillSession(row: HTMLElement, session: SessionSummary): void {
    const team = teamOf(session.team);
    row.style.setProperty("--brand", team.brand);
    const kind = el(
      "span",
      `records-kind ${session.kind}`,
      session.kind === "race" ? "Race" : "Practice",
    );
    const where = el("span", "records-where");
    where.append(
      el("b", "", trackNames[session.track] ?? session.track),
      el("small", "", when(session.startedAt)),
    );
    const laps = session.plannedLaps
      ? `${String(session.laps)} / ${String(session.plannedLaps)} laps`
      : `${String(session.laps)} ${session.laps === 1 ? "lap" : "laps"}`;
    row.append(
      teamLogo(team.id, team.brand),
      kind,
      where,
      el("span", "records-laps", laps),
      el("b", "records-time", fromMs(session.bestMs)),
    );
  }

  private async detail(id: string): Promise<void> {
    const session = await this.load(api.session(id));
    if (!session) return;
    this.backTo = () => {
      void this.overview();
    };
    const head = el("div", "records-detail-head");
    const stats = el("div", "records-stats");
    stats.append(
      stat(
        session.kind === "race" ? "Race" : "Practice",
        when(session.startedAt),
      ),
      stat("Team", teamOf(session.team).name),
      stat("Best lap", fromMs(session.bestMs)),
      stat("Total time", fromMs(session.totalMs)),
    );
    head.append(stats);
    this.body.replaceChildren(head, lapTable(session));
  }
}
