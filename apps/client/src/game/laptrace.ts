export interface LapResult {
  lap: number;
  time: number;
  sectors: number[];
  best: boolean;
  delta: number | null;
}

export interface SectorState {
  times: (number | null)[];
  status: ("pb" | "slower" | null)[];
  active: number;
}

export class LapTrace {
  private current: Float64Array;
  private best: Float64Array | null;
  private bestSectors: number[];
  private lastDistance = -1;
  private lap = -1;
  private sectorTimes: (number | null)[];
  private sectorStatus: SectorState["status"];

  constructor(
    length: number,
    readonly boundaries: number[],
    stored: { trace: number[]; sectors: number[] } | null = null,
  ) {
    this.current = new Float64Array(Math.ceil(length) + 1).fill(Number.NaN);
    this.best = stored ? Float64Array.from(stored.trace) : null;
    this.bestSectors = stored?.sectors ?? [];
    this.sectorTimes = Array.from(
      { length: boundaries.length + 1 },
      () => null,
    );
    this.sectorStatus = this.sectorTimes.map(() => null);
  }

  get bestTime(): number | null {
    return this.bestLapTime();
  }

  get reference(): { trace: number[]; sectors: number[] } | null {
    return this.best
      ? { trace: Array.from(this.best), sectors: this.bestSectors }
      : null;
  }

  sample(
    lap: number,
    distance: number,
    time: number,
    lastLapTime: number,
  ): LapResult | null {
    let result: LapResult | null = null;
    if (lap !== this.lap) {
      if (this.lap >= 1 && lap === this.lap + 1 && lastLapTime > 0)
        result = this.finish(this.lap, lastLapTime);
      this.startLap(lap);
    }
    if (lap >= 1) this.record(distance, time);
    return result;
  }

  private startLap(lap: number): void {
    this.lap = lap;
    this.current.fill(Number.NaN);
    this.lastDistance = -1;
    this.sectorTimes = this.sectorTimes.map(() => null);
    this.sectorStatus = this.sectorStatus.map(() => null);
  }

  private record(distance: number, time: number): void {
    const bin = Math.max(
      0,
      Math.min(this.current.length - 1, Math.floor(distance)),
    );
    if (this.lastDistance < 0) {
      this.current[bin] = time;
      this.lastDistance = bin;
      return;
    }
    if (bin <= this.lastDistance || bin - this.lastDistance >= 200) return;
    const from = this.lastDistance + 1;
    const startTime = this.current[this.lastDistance] ?? time;
    for (let i = from; i <= bin; i++)
      this.current[i] =
        startTime +
        ((time - startTime) * (i - this.lastDistance)) /
          (bin - this.lastDistance);
    this.crossSectors(this.lastDistance, bin);
    this.lastDistance = bin;
  }

  delta(distance: number, time: number): number | null {
    if (!this.best || this.lap < 1) return null;
    const bin = Math.max(
      0,
      Math.min(this.best.length - 1, Math.floor(distance)),
    );
    const reference = this.best[bin];
    if (
      reference === undefined ||
      Number.isNaN(reference) ||
      Number.isNaN(this.current[bin] ?? Number.NaN)
    )
      return null;
    return time - reference;
  }

  predicted(distance: number, time: number): number | null {
    const delta = this.delta(distance, time);
    const bestLap = this.bestLapTime();
    return delta === null || bestLap === null ? null : bestLap + delta;
  }

  sectors(distance: number): SectorState {
    const active = this.boundaries.filter((b) => distance >= b).length;
    return {
      times: [...this.sectorTimes],
      status: [...this.sectorStatus],
      active,
    };
  }

  private bestLapTime(): number | null {
    if (this.bestSectors.length === 0) return null;
    return this.bestSectors.reduce((a, b) => a + b, 0);
  }

  private crossSectors(from: number, to: number): void {
    this.boundaries.forEach((boundary, index) => {
      if (from >= 0 && from < boundary && to >= boundary)
        this.closeSector(index, this.current[Math.floor(boundary)] ?? 0);
    });
  }

  private closeSector(index: number, at: number): void {
    const start = index === 0 ? 0 : this.splitAt(index - 1);
    const time = at - start;
    this.sectorTimes[index] = time;
    const best = this.bestSectors[index];
    this.sectorStatus[index] =
      best === undefined || time < best ? "pb" : "slower";
  }

  private splitAt(index: number): number {
    const boundary = this.boundaries[index] ?? 0;
    return this.current[Math.floor(boundary)] ?? 0;
  }

  private finish(lap: number, lapTime: number): LapResult {
    const last = this.boundaries.length;
    this.closeSector(last, lapTime);
    const sectors = this.sectorTimes.map((t) => t ?? 0);
    const previous = this.bestLapTime();
    const best = previous === null || lapTime < previous;
    const delta = previous === null ? null : lapTime - previous;
    if (best && sectors.every((t) => t > 0)) {
      const trace = Float64Array.from(this.current);
      trace[trace.length - 1] = lapTime;
      this.best = trace;
      this.bestSectors = sectors;
    }
    return { lap, time: lapTime, sectors, best, delta };
  }
}
