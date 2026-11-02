import {
  carStride,
  type CarTiming,
  type Engine,
  sessionPhase,
} from "./engine.ts";
import type { Hud } from "./hud.ts";
import type { PitStop } from "./pitstop.ts";
import type { Scene } from "./scene.ts";
import type { Settings } from "./settings.ts";
import type { GameSound } from "./sound/game-sound.ts";
import { penaltyBadge } from "./stewards.ts";
import { CarLabels } from "./tower.ts";
import {
  saveWeekend,
  segmentNames,
  type Stage,
  type WeekendPlan,
} from "./weekend.ts";
import {
  GarageScreen,
  hideClassification,
  showClassification,
  showGrid,
  updateClassificationRows,
} from "./weekend-ui.ts";

const fastForward = 8;
const timingPeriod = 0.2;
const resultsRefresh = 1000;

export interface WeekendContext {
  engine: Engine;
  scene: Scene;
  hud: Hud;
  pit: PitStop;
  sound: GameSound;
  canvas: HTMLCanvasElement;
  hudRoot: HTMLElement;
  labelsRoot: HTMLElement;
  resultsRoot: HTMLElement;
  settings: Settings;
  trackLabel: string;
  stage: Stage;
  field: WeekendPlan;
  startFuel: number;
  restart: (autostart: boolean) => void;
}

export class WeekendFlow {
  finished = false;
  private timing: CarTiming[];
  private timingClock = 0;
  private scale = 1;
  private readonly labels: CarLabels;
  private readonly garage: GarageScreen;

  constructor(private readonly ctx: WeekendContext) {
    this.timing = ctx.engine.timing();
    this.labels = new CarLabels(ctx.labelsRoot, ctx.field.entrants);
    this.garage = new GarageScreen(ctx.field.entrants, {
      go: (compound) => {
        this.leaveGarage(compound);
      },
      fast: () => {
        this.setScale(this.scale === 1 ? fastForward : 1);
        return this.scale !== 1;
      },
      skip: () => {
        this.setScale(1);
        ctx.engine.simulateSession();
      },
    });
  }

  start(): void {
    if (this.ctx.stage === "qualifying") this.enterGarage();
    else this.ctx.engine.playerInGarage(false);
  }

  update(now: number): void {
    const { engine, scene, canvas, hud } = this.ctx;
    const cars = engine.cars();
    scene.updateField(cars);
    if (!this.garage.open)
      this.labels.update(
        cars,
        carStride,
        this.timing,
        scene.camera,
        canvas.clientWidth,
        canvas.clientHeight,
      );
    if (now - this.timingClock < timingPeriod) return;
    this.timingClock = now;
    this.timing = engine.timing();
    const info = engine.session();
    hud.updateField(cars, this.timing, info, now, this.penalties());
    if (this.garage.open) this.garage.update(this.timing, info);
    if (this.ctx.stage === "qualifying") this.updateQualifying();
    else if (!this.finished && this.playerDone()) this.raceFinished();
  }

  private penalties(): string[] {
    return this.timing.map((row) =>
      penaltyBadge(this.ctx.engine.stewardCar(row.index)),
    );
  }

  private playerDone(): boolean {
    const mine = this.timing[0];
    return mine ? mine.finished || mine.retired : false;
  }

  private updateQualifying(): void {
    const { engine, pit, sound } = this.ctx;
    const info = engine.session();
    const running = info.phase === sessionPhase.running;
    if (pit.atGarage && !this.garage.open && running) {
      sound.mute(true);
      engine.playerInGarage(true);
      this.setGarageOpen(true);
    }
    if (info.phase === sessionPhase.complete && this.ctx.resultsRoot.hidden)
      this.segmentResults();
  }

  private setScale(value: number): void {
    this.scale = value;
    this.ctx.engine.timeScale(value);
  }

  private setGarageOpen(open: boolean): void {
    if (open) {
      this.garage.show();
      this.garage.update(this.ctx.engine.timing(), this.ctx.engine.session());
    } else this.garage.hide();
    this.ctx.hudRoot.hidden = open;
  }

  private enterGarage(): void {
    const { pit, engine, sound } = this.ctx;
    pit.startInGarage();
    engine.playerInGarage(true);
    engine.setPitCompound(0);
    sound.mute(true);
    this.setGarageOpen(true);
  }

  private leaveGarage(compound: number): void {
    const { engine, pit, sound, startFuel } = this.ctx;
    engine.setPitCompound(compound);
    engine.pitService(startFuel, true);
    engine.playerInGarage(false);
    this.setScale(1);
    this.setGarageOpen(false);
    pit.goToTrack();
    sound.mute(false);
  }

  private leaveToMenu(): void {
    saveWeekend(null);
    this.ctx.restart(false);
  }

  private segmentResults(): void {
    const { engine, field, trackLabel, restart } = this.ctx;
    const info = engine.session();
    const name = segmentNames[info.segment] ?? "Q";
    const next = segmentNames[info.segment + 1];
    this.setGarageOpen(false);
    this.setScale(1);
    this.timing = engine.timing();
    showClassification(
      `${trackLabel} - Qualifying`,
      `${name} Results`,
      field.entrants,
      this.timing,
      "qualifying",
      info.segment,
      this.penalties(),
      [
        {
          label: next ? `Advance To ${next}` : "Advance To Grid",
          run: () => {
            this.advanceSegment();
          },
        },
        {
          label: "Restart Qualifying",
          run: () => {
            saveWeekend(null);
            restart(true);
          },
        },
        {
          label: "Main Menu",
          run: () => {
            this.leaveToMenu();
          },
        },
      ],
    );
  }

  private advanceSegment(): void {
    const result = this.ctx.engine.advanceSession();
    this.timing = this.ctx.engine.timing();
    if (result === 2) {
      this.finishQualifying();
      return;
    }
    hideClassification();
    this.enterGarage();
  }

  private finishQualifying(): void {
    const { field, trackLabel, settings, restart } = this.ctx;
    const codeOf = (index: number) => field.entrants[index]?.code ?? "";
    const codes = this.ctx.engine.grid().map(codeOf);
    const times = new Map(
      this.timing.map((row) => [codeOf(row.index), row.best]),
    );
    hideClassification();
    void showGrid(
      `${trackLabel} - Qualifying Result`,
      field.entrants,
      codes,
      times,
    ).then(() => {
      if (settings.session === "weekend") {
        saveWeekend({ stage: "race", grid: codes });
        restart(true);
      } else this.leaveToMenu();
    });
  }

  private raceFinished(): void {
    const { engine, sound, field, trackLabel, restart } = this.ctx;
    this.finished = true;
    engine.autopilot(true);
    sound.mute(true);
    this.timing = engine.timing();
    showClassification(
      `${trackLabel} - Race`,
      "Race Result",
      field.entrants,
      this.timing,
      "race",
      0,
      this.penalties(),
      [
        {
          label: "Restart Race",
          run: () => {
            restart(true);
          },
        },
        {
          label: "Main Menu",
          run: () => {
            this.leaveToMenu();
          },
        },
      ],
    );
    window.setInterval(() => {
      this.timing = engine.timing();
      updateClassificationRows(field.entrants, this.timing, this.penalties());
    }, resultsRefresh);
  }
}
