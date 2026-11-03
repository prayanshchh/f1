import { el, prompt } from "./dom.ts";

const repository = "https://github.com/prayanshchh/revracers";

interface Credit {
  name: string;
  role: string;
  licence: string;
  url: string;
}

const credits: Credit[] = [
  {
    name: "FreeSOLID",
    role: "Collision detection inside Speed Dreams, by Gino van den Bergen",
    licence: "GNU LGPL 2 or later",
    url: "https://sourceforge.net/projects/freesolid/",
  },
  {
    name: "OpenSceneGraph",
    role: "Scene maths used by the Speed Dreams graphics code",
    licence: "OpenSceneGraph Public License 1.0",
    url: "https://openscenegraph.github.io/openscenegraph.io/",
  },
  {
    name: "2022 Monoposto 1 by Peter Collings",
    role: "Car physics data for Speed Dreams",
    licence: "Free Art License 1.3",
    url: "https://forge.a-lec.org/speed-dreams/22mp1-sector-mcl36",
  },
  {
    name: "OpenStreetMap contributors",
    role: "Track layout, barriers, pit lane and venue",
    licence: "ODbL 1.0",
    url: "https://www.openstreetmap.org/copyright",
  },
  {
    name: "U.S. Geological Survey",
    role: "Terrain height and aerial imagery",
    licence: "Public domain",
    url: "https://www.usgs.gov/",
  },
  {
    name: "Poly Haven",
    role: "Surface textures and skies",
    licence: "CC0 1.0",
    url: "https://polyhaven.com/",
  },
  {
    name: "Quaternius",
    role: "Pit crew characters and animations",
    licence: "CC0 1.0",
    url: "https://quaternius.com/",
  },
  {
    name: "331music, Kulakovka and BreakzStudios",
    role: "Intro, build-up and victory music",
    licence: "Pixabay Content License",
    url: "https://pixabay.com/service/license-summary/",
  },
  {
    name: "cynicmusic",
    role: "Menu music, Hyperflight Racing",
    licence: "CC0 1.0",
    url: "https://opengameart.org/content/hyperflight-racing",
  },
  {
    name: "three.js",
    role: "WebGPU rendering",
    licence: "MIT",
    url: "https://threejs.org/",
  },
  {
    name: "Saira typeface",
    role: "Interface and livery lettering",
    licence: "SIL Open Font License 1.1",
    url: "https://fonts.google.com/specimen/Saira",
  },
  {
    name: "flag-icons, uqr, Hono, PGlite, node-postgres, Emscripten",
    role: "Flags, QR codes, accounts, lap records and the WebAssembly build",
    licence: "MIT, Apache 2.0 and NCSA",
    url: `${repository}/blob/main/CREDITS.md`,
  },
];

function link(url: string, text: string): HTMLAnchorElement {
  const anchor = el("a", "", text);
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  return anchor;
}

function speedDreams(): HTMLElement {
  const card = el("section", "credits-hero");
  card.dataset["credits"] = "speed-dreams";
  const words = el("p");
  words.append(
    "Every car in RevRacers is driven by the ",
    link("https://www.speed-dreams.net/", "Speed Dreams"),
    " simulation, compiled unmodified to WebAssembly: tyres, suspension, aerodynamics, engine, collisions and the race engine. Speed Dreams is free, open-source software built by volunteers over more than twenty years, growing out of TORCS. Thank you to everyone who made it.",
  );
  const terms = el(
    "small",
    "",
    "Speed Dreams is licensed under the GNU GPL version 2 or later. RevRacers is an independent project and is not endorsed by the Speed Dreams team.",
  );
  card.append(
    el("span", "credits-tag", "Physics by"),
    el("h2", "", "Speed Dreams"),
    words,
    terms,
  );
  return card;
}

function licence(): HTMLElement {
  const box = el("section", "credits-licence");
  box.dataset["credits"] = "licence";
  const free = el("p");
  free.append(
    "RevRacers © 2026 Prayansh Chhablani and contributors. This program is free software: you can redistribute it and/or modify it under the terms of the ",
    link(
      "https://www.gnu.org/licenses/gpl-3.0.html",
      "GNU General Public License",
    ),
    " as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.",
  );
  const source = el("p");
  source.append(
    "Source code: ",
    link(repository, repository.replace("https://", "")),
  );
  box.append(
    free,
    el(
      "p",
      "",
      "This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.",
    ),
    source,
    el(
      "p",
      "",
      "All teams, drivers, sponsors and venues are fictional. RevRacers is not affiliated with any racing series, team, circuit or car maker.",
    ),
  );
  return box;
}

function creditRow(credit: Credit): HTMLElement {
  const row = el("li", "credits-row");
  const name = el("b");
  name.append(link(credit.url, credit.name));
  row.append(name, el("span", "", credit.role), el("em", "", credit.licence));
  return row;
}

export class CreditsScreen {
  private readonly root: HTMLElement;
  private close: () => void = () => undefined;
  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    this.close();
  };

  constructor() {
    const found = document.querySelector<HTMLElement>("[data-records=root]");
    if (!found)
      throw new Error("drive page markup is missing the records page");
    this.root = found;
  }

  run(): Promise<void> {
    const stage = el("div", "stage");
    const head = el("header", "front-heading");
    head.append(
      el("span", "front-tag", "Credits"),
      el("h1", "", "Built on open source"),
    );
    const body = el("div", "records-body credits-body");
    const list = el("ul", "credits-list");
    list.append(...credits.map(creditRow));
    body.append(speedDreams(), list, licence());
    const foot = el("footer", "front-foot");
    const back = prompt("Esc", "Back");
    back.addEventListener("click", () => {
      this.close();
    });
    foot.append(back);
    stage.append(head, body, foot);
    this.root.replaceChildren(stage);
    this.root.hidden = false;
    window.addEventListener("keydown", this.onKey);
    return new Promise((resolve) => {
      this.close = () => {
        this.root.hidden = true;
        window.removeEventListener("keydown", this.onKey);
        resolve();
      };
    });
  }
}
