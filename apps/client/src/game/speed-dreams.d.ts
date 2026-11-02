declare module "*/wasm/speed-dreams.js" {
  export interface SpeedDreamsModule {
    HEAPF64: Float64Array;
    HEAPF32: Float32Array;
    cwrap(
      name: "sdInit",
      returns: "number",
      args: ["string", "string", "string", "string", "number"],
    ): (
      category: string,
      track: string,
      race: string,
      car: string,
      now: number,
    ) => number;
    cwrap(
      name: "sdFieldAdd",
      returns: null,
      args: [
        "string",
        "string",
        "string",
        "number",
        "number",
        "number",
        "number",
        "number",
        "number",
      ],
    ): (
      name: string,
      code: string,
      team: string,
      teamIndex: number,
      seat: number,
      slot: number,
      speed: number,
      raceSpeed: number,
      racecraft: number,
    ) => void;
    cwrap(
      name: "sdCarParamStr",
      returns: "string",
      args: ["string", "string"],
    ): (path: string, key: string) => string;
    cwrap(
      name: "sdCarParamNum",
      returns: "number",
      args: ["string", "string", "number"],
    ): (path: string, key: string, fallback: number) => number;
    cwrap(
      name: "sdCarLimits",
      returns: "number",
      args: ["string", "string", "string", "string", "number"],
    ): (
      car: string,
      path: string,
      key: string,
      unit: string,
      out: number,
    ) => number;
    cwrap(
      name: "sdCarParamCount",
      returns: "number",
      args: ["string"],
    ): (path: string) => number;
    _sdFieldClear(): void;
    _sdFieldPlayer(teamIndex: number, seat: number, slot: number): void;
    _sdFieldAutopilot(on: number): void;
    _sdFieldPlayerBox(): number;
    _sdFieldPlan(
      index: number,
      speed: number,
      raceSpeed: number,
      power: number,
    ): void;
    _sdFieldRun(index: number, segment: number, at: number): void;
    _sdFieldStint(index: number, compound: number, from: number): void;
    _sdSessionConfigure(
      kind: number,
      laps: number,
      lengthScale: number,
      difficulty: number,
      seed: number,
    ): void;
    _sdSessionReference(lap: number): void;
    _sdSessionInfo(out: number): void;
    _sdAiPlayerLaneClear: () => number;
    _sdSessionAdvance(): number;
    _sdSessionSimulate(): void;
    _sdSessionPlayerGarage(on: number): void;
    _sdSessionPitCompound(compound: number): void;
    _sdQualifyingTimes(index: number, out: number): void;
    _sdTiming(out: number): void;
    _sdSessionGrid(out: number): number;
    _sdStewardsLights(interval: number): void;
    _sdStewardsMessages(out: number, max: number, after: number): number;
    _sdStewardsCar(index: number, out: number): void;
    _sdStewardsFlags(out: number, max: number): number;
    _sdCars(out: number): void;
    _sdTimeScale(scale: number): void;
    _sdKey(key: number, state: number): void;
    _sdUpdate(now: number): number;
    _sdStep(count: number): number;
    _sdFrame(): number;
    _sdTrackLength(): number;
    _sdTrackLocal2Global(
      toStart: number,
      toMiddle: number,
      out: number,
    ): number;
    _sdTrackInfo(out: number): void;
    _sdCarInfo(out: number): void;
    _sdTelemetry(out: number): void;
    _sdHudInfo(out: number): void;
    _sdAudio(out: number): void;
    _sdTrackSectors(out: number, max: number): number;
    _sdInputAssist(on: number): void;
    _sdRaceCountdown(seconds: number): void;
    _sdInputAntiLock(on: number): void;
    _sdInputSpeedLimit(metresPerSecond: number): void;
    _sdInputSteerDirect(on: number): void;
    _sdInputPitHold(on: number): void;
    _sdPitService(fuel: number, frontWing: number): void;
    _sdInputAnalog(
      active: number,
      steer: number,
      throttle: number,
      brake: number,
    ): void;
    _sdTyresConfigure(compound: number, scale: number): void;
    _sdTyresInfo(out: number): void;
    _sdEnergyConfigure(
      race: number,
      mode: number,
      mix: number,
      assist: number,
    ): void;
    _sdEnergyMode(mode: number): void;
    _sdEnergyFuelMix(mix: number): void;
    _sdEnergyOvertake(armed: number): void;
    _sdEnergyBrakeBias(share: number): void;
    _sdEnergyInfo(out: number): void;
    _sdCarStatus(out: number): void;
    _sdEnergyDifferential(percent: number): void;
    _sdEnergyStraight(assisted: number, armed: number): void;
    _sdCarName(): number;
    _sdViewKey(key: number, ctrl: number): number;
    _sdViewResize(width: number, height: number): void;
    UTF8ToString(pointer: number): string;
    _malloc(size: number): number;
    _free(pointer: number): void;
    FS: {
      readFile(path: string, options: { encoding: "utf8" }): string;
      writeFile(path: string, data: string): void;
      analyzePath(path: string): { exists: boolean };
      mkdirTree(path: string): void;
    };
  }
  export default function createSpeedDreams(options?: {
    print?: (text: string) => void;
    printErr?: (text: string) => void;
  }): Promise<SpeedDreamsModule>;
}
