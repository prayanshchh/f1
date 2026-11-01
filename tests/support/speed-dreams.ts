import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./repo.ts";

export interface SpeedDreams {
  HEAPF64: Float64Array;
  cwrap: (
    name: string,
    result: string,
    args: string[],
  ) => (...values: (string | number)[]) => number;
  _malloc: (size: number) => number;
  _sdStep: (count: number) => void;
  _sdTelemetry: (pointer: number) => void;
  _sdAudio: (pointer: number) => void;
  _sdFrame: () => number;
  _sdInputAnalog: (
    active: number,
    steer: number,
    throttle: number,
    brake: number,
  ) => void;
}

export const wasm = path.join(repoRoot, "apps/client/wasm/speed-dreams.js");

export async function startCota<M extends SpeedDreams = SpeedDreams>(
  prepare?: (module: M) => void,
): Promise<M> {
  const url = pathToFileURL(wasm).href;
  const loaded = (await import(url)) as {
    default: (options: object) => Promise<M>;
  };
  const m = await loaded.default({
    print: () => undefined,
    printErr: () => undefined,
  });
  prepare?.(m);
  m.cwrap("sdInit", "number", [
    "string",
    "string",
    "string",
    "string",
    "number",
  ])(
    "circuit",
    "cota",
    "config/raceman/quickrace.xml",
    "22mp1-sector-mcl36",
    0,
  );
  return m;
}
