import { expect, test } from "vitest";
import { createLapClock } from "../../apps/client/src/drive/laps.ts";
import { formatLapTime } from "../../apps/client/src/hud/index.ts";

function reading(tick: number) {
  return {
    tick,
    lap: tick < 1000.5 ? 0 : tick < 2000.5 ? 1 : 2,
    lapDistance: ((((tick - 1000.5) * 0.1) % 100) + 100) % 100,
    speed: 50,
  };
}
function firstLap() {
  const clock = createLapClock();
  for (let tick = 0; tick <= 1000; tick += 8) clock.update(reading(tick));
  return clock;
}
test("a lap is timed from the moment the car crossed the line, not when the crossing was read", () => {
  const clock = firstLap();
  expect(clock.update(reading(1000))).toEqual({
    completed: 0,
    current: 2,
    last: null,
  });
  const crossed = clock.update(reading(1008));
  expect(crossed.completed).toBe(1);
  expect(crossed.last).toBeCloseTo(2.001, 9);
  expect(crossed.current).toBeCloseTo(0.015, 9);
  for (let tick = 1016; tick <= 2000; tick += 8) clock.update(reading(tick));
  const next = clock.update(reading(2008));
  expect(next.completed).toBe(2);
  expect(next.last).toBeCloseTo(2, 9);
});
test("crossing the line backwards and forwards again does not count a lap", () => {
  const clock = firstLap();
  const crossed = clock.update(reading(1008));
  clock.update({ ...reading(1016), lap: 0 });
  const recrossed = clock.update({ ...reading(1024), lap: 1 });
  expect(recrossed.completed).toBe(1);
  expect(recrossed.last).toBe(crossed.last);
});
test("invalid readings are refused", () => {
  for (const invalid of [
    { tick: NaN },
    { speed: -1 },
    { lapDistance: Infinity },
    { lap: -1 },
  ]) {
    expect(() =>
      createLapClock().update({ ...reading(0), ...invalid }),
    ).toThrow(RangeError);
  }
  const clock = firstLap();
  expect(() => clock.update(reading(999))).toThrow(RangeError);
});
test("lap times read as minutes, seconds and thousandths", () => {
  for (const [seconds, text] of [
    [null, "—"],
    [0, "0:00.000"],
    [83.4567, "1:23.457"],
    [59.9996, "1:00.000"],
    [3600, "60:00.000"],
    [0.0004, "0:00.000"],
  ] as const) {
    expect(formatLapTime(seconds)).toBe(text);
  }
  for (const invalid of [-0.001, NaN, Infinity])
    expect(() => formatLapTime(invalid)).toThrow(RangeError);
});
test("a stopped crossing uses the reading time and later crossings cannot precede it", () => {
  const clock = createLapClock();
  clock.update({ ...reading(0), lap: 4 });
  expect(clock.update({ ...reading(100), lap: 5, speed: 0 })).toEqual({
    completed: 1,
    current: 0,
    last: 0.2,
  });
  expect(clock.update({ ...reading(101), lap: 6, lapDistance: 500 })).toEqual({
    completed: 2,
    current: 0.002,
    last: 0,
  });
});
