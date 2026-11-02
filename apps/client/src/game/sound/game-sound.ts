import type { CarAudio } from "./sound-state.ts";
import { soundState } from "./sound-state.ts";
import workletUrl from "./worklet.ts?worker&url";

const fullVolume = 1;
const suspendDelay = 400;
const unlockEvents = [
  "keydown",
  "keyup",
  "pointerdown",
  "pointerup",
  "mousedown",
  "click",
  "touchend",
];

export function openAudio(): AudioContext {
  return new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
}

export class GameSound {
  private readonly context: AudioContext;
  private readonly node: AudioWorkletNode;
  private previous: CarAudio | null = null;
  private muted = false;
  private suspendTimer = 0;

  private constructor(context: AudioContext, node: AudioWorkletNode) {
    this.context = context;
    this.node = node;
  }

  static async start(context = openAudio()): Promise<GameSound> {
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
      if (!this.silent) void this.context.resume();
    };
    resume();
    for (const event of unlockEvents)
      window.addEventListener(event, resume, { capture: true });
    document.addEventListener("visibilitychange", () => {
      this.send();
    });
  }

  private get silent(): boolean {
    return this.muted || document.hidden;
  }

  private send(): void {
    window.clearTimeout(this.suspendTimer);
    if (this.silent)
      this.suspendTimer = window.setTimeout(() => {
        void this.context.suspend();
      }, suspendDelay);
    else void this.context.resume();
    if (!this.previous) return;
    this.node.port.postMessage(
      soundState(this.previous, this.previous, this.silent ? 0 : fullVolume),
    );
  }

  update(car: CarAudio): void {
    const volume = this.silent ? 0 : fullVolume;
    this.node.port.postMessage(soundState(car, this.previous, volume));
    this.previous = car;
  }

  mute(muted: boolean): void {
    this.muted = muted;
    this.send();
  }
}
