import { readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./repo.ts";
import {
  type RaceSystems,
  speedIndex,
  startRace,
  tyreReader,
} from "./race-systems.ts";

interface Line {
  x: number[];
  z: number[];
  profile: { speed: number[] };
}

interface Frame {
  origin: number[];
  heading: number;
}

const trackFile = (file: string) =>
  readFileSync(path.join(repoRoot, "content/tracks/cota", file), "utf8");

const line = JSON.parse(trackFile("racing-line.json")) as Line;
const track = JSON.parse(trackFile("sd-frame.json")) as Frame;
const count = line.x.length;
const wheelbase = 3.5;
const steerLock = (30 * Math.PI) / 180;
const distanceIndex = 53;
const toMiddleIndex = 54;
const lapIndex = 49;
const lastLapIndex = 51;

function frameOf(m: RaceSystems): Float64Array {
  return new Float64Array(m.HEAPF64.buffer, m._sdFrame(), 88);
}

function lineIndex(distance: number, length: number): number {
  const wrapped = ((distance % length) + length) % length;
  return Math.min(count - 1, Math.floor((wrapped / length) * count));
}

export class Pilot {
  private readonly length: number;
  private readonly startX: number;
  private readonly startY: number;

  constructor(
    private readonly m: RaceSystems,
    public scale: number,
  ) {
    this.length = m._sdTrackLength();
    const out = m._malloc(12);
    m._sdTrackLocal2Global(0, 0, out);
    const [x = 0, y = 0] = new Float32Array(m.HEAPF32.buffer, out, 3);
    this.startX = x;
    this.startY = y;
    m._sdInputSteerDirect(1);
  }

  private world(index: number): [number, number] {
    const [ox = 0, , oz = 0] = track.origin;
    const x = (line.x[index] ?? 0) - ox;
    const y = -(line.z[index] ?? 0) + oz;
    const c = Math.cos(-track.heading);
    const s = Math.sin(-track.heading);
    return [this.startX + c * x - s * y, this.startY + s * x + c * y];
  }

  private targetSpeed(distance: number, speed: number): number {
    const at = (d: number) =>
      (line.profile.speed[lineIndex(d, this.length)] ?? 0) * this.scale;
    return Math.min(at(distance + speed * 0.25), at(distance) + 3);
  }

  tick(): void {
    const f = frameOf(this.m);
    const distance = f[distanceIndex] ?? 0;
    const speed = Math.abs(f[speedIndex] ?? 0);
    const look = Math.max(8, speed * 0.45);
    const [px, py] = this.world(lineIndex(distance + look, this.length));
    const dx = px - (f[13] ?? 0);
    const dy = py - (f[14] ?? 0);
    const angle = Math.atan2(dy, dx) - Math.atan2(f[2] ?? 0, f[1] ?? 1);
    const reach = Math.max(1, Math.hypot(dx, dy));
    const steer =
      Math.atan((2 * wheelbase * Math.sin(angle)) / reach) / steerLock;
    const room = this.targetSpeed(distance, speed) - speed;
    this.m._sdInputAnalog(
      1,
      Math.max(-1, Math.min(1, steer)),
      Math.max(0, Math.min(1, room * 0.5)),
      speed > 1 ? Math.max(0, Math.min(1, -room * 0.35)) : 0,
    );
    this.m._sdStep(1);
  }

  driveUntil(done: () => boolean, limit = 400000): void {
    for (let tick = 0; tick < limit && !done(); tick++) this.tick();
  }

  distance(): number {
    return frameOf(this.m)[distanceIndex] ?? 0;
  }

  lapsDone(): number {
    return frameOf(this.m)[lapIndex] ?? 0;
  }

  lastLapTime(): number {
    return frameOf(this.m)[lastLapIndex] ?? 0;
  }

  offTrack(): number {
    return Math.abs(frameOf(this.m)[toMiddleIndex] ?? 0);
  }
}

export interface Stint {
  lapsToWear: number;
  wearPerLap: number;
}

export async function runStint(
  compound: number,
  scale: number,
  wear: number,
): Promise<Stint> {
  const m = await startRace({ compound, fuel: 100, race: true });
  const tyres = tyreReader(m);
  m._sdStep(1000);
  const pilot = new Pilot(m, scale);
  const worst = () => {
    const t = tyres();
    return Math.max(t.wear(0), t.wear(1), t.wear(2), t.wear(3));
  };
  const fresh = () => {
    const t = tyres();
    return Math.min((t.grip(0) + t.grip(1)) / 2, (t.grip(2) + t.grip(3)) / 2);
  };
  const reference = fresh();
  let lastLap = pilot.lapsDone();
  let laps = 0;
  let tick = 0;
  pilot.driveUntil(() => {
    if (tick++ % 500 === 0)
      pilot.scale = scale * Math.sqrt(Math.min(1, fresh() / reference));
    if (pilot.lapsDone() !== lastLap) {
      lastLap = pilot.lapsDone();
      if (lastLap >= 2) laps++;
    }
    return worst() >= wear;
  }, 5000000);
  return { lapsToWear: laps, wearPerLap: wear / Math.max(1, laps) };
}
