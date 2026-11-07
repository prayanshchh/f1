const leaveMs = 600;
const swallowed = ["keydown", "keyup", "keypress"] as const;

class Intro {
  readonly done: Promise<void>;
  readonly shown: boolean;
  private finish: () => void = () => undefined;
  private left = false;
  private readonly video: HTMLVideoElement | null;
  private readonly hint: HTMLElement | null;

  private constructor(private readonly box: HTMLElement | null) {
    this.done = new Promise((resolve) => {
      this.finish = resolve;
    });
    this.video = box?.querySelector("video") ?? null;
    this.hint = box?.querySelector<HTMLElement>("[data-intro-sound]") ?? null;
    this.shown = box?.isConnected === true && this.video !== null;
    if (!this.shown || !box || !this.video) {
      this.left = true;
      this.finish();
      return;
    }
    this.watch(box, this.video);
  }

  static take(): Intro {
    return new Intro(document.querySelector<HTMLElement>("[data-intro]"));
  }

  stop(): void {
    this.leave(0);
  }

  private watch(box: HTMLElement, video: HTMLVideoElement): void {
    const showHint = () => {
      if (this.hint) this.hint.hidden = !video.muted;
    };
    showHint();
    video.addEventListener("volumechange", showHint);
    video.addEventListener("ended", () => {
      this.leave(leaveMs);
    });
    video.addEventListener("error", () => {
      this.leave(0);
    });
    box.addEventListener("pointerdown", this.unmute);
    const skip = box.querySelector<HTMLElement>("[data-intro-skip]");
    if (skip) skip.hidden = false;
    skip?.addEventListener("click", () => {
      this.leave(leaveMs);
    });
    for (const type of swallowed) window.addEventListener(type, this.key, true);
    if (video.paused) {
      video.muted = true;
      video.play().catch(() => {
        this.leave(0);
      });
    }
  }

  private readonly unmute = () => {
    if (!this.video) return;
    this.video.muted = false;
    void this.video.play().catch(() => undefined);
  };

  private readonly key = (event: KeyboardEvent) => {
    event.stopImmediatePropagation();
    event.preventDefault();
    if (event.type !== "keydown") return;
    if (event.key === "Escape") this.leave(leaveMs);
    else this.unmute();
  };

  private leave(fadeMs: number): void {
    if (this.left || !this.box) return;
    this.left = true;
    for (const type of swallowed)
      window.removeEventListener(type, this.key, true);
    const { box, video } = this;
    box.classList.add("leaving");
    box.style.transitionDuration = `${String(fadeMs)}ms`;
    this.finish();
    window.setTimeout(() => {
      video?.pause();
      video?.removeAttribute("src");
      video?.load();
      box.remove();
    }, fadeMs);
  }
}

export const intro = Intro.take();
