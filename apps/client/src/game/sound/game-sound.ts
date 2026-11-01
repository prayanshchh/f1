import type { CarAudio } from "./sound-state.ts";
import { soundState } from "./sound-state.ts";
import workletUrl from "./worklet.ts?worker&url";

const fullVolume = 1;

export class GameSound {
  private readonly context: AudioContext;
  private readonly node: AudioWorkletNode;
  private previous: CarAudio | null = null;
  private muted = false;

  private constructor(context: AudioContext, node: AudioWorkletNode) {
    this.context = context;
    this.node = node;
  }

  static async start(): Promise<GameSound> {
    const context = new AudioContext({
      latencyHint: "interactive",
      sampleRate: 48000,
    });
    await context.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(context, "f1-car-sound", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    node.connect(context.destination);
    const sound = new GameSound(context, node);
    sound.unlock();
    return sound;
  }

  private unlock(): void {
    const resume = () => {
      void this.context.resume();
    };
    resume();
    for (const event of ["keydown", "pointerdown", "touchend"])
      window.addEventListener(event, resume);
    document.addEventListener("visibilitychange", () => {
      this.send();
    });
  }

  private send(): void {
    if (!this.previous) return;
    const volume = this.muted || document.hidden ? 0 : fullVolume;
    this.node.port.postMessage(
      soundState(this.previous, this.previous, volume),
    );
  }

  update(car: CarAudio): void {
    const volume = this.muted || document.hidden ? 0 : fullVolume;
    this.node.port.postMessage(soundState(car, this.previous, volume));
    this.previous = car;
  }

  mute(muted: boolean): void {
    this.muted = muted;
    this.send();
  }
}
