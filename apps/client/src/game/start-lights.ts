export const startLightCount = 5;

const raceInterval = 1;
const raceLead = 1;
const raceHoldMin = 0.2;
const raceHoldMax = 3;
const quickCountdown = 2;
const quickInterval = 0.4;

export class LightCue {
  private shown = 0;

  next(lit: number): boolean {
    const fresh = lit > this.shown;
    this.shown = lit;
    return fresh;
  }
}

export class StartLights {
  private constructor(
    readonly countdown: number,
    readonly interval: number,
    private readonly lead = 0,
  ) {}

  static race(random: number): StartLights {
    const hold = raceHoldMin + random * (raceHoldMax - raceHoldMin);
    return new StartLights(
      raceLead + startLightCount * raceInterval + hold,
      raceInterval,
      raceLead,
    );
  }

  static restart(countdown: number): StartLights {
    return new StartLights(countdown, raceInterval);
  }

  static quick(): StartLights {
    return new StartLights(quickCountdown, quickInterval);
  }

  lit(raceTime: number): number {
    const elapsed = raceTime + this.countdown - this.lead;
    if (raceTime >= 0 || elapsed < 0) return 0;
    return Math.min(
      startLightCount,
      Math.max(0, Math.floor(elapsed / this.interval) + 1),
    );
  }
}
