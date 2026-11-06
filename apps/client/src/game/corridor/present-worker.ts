import { type PresentSetup, shownSlot, shownWords } from "./shown.ts";

type WaitAsync = (
  array: Int32Array,
  index: number,
  value: number,
) => { async: boolean; value: Promise<string> | string };

const waitAsync = (Atomics as unknown as { waitAsync: WaitAsync }).waitAsync;

class Presenter {
  private readonly context: OffscreenCanvasRenderingContext2D;
  private image = new ImageData(1, 1);
  private seen = 0;

  constructor(private readonly setup: PresentSetup) {
    const context = setup.canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("no 2d context in the present worker");
    this.context = context;
  }

  private words(): Int32Array {
    return new Int32Array(
      this.setup.memory.buffer,
      this.setup.control,
      shownWords,
    );
  }

  private claim(shown: Int32Array): void {
    while (Atomics.compareExchange(shown, shownSlot.reading, 0, 1) !== 0)
      Atomics.wait(shown, shownSlot.reading, 2, 1);
  }

  private copy(shown: Int32Array): number {
    this.claim(shown);
    const frame = Atomics.load(shown, shownSlot.frame);
    const width = shown[shownSlot.width] ?? 0;
    const height = shown[shownSlot.height] ?? 0;
    if (this.image.width !== width || this.image.height !== height)
      this.image = new ImageData(width, height);
    this.image.data.set(
      new Uint8Array(
        this.setup.memory.buffer,
        shown[shownSlot.pixels] ?? 0,
        width * height * 4,
      ),
    );
    Atomics.store(shown, shownSlot.reading, 0);
    return frame;
  }

  private show(): void {
    const started = performance.now();
    const shown = this.words();
    const frame = this.copy(shown);
    const { canvas } = this.setup;
    if (canvas.width !== this.image.width) canvas.width = this.image.width;
    if (canvas.height !== this.image.height) canvas.height = this.image.height;
    this.context.putImageData(this.image, 0, 0);
    new Float32Array(this.setup.memory.buffer, this.setup.control, shownWords)[
      shownSlot.presentMs
    ] = performance.now() - started;
    this.seen = frame;
    Atomics.store(shown, shownSlot.seen, frame);
  }

  async run(): Promise<void> {
    for (;;) {
      const waited = waitAsync(this.words(), shownSlot.frame, this.seen);
      if (waited.async) await waited.value;
      this.show();
    }
  }
}

self.onmessage = (event: MessageEvent<PresentSetup>) => {
  void new Presenter(event.data).run();
};
