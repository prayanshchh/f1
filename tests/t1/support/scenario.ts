import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  Input,
  WorldSetup,
} from "../../../apps/client/src/contracts/index.ts";
import { releaseExecutable } from "../../support/cargo.ts";

interface Segment {
  fromTick: number;
  cars: Input[];
}

export interface Scenario {
  name: string;
  setup: WorldSetup;
  ticks: number;
  inputs: Segment[];
}

export const channelNames = [
  "time",
  "speed",
  "throttle",
  "brake",
  "steer",
  "lap",
  "lapDistance",
  "x",
  "y",
  "z",
] as const;

type ChannelName = (typeof channelNames)[number];

interface CarTelemetry {
  id: number;
  channels: Record<ChannelName, number[]>;
}

export interface Telemetry {
  name: string;
  hz: number;
  cars: CarTelemetry[];
  finalHash: string;
}

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function buildScenarioRunner(): string {
  return releaseExecutable(["--bin", "scenario"]);
}

export function runScenarioFile(
  executable: string,
  args: readonly string[],
): CliResult {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function withScenarioFile<T>(
  content: string,
  action: (file: string) => T,
): T {
  const directory = mkdtempSync(path.join(tmpdir(), "scenario-"));
  try {
    const file = path.join(directory, "scenario.json");
    writeFileSync(file, content);
    return action(file);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function runScenario(executable: string, scenario: Scenario): Telemetry {
  return withScenarioFile(JSON.stringify(scenario), (file) => {
    const result = runScenarioFile(executable, ["run", file]);
    if (result.code !== 0) {
      throw new Error(
        `scenario run exited with ${String(result.code)}: ${result.stderr}`,
      );
    }
    return JSON.parse(result.stdout) as Telemetry;
  });
}

export function inputsAt(scenario: Scenario, tick: number): Input[] {
  const active = scenario.inputs.filter(
    (segment) => segment.fromTick <= Math.min(tick, scenario.ticks - 1),
  );
  const segment = active.at(-1);
  if (segment === undefined) {
    throw new Error(`no input segment covers tick ${String(tick)}`);
  }
  return segment.cars;
}
