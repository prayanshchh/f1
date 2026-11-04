import { describe, expect, test } from "vitest";
import { Incidents } from "../../apps/client/src/game/incidents.ts";

const dt = 1 / 60;

function run(
  incidents: Incidents,
  from: number,
  to: number,
  state: { hurt: number; off?: boolean; retired?: boolean },
): number {
  let time = from;
  for (; time < to; time += dt)
    incidents.update(
      time,
      state.hurt,
      state.off ?? false,
      state.retired ?? false,
    );
  return time;
}

describe("going back before a crash", () => {
  test("R aims a second before the hit, however long the damaged car was driven on", () => {
    const incidents = new Incidents();
    let time = run(incidents, 0, 20, { hurt: 0.01 });
    const hitAt = time;
    time = run(incidents, time, time + 25, { hurt: 0.6 });
    expect(incidents.crashed).toBe(true);
    expect(incidents.target(time)).toBeCloseTo(hitAt - 1, 1);
  });

  test("small wear on the way does not count as a crash", () => {
    const incidents = new Incidents();
    let time = 0;
    for (let hurt = 0; hurt < 0.3; hurt += 0.001) {
      incidents.update(time, hurt, false, false);
      time += dt;
    }
    expect(incidents.crashed).toBe(false);
    expect(incidents.target(time)).toBeCloseTo(time - 5, 1);
  });

  test("leaving the track aims before the car left it, and is forgotten once it has been back on for a few seconds", () => {
    const incidents = new Incidents();
    let time = run(incidents, 0, 10, { hurt: 0 });
    const leftAt = time;
    time = run(incidents, time, time + 4, { hurt: 0, off: true });
    expect(incidents.crashed).toBe(false);
    expect(incidents.target(time)).toBeCloseTo(leftAt - 1, 1);
    time = run(incidents, time, time + 3.5, { hurt: 0 });
    expect(incidents.target(time)).toBeCloseTo(time - 5, 1);
  });

  test("a retirement stays a crash, a pit stop that fixes the damage clears it, and so does a rewind", () => {
    const retired = new Incidents();
    run(retired, run(retired, 0, 5, { hurt: 0 }), 15, {
      hurt: 0,
      retired: true,
    });
    expect(retired.crashed).toBe(true);

    const pitted = new Incidents();
    let time = run(pitted, 0, 5, { hurt: 0 });
    time = run(pitted, time, time + 5, { hurt: 0.5 });
    expect(pitted.crashed).toBe(true);
    time = run(pitted, time, time + 1, { hurt: 0.4 });
    expect(pitted.crashed).toBe(true);
    run(pitted, time, time + 1, { hurt: 0 });
    expect(pitted.crashed).toBe(false);

    const rewound = new Incidents();
    run(rewound, run(rewound, 0, 5, { hurt: 0 }), 10, { hurt: 0.5 });
    rewound.rewound();
    run(rewound, 3, 4, { hurt: 0 });
    expect(rewound.crashed).toBe(false);
    expect(rewound.target(4)).toBeCloseTo(-1, 1);
  });
});
