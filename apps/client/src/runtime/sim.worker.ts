import init, { World } from "../../wasm/physics.js";
import type { ClientMessage, Input, Snapshot } from "../contracts/index.ts";
import { PHYSICS_HZ } from "../contracts/index.ts";
import {
  idleInput,
  InputSlot,
  StateBuffers,
  type WorkerRequest,
  type WorkerResponse,
} from "./shared.ts";

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<WorkerRequest>) => void;
  postMessage: (message: WorkerResponse) => void;
};

const log: Input[] = [];
const clock = new MessageChannel();
const sleeper = new Int32Array(new SharedArrayBuffer(4));
const period = 1000 / PHYSICS_HZ;
let world: World | undefined;
let input: InputSlot;
let states: StateBuffers;
let inputs: Input[] = [];
let transport: MessagePort | undefined;
let sentInputs = 0;
let deadline = 0;

function publish(): void {
  if (world === undefined) {
    throw new Error("The world has not started");
  }
  const snapshot = world.snapshot() as Snapshot;
  states.publish({
    tick: snapshot.tick,
    hash: world.stateHash(),
    snapshot,
    sentInputs,
  });
}

function fail(error: unknown): void {
  clock.port1.close();
  clock.port2.close();
  transport?.close();
  world?.free();
  world = undefined;
  scope.postMessage({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
}

function step(): void {
  try {
    const remaining = deadline - performance.now();
    if (remaining > 0) {
      Atomics.wait(sleeper, 0, 0, remaining);
    }
    const applied = input.consume();
    inputs[0] = applied;
    world?.step(inputs);
    log.push(applied);
    const message: ClientMessage = {
      type: "input",
      tick: log.length,
      input: applied,
    };
    transport?.postMessage(message);
    publish();
    const now = performance.now();
    deadline += period;
    if (deadline <= now) {
      deadline = now + period;
    }
    clock.port2.postMessage(null);
  } catch (error) {
    fail(error);
  }
}

async function start(
  request: Extract<WorkerRequest, { type: "start" }>,
): Promise<void> {
  await init();
  world = new World(request.options.setup);
  input = new InputSlot(request.input);
  states = new StateBuffers(request.state);
  inputs = request.options.setup.cars.map(idleInput);
  if (request.options.transport === "loopback") {
    const loopback = new MessageChannel();
    transport = loopback.port1;
    loopback.port2.onmessage = () => {
      sentInputs += 1;
    };
  }
  publish();
  scope.postMessage({ type: "ready" });
  deadline = performance.now() + period;
  clock.port1.onmessage = step;
  clock.port2.postMessage(null);
}

scope.onmessage = ({ data }) => {
  if (data.type === "start") {
    start(data).catch(fail);
  } else {
    scope.postMessage({ type: "log", id: data.id, inputs: log });
  }
};
