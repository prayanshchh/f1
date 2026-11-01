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
  _sdPitService: (fuel: number) => void;
  _sdInputAnalog: (
    active: number,
    steer: number,
    throttle: number,
    brake: number,
  ) => void;
}

export const wasm = path.join(repoRoot, "apps/client/wasm/speed-dreams.js");

export async function startCota(): Promise<SpeedDreams> {
  const url = pathToFileURL(wasm).href;
  const loaded = (await import(url)) as {
    default: (options: object) => Promise<SpeedDreams>;
  };
  const m = await loaded.default({
    print: () => undefined,
    printErr: () => undefined,
  });
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
