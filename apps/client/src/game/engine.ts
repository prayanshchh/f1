import createSpeedDreams, {
  type SpeedDreamsModule,
} from "../../wasm/speed-dreams.js";
import type { CarInfo } from "./car.ts";
import type { SetupSource } from "./settings.ts";
import type { TrackLocal } from "./sky.ts";

export const frameIndex = {
  time: 0,
  posMat: 1,
  wheels: 17,
  speed: 45,
  rpm: 46,
  rpmRedLine: 47,
  gear: 48,
  laps: 49,
  curLapTime: 50,
  lastLapTime: 51,
  bestLapTime: 52,
  distFromStart: 53,
  toMiddle: 54,
  steer: 55,
  accel: 56,
  brake: 57,
  raceState: 58,
  dammage: 59,
  camera: 60,
  brakeTemp: 84,
  size: 88,
} as const;

export interface HudInfo {
  fuel: number;
  tank: number;
  damage: number;
  maxDamage: number;
  state: number;
  totalLaps: number;
  tyreTemp: number[];
  tyreOptimal: number[];
  tyreCondition: number[];
  tyreTread: number[];
}

export const outOfRaceState = 0x0400 | 0x0200 | 0x0004 | 0x0008 | 0x0010;

export async function loadSpeedDreams(): Promise<SpeedDreamsModule> {
  return createSpeedDreams({
    print: () => undefined,
    printErr: () => undefined,
  });
}

export function setupSource(module: SpeedDreamsModule): SetupSource {
  const limits = module.cwrap("sdCarLimits", "number", [
    "string",
    "string",
    "string",
    "string",
    "number",
  ]);
  return {
    fs: module.FS,
    limits: (car, path, key, unit) => {
      const pointer = module._malloc(24);
      const found = limits(car, path, key, unit, pointer) !== 0;
      const [value = 0, min = 0, max = 0] = Array.from(
        new Float64Array(module.HEAPF64.buffer, pointer, 3),
      );
      module._free(pointer);
      return found ? { value, min, max } : null;
    },
  };
}

export class Engine {
  private constructor(private readonly module: SpeedDreamsModule) {}

  static start(
    module: SpeedDreamsModule,
    category: string,
    track: string,
    car: string,
    assist: boolean,
    now: number,
  ): Engine {
    module._sdInputAssist(assist ? 1 : 0);
    const init = module.cwrap("sdInit", "number", [
      "string",
      "string",
      "string",
      "string",
      "number",
    ]);
    const status = init(
      category,
      track,
      "config/raceman/quickrace.xml",
      car,
      now,
    );
    if (status !== 0) {
      throw new Error(
        `Speed Dreams failed to start the race (${String(status)})`,
      );
    }
    return new Engine(module);
  }

  viewKey(code: number, ctrl: boolean): boolean {
    return this.module._sdViewKey(code, ctrl ? 1 : 0) !== 0;
  }

  viewResize(width: number, height: number): void {
    this.module._sdViewResize(Math.round(width), Math.round(height));
  }

  analog(
    input: { steer: number; throttle: number; brake: number } | null,
  ): void {
    if (input)
      this.module._sdInputAnalog(1, input.steer, input.throttle, input.brake);
    else this.module._sdInputAnalog(0, 0, 0, 0);
  }

  key(code: number, down: boolean): void {
    this.module._sdKey(code, down ? 1 : 0);
  }

  update(now: number): Float64Array {
    this.module._sdUpdate(now);
    return this.frame();
  }

  frame(): Float64Array {
    return new Float64Array(
      this.module.HEAPF64.buffer,
      this.module._sdFrame(),
      frameIndex.size,
    );
  }

  private doubles(count: number, fill: (pointer: number) => void): number[] {
    const pointer = this.module._malloc(count * 8);
    fill(pointer);
    const values = Array.from(
      new Float64Array(this.module.HEAPF64.buffer, pointer, count),
    );
    this.module._free(pointer);
    return values;
  }

  trackLocal(): TrackLocal {
    const v = this.doubles(10, (p) => {
      this.module._sdTrackInfo(p);
    });
    const at = (i: number) => v[i] ?? 0;
    return {
      timeOfDay: at(0),
      sunAscension: at(1),
      rain: at(2),
      visibility: at(3),
      worldX: at(7) - at(4) + 1,
      worldY: at(8) - at(5) + 1,
      worldZ: at(9) - at(6) + 1,
    };
  }

  carInfo(): CarInfo {
    const v = this.doubles(32, (p) => {
      this.module._sdCarInfo(p);
    });
    const at = (i: number) => v[i] ?? 0;
    const wheel = (k: number) => [0, 1, 2, 3].map((i) => at(i * 3 + k));
    const str = this.module.cwrap("sdCarParamStr", "string", [
      "string",
      "string",
    ]);
    const num = this.module.cwrap("sdCarParamNum", "number", [
      "string",
      "string",
      "number",
    ]);
    const count = this.module.cwrap("sdCarParamCount", "number", ["string"]);
    const objects = "Graphic Objects";
    const model = (section: string, key: string) =>
      str(`${objects}/${section}`, key);
    const gauge = (section: string, o: number) => {
      const file = model(section, "model");
      return file
        ? {
            model: file,
            xpos: at(o),
            ypos: at(o + 1),
            zpos: at(o + 2),
            angle: at(o + 3),
            minAngle: at(o + 4),
            factor: at(o + 5),
          }
        : null;
    };
    const steerModel = model("Steer Wheel", "model");
    const drivers = Array.from(
      { length: count(`${objects}/Driver`) },
      (_, i) => {
        const path = `${objects}/Driver/${String(i + 1)}`;
        return {
          model: str(path, "driver"),
          xpos: num(path, "xpos", 0),
          ypos: num(path, "ypos", 0),
          zpos: num(path, "zpos", 0),
          angle: 0,
        };
      },
    );
    const wheel3d = str(objects, "3d wheel") || "wheel";
    return {
      name: this.module.UTF8ToString(this.module._sdCarName()),
      wheelRadius: wheel(0),
      tireWidth: wheel(1),
      brakeDiskRadius: wheel(2),
      steerWheelRot: at(12),
      steerWheel: steerModel
        ? {
            model: steerModel,
            xpos: at(13),
            ypos: at(14),
            zpos: at(15),
            angle: at(16),
          }
        : null,
      drivers: drivers.filter((driver) => driver.model !== ""),
      speedometer: gauge("Speedometer Needle", 20),
      tachometer: gauge("Tachometer Needle", 26),
      frontWheel: str(objects, "3d front wheel") || wheel3d,
      rearWheel: str(objects, "3d rear wheel") || wheel3d,
    };
  }

  hudInfo(): HudInfo {
    const v = this.doubles(22, (p) => {
      this.module._sdHudInfo(p);
    });
    const at = (i: number) => v[i] ?? 0;
    const wheels = (o: number) => [0, 1, 2, 3].map((i) => at(o + i));
    return {
      fuel: at(0),
      tank: at(1),
      damage: at(2),
      maxDamage: at(3),
      state: at(4),
      totalLaps: at(5),
      tyreTemp: wheels(6),
      tyreOptimal: wheels(10),
      tyreCondition: wheels(14),
      tyreTread: wheels(18),
    };
  }

  trackLength(): number {
    return this.module._sdTrackLength();
  }

  sectorBoundaries(): number[] {
    const pointer = this.module._malloc(16 * 8);
    const count = this.module._sdTrackSectors(pointer, 16);
    const values = Array.from(
      new Float64Array(this.module.HEAPF64.buffer, pointer, count),
    );
    this.module._free(pointer);
    const length = this.trackLength();
    return values.filter((d) => d > 0 && d < length).sort((a, b) => a - b);
  }

  trackPoint(toStart: number, toMiddle: number): [number, number, number] {
    const out = this.module._malloc(12);
    this.module._sdTrackLocal2Global(toStart, toMiddle, out);
    const point = new Float32Array(this.module.HEAPF32.buffer, out, 3);
    const result: [number, number, number] = [
      point[0] ?? 0,
      point[1] ?? 0,
      point[2] ?? 0,
    ];
    this.module._free(out);
    return result;
  }
}
