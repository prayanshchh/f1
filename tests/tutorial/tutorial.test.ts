import { describe, expect, test } from "vitest";
import type { PitPhase } from "../../apps/client/src/game/pitstop.ts";
import {
  LineReader,
  type RacingLineData,
} from "../../apps/client/src/game/racing-line.ts";
import {
  type Command,
  type CourseTurn,
  type Pedals,
  Tutorial,
  type TutorialEvent,
  type TutorialView,
} from "../../apps/client/src/game/tutorial.ts";
import { readRepoFile } from "../support/repo.ts";

const line = JSON.parse(
  readRepoFile("content/tracks/hill-country/racing-line.json"),
) as RacingLineData;
const { turns } = JSON.parse(
  readRepoFile("content/tracks/hill-country/circuit-map.json"),
) as { turns: CourseTurn[] };
const length = 5477.9;
const pitEntry = 5346.4;
const lane = { from: pitEntry + 20, box: length + 105, to: length + 553 };
const gridStart = 297;
const countdown = 6;
const dt = 1 / 60;
const turnAt = (number: number) =>
  turns.find((turn) => turn.number === number)?.distance ?? 0;

const mfdPages = ["quick", "weather", "temps", "wear", "pressure"];
const nextPage = (page: string) =>
  mfdPages[(mfdPages.indexOf(page) + 1) % mfdPages.length] ?? "quick";

type Policy = (drive: Drive) => void;

class Drive {
  readonly tutorial = new Tutorial({ length, turns });
  private readonly reader = new LineReader(
    line.profile,
    line.length,
    line.length / length,
  );
  now = 0;
  travel = gridStart;
  speed = 0;
  raceTime = -countdown;
  input: Pedals = { steer: 0, throttle: 0, brake: 0 };
  cameras = 0;
  rewinds = 0;
  replays = true;
  mfd = "quick";
  boost = false;
  offTrack = false;
  pit: PitPhase = "track";
  limit = Infinity;
  retired = false;
  crashed = false;
  phone = false;
  gear = 1;
  menu = false;
  panel = false;
  sensitivity: number | null = null;
  centers: number | null = null;
  brakeIn: number | null = null;
  readonly events: TutorialEvent[] = [];
  readonly seen: string[] = [];
  private shownAt = 0;

  get id(): string {
    return this.tutorial.view.id;
  }

  get frames(): number {
    return Math.round((this.now - this.shownAt) / dt);
  }

  frame(): void {
    this.now += dt;
    const running =
      !this.tutorial.holding && !this.tutorial.frozen && !this.menu;
    if (running) this.raceTime += dt;
    if (running && this.raceTime >= 0) this.move();
    const lap = Math.floor(this.travel / length) + 1;
    const reading = this.reader.read(
      this.travel - (lap - 1) * length,
      this.speed,
    );
    this.brakeIn = reading.brakeIn;
    const fresh = this.tutorial.update({
      now: this.now,
      input: this.input,
      phone: this.phone,
      travel: this.travel,
      speed: this.speed,
      raceTime: this.raceTime,
      cue: reading.cue,
      brakeIn: reading.brakeIn,
      offTrack: this.offTrack,
      mfd: this.mfd,
      cameras: this.cameras,
      rewinds: this.rewinds,
      replays: this.replays,
      pit: this.pit,
      boost: this.boost,
      retired: this.retired,
      crashed: this.crashed,
      gear: this.gear,
      menu: this.menu,
      panel: this.panel,
      sensitivity: this.sensitivity,
      centers: this.centers,
    });
    this.events.push(...fresh);
    for (const event of fresh) {
      if (event.kind === "command") this.obey(event.command);
      if (event.kind === "slow") this.speed = Math.min(this.speed, event.speed);
    }
    this.note();
  }

  private move(): void {
    const { throttle, brake } = this.input;
    if (this.speed === 0 && brake > throttle) this.gear = -1;
    if (this.speed === 0 && throttle > brake) this.gear = 1;
    const back = this.gear < 0;
    const push = back ? brake : throttle;
    const stop = back ? throttle : brake;
    const accel = push * 9 - stop * 38 - 0.0004 * this.speed ** 2;
    this.speed = Math.max(0, Math.min(92, this.limit, this.speed + accel * dt));
    this.travel += (back ? -1 : 1) * this.speed * dt;
  }

  private obey(command: Command): void {
    if (command === "pause") this.menu = true;
    else this.panel = !this.panel;
  }

  private note(): void {
    const id = this.id;
    if (id === "" || this.seen.at(-1) === id) return;
    this.seen.push(id);
    this.shownAt = this.now;
  }

  drive(policy: Policy, seconds = 1500): void {
    for (let t = 0; t < seconds / dt && !this.tutorial.finished; t++) {
      policy(this);
      this.frame();
    }
  }

  until(id: string, policy: Policy, seconds = 600): void {
    for (let t = 0; t < seconds / dt && this.id !== id; t++) {
      policy(this);
      this.frame();
    }
  }
}

function racer(drive: Drive): void {
  const red = drive.brakeIn !== null && drive.brakeIn <= 4 + drive.speed * 0.12;
  drive.input = {
    steer: 0,
    throttle: red || drive.raceTime < 0 ? 0 : 1,
    brake: red ? 1 : 0,
  };
}

const hands: Record<string, (drive: Drive) => Pedals | undefined> = {
  "steer-left": () => ({ steer: 1, throttle: 0, brake: 0 }),
  "steer-right": () => ({ steer: -1, throttle: 0, brake: 0 }),
  "brake-pedal": () => ({ steer: 0, throttle: 0, brake: 1 }),
  "gas-pedal": () => ({ steer: 0, throttle: 1, brake: 0 }),
  "t1-brake": () => ({ steer: 0, throttle: 0, brake: 1 }),
  reversing: () => ({ steer: 0, throttle: 0, brake: 1 }),
};

const presses: Record<string, (drive: Drive) => void> = {
  controls: (d) => {
    d.tutorial.press("keyboard");
  },
  boost: (d) => {
    if (d.frames === 20) d.boost = true;
  },
  camera: (d) => {
    if (d.frames % 20 === 0) d.cameras++;
  },
  screens: (d) => {
    if (d.frames % 20 === 0) d.mfd = nextPage(d.mfd);
  },
  phone: (d) => {
    if (d.frames === 20) d.panel = true;
  },
  "pad-center": (d) => {
    if (d.frames === 20 && d.centers !== null) d.centers += 1;
  },
  "pad-sensitivity": (d) => {
    if (d.frames === 20 && d.sensitivity !== null) d.sensitivity += 0.15;
  },
  "phone-code": (d) => {
    if (d.frames === 20) d.panel = false;
  },
};

function pitLane(): Policy {
  let serviceUntil = Infinity;
  let left = false;
  const phase = (d: Drive): PitPhase => {
    left ||= d.travel >= lane.to;
    if (left || d.travel <= lane.from) return "track";
    if (d.travel < lane.box) return "lane";
    if (serviceUntil === Infinity) serviceUntil = d.now + 5;
    return d.now < serviceUntil ? "service" : "lane";
  };
  return (d) => {
    d.pit = phase(d);
    d.limit = d.pit === "track" ? Infinity : d.pit === "service" ? 0 : 22;
  };
}

function cooperative(pits = false): Policy {
  const pitStop = pitLane();
  return (drive) => {
    presses[drive.id]?.(drive);
    const held = hands[drive.id]?.(drive);
    if (held) drive.input = held;
    else racer(drive);
    if (pits) pitStop(drive);
  };
}

const lessons = [
  "welcome",
  "controls",
  "steer-left",
  "steer-right",
  "brake-pedal",
  "gas-pedal",
  "lights-wait",
  "go",
  "line",
  "line-wait",
  "t1-brake",
  "t1-keep",
  "follow",
  "boost",
  "boosting",
  "camera",
  "screens",
  "drive",
  "reverse",
  "reversing",
  "phone",
  "phone-code",
  "pause",
  "menu-pages",
  "menu-options",
  "menu-replay",
  "menu-restart",
  "menu-quit",
  "menu-resume",
  "finish",
];

function pitClashes(shown: TutorialView): string[] {
  const clashes: string[] = [];
  if (shown.id !== "pit") clashes.push(shown.id);
  if (shown.card !== null) clashes.push(shown.card.title);
  if (shown.coach !== null) clashes.push("coach");
  if (shown.alert !== null) clashes.push(shown.alert.title);
  return clashes;
}

function pastTurnOne(): Drive {
  const drive = new Drive();
  drive.until("follow", cooperative());
  return drive;
}

function brakeOnly(drive: Drive): void {
  drive.input = { steer: 0, throttle: 0, brake: 1 };
}

function tourSpots(drive: Drive): (string | null | undefined)[] {
  const spots: (string | null | undefined)[] = [];
  while (drive.id !== "finish" && spots.length < 10) {
    const id = drive.id;
    spots.push(drive.tutorial.view.card?.spot);
    for (let t = 0; t < 10 / dt && drive.id === id; t++) drive.frame();
  }
  return spots;
}

interface Shown {
  from: number;
  to: number;
}

function note(shown: Map<string, Shown>, drive: Drive): void {
  const entry = shown.get(drive.id);
  if (entry) entry.to = drive.now;
  else shown.set(drive.id, { from: drive.now, to: drive.now });
}

function expectTimed(
  shown: Map<string, Shown>,
  id: string,
  seconds: number,
): void {
  expect(stayed(shown.get(id)), id).toBeCloseTo(seconds, 1);
}

function stayed(entry: Shown | undefined): number {
  return (entry?.to ?? 0) - (entry?.from ?? 0);
}

const explainers: Record<string, number> = {
  welcome: 3,
  line: 5,
  reverse: 4,
  pause: 2,
  finish: 2,
};
const tourCards = [
  "menu-resume",
  "menu-pages",
  "menu-options",
  "menu-replay",
  "menu-restart",
  "menu-quit",
];

function lightsOut(): Drive {
  const drive = new Drive();
  drive.until("go", cooperative());
  return drive;
}

describe("driving school", () => {
  test("a player who follows every instruction gets every lesson in order and finishes", () => {
    const drive = new Drive();
    drive.drive(cooperative());

    expect(drive.tutorial.finished).toBe("done");
    expect(drive.seen).toEqual(lessons);
  });

  test("every card that only explains moves on by itself after its time, menu cards after a second and a half, with no key or pedal pressed for it", () => {
    const drive = new Drive();
    const shown = new Map<string, Shown>();
    const policy = cooperative();
    drive.drive((d) => {
      note(shown, d);
      if (d.id in explainers || tourCards.includes(d.id))
        d.input = { steer: 0, throttle: 0, brake: 0 };
      else policy(d);
    });

    expect(drive.tutorial.finished).toBe("done");
    for (const [id, seconds] of Object.entries(explainers))
      expectTimed(shown, id, seconds);
    for (const id of tourCards) expectTimed(shown, id, 1.5);
  });

  test("the clock is held for every grid card, there is no lights card, and the countdown starts once the last control is checked", () => {
    const drive = new Drive();
    const holding = new Map<string, boolean>();
    drive.drive((d) => {
      cooperative()(d);
      if (d.id !== "") holding.set(d.id, d.tutorial.holding);
    }, countdown + 30);
    expect([...holding].slice(0, 8)).toEqual([
      ["welcome", true],
      ["controls", true],
      ["steer-left", true],
      ["steer-right", true],
      ["brake-pedal", true],
      ["gas-pedal", true],
      ["lights-wait", false],
      ["go", false],
    ]);
  });

  test("each grid check only passes with the input it asks for", () => {
    const drive = new Drive();
    drive.drive((d) => {
      presses[d.id]?.(d);
    }, 4);
    expect(drive.id).toBe("steer-left");
    drive.drive((d) => {
      d.input = { steer: -1, throttle: 1, brake: 1 };
    }, 3);
    expect(drive.id).toBe("steer-left");
    drive.drive((d) => {
      d.input = { steer: 1, throttle: 0, brake: 0 };
    }, 0.1);
    expect(drive.id).toBe("steer-left");
    drive.drive((d) => {
      d.input = { steer: 1, throttle: 0, brake: 0 };
    }, 0.4);
    expect(drive.id).toBe("steer-right");
    drive.drive((d) => {
      d.input = { steer: 0, throttle: 0, brake: 0 };
    }, 0.5);
    drive.drive((d) => {
      d.input = { steer: -1, throttle: 0, brake: 0 };
    }, 0.5);
    expect(drive.id).toBe("brake-pedal");
    drive.drive((d) => {
      d.input = { steer: 0, throttle: 1, brake: 0 };
    }, 2);
    expect(drive.id).toBe("brake-pedal");
    drive.drive((d) => {
      d.input = { steer: 0, throttle: 0, brake: 1 };
    }, 0.5);
    expect(drive.id).toBe("gas-pedal");
    expect(drive.tutorial.view.checks.map((check) => check.done)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  test("time stops at the Turn 1 braking point and only restarts once the gas is released and the brake is pressed", () => {
    const drive = lightsOut();
    drive.drive((d) => {
      if (d.id !== "t1-brake") racer(d);
    }, 20);
    expect(drive.id).toBe("t1-brake");
    expect(drive.tutorial.frozen).toBe(true);
    const stoppedAt = drive.travel;
    expect(stoppedAt).toBeGreaterThan(turnAt(1) - 220);
    expect(stoppedAt).toBeLessThan(turnAt(1) - 40);

    drive.drive((d) => {
      d.input = { steer: 0, throttle: 1, brake: 1 };
    }, 4);
    expect(drive.tutorial.frozen).toBe(true);
    expect(drive.travel).toBe(stoppedAt);
    expect(drive.tutorial.view.card?.body).toBe("Let go of ↑");

    drive.drive((d) => {
      d.input = { steer: 0, throttle: 0, brake: 1 };
    }, 0.1);
    expect(drive.tutorial.frozen).toBe(false);
    expect(drive.id).toBe("t1-keep");
  });

  test("the screens lesson stops time with the screen spotlit and goes on by itself, with no Enter, once Y has shown every screen", () => {
    const drive = pastTurnOne();
    drive.until("screens", cooperative());
    const { raceTime, travel } = drive;
    drive.drive(() => undefined, 10);
    expect(drive.id).toBe("screens");
    expect(drive.tutorial.view.mode).toBe("pause");
    expect(drive.tutorial.view.card?.spot).toBe("mfd");
    expect(drive.raceTime).toBe(raceTime);
    expect(drive.travel).toBe(travel);
    expect(drive.tutorial.view.card?.body).toMatch(/keep pressing Y/i);

    for (let press = 1; press < mfdPages.length - 1; press++) {
      drive.mfd = nextPage(drive.mfd);
      drive.drive(() => undefined, 3);
      expect(drive.id).toBe("screens");
      expect(drive.tutorial.view.card?.body).toMatch(/keep pressing Y/i);
      expect(drive.tutorial.view.card?.body).toContain(
        `${String(press + 1)} of ${String(mfdPages.length)}`,
      );
    }
    drive.mfd = "quick";
    drive.frame();
    expect(drive.id).toBe("screens");

    const before = drive.events.length;
    drive.mfd = "pressure";
    drive.frame();
    expect(drive.events.slice(before)).toEqual([
      { kind: "tick" },
      { kind: "slow", speed: 25 / 3.6 },
    ]);
    expect(drive.id).toBe("drive");
    drive.drive(racer, 1);
    expect(drive.id).toBe("drive");
    expect(drive.raceTime).toBeGreaterThan(raceTime);
  });

  test("with a phone connected, the screens lesson still tells the player to keep pressing Y and names the phone's Display button", () => {
    const drive = new Drive();
    drive.phone = true;
    drive.until("screens", cooperative());
    drive.drive(() => undefined, 1);
    expect(drive.id).toBe("screens");
    expect(drive.tutorial.view.control).toBe("phone");
    expect(drive.tutorial.view.card?.body).toMatch(/keep pressing Y/i);
    expect(drive.tutorial.view.card?.body).toMatch(/Display on your phone/);

    drive.mfd = "wear";
    drive.frame();
    expect(drive.tutorial.view.card?.body).toMatch(/keep pressing Y/i);
    expect(drive.tutorial.view.card?.body).toMatch(/Display on your phone/);
  });

  test("the camera lesson stops time without dimming the picture and goes on by itself, with no Enter, once C has shown all six views", () => {
    const drive = pastTurnOne();
    drive.until("camera", cooperative());
    const { raceTime, travel } = drive;
    drive.drive(() => undefined, 10);
    expect(drive.id).toBe("camera");
    expect(drive.tutorial.view.mode).toBe("pause");
    expect(drive.tutorial.view.card?.high).toBe(true);
    expect(drive.tutorial.view.card?.spot).toBeNull();
    expect(drive.tutorial.view.card?.body).toMatch(/keep pressing C/i);
    expect(drive.raceTime).toBe(raceTime);
    expect(drive.travel).toBe(travel);

    for (let press = 1; press < 5; press++) {
      drive.cameras += 1;
      drive.drive(() => undefined, 3);
      expect(drive.id).toBe("camera");
      expect(drive.tutorial.view.card?.high).toBe(true);
      expect(drive.tutorial.view.card?.body).toMatch(/keep pressing C/i);
      expect(drive.tutorial.view.card?.body).toContain(
        `${String(press + 1)} of 6`,
      );
    }
    expect(drive.raceTime).toBe(raceTime);
    const before = drive.events.length;
    drive.cameras += 1;
    drive.frame();
    expect(drive.events.slice(before)).toEqual([
      { kind: "tick" },
      { kind: "slow", speed: 25 / 3.6 },
    ]);
    expect(drive.id).toBe("screens");
  });

  test("with no key row on the cards, the welcome and phone-or-keyboard cards say which keys to press in their text", () => {
    const drive = new Drive();
    drive.frame();
    expect(drive.id).toBe("welcome");
    expect(drive.tutorial.view.card?.body).toMatch(/Press Esc to skip/);
    drive.drive(() => undefined, 3.5);
    expect(drive.id).toBe("controls");
    expect(drive.tutorial.view.card?.body).toMatch(/Press P .* K /);
  });

  test("Esc on the welcome or the phone-or-keyboard card skips the whole tutorial, but not once it has started", () => {
    const skipped = new Drive();
    skipped.drive(() => undefined, 0.5);
    expect(skipped.tutorial.press("skip")).toBe(true);
    expect(skipped.tutorial.finished).toBe("skipped");

    const choosing = new Drive();
    choosing.drive(() => undefined, 3.5);
    expect(choosing.id).toBe("controls");
    expect(choosing.tutorial.press("skip")).toBe(true);
    expect(choosing.tutorial.finished).toBe("skipped");

    const started = lightsOut();
    expect(started.tutorial.press("skip")).toBe(false);
    expect(started.tutorial.finished).toBeNull();
  });

  test("Esc is swallowed on every card that stops the game, so it cannot open the menu, and the lesson carries on", () => {
    const drive = pastTurnOne();
    drive.until("boost", racer);
    expect(drive.tutorial.frozen).toBe(true);
    expect(drive.tutorial.press("skip")).toBe(true);
    expect(drive.tutorial.finished).toBeNull();
    drive.frame();
    expect(drive.id).toBe("boost");
    drive.boost = true;
    drive.frame();
    expect(drive.id).toBe("boosting");
  });

  test("leaving the track raises an alert after half a second that clears once back on, and a rewind clears it at once", () => {
    const drive = pastTurnOne();
    drive.drive(racer, 3);
    drive.drive((d) => {
      racer(d);
      d.offTrack = true;
    }, 0.3);
    expect(drive.tutorial.view.alert).toBeNull();
    drive.drive((d) => {
      racer(d);
      d.offTrack = true;
    }, 0.4);
    expect(drive.tutorial.view.alert?.title).toBe("Off track");
    expect(drive.events).toContainEqual({ kind: "alert" });
    drive.offTrack = false;
    drive.drive(racer, 0.5);
    expect(drive.tutorial.view.alert?.title).toBe("Off track");
    drive.drive(racer, 0.7);
    expect(drive.tutorial.view.alert).toBeNull();

    drive.drive((d) => {
      racer(d);
      d.offTrack = true;
    }, 1);
    expect(drive.tutorial.view.alert).not.toBeNull();
    drive.rewinds++;
    drive.offTrack = false;
    drive.frame();
    expect(drive.tutorial.view.alert).toBeNull();
    expect(drive.events).toContainEqual({ kind: "rewind" });
  });

  test("a player who drives into the pit lane anyway sees nothing from the tutorial over the pit screens, and is never told to get going in the box", () => {
    const drive = new Drive();
    const clashes: string[] = [];
    let pitFrames = 0;
    const policy = cooperative(true);
    drive.drive((d) => {
      if (d.pit !== "track") {
        pitFrames++;
        clashes.push(...pitClashes(d.tutorial.view));
      }
      policy(d);
    });

    expect(pitFrames).toBeGreaterThan(300);
    expect(clashes).toEqual([]);
    expect(drive.tutorial.finished).toBe("done");
  });

  test("the boost lesson on the back straight waits for Boost and lets the lap go on the moment it is switched on, with no Enter", () => {
    const drive = pastTurnOne();
    drive.until("boost", (d) => {
      racer(d);
    });
    expect(drive.travel).toBeGreaterThan(turnAt(11));
    expect(drive.travel).toBeLessThan(turnAt(12) - 900);
    expect(drive.tutorial.view.card?.spot).toBe("battery");
    expect(drive.tutorial.view.card?.body).toMatch(/Press B/);
    drive.drive(() => undefined, 10);
    expect(drive.id).toBe("boost");
    expect(drive.tutorial.frozen).toBe(true);

    const before = drive.events.length;
    drive.boost = true;
    drive.frame();
    expect(drive.events.slice(before)).toEqual([
      { kind: "tick" },
      { kind: "slow", speed: 25 / 3.6 },
    ]);
    expect(drive.id).toBe("boosting");
    expect(drive.tutorial.frozen).toBe(false);
  });

  test("with a phone connected, the boost lesson shows the phone with its Boost button to tap; on the keyboard it shows no phone", () => {
    const phone = pastTurnOne();
    phone.phone = true;
    phone.until("boost", racer);
    expect(phone.tutorial.view.card?.widget).toBe("pad-boost");
    expect(phone.tutorial.view.card?.body).toMatch(/Tap Boost on your phone/);
    phone.drive(() => undefined, 10);
    expect(phone.id).toBe("boost");
    phone.boost = true;
    phone.frame();
    expect(phone.id).toBe("boosting");

    const keyboard = pastTurnOne();
    keyboard.until("boost", racer);
    expect(keyboard.tutorial.view.card?.widget).toBeNull();
    expect(keyboard.tutorial.view.card?.body).toMatch(/Press B/);
  });

  test("a crash is called out at once with R to undo it, even when the car is off the track too", () => {
    const drive = pastTurnOne();
    drive.crashed = true;
    drive.offTrack = true;
    drive.drive(racer, 1);
    expect(drive.tutorial.view.alert?.title).toBe("Crash!");
    expect(drive.tutorial.view.alert?.body).toContain("No damage");
    expect(drive.tutorial.view.alert?.body).toMatch(/Press R/);
    drive.crashed = false;
    drive.offTrack = false;
    drive.drive(racer, 2);
    expect(drive.tutorial.view.alert).toBeNull();
  });

  test("a crash that retires the car asks for a rewind instead of telling it to get going", () => {
    const drive = pastTurnOne();
    drive.retired = true;
    drive.limit = 0;
    drive.drive(racer, 5);
    expect(drive.tutorial.view.alert?.title).toBe("Car's too damaged");
    drive.rewinds++;
    drive.retired = false;
    drive.limit = Infinity;
    drive.drive(racer, 1);
    expect(drive.tutorial.view.alert).toBeNull();
  });

  test("a car stopped for three seconds after the start is told to get going", () => {
    const drive = pastTurnOne();
    drive.drive(racer, 2);
    drive.drive((d) => {
      d.input = { steer: 0, throttle: 0, brake: d.speed > 0 ? 1 : 0 };
    }, 6);
    expect(drive.speed).toBe(0);
    expect(drive.tutorial.view.alert?.title).toBe("Get going");
  });

  test("after the lap, time stops to explain reverse, then lets go by itself, and the lesson lets the car reverse for five seconds", () => {
    const drive = new Drive();
    drive.until("reverse", cooperative());
    expect(drive.travel).toBeGreaterThan(length + 20);
    expect(drive.speed).toBeGreaterThan(40);
    expect(drive.tutorial.frozen).toBe(true);
    const { travel } = drive;
    drive.drive(() => undefined, 3.9);
    expect(drive.id).toBe("reverse");
    expect(drive.travel).toBe(travel);
    drive.drive(() => undefined, 0.2);
    expect(drive.id).toBe("reversing");
    expect(drive.tutorial.view.card?.title).toBe("Brake to a stop");

    drive.drive((d) => {
      d.input = { steer: 0, throttle: 0, brake: d.speed > 0 ? 1 : 0 };
    }, 8);
    expect(drive.speed).toBe(0);
    expect(drive.id).toBe("reversing");
    expect(drive.tutorial.view.alert).toBeNull();

    drive.drive(brakeOnly, 0.2);
    expect(drive.gear).toBe(-1);
    expect(drive.tutorial.view.card?.title).toBe("Keep holding ↓");
    const reversingFrom = drive.now - 0.2;
    drive.drive(brakeOnly, 4.5);
    expect(drive.id).toBe("reversing");
    drive.until("phone", brakeOnly, 2);
    expect(drive.id).toBe("phone");
    expect(drive.now - reversingFrom).toBeGreaterThan(4.9);
    expect(drive.now - reversingFrom).toBeLessThan(5.3);
    expect(drive.events.at(-1)).toEqual({ kind: "tick" });
  });

  test("time in the pause menu while backing up does not count towards the five seconds of reversing", () => {
    const drive = new Drive();
    drive.until("reversing", cooperative());
    drive.drive((d) => {
      d.input = { steer: 0, throttle: 0, brake: d.speed > 0 ? 1 : 0 };
    }, 8);
    drive.drive(brakeOnly, 1);
    expect(drive.gear).toBe(-1);
    drive.menu = true;
    drive.drive(brakeOnly, 10);
    drive.menu = false;
    drive.frame();
    expect(drive.id).toBe("reversing");
    drive.drive(brakeOnly, 3.5);
    expect(drive.id).toBe("reversing");
    drive.until("phone", brakeOnly, 1);
    expect(drive.id).toBe("phone");
  });

  test("the phone lesson spotlights the P key, then shows nothing over the code, and goes on once the code is closed", () => {
    const drive = new Drive();
    drive.until("phone", cooperative());
    expect(drive.tutorial.frozen).toBe(true);
    expect(drive.tutorial.view.card?.spot).toBe("phone-key");
    expect(drive.tutorial.view.card?.body).toMatch(/Press P/);
    drive.drive(() => undefined, 20);
    expect(drive.id).toBe("phone");

    drive.panel = true;
    drive.frame();
    expect(drive.id).toBe("phone-code");
    expect(drive.tutorial.view.card).toBeNull();
    drive.drive(() => undefined, 2);
    expect(drive.id).toBe("phone-code");
    drive.panel = false;
    drive.frame();
    expect(drive.id).toBe("pause");
  });

  test("with a phone connected, the grid teaches Center and then sensitivity right after the steering checks, each waiting for its button on the phone", () => {
    const drive = new Drive();
    drive.phone = true;
    drive.sensitivity = 1.3;
    drive.centers = 0;
    drive.until("pad-center", cooperative());
    expect(drive.seen.slice(-2)).toEqual(["gas-pedal", "pad-center"]);
    expect(drive.tutorial.holding).toBe(true);
    expect(drive.tutorial.view.card?.widget).toBe("pad-center");
    expect(drive.tutorial.view.card?.body).toMatch(/tap Center/);
    drive.drive(() => undefined, 30);
    expect(drive.id).toBe("pad-center");
    drive.centers = 1;
    drive.frame();
    expect(drive.id).toBe("pad-sensitivity");

    expect(drive.tutorial.holding).toBe(true);
    expect(drive.tutorial.view.card?.widget).toBe("pad-sensitivity");
    expect(drive.tutorial.view.card?.body).toMatch(/−.*\+/);
    expect(drive.tutorial.view.sensitivity).toBe(1.3);
    drive.drive(() => undefined, 30);
    expect(drive.id).toBe("pad-sensitivity");
    const before = drive.events.length;
    drive.sensitivity = 1.15;
    drive.frame();
    expect(drive.events.slice(before)).toEqual([{ kind: "tick" }]);
    expect(drive.id).toBe("lights-wait");
  });

  test("a phone that does not report Center or sensitivity still gets both cards, each moving on by itself; the keyboard gets neither", () => {
    const old = new Drive();
    old.phone = true;
    old.until("pad-center", cooperative());
    old.drive(() => undefined, 4.9);
    expect(old.id).toBe("pad-center");
    old.drive(() => undefined, 0.2);
    expect(old.id).toBe("pad-sensitivity");
    old.drive(() => undefined, 4.7);
    expect(old.id).toBe("pad-sensitivity");
    old.drive(() => undefined, 0.5);
    expect(old.id).toBe("lights-wait");

    const keyboard = new Drive();
    keyboard.until("lights-wait", cooperative());
    expect(keyboard.seen).not.toContain("pad-center");
    expect(keyboard.seen).not.toContain("pad-sensitivity");
  });

  test("when a paused card lets go the car is slowed to 25 km/h, but the braking freeze at Turn 1 keeps its speed", () => {
    const drive = pastTurnOne();
    const slows = (from: number) =>
      drive.events.slice(from).filter((event) => event.kind === "slow");
    expect(slows(0)).toEqual([{ kind: "slow", speed: 25 / 3.6 }]);

    drive.until("boost", racer);
    drive.speed = 60;
    const before = drive.events.length;
    drive.boost = true;
    drive.frame();
    expect(slows(before)).toEqual([{ kind: "slow", speed: 25 / 3.6 }]);
    expect(drive.speed).toBeLessThanOrEqual(25 / 3.6);
  });

  test("coming back from the pause menu while driving slows the car to 25 km/h", () => {
    const drive = pastTurnOne();
    drive.drive(racer, 2);
    expect(drive.speed).toBeGreaterThan(20);
    drive.menu = true;
    drive.drive(() => undefined, 1);
    const before = drive.events.length;
    drive.menu = false;
    drive.frame();
    expect(drive.events.slice(before)).toContainEqual({
      kind: "slow",
      speed: 25 / 3.6,
    });
    expect(drive.speed).toBeLessThanOrEqual(25 / 3.6);
  });

  test("pressing R to undo leaves the car at 15 km/h", () => {
    const drive = pastTurnOne();
    drive.drive(racer, 2);
    expect(drive.speed).toBeGreaterThan(20);
    const before = drive.events.length;
    drive.rewinds++;
    drive.frame();
    expect(drive.events.slice(before)).toEqual(
      expect.arrayContaining([
        { kind: "rewind" },
        { kind: "slow", speed: 15 / 3.6 },
      ]),
    );
    expect(drive.speed).toBeLessThanOrEqual(15 / 3.6);
  });

  test("the pause menu lesson opens the menu by itself, spotlights each part for a second and a half, ignores Esc throughout, and ends with the menu still open", () => {
    const drive = new Drive();
    drive.until("pause", cooperative());
    expect(drive.tutorial.view.card?.body).toMatch(/Press Esc/);
    expect(drive.tutorial.press("skip")).toBe(true);
    drive.drive(() => undefined, 1.9);
    expect(drive.id).toBe("pause");
    expect(drive.menu).toBe(false);
    expect(drive.tutorial.touring).toBe(false);

    drive.drive(() => undefined, 0.2);
    expect(drive.menu).toBe(true);
    expect(drive.tutorial.touring).toBe(true);
    expect(drive.tutorial.press("skip")).toBe(true);
    expect(drive.tutorial.finished).toBeNull();
    expect(tourSpots(drive)).toEqual([
      "menu-tabs",
      "menu-main",
      "menu-replay",
      "menu-restart",
      "menu-quit",
      "menu-resume",
    ]);

    expect(drive.id).toBe("finish");
    expect(drive.tutorial.view.card?.title).toBe("You're ready to race!");
    expect(drive.tutorial.touring).toBe(true);
    expect(drive.tutorial.press("skip")).toBe(true);
    expect(drive.tutorial.finished).toBeNull();
    drive.drive(() => undefined, 2.1);
    expect(drive.tutorial.finished).toBe("done");
    expect(drive.menu).toBe(true);
  });

  test("in Low graphics, where there are no replays, the tour leaves out Replay & Flashback", () => {
    const drive = new Drive();
    drive.replays = false;
    drive.until("pause", cooperative());
    drive.drive(() => undefined, 2.1);
    expect(drive.tutorial.touring).toBe(true);
    expect(tourSpots(drive)).toEqual([
      "menu-tabs",
      "menu-main",
      "menu-restart",
      "menu-quit",
      "menu-resume",
    ]);
    expect(drive.id).toBe("finish");
  });

  test("closing the menu in the middle of the tour skips the rest of it", () => {
    const drive = new Drive();
    drive.until("menu-options", cooperative());
    expect(drive.menu).toBe(true);
    drive.menu = false;
    drive.frame();
    expect(drive.id).toBe("finish");
  });

  test("with only a phone, the code, the pause menu, the tour and the finish all happen by themselves, and the only button needed is + or − for sensitivity", () => {
    const drive = new Drive();
    drive.phone = true;
    drive.sensitivity = 1;
    drive.until("phone", cooperative());
    const seen = drive.events.length;
    drive.drive((d) => {
      d.input = { steer: 0, throttle: 0, brake: 0 };
    }, 60);

    const commands = drive.events
      .slice(seen)
      .flatMap((event) => (event.kind === "command" ? [event.command] : []));
    expect(commands).toEqual(["panel", "panel", "pause"]);
    expect(drive.menu).toBe(true);
    expect(drive.tutorial.finished).toBe("done");
    expect(drive.seen.slice(drive.seen.indexOf("phone"))).toEqual(
      lessons.slice(lessons.indexOf("phone")),
    );
  });
});
