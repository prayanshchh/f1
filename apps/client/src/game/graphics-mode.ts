export type GraphicsLevel = "ultra" | "low";

export interface Overlay {
  render: () => void;
}

export interface GraphicsView {
  draw: () => void;
  overlay: (incident: Overlay) => void;
  show: (shown: boolean) => void;
}

const detectedKey = "revracers.graphics.detected";
const slowFrameMs = 22;
const judgeFrames = 240;
const settleFrames = 120;
const swapPollMs = 100;

export function detectedLevel(): GraphicsLevel {
  try {
    return localStorage.getItem(detectedKey) === "low" ? "low" : "ultra";
  } catch {
    return "ultra";
  }
}

export function rememberDetected(level: GraphicsLevel): void {
  try {
    localStorage.setItem(detectedKey, level);
  } catch {
    return;
  }
}

export function graphicsLevelOf(choice: "auto" | GraphicsLevel): GraphicsLevel {
  return choice === "auto" ? detectedLevel() : choice;
}

export function otherLevel(level: GraphicsLevel): GraphicsLevel {
  return level === "ultra" ? "low" : "ultra";
}

export class GraphicsMode {
  private readonly views = new Map<GraphicsLevel, Promise<GraphicsView>>();
  private current: GraphicsView | null = null;
  private wanted: GraphicsLevel;
  private frames: number[] = [];
  private lastFrame = 0;
  private judged = false;
  private busy: () => boolean = () => false;

  constructor(
    public level: GraphicsLevel,
    private readonly build: (level: GraphicsLevel) => Promise<GraphicsView>,
    private readonly changed: (level: GraphicsLevel) => void,
  ) {
    this.wanted = level;
  }

  get low(): boolean {
    return this.level === "low";
  }

  get target(): GraphicsLevel {
    return this.wanted;
  }

  holdSwapsWhile(busy: () => boolean): void {
    this.busy = busy;
  }

  async start(): Promise<void> {
    this.current = await this.viewOf(this.level).catch((error: unknown) => {
      if (this.level === "low") throw error;
      this.views.delete(this.level);
      this.level = "low";
      this.wanted = "low";
      return this.viewOf("low");
    });
    this.current.show(true);
    this.changed(this.level);
  }

  draw(): void {
    this.current?.draw();
  }

  overlay(incident: Overlay): void {
    this.current?.overlay(incident);
  }

  async switchTo(level: GraphicsLevel): Promise<boolean> {
    this.wanted = level;
    if (level === this.level) return false;
    const view = await this.viewOf(level).catch((error: unknown) => {
      this.views.delete(level);
      if (this.wanted === level) this.wanted = this.level;
      throw error;
    });
    while (this.busy())
      await new Promise((resolve) => setTimeout(resolve, swapPollMs));
    if (this.wanted !== level || level === this.level) return false;
    this.current?.show(false);
    view.show(true);
    this.current = view;
    this.level = level;
    this.changed(level);
    return true;
  }

  tooSlowForUltra(now: number): boolean {
    if (this.judged || this.level !== "ultra") return false;
    if (this.lastFrame > 0) this.frames.push((now - this.lastFrame) * 1000);
    this.lastFrame = now;
    if (this.frames.length < settleFrames + judgeFrames) return false;
    this.judged = true;
    const sorted = this.frames.slice(settleFrames).sort((a, b) => a - b);
    const slow = (sorted[sorted.length >> 1] ?? 0) > slowFrameMs;
    rememberDetected(slow ? "low" : "ultra");
    return slow;
  }

  private viewOf(level: GraphicsLevel): Promise<GraphicsView> {
    const known = this.views.get(level);
    if (known) return known;
    const made = this.build(level);
    this.views.set(level, made);
    return made;
  }
}
