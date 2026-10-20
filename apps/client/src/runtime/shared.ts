import type { Input, Snapshot, WorldSetup } from "../contracts/index.ts";

export interface RuntimeState {
  tick: number;
  hash: string;
  snapshot: Snapshot;
  sentInputs: number;
}

export interface StartOptions {
  setup: WorldSetup;
  transport: "none" | "loopback";
}

export type WorkerRequest =
  | {
      type: "start";
      options: StartOptions;
      input: SharedArrayBuffer;
      state: SharedArrayBuffer;
    }
  | { type: "log"; id: number };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "log"; id: number; inputs: Input[] };

export function idleInput(): Input {
  return { steer: 0, throttle: 0, brake: 0, shiftUp: false, shiftDown: false };
}

function validateInput(input: Input): void {
  for (const [value, minimum] of [
    [input.steer, -1],
    [input.throttle, 0],
    [input.brake, 0],
  ] as const) {
    if (!Number.isFinite(value) || value < minimum || value > 1) {
      throw new RangeError(
        "Controls must be finite and within their allowed range",
      );
    }
  }
  if (
    typeof input.shiftUp !== "boolean" ||
    typeof input.shiftDown !== "boolean"
  ) {
    throw new RangeError("Shift controls must be booleans");
  }
}

export class InputSlot {
  readonly buffer: SharedArrayBuffer;
  private readonly header: Int32Array;
  private readonly values: Float64Array;
  private previous = idleInput();

  constructor(buffer = new SharedArrayBuffer(40)) {
    this.buffer = buffer;
    this.header = new Int32Array(buffer, 0, 4);
    this.values = new Float64Array(buffer, 16, 3);
  }

  write(input: Input): void {
    validateInput(input);
    Atomics.add(this.header, 0, 1);
    this.values.set([input.steer, input.throttle, input.brake]);
    Atomics.or(
      this.header,
      1,
      Number(input.shiftUp) | (Number(input.shiftDown) << 1),
    );
    Atomics.add(this.header, 0, 1);
  }

  consume(): Input {
    const version = Atomics.load(this.header, 0);
    const [steer = 0, throttle = 0, brake = 0] = this.values;
    if ((version & 1) === 0 && version === Atomics.load(this.header, 0)) {
      this.previous = {
        steer,
        throttle,
        brake,
        shiftUp: false,
        shiftDown: false,
      };
    }
    const shifts = Atomics.exchange(this.header, 1, 0);
    return {
      ...this.previous,
      shiftUp: (shifts & 1) !== 0,
      shiftDown: (shifts & 2) !== 0,
    };
  }
}

const slotBytes = 65536;
const headerBytes = 16;

export class StateBuffers {
  readonly buffer: SharedArrayBuffer;
  private readonly header: Int32Array;
  private readonly bytes: Uint8Array;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private front = 0;
  private back = 2;

  constructor(buffer?: SharedArrayBuffer) {
    this.buffer = buffer ?? new SharedArrayBuffer(headerBytes + slotBytes * 3);
    this.header = new Int32Array(this.buffer, 0, 4);
    this.bytes = new Uint8Array(this.buffer, headerBytes);
    if (buffer === undefined) {
      Atomics.store(this.header, 0, 1);
    }
  }

  publish(state: RuntimeState): void {
    const encoded = this.encoder.encode(JSON.stringify(state));
    if (encoded.length > slotBytes) {
      throw new Error("World state exceeds the shared buffer capacity");
    }
    this.bytes.set(encoded, this.back * slotBytes);
    Atomics.store(this.header, this.back + 1, encoded.length);
    this.back = Atomics.exchange(this.header, 0, this.back | 4) & 3;
  }

  read(): RuntimeState {
    let middle = Atomics.load(this.header, 0);
    while ((middle & 4) !== 0) {
      const exchanged = Atomics.compareExchange(
        this.header,
        0,
        middle,
        this.front,
      );
      if (exchanged === middle) {
        this.front = middle & 3;
        break;
      }
      middle = exchanged;
    }
    const length = Atomics.load(this.header, this.front + 1);
    const offset = this.front * slotBytes;
    return JSON.parse(
      this.decoder.decode(this.bytes.slice(offset, offset + length)),
    ) as RuntimeState;
  }
}
