import { describe, expect, test } from "vitest";
import { Rumble, type Shake } from "../../apps/client/src/game/rumble.ts";

const frame = 1 / 60;
const cockpitPixelsPerRadian = 1080 / ((48.6 * Math.PI) / 180);
const wheelbase = 3.6;
const left = [1, 3];

function drive(
  kmh: number,
  from: number,
  until: number,
  start: number,
  seconds = 2,
): Shake[] {
  const rumble = new Rumble();
  const speed = kmh / 3.6;
  const lag = wheelbase / speed;
  const shakes: Shake[] = [];
  for (let t = 0; t < seconds; t += frame) {
    const wheels = [0, 1, 2, 3].map((i) => {
      const delay = i >= 2 ? lag : 0;
      const on = left.includes(i) && t >= from + delay && t < until + delay;
      return { surface: on ? 1 : 0 };
    });
    shakes.push(rumble.update(wheels, speed, frame, start + t));
  }
  return shakes;
}

function bouncePixels(shakes: Shake[], from: number): number {
  const view = shakes.map(
    (s) => (s.pitch + s.buzzPitch) * cockpitPixelsPerRadian,
  );
  const reach = 7;
  const fast = view.map((v, i) => {
    const near = view.slice(Math.max(0, i - reach), i + reach + 1);
    return v - near.reduce((a, b) => a + b, 0) / near.length;
  });
  const window = fast.slice(
    Math.round((from - 0.2) / frame),
    Math.round((from + 0.8) / frame),
  );
  return Math.max(...window) - Math.min(...window);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

describe("kerb bounce", () => {
  test("leaves the view and the car still on smooth tarmac", () => {
    const rumble = new Rumble();
    const flat = [0, 1, 2, 3].map(() => ({ surface: 0 }));
    for (let t = 0; t < 2; t += frame) {
      const s = rumble.update(flat, 80, frame, t);
      const moves = [s.heave, s.pitch, s.roll, s.buzzYaw, s.buzzPitch];
      expect(Math.max(...moves.map(Math.abs))).toBe(0);
    }
  });

  test("bounces the cockpit view about as hard as the reference footage on a kerb strike", () => {
    const strikes = [17, 40, 93, 211, 377].map((start) =>
      bouncePixels(drive(200, 0.4, 1, start), 0.4),
    );
    expect(median(strikes)).toBeGreaterThan(6);
    expect(median(strikes)).toBeLessThan(11);
  });

  test("barely moves when crawling over a kerb", () => {
    const strikes = [17, 40, 93].map((start) =>
      bouncePixels(drive(25, 0.4, 1, start), 0.4),
    );
    expect(Math.max(...strikes)).toBeLessThan(2);
  });

  test("settles after the kerb and stays sane through a long frame hitch", () => {
    const rumble = new Rumble();
    const kerb = [0, 1, 2, 3].map((i) => ({
      surface: left.includes(i) ? 1 : 0,
    }));
    const flat = [0, 1, 2, 3].map(() => ({ surface: 0 }));
    rumble.update(kerb, 60, frame, 1);
    rumble.update(kerb, 60, 0.5, 1.5);
    const hitched = rumble.update(kerb, 60, 2, 3.5);
    expect(Math.abs(hitched.pitch)).toBeLessThan(0.02);
    expect(Math.abs(hitched.heave)).toBeLessThan(0.02);
    let settled = hitched;
    for (let t = 3.5; t < 5.5; t += frame)
      settled = rumble.update(flat, 60, frame, t);
    expect(Math.abs(settled.pitch)).toBeLessThan(1e-4);
    expect(Math.abs(settled.roll)).toBeLessThan(1e-4);
    expect(Math.abs(settled.heave)).toBeLessThan(1e-4);
  });
});
