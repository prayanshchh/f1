const pageBytes = 4096;
const pageWords = pageBytes / 4;

export interface HistoryOptions {
  interval: number;
  window: number;
  sweep: number;
  nearSweep: number;
  nearPages: number;
}

export interface Moment<Extra> {
  time: number;
  pages: Int32Array;
  data: Uint8Array;
  extra: Extra;
  valid: boolean;
}

const defaultHistory: HistoryOptions = {
  interval: 0.5,
  window: 30,
  sweep: 1,
  nearSweep: 0.1,
  nearPages: 8,
};

function pageIsZero(words: Int32Array, page: number): boolean {
  const end = (page + 1) * pageWords;
  for (let w = page * pageWords; w < end; w++) if (words[w] !== 0) return false;
  return true;
}

class PageSet {
  readonly pages: number[] = [];
  private readonly member: Uint8Array;
  cursor = 0;

  constructor(size: number) {
    this.member = new Uint8Array(size);
  }

  add(page: number): void {
    if (this.member[page]) return;
    this.member[page] = 1;
    this.pages.push(page);
  }

  removeAt(index: number): void {
    this.member[this.pages[index] ?? 0] = 0;
    this.pages[index] = this.pages[this.pages.length - 1] ?? 0;
    this.pages.pop();
  }
}

export class HeapHistory<Extra> {
  private readonly basePages: number;
  private readonly baseOffset: Int32Array;
  private readonly baseWords: Int32Array;
  private readonly dirty: Uint8Array;
  private readonly cleanAt: Float64Array;
  private readonly watched: PageSet;
  private readonly near: PageSet;
  private dirtyList: number[] = [];
  private cursor = 0;
  private lastShot = -Infinity;
  private moments: Moment<Extra>[] = [];

  constructor(
    private readonly heap: () => Uint8Array,
    private readonly options: HistoryOptions = defaultHistory,
  ) {
    const bytes = heap();
    const words = new Int32Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.length / 4,
    );
    this.basePages = Math.floor(bytes.length / pageBytes);
    this.baseOffset = new Int32Array(this.basePages).fill(-1);
    let stored = 0;
    for (let page = 0; page < this.basePages; page++)
      if (!pageIsZero(words, page)) this.baseOffset[page] = stored++;
    this.baseWords = new Int32Array(stored * pageWords);
    for (let page = 0; page < this.basePages; page++) {
      const at = this.baseOffset[page] ?? -1;
      if (at >= 0)
        this.baseWords.set(
          words.subarray(page * pageWords, (page + 1) * pageWords),
          at * pageWords,
        );
    }
    this.dirty = new Uint8Array(this.basePages);
    this.cleanAt = new Float64Array(this.basePages).fill(-Infinity);
    this.watched = new PageSet(this.basePages);
    this.near = new PageSet(this.basePages);
  }

  get trackedPages(): number {
    return this.dirtyList.length;
  }

  private words(): Int32Array {
    const bytes = this.heap();
    return new Int32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  }

  private differs(words: Int32Array, page: number): boolean {
    const at = this.baseOffset[page] ?? -1;
    if (at < 0) return !pageIsZero(words, page);
    const start = page * pageWords;
    const base = at * pageWords;
    for (let w = 0; w < pageWords; w++)
      if (words[start + w] !== this.baseWords[base + w]) return true;
    return false;
  }

  private check(words: Int32Array, page: number, time: number): boolean {
    if (this.dirty[page]) return false;
    if (!this.differs(words, page)) {
      this.cleanAt[page] = time;
      return false;
    }
    this.dirty[page] = 1;
    this.dirtyList.push(page);
    const clean = this.cleanAt[page] ?? -Infinity;
    for (const moment of this.moments)
      if (moment.time > clean) moment.valid = false;
    const reach = this.options.nearPages;
    const from = Math.max(0, page - reach);
    const to = Math.min(this.basePages - 1, page + reach);
    for (let other = from; other <= to; other++) {
      if (this.dirty[other]) continue;
      if (Math.abs(other - page) === 1) this.watched.add(other);
      else this.near.add(other);
    }
    return true;
  }

  private visit(
    set: PageSet,
    count: number,
    words: Int32Array,
    time: number,
  ): boolean {
    let found = false;
    for (let k = 0; k < count && set.pages.length > 0; k++) {
      if (set.cursor >= set.pages.length) set.cursor = 0;
      const page = set.pages[set.cursor] ?? 0;
      found = this.check(words, page, time) || found;
      if (this.dirty[page]) set.removeAt(set.cursor);
      else set.cursor++;
    }
    return found;
  }

  private scan(words: Int32Array, time: number, dt: number): void {
    const { sweep, nearSweep } = this.options;
    const share = (pages: number, period: number) =>
      Math.max(1, Math.ceil((pages * Math.max(dt, 0)) / period));
    let found = this.visit(
      this.watched,
      this.watched.pages.length,
      words,
      time,
    );
    found =
      this.visit(
        this.near,
        share(this.near.pages.length, nearSweep),
        words,
        time,
      ) || found;
    const count = share(this.basePages, sweep);
    for (let k = 0; k < count; k++) {
      const page = this.cursor;
      this.cursor = (this.cursor + 1) % this.basePages;
      found = this.check(words, page, time) || found;
    }
    if (found) this.dirtyList.sort((a, b) => a - b);
  }

  private capture(words: Int32Array, time: number, extra: Extra): void {
    const totalPages = Math.floor((words.length * 4) / pageBytes);
    const grown: number[] = [];
    for (let page = this.basePages; page < totalPages; page++) grown.push(page);
    const pages = Int32Array.from([...this.dirtyList, ...grown]);
    const data = new Uint8Array(pages.length * pageBytes);
    const bytes = new Uint8Array(
      words.buffer,
      words.byteOffset,
      words.length * 4,
    );
    pages.forEach((page, i) => {
      data.set(
        bytes.subarray(page * pageBytes, (page + 1) * pageBytes),
        i * pageBytes,
      );
    });
    this.moments.push({ time, pages, data, extra, valid: true });
    const oldest = time - this.options.window;
    while ((this.moments[0]?.time ?? Infinity) < oldest) this.moments.shift();
  }

  tick(time: number, dt: number, extra: () => Extra, allowShot = true): void {
    const words = this.words();
    this.scan(words, time, dt);
    if (!allowShot || time - this.lastShot < this.options.interval) return;
    this.lastShot = time;
    this.capture(words, time, extra());
  }

  usable(): Moment<Extra>[] {
    return this.moments.filter((m) => m.valid);
  }

  rewind(time: number, now: number): Moment<Extra> | null {
    this.scan(this.words(), now, this.options.sweep);
    const usable = this.usable();
    const moment =
      usable.filter((m) => m.time <= time).at(-1) ?? usable[0] ?? null;
    if (moment) this.restore(moment);
    return moment;
  }

  private restore(moment: Moment<Extra>): void {
    const bytes = this.heap();
    const kept = new Set<number>();
    moment.pages.forEach((page, i) => {
      kept.add(page);
      if ((page + 1) * pageBytes > bytes.length) return;
      bytes.set(
        moment.data.subarray(i * pageBytes, (i + 1) * pageBytes),
        page * pageBytes,
      );
    });
    const zero = new Uint8Array(pageBytes);
    for (const page of this.dirtyList) {
      if (kept.has(page)) continue;
      const at = this.baseOffset[page] ?? -1;
      bytes.set(
        at < 0
          ? zero
          : new Uint8Array(this.baseWords.buffer, at * pageBytes, pageBytes),
        page * pageBytes,
      );
    }
    this.moments = this.moments.filter((m) => m.time <= moment.time);
    this.lastShot = moment.time;
    this.cleanAt.fill(moment.time);
  }
}
