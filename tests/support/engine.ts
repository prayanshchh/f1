import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./repo.ts";

export const wasm = path.join(repoRoot, "apps/client/wasm/speed-dreams.js");

export async function startCota<T extends object>(): Promise<T & CotaInit> {
  const loaded = (await import(pathToFileURL(wasm).href)) as {
    default: (options: object) => Promise<T & CotaInit>;
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

interface CotaInit {
  cwrap: (
    name: string,
    result: string,
    args: string[],
  ) => (...values: (string | number)[]) => number;
}
