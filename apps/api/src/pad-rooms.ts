export interface PadOffer {
  id: string;
  seq: number;
  sdp: string;
}

interface Pending extends PadOffer {
  at: number;
  answer: string | null;
}

interface Room {
  seq: number;
  pending: Pending[];
  touched: number;
  wake: Set<() => void>;
}

export interface PadRoomLimits {
  offerLife: number;
  roomLife: number;
  maxPending: number;
  maxRooms: number;
  firstSeq: number;
}

const defaultLimits: PadRoomLimits = {
  offerLife: 30_000,
  roomLife: 600_000,
  maxPending: 8,
  maxRooms: 10_000,
  firstSeq: 0,
};

export class RoomsFull extends Error {}

export class PadRooms {
  private readonly rooms = new Map<string, Room>();
  private readonly limits: PadRoomLimits;

  constructor(
    limits: Partial<PadRoomLimits> = {},
    private readonly now: () => number = Date.now,
  ) {
    this.limits = { ...defaultLimits, ...limits };
  }

  offer(roomId: string, sdp: string): PadOffer | null {
    const room = this.open(roomId);
    if (room.pending.length >= this.limits.maxPending) return null;
    room.seq += 1;
    const offer: Pending = {
      id: crypto.randomUUID(),
      seq: room.seq,
      sdp,
      at: this.now(),
      answer: null,
    };
    room.pending.push(offer);
    this.notify(room);
    return { id: offer.id, seq: offer.seq, sdp };
  }

  offers(roomId: string, after: number): PadOffer[] {
    const room = this.find(roomId);
    if (!room) return [];
    return room.pending
      .filter((offer) => offer.seq > after && offer.answer === null)
      .map(({ id, seq, sdp }) => ({ id, seq, sdp }));
  }

  answer(roomId: string, id: string, sdp: string): boolean {
    const room = this.find(roomId);
    const offer = room?.pending.find((pending) => pending.id === id);
    if (!room || !offer || offer.answer !== null) return false;
    offer.answer = sdp;
    this.notify(room);
    return true;
  }

  answerFor(roomId: string, id: string): string | null | undefined {
    const room = this.find(roomId);
    const offer = room?.pending.find((pending) => pending.id === id);
    if (!room || !offer) return undefined;
    if (offer.answer === null) return null;
    room.pending = room.pending.filter((pending) => pending !== offer);
    return offer.answer;
  }

  async wait(roomId: string, timeout: number, signal?: AbortSignal) {
    const room = this.open(roomId);
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        room.wake.delete(done);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, timeout);
      room.wake.add(done);
      signal?.addEventListener("abort", done);
    });
  }

  private notify(room: Room): void {
    room.touched = this.now();
    for (const wake of [...room.wake]) wake();
  }

  private find(roomId: string): Room | undefined {
    this.sweep();
    const room = this.rooms.get(roomId);
    if (room) room.touched = this.now();
    return room;
  }

  private open(roomId: string): Room {
    const found = this.find(roomId);
    if (found) return found;
    if (this.rooms.size >= this.limits.maxRooms) throw new RoomsFull();
    const room: Room = {
      seq: this.limits.firstSeq,
      pending: [],
      touched: this.now(),
      wake: new Set(),
    };
    this.rooms.set(roomId, room);
    return room;
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, room] of this.rooms) {
      room.pending = room.pending.filter(
        (offer) => now - offer.at < this.limits.offerLife,
      );
      if (
        room.pending.length === 0 &&
        room.wake.size === 0 &&
        now - room.touched > this.limits.roomLife
      )
        this.rooms.delete(id);
    }
  }
}
