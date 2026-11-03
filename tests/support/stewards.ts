import {
  carFields,
  messageFields,
  parseCar,
  parseMessages,
  type StewardCar,
  type StewardMessage,
} from "../../apps/client/src/game/stewards.ts";
import type { SpeedDreams } from "./speed-dreams.ts";

export interface Stewarded extends SpeedDreams {
  _free: (pointer: number) => void;
  _sdStewardsMessages: (out: number, max: number, after: number) => number;
  _sdStewardsCar: (index: number, out: number) => void;
  _sdStewardsLights: (interval: number) => void;
  _sdStewardsTrackLimits: (on: number) => void;
}

const batch = 256;

export function stewardMessages(m: Stewarded): StewardMessage[] {
  const pointer = m._malloc(batch * messageFields * 8);
  const count = m._sdStewardsMessages(pointer, batch, 0);
  const values = new Float64Array(
    m.HEAPF64.buffer,
    pointer,
    count * messageFields,
  ).slice();
  m._free(pointer);
  return parseMessages(values);
}

export function stewardCar(m: Stewarded, index: number): StewardCar {
  const pointer = m._malloc(carFields * 8);
  m._sdStewardsCar(index, pointer);
  const values = new Float64Array(m.HEAPF64.buffer, pointer, carFields).slice();
  m._free(pointer);
  return parseCar(values);
}

export function frameOf(m: SpeedDreams): Float64Array {
  return new Float64Array(m.HEAPF64.buffer, m._sdFrame(), 88);
}
