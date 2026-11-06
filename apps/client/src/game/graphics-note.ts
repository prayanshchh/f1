export type LowReason = "no-gpu" | "busy";

const noticedKey = "revracers.graphics.noticed";
const shownMs = 10_000;
const reasons: Record<LowReason, string> = {
  "no-gpu": "No graphics card was found.",
  busy: "Your graphics card is busy.",
};

function noticed(): boolean {
  try {
    return localStorage.getItem(noticedKey) === "1";
  } catch {
    return false;
  }
}

function markNoticed(): void {
  try {
    localStorage.setItem(noticedKey, "1");
  } catch {
    return;
  }
}

export class GraphicsNote {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly reason: HTMLElement,
  ) {}

  show(reason: LowReason): boolean {
    if (noticed()) return false;
    markNoticed();
    this.reason.textContent = reasons[reason];
    this.root.hidden = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.hide();
    }, shownMs);
    return true;
  }

  hide(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.root.hidden = true;
  }
}
