export interface PitLayout {
  length: number;
  entry: number;
  wallStart: number;
  wallEnd: number;
  exit: number;
  pitWall: number;
  shift: number;
  ramp: number;
  fastLane: number;
  speedLimit: number;
  boxDistance: number;
  boxLateral: number;
}

export type PitPhase = "track" | "lane" | "boxing" | "service" | "release";
export type TurnInGrade = "optimal" | "good" | "early" | "late";

export interface PitCarState {
  distance: number;
  toMiddle: number;
  speed: number;
  laneClear?: boolean;
}

export interface PitDrive {
  lateral: number;
  lookahead: number;
  speed: number;
}

export interface PitControl {
  phase: PitPhase;
  limit: number;
  hold: boolean;
  drive: PitDrive | null;
  serviceNow: boolean;
  serviceProgress: number;
  countdown: number | null;
  grade: TurnInGrade | null;
  pitTime: number | null;
  stopTime: number | null;
  estimate: number | null;
  wingChange: boolean;
  choosingTyres: boolean;
  distanceToBox: number | null;
  speedKph: number;
}

const baseStop = 2.5;
const wingChangeTime = 8;
const turnInLead = 34;
const countdownShown = 3.5;
const optimalWindow = 0.12;
const goodWindow = 0.35;
const latestPress = -0.35;
const stopDecel = 7;
const arrivalDistance = 0.5;
const creepSpeed = 1.2;
const creepDistance = 1.5;
const releaseRun = 26;
const releaseSettle = 20;
const releaseDone = 0.5;
const lanePad = 0.2;
const entryClear = 15;
const minimumLook = 6;
const lookTime = 0.45;
const wheelbase = 3.5;
const steerLock = (30 * Math.PI) / 180;
const throttleGain = 0.5;
const brakeGain = 0.35;
const brakeFloor = 1.2;

const penalties: Record<TurnInGrade, number> = {
  optimal: 0,
  good: 0.4,
  early: 1.2,
  late: 1.6,
};

export function gradeTurnIn(secondsEarly: number): TurnInGrade {
  const size = Math.abs(secondsEarly);
  if (size <= optimalWindow) return "optimal";
  if (size <= goodWindow) return "good";
  return secondsEarly > 0 ? "early" : "late";
}

export function stopDuration(grade: TurnInGrade, frontWing = false): number {
  return baseStop + penalties[grade] + (frontWing ? wingChangeTime : 0);
}

function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

export class PitStop {
  private phase: PitPhase = "track";
  private grade: TurnInGrade | null = null;
  private turnStart = 0;
  private turnLateral = 0;
  private serviceAt = 0;
  private serviced = false;
  private stopTime: number | null = null;
  private laneAt: number | null = null;
  private releaseAt = 0;
  private garageMode = false;
  private waiting = false;
  private garageReleased = false;
  private wingRequest = false;
  private wingChange = false;

  constructor(
    private readonly layout: PitLayout,
    private readonly autoTurnIn: boolean,
  ) {}

  startInGarage(): void {
    this.garageMode = true;
    this.waiting = true;
    this.phase = "service";
    this.grade = "optimal";
    this.serviceAt = Infinity;
    this.serviced = false;
  }

  useGarage(): void {
    this.garageMode = true;
  }

  get atGarage(): boolean {
    return this.waiting;
  }

  goToTrack(): void {
    this.garageReleased = true;
  }

  private ahead(from: number, to: number): number {
    const { length } = this.layout;
    return (((to - from) % length) + length) % length;
  }

  private onArc(distance: number, from: number, to: number): boolean {
    return this.ahead(from, distance) <= this.ahead(from, to);
  }

  requestWing(on: boolean): void {
    this.wingRequest = on;
  }

  shiftAt(distance: number): number {
    const { wallStart, wallEnd, shift, ramp } = this.layout;
    if (this.onArc(distance, wallStart, wallEnd)) return shift;
    const before = this.ahead(distance, wallStart);
    const after = this.ahead(wallEnd, distance);
    return shift * ease(Math.max(1 - before / ramp, 1 - after / ramp, 0));
  }

  private inLane(car: PitCarState): boolean {
    const { entry, wallEnd, pitWall } = this.layout;
    if (!this.onArc(car.distance, entry + entryClear, wallEnd)) return false;
    return car.toMiddle + this.shiftAt(car.distance) > pitWall + lanePad;
  }

  private updateLane(car: PitCarState, pressed: boolean): number | null {
    const { length, boxDistance } = this.layout;
    const toTurn = this.ahead(car.distance, boxDistance - turnInLead);
    const distance = toTurn > length / 2 ? toTurn - length : toTurn;
    const seconds = distance / Math.max(car.speed, 1);
    if (seconds >= countdownShown) return null;
    if (pressed || (this.autoTurnIn && seconds <= 0) || seconds < latestPress) {
      this.grade = this.autoTurnIn ? "optimal" : gradeTurnIn(seconds);
      this.phase = "boxing";
      this.turnStart = car.distance;
      this.turnLateral = car.toMiddle + this.shiftAt(car.distance);
    }
    return Math.max(0, seconds);
  }

  private updateBoxing(car: PitCarState, look: number, now: number): PitDrive {
    const { boxDistance, boxLateral, length, speedLimit } = this.layout;
    const toBox = this.ahead(car.distance, boxDistance);
    const run = Math.max(1, this.ahead(this.turnStart, boxDistance) - 8);
    const blend = ease(this.ahead(this.turnStart, car.distance + look) / run);
    const crawling = toBox < creepDistance && car.speed < creepSpeed;
    if (toBox > length / 2 || toBox < arrivalDistance || crawling) {
      this.phase = "service";
      this.serviceAt = now;
      this.wingChange = this.wingRequest;
    }
    return {
      lateral: this.turnLateral + (boxLateral - this.turnLateral) * blend,
      lookahead: look,
      speed: Math.min(speedLimit / 3.6, Math.sqrt(2 * stopDecel * toBox) + 0.5),
    };
  }

  private updateGarage(car: PitCarState): number {
    this.waiting = true;
    if (!this.garageReleased || car.laneClear === false) return 0;
    this.garageReleased = false;
    this.waiting = false;
    this.serviced = true;
    this.phase = "release";
    this.releaseAt = car.distance;
    return 1;
  }

  private updateService(car: PitCarState, now: number): number {
    if (this.garageMode) return this.updateGarage(car);
    const duration = stopDuration(this.grade ?? "optimal", this.wingChange);
    const elapsed = now - this.serviceAt;
    if (elapsed >= duration && car.laneClear !== false) {
      this.stopTime = duration;
      this.serviced = true;
      this.phase = "release";
      this.releaseAt = car.distance;
    }
    return Math.min(1, elapsed / duration);
  }

  private updateRelease(car: PitCarState, look: number): PitDrive | null {
    const { boxLateral, fastLane, speedLimit } = this.layout;
    const blend = ease(
      this.ahead(this.releaseAt, car.distance + look) / releaseRun,
    );
    const lateral = car.toMiddle + this.shiftAt(car.distance);
    const settled =
      this.ahead(this.releaseAt, car.distance) > releaseRun + releaseSettle;
    if (settled && Math.abs(lateral - fastLane) < releaseDone) {
      this.phase = "lane";
      return null;
    }
    return {
      lateral: boxLateral + (fastLane - boxLateral) * blend,
      lookahead: look,
      speed: speedLimit / 3.6,
    };
  }

  private inLimiter(car: PitCarState): boolean {
    const { entry, wallEnd } = this.layout;
    if (this.phase === "track") return false;
    return this.phase !== "lane" || this.onArc(car.distance, entry, wallEnd);
  }

  private boxRemaining(car: PitCarState): number | null {
    if (this.phase === "track" || this.serviced) return null;
    const toBox = this.ahead(car.distance, this.layout.boxDistance);
    return toBox < this.layout.length / 2 ? toBox : null;
  }

  private startTimer(car: PitCarState, now: number): void {
    const { wallStart, wallEnd } = this.layout;
    const crossed = this.onArc(car.distance, wallStart, wallEnd);
    if (this.laneAt === null && this.phase !== "track" && crossed)
      this.laneAt = now;
  }

  private advance(car: PitCarState, now: number, pressed: boolean) {
    const look = Math.max(minimumLook, car.speed * lookTime);
    let countdown: number | null = null;
    let drive: PitDrive | null = null;
    let serviceProgress = 0;
    if (this.phase === "track" && this.inLane(car)) this.phase = "lane";
    if (this.phase === "lane" && !this.serviced)
      countdown = this.updateLane(car, pressed);
    if (this.phase === "boxing") drive = this.updateBoxing(car, look, now);
    const inService = this.phase === "service";
    if (inService) {
      drive = null;
      serviceProgress = this.updateService(car, now);
    }
    const hold = this.phase === "service";
    const serviceNow = inService && !hold;
    if (this.phase === "release") drive = this.updateRelease(car, look);
    return { countdown, drive, serviceProgress, hold, serviceNow };
  }

  update(car: PitCarState, now: number, pressed: boolean): PitControl {
    const state = this.advance(car, now, pressed);
    const inLimit = this.inLimiter(car);
    this.startTimer(car, now);
    const control: PitControl = {
      ...state,
      phase: this.phase,
      limit: inLimit ? this.layout.speedLimit / 3.6 : 0,
      grade: this.grade,
      pitTime: this.laneAt === null ? null : now - this.laneAt,
      stopTime: this.stopTime,
      estimate: this.grade
        ? stopDuration(
            this.grade,
            this.phase === "boxing" ? this.wingRequest : this.wingChange,
          )
        : null,
      wingChange: this.wingChange,
      choosingTyres:
        (this.phase === "lane" || this.phase === "boxing") && !this.serviced,
      distanceToBox: this.boxRemaining(car),
      speedKph: Math.abs(car.speed) * 3.6,
    };
    if (this.phase === "lane" && !inLimit) this.reset();
    return control;
  }

  private reset(): void {
    this.phase = "track";
    this.grade = null;
    this.serviced = false;
    this.stopTime = null;
    this.laneAt = null;
    this.wingChange = false;
  }
}

export function steerCommand(
  car: { x: number; y: number; heading: number; speed: number },
  target: number[],
  speed: number,
): { steer: number; throttle: number; brake: number } {
  const [px = 0, py = 0] = target;
  const angle = Math.atan2(py - car.y, px - car.x) - car.heading;
  const reach = Math.max(1, Math.hypot(px - car.x, py - car.y));
  const wheel =
    Math.atan((2 * wheelbase * Math.sin(angle)) / reach) / steerLock;
  const room = speed - car.speed;
  return {
    steer: Math.max(-1, Math.min(1, wheel)),
    throttle: Math.max(0, Math.min(1, room * throttleGain)),
    brake:
      car.speed > brakeFloor ? Math.max(0, Math.min(1, -room * brakeGain)) : 0,
  };
}
