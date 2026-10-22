import { PHYSICS_HZ } from "../contracts/index.ts";

interface LapReading {
  tick: number;
  lap: number;
  lapDistance: number;
  speed: number;
}

export function createLapClock() {
  let previous = 0;
  let startTick = 0;
  let base: number | undefined;
  let highest = 0;
  let last: number | null = null;
  return {
    update(reading: LapReading) {
      if (
        !Object.values(reading).every((v) => Number.isFinite(v) && v >= 0) ||
        reading.tick < previous
      ) {
        throw new RangeError(
          "Lap readings must be finite, not negative and in time order",
        );
      }
      previous = reading.tick;
      if (base === undefined) {
        base = reading.lap;
        highest = base;
      }
      if (reading.lap > highest) {
        const estimate =
          reading.speed > 0
            ? reading.tick - (reading.lapDistance / reading.speed) * PHYSICS_HZ
            : reading.tick;
        const crossing = Math.max(startTick, Math.min(reading.tick, estimate));
        last = (crossing - startTick) / PHYSICS_HZ;
        startTick = crossing;
        highest = reading.lap;
      }
      return {
        completed: highest - base,
        current: (reading.tick - startTick) / PHYSICS_HZ,
        last,
      };
    },
  };
}
