import { describe, expect, test } from "vitest";
import {
  type CarAudio,
  soundState,
  surfaces,
} from "../../apps/client/src/game/sound/sound-state.ts";

const wheel = (speed: number, surface: number = surfaces.road) => ({
  skid: 0,
  spin: speed / 0.34,
  radius: 0.34,
  surface,
  load: 3000,
});

const car = (patch: Partial<CarAudio> = {}): CarAudio => ({
  rpm: 1000,
  redline: 1623,
  throttle: 1,
  brake: 0,
  gear: 4,
  speed: 60,
  damage: 0,
  wheels: [wheel(60), wheel(60), wheel(60), wheel(60)],
  ...patch,
});

describe("sound state", () => {
  test("the redline maps to the F1 25 rev ceiling, in any engine unit", () => {
    expect(soundState(car({ rpm: 1623 }), null, 1).rpm).toBeCloseTo(12900);
    expect(
      soundState(car({ rpm: 15500, redline: 15500 }), null, 1).rpm,
    ).toBeCloseTo(12900);
  });

  test("two wheels on a kerb is full contact and airborne wheels are silent", () => {
    const kerb = wheel(60, surfaces.kerb);
    const two = car({ wheels: [kerb, kerb, wheel(60), wheel(60)] });
    expect(soundState(two, null, 1).kerb).toBeCloseTo(1);
    const airborne = { ...kerb, load: 0 };
    const none = car({ wheels: [airborne, airborne, wheel(60), wheel(60)] });
    expect(soundState(none, null, 1).kerb).toBe(0);
  });

  test("a standing car on a kerb makes no kerb sound", () => {
    const kerb = wheel(0, surfaces.kerb);
    const parked = car({ speed: 0, wheels: [kerb, kerb, kerb, kerb] });
    expect(soundState(parked, null, 1).kerb).toBe(0);
  });

  test("grass and gravel both count as rough but not as kerb", () => {
    const off = wheel(60, surfaces.grass);
    const state = soundState(car({ wheels: [off, off, off, off] }), null, 1);
    expect(state.rough).toBeCloseTo(1);
    expect(state.kerb).toBe(0);
    const stones = wheel(60, surfaces.gravel);
    const gravel = car({ wheels: [stones, stones, stones, stones] });
    expect(soundState(gravel, null, 1).rough).toBeCloseTo(1);
  });

  test("lock-up needs braking, speed and a stopped wheel", () => {
    const stopped = { ...wheel(60), spin: 0 };
    const braking = car({
      throttle: 0,
      brake: 1,
      wheels: [stopped, wheel(60), wheel(60), wheel(60)],
    });
    expect(soundState(braking, null, 1).lock).toBeCloseTo(1);
    expect(soundState({ ...braking, brake: 0 }, null, 1).lock).toBe(0);
    expect(soundState({ ...braking, speed: 2 }, null, 1).lock).toBe(0);
    expect(soundState(car({ brake: 1 }), null, 1).lock).toBe(0);
  });

  test("scrub starts above the threshold and ignores grass", () => {
    const light = car({ wheels: [{ ...wheel(60), skid: 0.05 }] });
    expect(soundState(light, null, 1).scrub).toBe(0);
    const hard = car({ wheels: [{ ...wheel(60), skid: 1 }] });
    expect(soundState(hard, null, 1).scrub).toBeCloseTo(1);
    const grass = car({ wheels: [{ ...wheel(60, surfaces.grass), skid: 1 }] });
    expect(soundState(grass, null, 1).scrub).toBe(0);
  });

  test("impact comes from new damage only", () => {
    const before = car({ damage: 100 });
    expect(soundState(before, before, 1).impact).toBe(0);
    expect(soundState(car({ damage: 300 }), before, 1).impact).toBeCloseTo(0.5);
    expect(soundState(car({ damage: 90 }), before, 1).impact).toBe(0);
    expect(soundState(before, null, 1).impact).toBe(0);
  });
});
