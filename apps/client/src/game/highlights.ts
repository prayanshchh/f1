import type { ReplayTape } from "./replay.ts";

export interface Pass {
  time: number;
  passer: number;
  passed: number;
  position: number;
  lap: number;
}

const before = 5;
const after = 2.5;
const reelClips = 6;

export interface Clip {
  from: number;
  to: number;
  passes: Pass[];
  tape: ReplayTape;
}

interface Window {
  from: number;
  to: number;
  passes: Pass[];
}

function bestPosition(clip: Clip): number {
  return Math.min(...clip.passes.map((pass) => pass.position));
}

export class Highlights {
  private pending: Window | null = null;
  private clips: Clip[] = [];
  private seen = 0;
  private last = -Infinity;

  constructor(
    private readonly car: number,
    private readonly copy: (from: number, to: number) => ReplayTape,
  ) {}

  get from(): number {
    return this.seen;
  }

  update(time: number, total: number, fresh: Pass[]): void {
    if (time < this.last) this.rewind(time, total);
    this.last = time;
    for (const pass of fresh) {
      this.seen++;
      if (pass.passer !== this.car) continue;
      const open = this.pending;
      if (open && pass.time - before <= open.to) {
        open.to = pass.time + after;
        open.passes.push(pass);
        continue;
      }
      this.flush();
      this.pending = {
        from: pass.time - before,
        to: pass.time + after,
        passes: [pass],
      };
    }
    if (this.pending && time >= this.pending.to) this.flush();
  }

  reel(count = reelClips): Clip[] {
    this.flush();
    return [...this.clips]
      .sort((a, b) => bestPosition(a) - bestPosition(b) || b.from - a.from)
      .slice(0, count)
      .sort((a, b) => a.from - b.from);
  }

  private flush(): void {
    const open = this.pending;
    this.pending = null;
    if (open) this.clips.push({ ...open, tape: this.copy(open.from, open.to) });
  }

  private rewind(time: number, total: number): void {
    this.seen = Math.min(this.seen, total);
    const kept = (passes: Pass[]) => passes.filter((p) => p.time <= time);
    this.clips = this.clips
      .map((clip) => ({ ...clip, passes: kept(clip.passes) }))
      .filter((clip) => clip.passes.length > 0);
    const open = this.pending;
    if (open) open.passes = kept(open.passes);
    if (open?.passes.length === 0) this.pending = null;
  }
}
