import { describe, expect, test } from "vitest";
import type { PitPhase } from "../../apps/client/src/game/pitstop.ts";
import {
  LineReader,
  type RacingLineData,
} from "../../apps/client/src/game/racing-line.ts";
import {
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
  mfd = "quick";
  boost = false;
  offTrack = false;
  pit: PitPhase = "track";
  limit = Infinity;
  retired = false;
  crashed = false;
  brakeIn: number | null = null;
  readonly events: TutorialEvent[] = [];
  readonly seen: string[] = [];
  private shownAt = 0;
  private pressed = "";

  get id(): string {
    return this.tutorial.view.id;
  }

  get frames(): number {
    return Math.round((this.now - this.shownAt) / dt);
  }

  confirmOnce(): void {
    if (this.pressed === this.id || this.frames < 48) return;
    this.pressed = this.id;
    this.tutorial.press("confirm");
  }

  frame(): void {
    this.now += dt;
    const running = !this.tutorial.holding && !this.tutorial.frozen;
    if (running) this.raceTime += dt;
    if (running && this.raceTime >= 0) this.move();
    const lap = Math.floor(this.travel / length) + 1;
    const reading = this.reader.read(
      this.travel - (lap - 1) * length,
      this.speed,
    );
    this.brakeIn = reading.brakeIn;
    this.events.push(
      ...this.tutorial.update({
        now: this.now,
        input: this.input,
        phone: false,
        travel: this.travel,
        speed: this.speed,
        raceTime: this.raceTime,
        cue: reading.cue,
        brakeIn: reading.brakeIn,
        offTrack: this.offTrack,
        mfd: this.mfd,
        cameras: this.cameras,
        rewinds: this.rewinds,
        pit: this.pit,
        boost: this.boost,
        retired: this.retired,
        crashed: this.crashed,
      }),
    );
    this.note();
  }

  private move(): void {
    const { throttle, brake } = this.input;
    const accel = throttle * 9 - brake * 38 - 0.0004 * this.speed ** 2;
    this.speed = Math.max(0, Math.min(92, this.limit, this.speed + accel * dt));
    this.travel += this.speed * dt;
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
  if (drive.tutorial.view.mode === "pause") drive.confirmOnce();
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
};

const presses: Record<string, (drive: Drive) => void> = {
  welcome: (d) => {
    d.confirmOnce();
  },
  controls: (d) => {
    d.tutorial.press("keyboard");
  },
  lights: (d) => {
    d.confirmOnce();
  },
  boost: (d) => {
    if (d.frames === 20) d.boost = true;
  },
  camera: (d) => {
    if (d.frames === 20) d.cameras++;
  },
  screens: (d) => {
    if (d.frames === 20) d.mfd = "temps";
  },
};

function pitLane(): Policy {
  let serviceUntil = Infinity;
  return (d) => {
    const inLane = d.travel > lane.from && d.travel < lane.to;
    const boxed = inLane && d.travel >= lane.box;
    if (boxed && serviceUntil === Infinity) serviceUntil = d.now + 5;
    const service = boxed && d.now < serviceUntil;
    d.pit = !inLane ? "track" : service ? "service" : "lane";
    d.limit = !inLane ? Infinity : service ? 0 : 22;
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
  "lights",
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

function lightsOut(): Drive {
  const drive = new Drive();
  drive.until("go", cooperative());
  return drive;
}

describe("driving school", () => {
  test("a player who follows every instruction gets the five lessons in order and finishes after a pit stop", () => {
    const drive = new Drive();
    drive.drive(cooperative());

    expect(drive.tutorial.finished).toBe("done");
    expect(drive.seen).toEqual(lessons);
  });

  test("the clock is held for every grid card and released by the lights card", () => {
    const drive = new Drive();
    const holding = new Map<string, boolean>();
    drive.drive((d) => {
      cooperative()(d);
      if (d.id !== "") holding.set(d.id, d.tutorial.holding);
    }, countdown + 30);
    expect([...holding].slice(0, 9)).toEqual([
      ["welcome", true],
      ["controls", true],
      ["steer-left", true],
      ["steer-right", true],
      ["brake-pedal", true],
      ["gas-pedal", true],
      ["lights", true],
      ["lights-wait", false],
      ["go", false],
    ]);
  });

  test("each grid check only passes with the input it asks for", () => {
    const drive = new Drive();
    drive.drive((d) => {
      presses[d.id]?.(d);
    }, 3);
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

  test("the screens lesson stops time with the screen spotlit and only lets go once Y has been pressed and then Enter", () => {
    const drive = pastTurnOne();
    drive.until("screens", cooperative());
    const { raceTime, travel } = drive;
    drive.drive(() => undefined, 1);
    drive.tutorial.press("confirm");
    drive.drive(() => undefined, 3);
    expect(drive.id).toBe("screens");
    expect(drive.tutorial.view.mode).toBe("pause");
    expect(drive.tutorial.view.card?.spot).toBe("mfd");
    expect(drive.tutorial.view.card?.actions).toEqual(["mfd"]);
    expect(drive.raceTime).toBe(raceTime);
    expect(drive.travel).toBe(travel);

    drive.mfd = "wear";
    drive.frame();
    expect(drive.tutorial.view.card?.actions).toEqual(["mfd", "confirm"]);
    drive.tutorial.press("confirm");
    drive.drive(racer, 1);
    expect(drive.id).toBe("drive");
    expect(drive.raceTime).toBeGreaterThan(raceTime);
  });

  test("Esc on the welcome card skips the whole tutorial, but not once it has started", () => {
    const skipped = new Drive();
    skipped.drive(() => undefined, 0.5);
    expect(skipped.tutorial.press("skip")).toBe(true);
    expect(skipped.tutorial.finished).toBe("skipped");

    const started = lightsOut();
    expect(started.tutorial.press("skip")).toBe(false);
    expect(started.tutorial.finished).toBeNull();
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

  test("the boost lesson on the back straight waits for Boost to be switched on before it lets the lap go on", () => {
    const drive = pastTurnOne();
    drive.until("boost", (d) => {
      racer(d);
    });
    expect(drive.travel).toBeGreaterThan(turnAt(11));
    expect(drive.travel).toBeLessThan(turnAt(12) - 900);
    expect(drive.tutorial.view.card?.spot).toBe("battery");
    drive.drive(() => undefined, 1);
    drive.tutorial.press("confirm");
    drive.drive(() => undefined, 1);
    expect(drive.id).toBe("boost");
    expect(drive.tutorial.frozen).toBe(true);

    drive.boost = true;
    drive.drive(() => undefined, 0.1);
    drive.tutorial.press("confirm");
    drive.drive(racer, 1);
    expect(drive.id).toBe("boosting");
  });

  test("a crash is called out at once with R to undo it, even when the car is off the track too", () => {
    const drive = pastTurnOne();
    drive.crashed = true;
    drive.offTrack = true;
    drive.drive(racer, 1);
    expect(drive.tutorial.view.alert?.title).toBe("Crash!");
    expect(drive.tutorial.view.alert?.body).toContain("No damage");
    expect(drive.tutorial.view.alert?.actions).toEqual(["rewind"]);
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
      d.input = { steer: 0, throttle: 0, brake: 1 };
    }, 6);
    expect(drive.speed).toBe(0);
    expect(drive.tutorial.view.alert?.title).toBe("Get going");
  });
});
