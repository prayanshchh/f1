const slowDown = 0.5;
const speedUp = 0.25;
const drift = 1e-4;

function approach(value: number, target: number, step: number): number {
  return value < target
    ? Math.min(target, value + step)
    : Math.max(target, value - step);
}

export class SlowClock {
  private rate = 1;
  private target = 1;
  private behind = 0;
  private last: number | null = null;
  private resync = false;

  get stopped(): boolean {
    return this.rate === 0;
  }

  get realTime(): boolean {
    return this.rate === 1 && this.target === 1 && this.behind === 0;
  }

  hold(): void {
    this.rate = 0;
    this.target = 0;
  }

  slow(): void {
    this.target = 0;
  }

  run(instant = false): void {
    this.target = 1;
    if (instant) this.rate = 1;
  }

  time(now: number): number {
    const dt = Math.max(0, now - (this.last ?? now));
    this.last = now;
    const before = this.rate;
    const pace = this.target > this.rate ? speedUp : slowDown;
    this.rate = approach(this.rate, this.target, dt / pace);
    this.behind += dt * (1 - (before + this.rate) / 2);
    if (this.rate === 1 && this.behind > 0) {
      this.resync = this.behind > drift;
      this.behind = 0;
    }
    return now - this.behind;
  }

  takeResync(): boolean {
    const due = this.resync;
    this.resync = false;
    return due;
  }
}
