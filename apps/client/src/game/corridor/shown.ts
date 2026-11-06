export const shownSlot = {
  frame: 0,
  width: 1,
  height: 2,
  pixels: 3,
  reading: 4,
  seen: 5,
  presentMs: 6,
} as const;

export const shownWords = 8;

export interface PresentSetup {
  memory: WebAssembly.Memory;
  control: number;
  canvas: OffscreenCanvas;
}
