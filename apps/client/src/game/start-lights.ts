export const startLightCount = 5;

const raceInterval = 1;
const raceHoldMin = 0.2;
const raceHoldMax = 3;
const quickCountdown = 2;
const quickInterval = 0.4;

export class StartLights {
  private constructor(
    readonly countdown: number,
    readonly interval: number,
  ) {}

  static race(random: number): StartLights {
    const hold = raceHoldMin + random * (raceHoldMax - raceHoldMin);
    return new StartLights(startLightCount * raceInterval + hold, raceInterval);
  }

  static quick(): StartLights {
    return new StartLights(quickCountdown, quickInterval);
  }

  lit(raceTime: number): number {
    if (raceTime >= 0) return 0;
    const elapsed = raceTime + this.countdown;
    return Math.min(
      startLightCount,
      Math.max(0, Math.floor(elapsed / this.interval) + 1),
    );
  }
}
