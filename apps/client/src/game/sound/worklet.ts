import { CarSynth, type SynthState } from "./synth.ts";
import tables from "./tables.json";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor,
): void;

class CarProcessor extends AudioWorkletProcessor {
  private readonly synth = new CarSynth(tables, sampleRate);

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<SynthState>) => {
      this.synth.set(event.data);
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    const left = output?.[0];
    if (!left) return true;
    this.synth.process({ left, right: output[1] ?? left });
    return true;
  }
}

registerProcessor("revracers-car-sound", CarProcessor);
