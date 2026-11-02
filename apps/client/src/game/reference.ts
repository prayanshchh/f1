import { api, type Driver, type ServerReference } from "./api.ts";
import type { StoredReference } from "./laptrace.ts";
import { decodeTrace, encodeTrace, toMs } from "./race-log.ts";

const serverWaitMs = 2500;

function cacheKey(driver: Driver | null, track: string, car: string): string {
  return `f1.reference.${driver?.id ?? "guest"}.${track}.${car}`;
}

function readCache(key: string): ServerReference | null {
  try {
    return JSON.parse(
      localStorage.getItem(key) ?? "null",
    ) as ServerReference | null;
  } catch {
    return null;
  }
}

function writeCache(key: string, reference: ServerReference): void {
  try {
    localStorage.setItem(key, JSON.stringify(reference));
  } catch {
    return;
  }
}

function toStored(reference: ServerReference): StoredReference {
  return {
    trace: decodeTrace(reference.trace),
    sectors: reference.sectorsMs.map((ms) => ms / 1000),
    fastestSectors: reference.bestSectorsMs.map((ms) => ms / 1000),
  };
}

function withTimeout<T>(work: Promise<T>): Promise<T | null> {
  return Promise.race([
    work,
    new Promise<null>((resolve) => {
      window.setTimeout(() => {
        resolve(null);
      }, serverWaitMs);
    }),
  ]);
}

function faster(
  a: ServerReference | null,
  b: ServerReference | null,
): ServerReference | null {
  if (!a || !b) return a ?? b;
  return a.timeMs <= b.timeMs ? a : b;
}

export async function loadReference(
  driver: Driver | null,
  track: string,
  car: string,
): Promise<StoredReference | null> {
  const key = cacheKey(driver, track, car);
  const cached = readCache(key);
  const remote = driver
    ? await withTimeout(api.reference(track, car)).catch(() => null)
    : null;
  const best = faster(remote, cached);
  if (!best) return null;
  writeCache(key, best);
  return toStored(best);
}

export function rememberReference(
  driver: Driver | null,
  track: string,
  car: string,
  reference: { trace: number[]; sectors: number[] },
): void {
  const sectorsMs = reference.sectors.map(toMs);
  const key = cacheKey(driver, track, car);
  const previous = readCache(key)?.bestSectorsMs ?? sectorsMs;
  writeCache(key, {
    timeMs: sectorsMs.reduce((sum, ms) => sum + ms, 0),
    sectorsMs,
    bestSectorsMs: sectorsMs.map((ms, i) => Math.min(ms, previous[i] ?? ms)),
    trace: encodeTrace(reference.trace),
  });
}
