import {
  api,
  ApiError,
  type Driver,
  type DriverProfile,
  rememberDriver,
} from "./api.ts";
import { button, el, prompt } from "./dom.ts";
import { countries, countryName, flagUrl, guessCountry } from "./flags.ts";
import { ProfileScreen } from "./profile-screen.ts";
import { framings, type Studio } from "./studio.ts";
import { teamLogo } from "./team-logos.ts";
import { type Team, teamOf, teams, type TeamRatings } from "./teams.ts";

export interface HubChoice {
  action: "race" | "signout";
  driver: Driver;
}

const insights: { id: keyof TeamRatings; label: string }[] = [
  { id: "performance", label: "Performance" },
  { id: "aero", label: "Aerodynamics" },
  { id: "power", label: "Power Unit" },
  { id: "reliability", label: "Reliability" },
];
const numberColumns = 3;
const driverNumbers = 99;

type Keys = Record<string, () => void>;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function flagImage(code: string | null, className = "flag"): HTMLImageElement {
  const image = el("img", className);
  image.src = flagUrl(code);
  image.alt = countryName(code);
  return image;
}

function heading(tag: string, title: string, detail = ""): HTMLElement {
  const box = el("header", "front-heading");
  box.append(el("span", "front-tag", tag), el("h1", "", title));
  if (detail) box.append(el("p", "", detail));
  return box;
}

function draftOf(driver: Driver): DriverProfile {
  return {
    firstName: driver.firstName ?? "",
    lastName: driver.lastName ?? "",
    nationality: driver.nationality ?? guessCountry(),
    number: driver.number ?? 1,
    team: driver.team ?? teams[0]?.id ?? "",
  };
}

export class FrontEnd {
  private keys: Keys = {};
  private readonly stage: HTMLElement;
  private readonly keyHandler = (event: KeyboardEvent): void => {
    const action = this.keys[event.key];
    if (!action) return;
    const typing = event.target instanceof HTMLInputElement;
    if (
      typing &&
      !["Enter", "Escape", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    action();
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly studio: Studio,
  ) {
    this.stage = el("div", "stage");
    root.append(this.stage);
  }

  open(): void {
    this.root.hidden = false;
    this.studio.start();
    window.addEventListener("keydown", this.keyHandler);
  }

  close(): void {
    this.root.hidden = true;
    this.studio.stop();
    window.removeEventListener("keydown", this.keyHandler);
    this.keys = {};
  }

  private show(keys: Keys, ...nodes: HTMLElement[]): void {
    this.keys = keys;
    this.stage.replaceChildren(...nodes);
    this.stage.classList.remove("enter");
    void this.stage.getBoundingClientRect();
    this.stage.classList.add("enter");
  }

  private footer(...prompts: [string, string, () => void][]): HTMLElement {
    const foot = el("footer", "front-foot");
    for (const [glyph, label, action] of prompts) {
      const item = prompt(glyph, label);
      item.addEventListener("click", action);
      foot.append(item);
    }
    return foot;
  }

  async welcome(): Promise<Driver> {
    this.studio.frame(framings.empty);
    this.studio.hideCar();
    return new Promise((resolve) => {
      this.authScreen("register", resolve);
    });
  }

  private authScreen(
    mode: "register" | "login",
    done: (driver: Driver) => void,
  ): void {
    const creating = mode === "register";
    const username = el("input");
    username.placeholder = "Driver name";
    username.autocomplete = "username";
    username.spellcheck = false;
    username.dataset["front"] = "username";
    const password = el("input");
    password.type = "password";
    password.placeholder = "Password";
    password.autocomplete = creating ? "new-password" : "current-password";
    password.dataset["front"] = "password";
    const message = el("p", "front-error");
    message.dataset["front"] = "error";
    const submit = async () => {
      message.textContent = "";
      try {
        const name = username.value.trim();
        done(
          await (creating
            ? api.register(name, password.value)
            : api.login(name, password.value)),
        );
      } catch (error) {
        message.textContent = errorText(error);
        const field = error instanceof ApiError ? error.field : null;
        (field === "password" ? password : username).focus();
      }
    };
    const form = el("form", "front-auth");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submit();
    });
    const go = el(
      "button",
      "front-primary",
      creating ? "Create Driver" : "Sign In",
    );
    go.dataset["front"] = "submit";
    const swap = button(
      "front-link",
      creating ? "I already have a driver" : "Create a new driver",
      () => {
        this.authScreen(creating ? "login" : "register", done);
      },
    );
    swap.dataset["front"] = "swap";
    form.append(username, password, message, go, swap);
    const logo = el("div", "front-brand");
    logo.innerHTML = '<svg class="f1"><use href="#f1-logo" /></svg>';
    this.show(
      { Enter: () => void submit() },
      logo,
      heading(
        creating ? "New driver" : "Welcome back",
        creating ? "Create your driver" : "Sign in",
        creating
          ? "Your name, team, lap times and race history are saved to your driver."
          : "Pick up your career where you left it.",
      ),
      form,
    );
    username.focus();
  }

  async onboard(driver: Driver): Promise<Driver> {
    const draft = draftOf(driver);
    const steps: ((back: () => void, next: () => void) => void)[] = [
      (back, next) => {
        this.nameScreen("firstName", "Enter first name", draft, back, next);
      },
      (back, next) => {
        this.nameScreen("lastName", "Enter last name", draft, back, next);
      },
      (back, next) => {
        this.nationalityScreen(draft, back, next);
      },
      (back, next) => {
        this.numberScreen(draft, back, next);
      },
      (back, next) => {
        this.teamScreen(draft, back, next);
      },
    ];
    return new Promise((resolve) => {
      const run = (index: number) => {
        const step = steps[index];
        if (!step) {
          this.confirmScreen(
            draft,
            () => {
              run(steps.length - 1);
            },
            resolve,
          );
          return;
        }
        step(
          () => {
            run(Math.max(0, index - 1));
          },
          () => {
            run(index + 1);
          },
        );
      };
      run(0);
    });
  }

  private nameScreen(
    field: "firstName" | "lastName",
    title: string,
    draft: DriverProfile,
    back: () => void,
    next: () => void,
  ): void {
    this.studio.frame(framings.empty);
    this.studio.hideCar();
    const input = el("input", "front-name");
    input.value = draft[field];
    input.maxLength = 24;
    input.autocomplete = field === "firstName" ? "given-name" : "family-name";
    input.dataset["front"] = "name";
    const message = el("p", "front-error");
    const advance = () => {
      const value = input.value.trim();
      if (!value) {
        message.textContent = "Enter a name to continue.";
        return;
      }
      draft[field] = value;
      next();
    };
    const box = el("div", "front-centre");
    box.append(el("h2", "", title), input, message);
    this.show(
      { Enter: advance, Escape: back },
      box,
      this.footer(["↵", "Continue", advance], ["Esc", "Back", back]),
    );
    input.focus();
    input.select();
  }

  private nationalityScreen(
    draft: DriverProfile,
    back: () => void,
    next: () => void,
  ): void {
    this.studio.frame(framings.empty);
    this.studio.hideCar();
    const list = el("div", "front-countries");
    const search = el("input", "front-search");
    search.placeholder = "Search countries";
    search.spellcheck = false;
    const paint = () => {
      const query = search.value.trim().toLowerCase();
      const shown = countries.filter((c) =>
        c.name.toLowerCase().includes(query),
      );
      list.replaceChildren(
        ...shown.map((country) => {
          const row = button("front-country", "", () => {
            draft.nationality = country.code;
            next();
          });
          row.dataset["code"] = country.code;
          row.classList.toggle("active", country.code === draft.nationality);
          row.append(flagImage(country.code), el("span", "", country.name));
          return row;
        }),
      );
      list.querySelector(".active")?.scrollIntoView({ block: "nearest" });
    };
    search.addEventListener("input", paint);
    paint();
    const move = (delta: number) => {
      const rows = Array.from(list.children) as HTMLElement[];
      const index = rows.findIndex((row) => row.classList.contains("active"));
      const target =
        rows[Math.max(0, Math.min(rows.length - 1, index + delta))];
      if (!target) return;
      draft.nationality = target.dataset["code"] ?? draft.nationality;
      paint();
    };
    const advance = () => {
      next();
    };
    this.show(
      {
        ArrowUp: () => {
          move(-1);
        },
        ArrowDown: () => {
          move(1);
        },
        Enter: advance,
        Escape: back,
      },
      heading("Driver profile", "Choose nationality"),
      search,
      list,
      this.footer(["↵", "Continue", advance], ["Esc", "Back", back]),
    );
    search.focus();
  }

  private numberScreen(
    draft: DriverProfile,
    back: () => void,
    next: () => void,
  ): void {
    this.studio.frame(framings.empty);
    this.studio.hideCar();
    const grid = el("div", "front-numbers");
    const tiles = Array.from({ length: driverNumbers }, (_, index) => {
      const number = index + 1;
      const tile = button("front-number", String(number), () => {
        draft.number = number;
        paint();
      });
      tile.addEventListener("dblclick", next);
      return tile;
    });
    grid.append(...tiles);
    const paint = () => {
      tiles.forEach((tile, index) => {
        tile.classList.toggle("active", index + 1 === draft.number);
      });
      tiles[draft.number - 1]?.scrollIntoView({ block: "nearest" });
    };
    const move = (delta: number) => {
      draft.number = Math.max(1, Math.min(driverNumbers, draft.number + delta));
      paint();
    };
    this.show(
      {
        ArrowLeft: () => {
          move(-1);
        },
        ArrowRight: () => {
          move(1);
        },
        ArrowUp: () => {
          move(-numberColumns);
        },
        ArrowDown: () => {
          move(numberColumns);
        },
        Enter: next,
        Escape: back,
      },
      heading(
        "Driver profile",
        "Choose driver number",
        "Your number appears on the timing tower and the starting grid.",
      ),
      grid,
      this.footer(["↵", "Continue", next], ["Esc", "Back", back]),
    );
    paint();
  }

  private teamScreen(
    draft: DriverProfile,
    back: () => void,
    next: () => void,
  ): void {
    this.studio.frame(framings.team);
    void this.studio.select(draft.team);
    let insight = 0;
    const title = el("h1", "front-team-name");
    const details = el("dl", "front-team-details");
    const board = el("div", "front-insight");
    const label = el("span", "front-insight-label");
    const tilesRow = el("div", "front-team-tiles");
    const tiles = teams.map((team) => {
      const tile = button("front-team-tile", "", () => {
        select(team);
      });
      tile.dataset["team"] = team.id;
      tile.title = team.name;
      tile.append(teamLogo(team.id, team.brand));
      return tile;
    });
    tilesRow.append(...tiles);
    const paintBoard = (selected: Team) => {
      const metric = insights[insight] ?? insights[0];
      if (!metric) return;
      label.textContent = metric.label;
      const ranked = [...teams].sort(
        (a, b) => b.ratings[metric.id] - a.ratings[metric.id],
      );
      const average =
        teams.reduce((sum, team) => sum + team.ratings[metric.id], 0) /
        teams.length;
      board.style.setProperty("--average", `${String(average)}%`);
      board.replaceChildren(
        ...ranked.map((team) => {
          const row = el("div", "front-insight-row");
          row.classList.toggle("active", team.id === selected.id);
          row.style.setProperty("--brand", team.brand);
          row.style.setProperty(
            "--value",
            `${String(team.ratings[metric.id])}%`,
          );
          const name = el("span", "front-insight-name");
          name.append(
            teamLogo(team.id, team.brand),
            el("b", "", team.fullName),
          );
          row.append(name, el("i", "front-insight-bar"));
          return row;
        }),
      );
    };
    const select = (team: Team) => {
      draft.team = team.id;
      title.textContent = team.fullName;
      details.replaceChildren(
        ...(
          [
            ["Team Principal", team.principal],
            ["Chassis", team.chassis],
            ["Base", team.base],
            ["Power Unit", team.powerUnit],
          ] as const
        ).map(([term, value]) => {
          const box = el("div");
          box.append(el("dt", "", term), el("dd", "", value));
          return box;
        }),
      );
      tiles.forEach((tile) => {
        tile.classList.toggle("active", tile.dataset["team"] === team.id);
      });
      paintBoard(team);
      void this.studio.select(team.id);
    };
    const shift = (delta: number) => {
      const index = teams.findIndex((team) => team.id === draft.team);
      const target = teams[(index + delta + teams.length) % teams.length];
      if (target) select(target);
    };
    const nextInsight = () => {
      insight = (insight + 1) % insights.length;
      paintBoard(teamOf(draft.team));
    };
    const insightHead = button("front-insight-head", "", nextInsight);
    insightHead.append(
      el("i", "btn-glyph", "I"),
      el("b", "", "Insights"),
      label,
    );
    const panel = el("aside", "front-insight-panel");
    panel.append(insightHead, board);
    const head = el("header", "front-heading");
    head.append(el("span", "front-tag", "Team select"), title, details);
    this.show(
      {
        ArrowLeft: () => {
          shift(-1);
        },
        ArrowRight: () => {
          shift(1);
        },
        i: nextInsight,
        I: nextInsight,
        Enter: next,
        Escape: back,
      },
      head,
      panel,
      tilesRow,
      this.footer(["↵", "Continue", next], ["Esc", "Back", back]),
    );
    select(teamOf(draft.team));
  }

  private confirmScreen(
    draft: DriverProfile,
    back: () => void,
    done: (driver: Driver) => void,
  ): void {
    this.studio.frame(framings.confirm);
    void this.studio.select(draft.team, false);
    const message = el("p", "front-error");
    const confirm = async () => {
      try {
        done(await api.saveProfile(draft));
      } catch (error) {
        message.textContent = errorText(error);
      }
    };
    const team = teamOf(draft.team);
    const card = el("section", "front-driver-card");
    card.style.setProperty("--brand", team.brand);
    const names = el("div", "front-driver-name");
    names.append(el("span", "", draft.firstName), el("b", "", draft.lastName));
    const meta = el("div", "front-driver-meta");
    meta.append(
      flagImage(draft.nationality),
      el("span", "", countryName(draft.nationality)),
    );
    const number = el("div", "front-driver-number", String(draft.number));
    const teamRow = el("div", "front-driver-team");
    teamRow.append(
      teamLogo(team.id, team.brand),
      el("span", "", team.fullName),
    );
    card.append(number, names, meta, teamRow, message);
    const start = () => void confirm();
    this.show(
      { Enter: start, Escape: back },
      heading("Driver profile", "Confirm settings"),
      card,
      this.footer(["↵", "Confirm", start], ["Esc", "Back", back]),
    );
  }

  async hub(driver: Driver): Promise<HubChoice> {
    this.studio.frame(framings.hub);
    void this.studio.select(driver.team ?? teams[0]?.id ?? "", false);
    return new Promise((resolve) => {
      this.hubScreen(driver, resolve);
    });
  }

  private hubScreen(driver: Driver, done: (choice: HubChoice) => void): void {
    const team = teamOf(driver.team ?? "");
    const reopen = (next: Driver) => {
      rememberDriver(next);
      void this.hub(next).then(done);
    };
    const items: { label: string; detail: string; run: () => void }[] = [
      {
        label: "Race",
        detail: "Set up a session at Circuit of the Americas",
        run: () => {
          done({ action: "race", driver });
        },
      },
      {
        label: "Lap Records",
        detail: "Personal bests, sectors and past sessions",
        run: () => {
          void new ProfileScreen(driver).run().then(() => {
            reopen(driver);
          });
          this.keys = {};
        },
      },
      {
        label: "Change Team",
        detail: `Racing for ${team.name}`,
        run: () => {
          const draft = draftOf(driver);
          this.teamScreen(
            draft,
            () => {
              reopen(driver);
            },
            () => {
              void api.saveProfile(draft).then(reopen);
            },
          );
        },
      },
      {
        label: "Edit Driver",
        detail: "Name, nationality and number",
        run: () => {
          void this.onboard(driver).then(reopen);
        },
      },
      {
        label: "Sign Out",
        detail: `Signed in as ${driver.username}`,
        run: () => {
          void api.logout().finally(() => {
            done({ action: "signout", driver });
          });
        },
      },
    ];
    let focus = 0;
    const nav = el("nav", "front-hub");
    const rows = items.map((item, index) => {
      const row = button("front-hub-item", "", item.run);
      row.append(el("b", "", item.label), el("span", "", item.detail));
      row.addEventListener("pointermove", (event) => {
        if (event.movementX === 0 && event.movementY === 0) return;
        focus = index;
        paint();
      });
      return row;
    });
    nav.append(...rows);
    const paint = () => {
      rows.forEach((row, index) => {
        row.classList.toggle("active", index === focus);
      });
    };
    const card = el("section", "front-hub-driver");
    card.style.setProperty("--brand", team.brand);
    const names = el("div", "front-driver-name");
    names.append(
      el("span", "", driver.firstName ?? ""),
      el("b", "", driver.lastName ?? driver.username),
    );
    const meta = el("div", "front-driver-meta");
    meta.append(
      flagImage(driver.nationality),
      el("span", "", `#${String(driver.number ?? "")}`),
      teamLogo(team.id, team.brand),
      el("span", "", team.name),
    );
    card.append(names, meta);
    this.show(
      {
        ArrowUp: () => {
          focus = (focus - 1 + items.length) % items.length;
          paint();
        },
        ArrowDown: () => {
          focus = (focus + 1) % items.length;
          paint();
        },
        Enter: () => {
          items[focus]?.run();
        },
      },
      card,
      nav,
      this.footer(["↵", "Select", () => items[focus]?.run()]),
    );
    paint();
  }
}
