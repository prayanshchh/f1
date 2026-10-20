import type { Input } from "../contracts/index.ts";
import {
  InputSlot,
  StateBuffers,
  type RuntimeState,
  type StartOptions,
  type WorkerRequest,
  type WorkerResponse,
} from "./shared.ts";

interface PendingLog {
  resolve: (inputs: Input[]) => void;
  reject: (error: Error) => void;
}

class Session {
  readonly worker = new Worker(new URL("./sim.worker.ts", import.meta.url), {
    type: "module",
  });
  readonly input = new InputSlot();
  readonly states = new StateBuffers();
  readonly ready: Promise<void>;
  running = false;
  private readonly logs = new Map<number, PendingLog>();
  private nextId = 0;
  private resolveReady: (() => void) | undefined;
  private rejectReady: ((error: Error) => void) | undefined;

  constructor(options: StartOptions) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      this.receive(data);
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.close(new Error(event.message));
    };
    try {
      this.send({
        type: "start",
        options,
        input: this.input.buffer,
        state: this.states.buffer,
      });
    } catch (error) {
      this.close(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private send(message: WorkerRequest): void {
    this.worker.postMessage(message);
  }

  private receive(message: WorkerResponse): void {
    switch (message.type) {
      case "ready":
        this.running = true;
        this.resolveReady?.();
        break;
      case "error":
        this.close(new Error(message.message));
        break;
      case "log":
        this.logs.get(message.id)?.resolve(message.inputs);
        this.logs.delete(message.id);
        break;
    }
  }

  inputLog(): Promise<Input[]> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.logs.set(id, { resolve, reject });
      this.send({ type: "log", id });
    });
  }

  close(error = new Error("The runtime has stopped")): void {
    this.running = false;
    this.worker.terminate();
    this.rejectReady?.(error);
    for (const pending of this.logs.values()) {
      pending.reject(error);
    }
    this.logs.clear();
  }
}

export class Runtime {
  private session: Session | undefined;

  async start(options: StartOptions): Promise<void> {
    if (this.session !== undefined) {
      throw new Error("The runtime has already started");
    }
    if (!["none", "loopback"].includes(options.transport)) {
      throw new Error("Unknown transport");
    }
    const session = new Session(options);
    this.session = session;
    try {
      await session.ready;
    } catch (error) {
      if (this.session === session) {
        this.session = undefined;
      }
      throw error;
    }
  }

  private active(): Session {
    if (this.session?.running !== true) {
      throw new Error("The runtime is not running");
    }
    return this.session;
  }

  setInput(input: Input): void {
    this.active().input.write(input);
  }

  state(): RuntimeState {
    return this.active().states.read();
  }

  async inputLog(): Promise<Input[]> {
    return this.active().inputLog();
  }

  async stop(): Promise<void> {
    this.session?.close();
    this.session = undefined;
    await Promise.resolve();
  }
}
