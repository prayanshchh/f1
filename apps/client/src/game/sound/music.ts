import sources from "../../../../../content/music/MUSIC-SOURCES.json";

export type Cue = "intro" | "menu" | "buildup" | "victory";

interface Track {
  cue: string;
  file: string;
  loop?: { start: number; end: number };
}

interface Voice {
  cue: Cue;
  gain: GainNode;
  release: () => void;
}

const files = import.meta.glob<string>("../../../../../content/music/*.ogg", {
  eager: true,
  query: "?url",
  import: "default",
});
const tracks = sources.tracks as Track[];
const introKey = "revracers.introPlayed";
const fadeIn = 1.2;
const crossfade = 1.5;
const volumePeriod = 250;
const volumeSmoothing = 0.08;
const followOn: Partial<Record<Cue, Cue>> = { intro: "menu", victory: "menu" };
const synced = new Set<Cue>(["buildup", "victory"]);
const unlockEvents = ["keydown", "pointerdown", "touchend"];

function trackOf(cue: Cue): Track {
  const track = tracks.find((t) => t.cue === cue);
  if (!track) throw new Error(`no music for ${cue}`);
  return track;
}

function urlOf(track: Track): string {
  const url = files[`../../../../../content/music/${track.file}`];
  if (!url) throw new Error(`missing music file ${track.file}`);
  return url;
}

export class Music {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private voice: Voice | null = null;
  private wanted: Cue | null = null;
  private requestedAt = 0;
  private buffer: Promise<AudioBuffer> | null = null;
  private readonly elements = new Map<Cue, HTMLAudioElement>();
  private readonly feeds = new Map<Cue, MediaElementAudioSourceNode>();
  private volumeTimer = 0;
  private closeTimer = 0;
  private waiting = false;

  constructor(private readonly volume: () => number) {
    document.addEventListener("visibilitychange", () => {
      if (!this.context) return;
      if (document.hidden) void this.context.suspend();
      else if (this.wanted) void this.context.resume();
    });
  }

  get cue(): Cue | null {
    return this.wanted;
  }

  opening(): void {
    const played = sessionStorage.getItem(introKey) === "1";
    sessionStorage.setItem(introKey, "1");
    this.play(played ? "menu" : "intro");
  }

  preload(cue: Cue): void {
    if (trackOf(cue).loop) return;
    this.element(cue);
  }

  play(cue: Cue): void {
    if (this.wanted === cue) return;
    this.wanted = cue;
    this.requestedAt = performance.now() / 1000;
    document.body.dataset["music"] = cue;
    window.clearTimeout(this.closeTimer);
    const context = this.open();
    if (context.state === "running") this.start(cue);
    else this.unlock(context);
  }

  stop(seconds = crossfade): void {
    if (!this.wanted && !this.voice) return;
    this.wanted = null;
    document.body.dataset["music"] = "";
    this.fadeOut(seconds);
    window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(
      () => {
        this.close();
      },
      seconds * 1000 + 100,
    );
  }

  private open(): AudioContext {
    if (this.context) return this.context;
    const context = new AudioContext({ latencyHint: "playback" });
    const master = context.createGain();
    master.gain.value = this.volume();
    master.connect(context.destination);
    this.context = context;
    this.master = master;
    this.volumeTimer = window.setInterval(() => {
      master.gain.setTargetAtTime(
        this.volume(),
        context.currentTime,
        volumeSmoothing,
      );
    }, volumePeriod);
    return context;
  }

  private close(): void {
    window.clearInterval(this.volumeTimer);
    for (const element of this.elements.values()) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    this.elements.clear();
    this.feeds.clear();
    this.buffer = null;
    this.voice = null;
    void this.context?.close();
    this.context = null;
    this.master = null;
  }

  private unlock(context: AudioContext): void {
    if (this.waiting) return;
    this.waiting = true;
    const resume = () => {
      void context.resume().then(() => {
        if (context !== this.context || context.state !== "running") return;
        for (const event of unlockEvents)
          window.removeEventListener(event, resume, true);
        this.waiting = false;
        if (this.wanted) this.start(this.wanted);
      });
    };
    for (const event of unlockEvents)
      window.addEventListener(event, resume, true);
    resume();
  }

  private element(cue: Cue): HTMLAudioElement {
    const known = this.elements.get(cue);
    if (known) return known;
    const element = new Audio(urlOf(trackOf(cue)));
    element.preload = "auto";
    this.elements.set(cue, element);
    return element;
  }

  private loopBuffer(
    context: AudioContext,
    track: Track,
  ): Promise<AudioBuffer> {
    this.buffer ??= fetch(urlOf(track))
      .then((response) => response.arrayBuffer())
      .then((data) => context.decodeAudioData(data));
    return this.buffer;
  }

  private fadeOut(seconds: number): void {
    const voice = this.voice;
    const context = this.context;
    this.voice = null;
    if (!voice || !context) return;
    const now = context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.linearRampToValueAtTime(0, now + seconds);
    window.setTimeout(
      () => {
        voice.release();
      },
      seconds * 1000 + 50,
    );
  }

  private start(cue: Cue): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master || this.voice?.cue === cue) return;
    this.fadeOut(crossfade);
    const track = trackOf(cue);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(1, context.currentTime + fadeIn);
    gain.connect(master);
    const offset = synced.has(cue)
      ? performance.now() / 1000 - this.requestedAt
      : 0;
    const ended = () => {
      const next = followOn[cue];
      if (this.voice?.cue === cue && this.wanted === cue && next)
        this.play(next);
    };
    if (track.loop) {
      const { start, end } = track.loop;
      const voice: Voice = {
        cue,
        gain,
        release: () => {
          gain.disconnect();
        },
      };
      this.voice = voice;
      void this.loopBuffer(context, track).then((buffer) => {
        if (this.voice !== voice) return;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.loopStart = start;
        source.loopEnd = end;
        source.connect(gain);
        source.start();
        voice.release = () => {
          source.stop();
          gain.disconnect();
        };
      });
      return;
    }
    const element = this.element(cue);
    const source =
      this.feeds.get(cue) ?? context.createMediaElementSource(element);
    this.feeds.set(cue, source);
    source.connect(gain);
    element.currentTime = offset;
    element.onended = ended;
    void element.play().catch(() => undefined);
    this.voice = {
      cue,
      gain,
      release: () => {
        if (this.voice?.cue !== cue) element.pause();
        source.disconnect(gain);
        gain.disconnect();
      },
    };
  }
}
