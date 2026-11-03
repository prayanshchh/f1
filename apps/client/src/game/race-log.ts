import type { LapResult } from "./laptrace.ts";

export interface PendingCall {
  method: "PUT" | "POST";
  path: string;
  body: unknown;
}

export type DeliveryResult = "done" | "retry" | "drop";

export type Deliver = (call: PendingCall) => Promise<DeliveryResult>;

type Store = Pick<Storage, "getItem" | "setItem">;

function readQueue(store: Store, key: string): PendingCall[] {
  try {
    const stored = JSON.parse(store.getItem(key) ?? "[]") as unknown;
    return Array.isArray(stored) ? (stored as PendingCall[]) : [];
  } catch {
    return [];
  }
}

export class Outbox {
  private queue: PendingCall[];
  private active: Promise<void> | null = null;

  constructor(
    private readonly key: string,
    private readonly store: Store,
    private readonly deliver: Deliver,
  ) {
    this.queue = readQueue(store, key);
  }

  get pending(): number {
    return this.queue.length;
  }

  add(call: PendingCall): void {
    const same = this.queue.findIndex(
      (queued) => queued.method === call.method && queued.path === call.path,
    );
    if (same >= 0) this.queue[same] = call;
    else this.queue.push(call);
    this.persist();
    void this.flush();
  }

  flush(): Promise<void> {
    this.active ??= this.drain().finally(() => {
      this.active = null;
    });
    return this.active;
  }

  private async drain(): Promise<void> {
    for (;;) {
      const next = this.queue[0];
      if (!next) return;
      const result = await this.deliver(next).catch(
        (): DeliveryResult => "retry",
      );
      if (result === "retry") return;
      if (this.queue[0] === next) this.queue.shift();
      this.persist();
    }
  }

  private persist(): void {
    try {
      this.store.setItem(this.key, JSON.stringify(this.queue));
    } catch {
      return;
    }
  }
}

export function toMs(seconds: number): number {
  return Math.round(seconds * 1000);
}

function sectorMs(seconds: number): number | null {
  const ms = toMs(seconds);
  return ms > 0 ? ms : null;
}

const base64Chunk = 0x8000;

export function encodeTrace(trace: ArrayLike<number>): string {
  const bytes = new Uint8Array(Float32Array.from(trace).buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += base64Chunk)
    binary += String.fromCharCode(...bytes.subarray(i, i + base64Chunk));
  return btoa(binary);
}

export function decodeTrace(encoded: string): number[] {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return Array.from(new Float32Array(bytes.buffer));
}

export interface RaceInfo {
  id: string;
  track: string;
  car: string;
  team: string;
  kind: "practice" | "race";
  plannedLaps: number | null;
  conditions: Record<string, unknown>;
  startedAt: string;
}

export class RaceLog {
  private opened = false;

  constructor(
    private readonly outbox: Outbox,
    private readonly race: RaceInfo,
  ) {}

  private open(): void {
    if (this.opened) return;
    this.opened = true;
    const { id, ...session } = this.race;
    this.outbox.add({
      method: "PUT",
      path: `/api/sessions/${id}`,
      body: session,
    });
  }

  lap(result: LapResult, compound: string): void {
    this.open();
    this.outbox.add({
      method: "PUT",
      path: `/api/sessions/${this.race.id}/laps/${String(result.lap)}`,
      body: {
        timeMs: toMs(result.time),
        sectorsMs: result.sectors.map(sectorMs),
        compound,
        valid: result.valid,
      },
    });
  }

  personalBest(reference: { trace: number[]; sectors: number[] }): void {
    this.outbox.add({
      method: "PUT",
      path: `/api/references/${this.race.track}/${this.race.car}`,
      body: {
        timeMs: reference.sectors.map(toMs).reduce((a, b) => a + b, 0),
        sectorsMs: reference.sectors.map(toMs),
        trace: encodeTrace(reference.trace),
      },
    });
  }

  finish(): void {
    if (!this.opened) return;
    this.outbox.add({
      method: "POST",
      path: `/api/sessions/${this.race.id}/finish`,
      body: {},
    });
  }
}
