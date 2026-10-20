declare module "*wasm/physics.js" {
  export default function init(): Promise<unknown>;

  export class World {
    constructor(setup: import("../contracts/index.ts").WorldSetup);
    step(inputs: import("../contracts/index.ts").Input[]): void;
    snapshot(): unknown;
    stateHash(): string;
    free(): void;
  }
}
