import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./repo.ts";

export interface SpeedDreams {
  HEAPF64: Float64Array;
  HEAPF32: Float32Array;
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
  _sdHudInfo: (pointer: number) => void;
  _sdTrackLocal2Global: (d: number, l: number, out: number) => number;
  _sdInputSpeedLimit: (limit: number) => void;
  _sdInputSteerDirect: (on: number) => void;
  _sdInputPitHold: (on: number) => void;
  _sdPitService: (fuel: number, frontWing: number) => void;
  _sdInputAnalog: (
    active: number,
    steer: number,
    throttle: number,
    brake: number,
  ) => void;
}

export const wasm = path.join(repoRoot, "apps/client/wasm/speed-dreams.js");

export async function startCircuit<M extends SpeedDreams = SpeedDreams>(
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
    "hill-country",
    "config/raceman/quickrace.xml",
    "revracer-26",
    0,
  );
  return m;
}
